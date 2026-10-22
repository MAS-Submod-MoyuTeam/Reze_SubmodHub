package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

// manifestServer serves rezehub.yml plus the archives it points at, and counts
// archive downloads so a cached sync can prove it did no work.
func manifestServer(t *testing.T, manifest func(base string) string) (*httptest.Server, *int) {
	t.Helper()
	downloads := 0
	archive := createTestZip(t, "init python:\n    pass\n")
	mux := http.NewServeMux()
	mux.HandleFunc("/octocat/hello/HEAD/"+github.ManifestFileName, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(manifest("http://" + r.Host)))
	})
	mux.HandleFunc("/downloads/", func(w http.ResponseWriter, r *http.Request) {
		downloads++
		_, _ = w.Write(archive)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, &downloads
}

func newManifestStore(t *testing.T, server *httptest.Server) *Store {
	t.Helper()
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "mod_manifest", Category: "submod", SourceType: "github_releases",
		GitHubOwner: "octocat", GitHubRepo: "hello", GitHubManifest: true,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	return store
}

func manifestBody(base string, versions ...string) string {
	var b strings.Builder
	b.WriteString("schema: 1\nreleases:\n")
	for _, v := range versions {
		fmt.Fprintf(&b, "  - version: %q\n    url: %s/downloads/%s.zip\n    notes: release %s\n", v, base, v, v)
	}
	return b.String()
}

func TestManifestSyncImportsDeclaredReleasesWithoutAPIAccess(t *testing.T) {
	server, downloads := manifestServer(t, func(base string) string {
		return manifestBody(base, "1.0.0", "1.1.0")
	})
	store := newManifestStore(t, server)

	summary, err := store.SyncMod(context.Background(), "mod_manifest")
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if summary.Created != 2 || summary.Failed != 0 {
		t.Fatalf("summary = %+v", summary)
	}
	if *downloads != 2 {
		t.Fatalf("downloads = %d, want 2", *downloads)
	}
	mod := store.Catalog.Mods[0]
	if mod.GitHubManifestDigest == "" {
		t.Fatal("manifest digest was not recorded")
	}
	if mod.GitHubLastSyncError != "" {
		t.Fatalf("unexpected sync error: %s", mod.GitHubLastSyncError)
	}
	versions := map[string]Version{}
	for _, v := range store.Catalog.Versions {
		versions[v.Version] = v
	}
	for _, want := range []string{"1.0.0", "1.1.0"} {
		v, ok := versions[want]
		if !ok {
			t.Fatalf("version %s was not imported; have %v", want, versions)
		}
		if v.State != "ready_for_review" {
			t.Fatalf("version %s state = %q", want, v.State)
		}
		if v.GitHubSource == nil || v.GitHubSource.DownloadURL == "" {
			t.Fatalf("version %s lost its upstream provenance", want)
		}
	}
	if versions["1.1.0"].ReleaseNotes != "release 1.1.0" {
		t.Fatalf("manifest notes were dropped: %q", versions["1.1.0"].ReleaseNotes)
	}

	// Second pass: the digest is unchanged, so nothing is downloaded again.
	again, err := store.SyncMod(context.Background(), "mod_manifest")
	if err != nil {
		t.Fatalf("resync: %v", err)
	}
	if again.Created != 0 || again.Skipped != 0 {
		t.Fatalf("unchanged manifest should be a no-op, got %+v", again)
	}
	if *downloads != 2 {
		t.Fatalf("unchanged manifest re-downloaded archives: %d", *downloads)
	}
}

func TestManifestSyncImportsOnlyNewEntries(t *testing.T) {
	versions := []string{"1.0.0"}
	server, downloads := manifestServer(t, func(base string) string {
		return manifestBody(base, versions...)
	})
	store := newManifestStore(t, server)

	if _, err := store.SyncMod(context.Background(), "mod_manifest"); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	versions = []string{"1.0.0", "1.1.0"}
	summary, err := store.SyncMod(context.Background(), "mod_manifest")
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if summary.Created != 1 || summary.Skipped != 1 {
		t.Fatalf("summary = %+v", summary)
	}
	// Only the new archive is fetched; the already-imported version is skipped
	// before any download starts.
	if *downloads != 2 {
		t.Fatalf("downloads = %d, want 2", *downloads)
	}
}

func TestManifestSyncRejectsHashMismatch(t *testing.T) {
	server, _ := manifestServer(t, func(base string) string {
		return fmt.Sprintf("schema: 1\nreleases:\n  - version: \"1.0.0\"\n    url: %s/downloads/1.0.0.zip\n    sha256: %s\n",
			base, strings.Repeat("0", 64))
	})
	store := newManifestStore(t, server)

	summary, err := store.SyncMod(context.Background(), "mod_manifest")
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if summary.Failed != 1 {
		t.Fatalf("summary = %+v", summary)
	}
	if !strings.Contains(summary.LastError, "download_hash_mismatch") {
		t.Fatalf("last error = %q", summary.LastError)
	}
	if len(store.Catalog.Versions) != 0 {
		t.Fatalf("a rejected archive must not become a version: %+v", store.Catalog.Versions)
	}
}

func TestManifestSyncSurfacesMissingManifest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	store := newManifestStore(t, server)

	summary, err := store.SyncMod(context.Background(), "mod_manifest")
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if summary.Failed != 1 || !strings.Contains(summary.LastError, github.ManifestFileName) {
		t.Fatalf("summary = %+v", summary)
	}
	if store.Catalog.Mods[0].GitHubLastSyncError == "" {
		t.Fatal("the missing manifest must be recorded on the mod")
	}
}

