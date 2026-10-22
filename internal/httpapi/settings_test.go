package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

func createTestStoreWithAdmin(t *testing.T) (*Store, *http.Cookie, string, *http.Cookie, string) {
	t.Helper()
	dataDir := t.TempDir()
	store, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}

	adminToken := strings.Repeat("a", 64)
	userToken := strings.Repeat("b", 64)
	adminSessionKey := sessionKey(adminToken)
	userSessionKey := sessionKey(userToken)

	store.sessions[adminSessionKey] = authSession{
		User:    authUser{ID: "flarum:1", Username: "admin_user", DisplayName: "Admin"},
		Roles:   []string{"admin"},
		CSRF:    "admin-csrf-token",
		Expires: time.Now().Add(24 * time.Hour),
	}
	store.sessions[userSessionKey] = authSession{
		User:    authUser{ID: "flarum:2", Username: "normal_user", DisplayName: "User"},
		Roles:   []string{"author"},
		CSRF:    "user-csrf-token",
		Expires: time.Now().Add(24 * time.Hour),
	}

	adminCookie := &http.Cookie{Name: "submodhub_session", Value: adminToken}
	userCookie := &http.Cookie{Name: "submodhub_session", Value: userToken}

	return store, adminCookie, "admin-csrf-token", userCookie, "user-csrf-token"
}

