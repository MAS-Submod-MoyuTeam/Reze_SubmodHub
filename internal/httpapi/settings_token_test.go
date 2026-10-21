package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/delivery"
	"github.com/reze/submodhub/internal/github"
)

// patchAdminSettings issues an authenticated settings PATCH and returns the
// decoded view. Tests only ever see the redacted response, never the token.
func patchAdminSettings(t *testing.T, server *httptest.Server, cookie *http.Cookie, csrf, body string) (*http.Response, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/settings", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", csrf)
	req.AddCookie(cookie)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	_ = json.NewDecoder(res.Body).Decode(&decoded)
	_ = res.Body.Close()
	return res, decoded
}

func getAdminSettings(t *testing.T, server *httptest.Server, cookie *http.Cookie) map[string]any {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/admin/settings", nil)
	req.AddCookie(cookie)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("settings GET = %d", res.StatusCode)
	}
	var decoded map[string]any
	if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func TestAdminSettingsStoresGitHubTokenWithoutMasterKey(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	const token = "ghp_plaintexttoken1234"
	res, body := patchAdminSettings(t, server, adminCookie, adminCSRF,
		fmt.Sprintf(`{"github_token":%q,"revision":0}`, token))
	if res.StatusCode != 200 {
		t.Fatalf("PATCH token = %d (%v)", res.StatusCode, body)
	}

	view := getAdminSettings(t, server, adminCookie)
	if view["github_token_configured"] != true {
		t.Fatalf("token should be reported as configured: %v", view)
	}
	if view["github_token_encrypted"] != false {
		t.Fatalf("without a master key the token is stored verbatim: %v", view)
	}
	if view["github_token_hint"] != "1234" {
		t.Fatalf("hint = %v, want last four characters", view["github_token_hint"])
	}
	if view["master_key_configured"] != false {
		t.Fatalf("master_key_configured = %v", view["master_key_configured"])
	}
	// The plaintext token must never travel back to the browser.
	for key, value := range view {
		if text, ok := value.(string); ok && strings.Contains(text, token) {
			t.Fatalf("settings response leaked the token in %q", key)
		}
	}

	proxy, stored := store.githubSettings()
	if stored != token {
		t.Fatalf("stored token = %q", stored)
	}
	if proxy != "" {
		t.Fatalf("unrelated proxy field changed: %q", proxy)
	}
}

func TestAdminSettingsEncryptsTokenWhenMasterKeyConfigured(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))
	secrets, err := delivery.NewSecrets(key)
	if err != nil {
		t.Fatal(err)
	}
	store.DeliverySecrets = secrets

	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	const token = "ghp_encryptedtoken9876"
	res, body := patchAdminSettings(t, server, adminCookie, adminCSRF,
		fmt.Sprintf(`{"github_token":%q,"revision":0}`, token))
	if res.StatusCode != 200 {
		t.Fatalf("PATCH token = %d (%v)", res.StatusCode, body)
	}

	raw := store.Catalog.Settings.GitHubToken
	if raw == nil || !raw.Encrypted || !strings.HasPrefix(raw.Value, "v1:") {
		t.Fatalf("token was not sealed: %+v", raw)
	}
	if strings.Contains(raw.Value, token) {
		t.Fatal("ciphertext contains the plaintext token")
	}

	view := getAdminSettings(t, server, adminCookie)
	if view["github_token_encrypted"] != true || view["github_token_hint"] != "9876" {
		t.Fatalf("unexpected view: %v", view)
	}

	// The ciphertext is bound to the settings namespace, so a value sealed for a
	// download node cannot be replayed as the API token.
	nodeCiphertext, err := secrets.Seal("node-1", token)
	if err != nil {
		t.Fatal(err)
	}
	store.Catalog.Settings.GitHubToken = &githubTokenSecret{Value: nodeCiphertext, Encrypted: true}
	if _, got := store.githubSettings(); got != "" {
		t.Fatalf("cross-namespace ciphertext was accepted: %q", got)
	}
}