func TestPassiveSyncHonoursMaxAgeAndMode(t *testing.T) {
	lastSync := time.Now().UTC().Add(-time.Minute)
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{
		{ID: "due", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "hello"},
		{ID: "fresh", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "hello", GitHubLastSyncAt: &lastSync},
		{ID: "local", SourceType: "local"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	store.GitHubSyncMaxAge = 10 * time.Minute

	if !store.syncDueLocked(store.Catalog.Mods[0], now) {
		t.Fatal("a never-synced mod is due")
	}
	if store.syncDueLocked(store.Catalog.Mods[1], now) {
		t.Fatal("a mod synced inside the max-age window is not due")
	}
	if store.syncDueLocked(store.Catalog.Mods[2], now) {
		t.Fatal("local mods are never refreshed")
	}

	// Outside the window the mod becomes due again.
	store.GitHubSyncMaxAge = 30 * time.Second
	if !store.syncDueLocked(store.Catalog.Mods[1], now) {
		t.Fatal("a mod older than the max-age window is due")
	}

	// Zero disables passive refresh entirely: only the explicit action remains.
	store.GitHubSyncMaxAge = 0
	if store.syncDueLocked(store.Catalog.Mods[0], now) {
		t.Fatal("max-age=0 must disable passive refresh")
	}
	if store.MaybeSyncGitHubMod("due") {
		t.Fatal("MaybeSyncGitHubMod must stay inert with max-age=0")
	}
}

func TestPassiveSyncSkipsModsAlreadyInFlight(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{
		{ID: "busy", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "hello"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubSyncMaxAge = 10 * time.Minute
	store.simultaneousSyncs["busy"] = true
	if store.MaybeSyncGitHubMod("busy") {
		t.Fatal("a mod that is already syncing must not start a second refresh")
	}
}

func TestManifestSyncRetriesFailuresWithoutRollingBackLatest(t *testing.T) {
	for _, force := range []bool{false, true} {
		t.Run(fmt.Sprintf("force=%t", force), func(t *testing.T) {
			archive := createTestZip(t, "init python:\n    pass\n")
			oldAttempts := 0
			newAttempts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/octocat/hello/HEAD/" + github.ManifestFileName:
					fmt.Fprint(w, manifestBody("http://"+r.Host, "1.0.0", "1.1.0"))
				case "/downloads/1.0.0.zip":
					oldAttempts++
					if oldAttempts <= 2 {
						http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
						return
					}
					_, _ = w.Write(archive)
				case "/downloads/1.1.0.zip":
					newAttempts++
					_, _ = w.Write(archive)
				default:
					t.Errorf("unexpected request: %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			store := newManifestStore(t, server)
			store.AutoPublish = true
			for attempt := 0; attempt < 3; attempt++ {
				summary, err := store.syncMod(context.Background(), "mod_manifest", force)
				if err != nil {
					t.Fatal(err)
				}
				if attempt < 2 {
					if summary.Failed != 1 || store.Catalog.Mods[0].GitHubLastSyncError == "" {
						t.Fatalf("attempt %d lost failure: %+v", attempt, summary)
					}
				} else if summary.Created != 1 || summary.Failed != 0 || store.Catalog.Mods[0].GitHubLastSyncError != "" {
					t.Fatalf("retry failed: %+v", summary)
				}
				latest := store.Catalog.Versions[store.Catalog.Mods[0].LatestVersionID]
				if latest.Version != "1.1.0" {
					t.Fatalf("attempt %d latest = %q", attempt, latest.Version)
				}
			}
			if oldAttempts != 3 || newAttempts != 1 {
				t.Fatalf("download attempts old=%d new=%d", oldAttempts, newAttempts)
			}
			if _, err := store.SyncMod(context.Background(), "mod_manifest"); err != nil {
				t.Fatal(err)
			}
			if oldAttempts != 3 || newAttempts != 1 {
				t.Fatal("successful unchanged manifest downloaded archives again")
			}
		})
	}
}

func TestManifestSyncBypassesAPIBackoff(t *testing.T) {
	server, downloads := manifestServer(t, func(base string) string {
		return manifestBody(base, "1.0.0")
	})
	store := newManifestStore(t, server)
	store.GitHubSyncMaxAge = time.Minute
	deadline := time.Now().UTC().Add(time.Hour)
	store.gitHubBackoffUntil = deadline
	store.Catalog.Mods[0].GitHubBackoffUntil = &deadline
	apiMod := Mod{ID: "api", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "hello"}
	store.Catalog.Mods = append(store.Catalog.Mods, apiMod)
	if !store.syncDueLocked(store.Catalog.Mods[0], time.Now()) {
		t.Fatal("API backoff suppressed passive manifest refresh")
	}
	if store.syncDueLocked(apiMod, time.Now()) {
		t.Fatal("API mode must honour global backoff")
	}
	results := store.SyncAllGitHubMods(context.Background())
	if results["mod_manifest"] == nil || results["mod_manifest"].Created != 1 || *downloads != 1 {
		t.Fatalf("manifest did not sync during API backoff: %+v", results)
	}
	if results["api"] == nil || results["api"].Failed != 1 {
		t.Fatal("batch sync must still suppress API requests during backoff")
	}
	store.gitHubBackoffUntil = time.Time{}
	apiMod.GitHubBackoffUntil = &deadline
	if store.syncDueLocked(apiMod, time.Now()) {
		t.Fatal("API mode must honour per-mod backoff")
	}
	if store.syncDueLocked(store.Catalog.Mods[0], time.Now()) {
		t.Fatal("manifest mode must still honour max-age")
	}
}

func TestValidateSourceConfigAllowsManifestWithoutAssetRegex(t *testing.T) {
	manifest := sourceConfigInput{
		SourceType: "github_releases",
		Owner:      "octocat",
		Repo:       "hello",
		Manifest:   true,
	}
	if err := validateSourceConfig(manifest); err != nil {
		t.Fatalf("manifest mode must not demand an asset regex: %v", err)
	}
	if err := validateSourceConfig(sourceConfigInput{
		SourceType: "github_releases", Owner: "octocat", Repo: "hello",
	}); err == nil {
		t.Fatal("API mode still requires an asset regex or the source-code fallback")
	}
	// The regex is optional in manifest mode, but a broken one is still rejected.
	manifest.AssetRegex = "[invalid"
	if err := validateSourceConfig(manifest); err == nil {
		t.Fatal("an invalid regex must be rejected even in manifest mode")
	}
}