func TestAdminSettingsAuthAndPermissions(t *testing.T) {
	store, adminCookie, adminCSRF, userCookie, userCSRF := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// 1. GET anonymous -> 401
	res, err := http.Get(server.URL + "/api/v1/admin/settings")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 401 {
		t.Fatalf("expected 401 for anonymous GET, got %d", res.StatusCode)
	}

	// 2. GET user -> 403
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/admin/settings", nil)
	req.AddCookie(userCookie)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 403 {
		t.Fatalf("expected 403 for normal user GET, got %d", res.StatusCode)
	}

	// 3. GET admin -> 200, empty template, revision 0
	req, _ = http.NewRequest(http.MethodGet, server.URL+"/api/v1/admin/settings", nil)
	req.AddCookie(adminCookie)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 {
		t.Fatalf("expected 200 for admin GET, got %d", res.StatusCode)
	}
	var getPayload struct {
		GitHubProxyTemplate string `json:"github_proxy_template"`
		Revision            uint64 `json:"revision"`
	}
	if err := json.NewDecoder(res.Body).Decode(&getPayload); err != nil {
		t.Fatal(err)
	}
	if getPayload.GitHubProxyTemplate != "" || getPayload.Revision != 0 {
		t.Fatalf("expected empty template and revision 0, got %+v", getPayload)
	}

	// Helper for PATCH
	patchSettings := func(cookie *http.Cookie, csrf, origin, body string) (*http.Response, error) {
		pReq, err := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/settings", strings.NewReader(body))
		if err != nil {
			return nil, err
		}
		pReq.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			pReq.AddCookie(cookie)
		}
		if csrf != "" {
			pReq.Header.Set("X-CSRF-Token", csrf)
		}
		if origin != "" {
			pReq.Header.Set("Origin", origin)
		}
		return http.DefaultClient.Do(pReq)
	}

	// 4. PATCH anonymous -> 401
	res, _ = patchSettings(nil, "", "", `{"github_proxy_template":"","revision":0}`)
	if res.StatusCode != 401 {
		t.Fatalf("expected 401 for anonymous PATCH, got %d", res.StatusCode)
	}

	// 5. PATCH user -> 403
	res, _ = patchSettings(userCookie, userCSRF, "", `{"github_proxy_template":"","revision":0}`)
	if res.StatusCode != 403 {
		t.Fatalf("expected 403 for user PATCH, got %d", res.StatusCode)
	}

	// 6. PATCH admin without CSRF -> 403
	res, _ = patchSettings(adminCookie, "", "", `{"github_proxy_template":"","revision":0}`)
	if res.StatusCode != 403 {
		t.Fatalf("expected 403 for missing CSRF, got %d", res.StatusCode)
	}

	// 7. PATCH admin with cross-origin Origin header -> 403
	res, _ = patchSettings(adminCookie, adminCSRF, "https://evil.attacker.com", `{"github_proxy_template":"","revision":0}`)
	if res.StatusCode != 403 {
		t.Fatalf("expected 403 for cross-origin PATCH, got %d", res.StatusCode)
	}

	// 8. PATCH admin with unknown fields -> 400
	res, _ = patchSettings(adminCookie, adminCSRF, "", `{"github_proxy_template":"","revision":0,"unknown_field":"val"}`)
	if res.StatusCode != 400 {
		t.Fatalf("expected 400 for unknown field, got %d", res.StatusCode)
	}

	// 9. PATCH admin with invalid template -> 400
	res, _ = patchSettings(adminCookie, adminCSRF, "", `{"github_proxy_template":"http://proxy.example/{url}","revision":0}`)
	if res.StatusCode != 400 {
		t.Fatalf("expected 400 for invalid template (http), got %d", res.StatusCode)
	}

	// 10. PATCH admin with revision mismatch -> 409
	res, _ = patchSettings(adminCookie, adminCSRF, "", `{"github_proxy_template":"https://proxy.example/{url}","revision":999}`)
	if res.StatusCode != 409 {
		t.Fatalf("expected 409 for revision conflict, got %d", res.StatusCode)
	}
	res, _ = patchSettings(adminCookie, adminCSRF, "", `{"github_proxy_template":"100.106.239.85:7890","revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("expected 200 for HTTP proxy host:port, got %d", res.StatusCode)
	}
	res, _ = patchSettings(adminCookie, adminCSRF, "", `{"github_proxy_template":"","revision":1}`)
	if res.StatusCode != 200 {
		t.Fatalf("expected 200 clearing HTTP proxy, got %d", res.StatusCode)
	}

	// 11. PATCH admin valid -> 200, revision incremented to 3
	res, _ = patchSettings(adminCookie, adminCSRF, "", `{"github_proxy_template":"https://proxy.example/{url}","revision":2}`)
	if res.StatusCode != 200 {
		t.Fatalf("expected 200 for valid PATCH, got %d", res.StatusCode)
	}
	var patchResp struct {
		GitHubProxyTemplate string `json:"github_proxy_template"`
		Revision            uint64 `json:"revision"`
	}
	if err := json.NewDecoder(res.Body).Decode(&patchResp); err != nil {
		t.Fatal(err)
	}
	if patchResp.GitHubProxyTemplate != "https://proxy.example/{url}" || patchResp.Revision != 3 {
		t.Fatalf("unexpected patch response: %+v", patchResp)
	}

	// 12. PATCH admin clear template -> 200, revision incremented to 4
	res, _ = patchSettings(adminCookie, adminCSRF, "", `{"github_proxy_template":"","revision":3}`)
	if res.StatusCode != 200 {
		t.Fatalf("expected 200 for clearing template, got %d", res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(&patchResp); err != nil {
		t.Fatal(err)
	}
	if patchResp.GitHubProxyTemplate != "" || patchResp.Revision != 4 {
		t.Fatalf("unexpected patch response after clear: %+v", patchResp)
	}
}

func TestAdminSettingsPersistenceAndRestart(t *testing.T) {
	dataDir := t.TempDir()
	store, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}

	adminToken := strings.Repeat("c", 64)
	adminSessionKey := sessionKey(adminToken)
	store.sessions[adminSessionKey] = authSession{
		User:    authUser{ID: "flarum:1", Username: "admin", DisplayName: "Admin"},
		Roles:   []string{"admin"},
		CSRF:    "admin-csrf",
		Expires: time.Now().Add(24 * time.Hour),
	}
	adminCookie := &http.Cookie{Name: "submodhub_session", Value: adminToken}

	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// Update settings
	req, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/settings", strings.NewReader(`{"github_proxy_template":"https://proxy.example/{url}","revision":0}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", "admin-csrf")
	req.AddCookie(adminCookie)
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("patch settings failed: err=%v, code=%d", err, res.StatusCode)
	}

	// Reopen Store from disk (simulates server restart)
	restartedStore, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatalf("reopen store failed: %v", err)
	}

	if restartedStore.Catalog.Settings.GitHubProxyTemplate != "https://proxy.example/{url}" {
		t.Fatalf("expected persisted proxy template 'https://proxy.example/{url}', got %q", restartedStore.Catalog.Settings.GitHubProxyTemplate)
	}
	if restartedStore.Catalog.Settings.Revision != 1 {
		t.Fatalf("expected revision 1, got %d", restartedStore.Catalog.Settings.Revision)
	}
	if len(restartedStore.Catalog.SettingsAudit) != 1 {
		t.Fatalf("expected 1 settings audit entry, got %d", len(restartedStore.Catalog.SettingsAudit))
	}
	audit := restartedStore.Catalog.SettingsAudit[0]
	if audit.ActorID != "flarum:1" || audit.PreviousTemplate != "" || audit.NewTemplate != "https://proxy.example/{url}" || audit.Revision != 1 {
		t.Fatalf("unexpected audit entry: %+v", audit)
	}
}