func TestAdminSettingsTokenSurvivesRestart(t *testing.T) {
	dataDir := t.TempDir()
	store, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("r", 32)))
	if store.DeliverySecrets, err = delivery.NewSecrets(key); err != nil {
		t.Fatal(err)
	}
	store.sessions[sessionKey(strings.Repeat("d", 64))] = authSession{
		User: authUser{ID: "flarum:1", Username: "admin"}, Roles: []string{"admin"},
		CSRF: "csrf", Expires: time.Now().Add(time.Hour),
	}
	server := httptest.NewServer(NewStoreHandler(store))
	cookie := &http.Cookie{Name: "submodhub_session", Value: strings.Repeat("d", 64)}
	res, body := patchAdminSettings(t, server, cookie, "csrf", `{"github_token":"ghp_persisted","revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("PATCH token = %d (%v)", res.StatusCode, body)
	}
	server.Close()

	reopened, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.DeliverySecrets, err = delivery.NewSecrets(key); err != nil {
		t.Fatal(err)
	}
	if _, token := reopened.githubSettings(); token != "ghp_persisted" {
		t.Fatalf("token after restart = %q", token)
	}

	// Without the same master key the ciphertext is unusable, and the server
	// degrades to the anonymous quota instead of failing requests.
	noKey, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if _, token := noKey.githubSettings(); token != "" {
		t.Fatalf("undecryptable token must not be used: %q", token)
	}
}

func TestAdminSettingsClearsAndValidatesToken(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	if res, body := patchAdminSettings(t, server, adminCookie, adminCSRF, `{"github_token":"ghp_first","revision":0}`); res.StatusCode != 200 {
		t.Fatalf("set token = %d (%v)", res.StatusCode, body)
	}
	// Whitespace-only input clears the credential.
	res, _ := patchAdminSettings(t, server, adminCookie, adminCSRF, `{"github_token":"   ","revision":1}`)
	if res.StatusCode != 200 {
		t.Fatalf("clear token = %d", res.StatusCode)
	}
	if view := getAdminSettings(t, server, adminCookie); view["github_token_configured"] != false {
		t.Fatalf("token still configured after clear: %v", view)
	}

	for name, token := range map[string]string{
		"embedded space": "ghp_bad token",
		"newline":        "ghp_bad\ntoken",
		"too long":       strings.Repeat("x", 256),
	} {
		t.Run(name, func(t *testing.T) {
			body := fmt.Sprintf(`{"github_token":%q,"revision":2}`, token)
			res, decoded := patchAdminSettings(t, server, adminCookie, adminCSRF, body)
			if res.StatusCode != 400 || decoded["code"] != "invalid_github_token" {
				t.Fatalf("expected 400 invalid_github_token, got %d %v", res.StatusCode, decoded)
			}
		})
	}

	// Omitting the field keeps the stored token untouched.
	if res, _ := patchAdminSettings(t, server, adminCookie, adminCSRF, `{"github_token":"ghp_keep","revision":2}`); res.StatusCode != 200 {
		t.Fatalf("set token = %d", res.StatusCode)
	}
	if res, _ := patchAdminSettings(t, server, adminCookie, adminCSRF, `{"github_proxy_template":"","revision":3}`); res.StatusCode != 200 {
		t.Fatalf("proxy-only patch = %d", res.StatusCode)
	}
	if _, token := store.githubSettings(); token != "ghp_keep" {
		t.Fatalf("a proxy-only patch dropped the token: %q", token)
	}
}

func TestAdminSettingsRejectsEmptyPatch(t *testing.T) {
	_, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	store, _, _, _, _ := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res, decoded := patchAdminSettings(t, server, adminCookie, adminCSRF, `{"revision":0}`)
	if res.StatusCode != 400 {
		t.Fatalf("expected 400 for a patch that changes nothing, got %d %v", res.StatusCode, decoded)
	}
}

// The stored token must actually reach GitHub: a token that is saved but never
// sent would look identical from the settings page.
func TestStoredTokenIsSentToGitHubAPI(t *testing.T) {
	var authHeader string
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		switch {
		case strings.HasSuffix(r.URL.Path, "/releases/latest"):
			fmt.Fprint(w, `{"id":101,"tag_name":"v1.0.0"}`)
		case strings.HasSuffix(r.URL.Path, "/releases"):
			w.Header().Set("ETag", `W/"v1"`)
			fmt.Fprint(w, `[{"id":101,"tag_name":"v1.0.0","draft":false,"prerelease":false,"assets":[]}]`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "mod_gh", Category: "submod", SourceType: "github_releases",
		GitHubOwner: "octocat", GitHubRepo: "hello",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))
	store.Catalog.Settings.GitHubToken = &githubTokenSecret{Value: "ghp_from_settings"}

	if _, err := store.SyncMod(context.Background(), "mod_gh"); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if authHeader != "Bearer ghp_from_settings" {
		t.Fatalf("Authorization = %q, want the token from settings", authHeader)
	}
}

func TestRotatingSettingsClearsRateLimitBackoff(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	future := time.Now().UTC().Add(time.Hour)
	store.Catalog.Mods = []Mod{{ID: "mod_gh", GitHubBackoffUntil: &future}}
	store.gitHubBackoffUntil = future
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	if res, _ := patchAdminSettings(t, server, adminCookie, adminCSRF, `{"github_token":"ghp_new","revision":0}`); res.StatusCode != 200 {
		t.Fatalf("patch = %d", res.StatusCode)
	}
	if !store.gitHubBackoffUntil.IsZero() {
		t.Fatalf("global backoff survived a credential change: %v", store.gitHubBackoffUntil)
	}
	if store.Catalog.Mods[0].GitHubBackoffUntil != nil {
		t.Fatalf("mod backoff survived a credential change: %v", store.Catalog.Mods[0].GitHubBackoffUntil)
	}
	audit := store.Catalog.SettingsAudit[len(store.Catalog.SettingsAudit)-1]
	if !audit.TokenChanged {
		t.Fatalf("audit entry did not record the token change: %+v", audit)
	}
}
