package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// notifyStore builds a store whose GitHub sync window is live, so staleness is
// decided by github_last_sync_at alone rather than by a disabled sweep.
func notifyStore(t *testing.T) *Store {
	t.Helper()
	recent := time.Now().UTC()
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:               "mod_bound",
				Title:            "Bound Mod",
				SourceType:       "github_releases",
				GitHubOwner:      "Reze",
				GitHubRepo:       "Reze_SubmodHub",
				GitHubAssetRegex: `.*\.zip`,
				GitHubLastSyncAt: &recent,
			},
			{
				ID:          "mod_local",
				Title:       "Local Mod",
				SourceType:  "local",
				GitHubOwner: "Reze",
				GitHubRepo:  "Reze_SubmodHub",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubSyncMaxAge = time.Hour
	return store
}

// lookupMod reads one mod copy under the store lock; the notification mutates
// github_last_sync_at, so every assertion here has to re-read it.
func lookupMod(store *Store, id string) *Mod {
	store.mu.RLock()
	defer store.mu.RUnlock()
	for i := range store.Catalog.Mods {
		if store.Catalog.Mods[i].ID == id {
			m := store.Catalog.Mods[i]
			return &m
		}
	}
	return nil
}

func postNotify(t *testing.T, server *httptest.Server, body string) *http.Response {
	t.Helper()
	res, err := server.Client().Post(server.URL+"/api/v1/github-release-notify", "application/json", bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// The notification is the only signal the hub cannot poll for, so its whole job
// is turning "release published" into "this mod is due", not into a download.
func TestGitHubReleaseNotifyMarksBoundModStale(t *testing.T) {
	store := notifyStore(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res := postNotify(t, server, `{"owner":"reze","repo":"reze_submodhub","version":"v1.2.3"}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", res.StatusCode)
	}

	snapshot := lookupMod(store, "mod_bound")
	if snapshot == nil {
		t.Fatal("bound mod disappeared")
	}
	if snapshot.GitHubLastSyncAt != nil {
		t.Fatalf("expected github_last_sync_at to be cleared, got %v", *snapshot.GitHubLastSyncAt)
	}
	// A local mod that happens to name the same repository is not GitHub-backed;
	// the notification must not touch it.
	local := lookupMod(store, "mod_local")
	if local == nil {
		t.Fatal("local mod disappeared")
	}

	// Marked stale means the existing sweep picks it up on its next pass, which
	// is the only sync path this endpoint is allowed to trigger.
	store.mu.RLock()
	due := store.syncDueLocked(*snapshot, time.Now().UTC())
	store.mu.RUnlock()
	if !due {
		t.Fatal("expected the notified mod to be due for the next sweep")
	}
}

// A workflow generated for a source-only repository carries no patterns, only
// the fallback flag. That is a complete rule set for this endpoint: rejecting it
// would make the notification unusable exactly where no asset name exists.
func TestGitHubReleaseNotifyAcceptsSourceArchiveRules(t *testing.T) {
	store := notifyStore(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res := postNotify(t, server, `{"owner":"reze","repo":"reze_submodhub","version":"v2.0.0","rules":{"shared_source_code":true}}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", res.StatusCode)
	}
	if snapshot := lookupMod(store, "mod_bound"); snapshot == nil || snapshot.GitHubLastSyncAt != nil {
		t.Fatal("a source-only notification must still mark the mod stale")
	}
}

// An unbound repository must be indistinguishable from a typo: same status, no
// catalog detail in the response, and no state change.
func TestGitHubReleaseNotifyDropsUnboundRepository(t *testing.T) {
	store := notifyStore(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res := postNotify(t, server, `{"owner":"someone","repo":"else"}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res.StatusCode)
	}

	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("expected a JSON error body: %v", err)
	}
	if payload["code"] != "not_found" {
		t.Fatalf("expected not_found code, got %v", payload["code"])
	}

	if snapshot := lookupMod(store, "mod_bound"); snapshot == nil || snapshot.GitHubLastSyncAt == nil {
		t.Fatal("an unbound notification must not clear a bound mod's sync time")
	}
}