func TestAdminSettingsSyncMaxAgeSaveFailureRollsBackRuntime(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	store.DataDir = filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(store.DataDir, []byte("block"), 0o600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	body := strings.NewReader(`{"github_sync_max_age":"90m","revision":0}`)
	req, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/settings", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", adminCSRF)
	req.AddCookie(adminCookie)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected storage failure, got %d", res.StatusCode)
	}
	if got := store.syncMaxAge(); got != defaultGitHubSyncMaxAge {
		t.Fatalf("runtime max age after failed save = %v, want %v", got, defaultGitHubSyncMaxAge)
	}
	if store.Catalog.Settings.GitHubSyncMaxAge != "" || store.Catalog.Settings.Revision != 0 {
		t.Fatalf("catalog changed after failed save: %+v", store.Catalog.Settings)
	}
}

func TestAdminSettingsSyncMaxAgeEnvironmentOverrideLocksOnlyWindow(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	pinned := 15 * time.Minute
	store.GitHubSyncMaxAge = pinned
	store.GitHubSyncMaxAgeOverride = &pinned
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	patch := func(body string) int {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/settings", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", adminCSRF)
		req.AddCookie(adminCookie)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		return res.StatusCode
	}

	if code := patch(`{"github_sync_max_age":"30m","revision":0}`); code != http.StatusConflict {
		t.Fatalf("window edit under env override got %d, want 409", code)
	}
	if got := store.syncMaxAge(); got != pinned {
		t.Fatalf("environment-pinned window changed to %v", got)
	}
	if code := patch(`{"github_proxy_template":"","revision":0}`); code != http.StatusOK {
		t.Fatalf("unrelated settings edit under env override got %d, want 200", code)
	}
}

