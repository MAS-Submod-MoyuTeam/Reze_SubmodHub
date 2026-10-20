package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/delivery"
)

func TestDeliveryNodeConnectionTestRequiresAdminAndCSRF(t *testing.T) {
	s, admin, csrf, user, _ := createTestStoreWithAdmin(t)
	h := NewStoreHandler(s)
	for _, tc := range []struct {
		cookie *http.Cookie
		csrf   string
		want   int
	}{{nil, "", 401}, {user, "", 403}, {admin, "", 403}, {admin, csrf, 404}} {
		r := httptest.NewRequest("POST", "/api/v1/admin/download-nodes/missing/test", strings.NewReader(`{"revision":0}`))
		if tc.cookie != nil {
			r.AddCookie(tc.cookie)
		}
		r.Header.Set("X-CSRF-Token", tc.csrf)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("got %d want %d: %s", w.Code, tc.want, w.Body.String())
		}
	}
}

func TestDeliverySettingsSecurityPersistenceAndConflict(t *testing.T) {
	s, admin, csrf, user, _ := createTestStoreWithAdmin(t)
	box, _ := delivery.NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)))
	s.DeliverySecrets = box
	h := NewStoreHandler(s)
	call := func(method, path, body string, cookie *http.Cookie, token, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://example.test/api/v1/admin/download-nodes"+path, strings.NewReader(body))
		if cookie != nil {
			r.AddCookie(cookie)
		}
		r.Header.Set("X-CSRF-Token", token)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	body := `{"revision":0,"node":{"id":"cloud-one","name":"Cloud","type":"cloudreve","enabled":true,"weight":1,"api_base_url":"https://disk.example/api/v3","username":"admin","password":"private-password","directory":"/SubmodHub","allowed_download_origins":["https://cdn.example"],"capabilities":["cloudreve"]}}`
	for _, tc := range []struct {
		cookie        *http.Cookie
		token, origin string
		status        int
	}{{nil, "", "", 401}, {user, "", "", 403}, {admin, "", "", 403}, {admin, csrf, "https://evil.test", 403}} {
		if w := call("POST", "", body, tc.cookie, tc.token, tc.origin); w.Code != tc.status {
			t.Fatalf("permissions: %d %s", w.Code, w.Body.String())
		}
	}
	w := call("POST", "", body, admin, csrf, "")
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "private-password") || strings.Contains(w.Body.String(), "v1:") {
		t.Fatal("secret in write DTO")
	}
	if w = call("POST", "", body, admin, csrf, ""); w.Code != 409 {
		t.Fatalf("stale revision: %d", w.Code)
	}
	w = call("GET", "", "", admin, "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "private-password") || !strings.Contains(w.Body.String(), `"credential_configured":true`) {
		t.Fatalf("read DTO: %s", w.Body.String())
	}
	b, err := os.ReadFile(filepath.Join(s.DataDir, "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(b, []byte("private-password")) {
		t.Fatal("plaintext on disk")
	}
	reloaded, err := NewStore(s.DataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Catalog.DeliveryNodes) != 1 {
		t.Fatal("node lost on restart")
	}
	plain, err := box.Open("cloud-one", reloaded.Catalog.DeliveryNodes[0].CredentialCiphertext)
	if err != nil || plain != "private-password" {
		t.Fatalf("restart decrypt: %v", err)
	}
	// An empty edit keeps the encrypted secret, using the shared settings revision.
	edit := strings.Replace(strings.Replace(body, `"revision":0`, `"revision":1`, 1), `"private-password"`, `""`, 1)
	if w = call("PUT", "/cloud-one", edit, admin, csrf, ""); w.Code != 200 {
		t.Fatalf("edit: %d %s", w.Code, w.Body.String())
	}
	if w = call("DELETE", "/builtin", `{"revision":2}`, admin, csrf, ""); w.Code != 400 {
		t.Fatalf("builtin deletion: %d", w.Code)
	}
	if w = call("DELETE", "/cloud-one", `{"revision":2}`, admin, csrf, ""); w.Code != 200 {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
	if len(s.Catalog.DeliveryNodes) != 0 {
		t.Fatal("node not removed")
	}
}
func TestDeliverySettingsMissingKeyAndSaveRollback(t *testing.T) {
	s, admin, csrf, _, _ := createTestStoreWithAdmin(t)
	h := NewStoreHandler(s)
	body := `{"revision":0,"node":{"id":"relay","name":"Relay","type":"github_relay","enabled":true,"weight":1,"base_url":"https://relay.example","password":"private-key-32-byte-test-placeholder","capabilities":["github"]}}`
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/v1/admin/download-nodes", strings.NewReader(body))
		r.AddCookie(admin)
		r.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request(); w.Code != 503 {
		t.Fatalf("missing master key: %d %s", w.Code, w.Body.String())
	}
	s.DeliverySecrets, _ = delivery.NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{5}, 32)))
	invalidDir := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(invalidDir, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	s.DataDir = invalidDir
	if w := request(); w.Code != 500 {
		t.Fatalf("save failure: %d %s", w.Code, w.Body.String())
	}
	if len(s.Catalog.DeliveryNodes) != 0 || s.Catalog.Settings.Revision != 0 {
		b, _ := json.Marshal(s.Catalog)
		t.Fatalf("rollback failed: %s", b)
	}
}