func TestAdminSettingsSyncMaxAgeRoundTrip(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	patch := func(body string) (*http.Response, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/settings", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", adminCSRF)
		req.AddCookie(adminCookie)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var payload map[string]any
		_ = json.NewDecoder(res.Body).Decode(&payload)
		return res, payload
	}

	// The built-in default is 60 minutes, both at runtime and in the response.
	if got := store.syncMaxAge(); got != 60*time.Minute {
		t.Fatalf("default max age = %v, want 60m", got)
	}

	// A valid duration is stored in canonical form and applied immediately.
	res, payload := patch(`{"github_sync_max_age":"90m","revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	if payload["github_sync_max_age"] != "1h30m0s" {
		t.Fatalf("response max age = %v, want 1h30m0s", payload["github_sync_max_age"])
	}
	if got := store.syncMaxAge(); got != 90*time.Minute {
		t.Fatalf("runtime max age = %v, want 90m", got)
	}
	if store.Catalog.Settings.GitHubSyncMaxAge != "1h30m0s" {
		t.Fatalf("persisted max age = %q", store.Catalog.Settings.GitHubSyncMaxAge)
	}
	reloaded, err := NewStore(store.DataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.syncMaxAge(); got != 90*time.Minute {
		t.Fatalf("reloaded max age = %v, want 90m", got)
	}

	// "0" disables automatic refresh but keeps the stored value.
	res, payload = patch(`{"github_sync_max_age":"0","revision":1}`)
	if res.StatusCode != 200 || payload["github_sync_max_age"] != "0s" {
		t.Fatalf("disable failed: code=%d payload=%v", res.StatusCode, payload)
	}
	if got := store.syncMaxAge(); got != 0 {
		t.Fatalf("disabled max age = %v, want 0", got)
	}
	now := time.Now().UTC()
	fresh := now.Add(-time.Hour)
	mod := Mod{ID: "m", SourceType: "github_releases", GitHubLastSyncAt: &fresh}
	if store.syncDueLocked(mod, now) {
		t.Fatal("a disabled window must not mark mods stale")
	}

	// An empty value restores the default.
	res, payload = patch(`{"github_sync_max_age":"","revision":2}`)
	if res.StatusCode != 200 || payload["github_sync_max_age"] != "1h0m0s" {
		t.Fatalf("reset failed: code=%d payload=%v", res.StatusCode, payload)
	}
	if got := store.syncMaxAge(); got != 60*time.Minute {
		t.Fatalf("reset max age = %v, want 60m", got)
	}

	// Garbage and negative values are rejected without touching the state.
	for _, body := range []string{
		`{"github_sync_max_age":"soon","revision":3}`,
		`{"github_sync_max_age":"-5m","revision":3}`,
		`{"github_sync_max_age":"1000h","revision":3}`,
	} {
		res, _ := patch(body)
		if res.StatusCode != 400 {
			t.Fatalf("expected 400 for %s, got %d", body, res.StatusCode)
		}
	}
	if got := store.syncMaxAge(); got != 60*time.Minute {
		t.Fatalf("rejected values changed the window: %v", got)
	}
}

func TestSyncStaleGitHubModsSkipsFreshAndBackedOff(t *testing.T) {
	stale := time.Now().UTC().Add(-time.Hour)
	fresh := time.Now().UTC()
	backoff := time.Now().UTC().Add(time.Hour)
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{
		{ID: "stale", SourceType: "github_releases", GitHubOwner: "o", GitHubRepo: "r", GitHubLastSyncAt: &stale},
		{ID: "fresh", SourceType: "github_releases", GitHubOwner: "o", GitHubRepo: "r", GitHubLastSyncAt: &fresh},
		{ID: "backoff", SourceType: "github_releases", GitHubOwner: "o", GitHubRepo: "r", GitHubLastSyncAt: &stale, GitHubBackoffUntil: &backoff},
		{ID: "local", SourceType: "local"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubSyncMaxAge = 30 * time.Minute

	now := time.Now().UTC()
	due := map[string]bool{}
	for _, mod := range store.Catalog.Mods {
		if store.syncDueLocked(mod, now) {
			due[mod.ID] = true
		}
	}
	if len(due) != 1 || !due["stale"] {
		t.Fatalf("expected only the stale mod to be due, got %v", due)
	}
}

// TestGitHubSyncSweepRefreshesStaleMods proves the background loop is the second
// half of the contract: a mod nobody opens is still refreshed once its window
// lapses, and the sweep does not touch a mod that was just checked.
func TestGitHubSyncSweepRefreshesStaleMods(t *testing.T) {
	stale := time.Now().UTC().Add(-time.Hour)
	fresh := time.Now().UTC()
	var staleCalls, freshCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/repos/octocat/stale/"):
			staleCalls.Add(1)
		case strings.HasPrefix(r.URL.Path, "/repos/octocat/fresh/"):
			freshCalls.Add(1)
		}
		if strings.HasSuffix(r.URL.Path, "/releases") {
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, "[]")
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{
		{ID: "stale", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "stale", GitHubLastSyncAt: &stale},
		{ID: "fresh", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "fresh", GitHubLastSyncAt: &fresh},
	}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	store.GitHubSyncMaxAge = 30 * time.Minute

	previous := githubSyncSweepInterval
	githubSyncSweepInterval = 5 * time.Millisecond
	store.StartGitHubSync()
	time.Sleep(150 * time.Millisecond)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	githubSyncSweepInterval = previous

	if staleCalls.Load() == 0 {
		t.Fatal("the sweep never refreshed the stale mod")
	}
	if freshCalls.Load() != 0 {
		t.Fatalf("the sweep refreshed a fresh mod %d times", freshCalls.Load())
	}
}

// TestGitHubSyncSweepHonoursDisabledWindow proves the window is the only switch:
// disabling it stops the sweep without stopping the process.
func TestGitHubSyncSweepHonoursDisabledWindow(t *testing.T) {
	stale := time.Now().UTC().Add(-time.Hour)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "[]")
	}))
	defer server.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{
		{ID: "stale", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "stale", GitHubLastSyncAt: &stale},
	}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	store.GitHubSyncMaxAge = 0

	previous := githubSyncSweepInterval
	githubSyncSweepInterval = 5 * time.Millisecond
	store.StartGitHubSync()
	time.Sleep(100 * time.Millisecond)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	githubSyncSweepInterval = previous

	if calls.Load() != 0 {
		t.Fatalf("a disabled window must stop the sweep, got %d requests", calls.Load())
	}
}

func TestPublicSourcePolicyReflectsSettings(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	store.GitHubSyncMaxAge = 60 * time.Minute
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	read := func() (int, map[string]any) {
		t.Helper()
		res, err := http.Get(server.URL + "/api/v1/source-policy")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var payload map[string]any
		_ = json.NewDecoder(res.Body).Decode(&payload)
		return res.StatusCode, payload
	}

	// Anonymous access is the point: the copy that quotes this value is public.
	code, payload := read()
	if code != 200 {
		t.Fatalf("expected 200 for anonymous GET, got %d", code)
	}
	if payload["github_sync_max_age"] != "1h0m0s" {
		t.Fatalf("max age = %v, want 1h0m0s", payload["github_sync_max_age"])
	}
	if payload["github_sync_max_age_seconds"] != float64(3600) {
		t.Fatalf("max age seconds = %v, want 3600", payload["github_sync_max_age_seconds"])
	}
	if payload["github_sync_max_age_configured"] != true {
		t.Fatalf("expected configured=true, got %v", payload["github_sync_max_age_configured"])
	}

	// Saving a new window must change the published policy immediately.
	req, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/settings", strings.NewReader(`{"github_sync_max_age":"30m","revision":0}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", adminCSRF)
	req.AddCookie(adminCookie)
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("patch failed: err=%v code=%d", err, res.StatusCode)
	}
	res.Body.Close()

	_, payload = read()
	if payload["github_sync_max_age"] != "30m0s" || payload["github_sync_max_age_seconds"] != float64(1800) {
		t.Fatalf("policy did not follow the setting: %v", payload)
	}

	// Disabling the window is reported as such instead of as a zero duration.
	req, _ = http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/settings", strings.NewReader(`{"github_sync_max_age":"0","revision":1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", adminCSRF)
	req.AddCookie(adminCookie)
	res, err = http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("disable failed: err=%v code=%d", err, res.StatusCode)
	}
	res.Body.Close()

	_, payload = read()
	if payload["github_sync_max_age_configured"] != false || payload["github_sync_max_age_seconds"] != float64(0) {
		t.Fatalf("disabled policy = %v", payload)
	}
}

func TestAdminSettingsTestConnection(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)

	// Mock GitHub & Proxy
	zipData := []byte("PK\x03\x04" + strings.Repeat("a", 100))
	var mockGH *httptest.Server
	mockGH = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/releases") {
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `[{"id":1,"tag_name":"v1.0","draft":false,"assets":[{"id":10,"name":"mod.zip","size":%d,"browser_download_url":"%s/mod.zip"}]}]`, len(zipData), mockGH.URL)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/mod.zip") {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(zipData)
			return
		}
		http.NotFound(w, r)
	}))
	defer mockGH.Close()

	mockProxy := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target := strings.TrimPrefix(r.URL.RequestURI(), "/")
		if !strings.HasPrefix(target, "http") {
			target = "http://" + target
		}
		targetURL, _ := url.Parse(target)
		fReq, _ := http.NewRequest(r.Method, targetURL.String(), nil)
		fRes, err := http.DefaultTransport.RoundTrip(fReq)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		defer fRes.Body.Close()
		w.WriteHeader(fRes.StatusCode)
		_, _ = io.Copy(w, fRes.Body)
	}))
	defer mockProxy.Close()

	store.GitHubClient = github.NewClient(
		github.WithBaseURL(mockGH.URL),
		github.WithAllowInsecureTestHosts(true),
	)

	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// POST /api/v1/admin/settings/github-proxy/test
	body := fmt.Sprintf(`{"github_proxy_template":"%s/{url}"}`, mockProxy.URL)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/admin/settings/github-proxy/test", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", adminCSRF)
	req.AddCookie(adminCookie)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 {
		t.Fatalf("expected 200 for test connection, got %d", res.StatusCode)
	}

	var testResp struct {
		API struct {
			OK        bool   `json:"ok"`
			ElapsedMS int64  `json:"elapsed_ms"`
			ErrorCode string `json:"error_code,omitempty"`
		} `json:"api"`
		Asset struct {
			OK        bool   `json:"ok"`
			ElapsedMS int64  `json:"elapsed_ms"`
			ErrorCode string `json:"error_code,omitempty"`
		} `json:"asset"`
	}
	if err := json.NewDecoder(res.Body).Decode(&testResp); err != nil {
		t.Fatal(err)
	}
	if !testResp.API.OK {
		t.Fatalf("expected API.OK == true, got error_code %q", testResp.API.ErrorCode)
	}
	if !testResp.Asset.OK {
		t.Fatalf("expected Asset.OK == true, got error_code %q", testResp.Asset.ErrorCode)
	}
}
func TestLegacySnapshotWithoutSettings(t *testing.T) {
	dataDir := t.TempDir()
	// Write legacy catalog.json without settings fields
	legacyJSON := `{"mods":[],"versions":{}}`
	if err := os.WriteFile(filepath.Join(dataDir, "catalog.json"), []byte(legacyJSON), 0644); err != nil {
		t.Fatal(err)
	}

	store, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatalf("NewStore with legacy catalog failed: %v", err)
	}

	if store.Catalog.Settings.GitHubProxyTemplate != "" {
		t.Fatalf("expected empty proxy template for legacy snapshot, got %q", store.Catalog.Settings.GitHubProxyTemplate)
	}
	if store.Catalog.Settings.Revision != 0 {
		t.Fatalf("expected 0 revision for legacy snapshot, got %d", store.Catalog.Settings.Revision)
	}
	if len(store.Catalog.SettingsAudit) != 0 {
		t.Fatalf("expected empty settings audit, got %d", len(store.Catalog.SettingsAudit))
	}
}
