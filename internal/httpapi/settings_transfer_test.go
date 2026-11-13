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
	"time"

	"github.com/reze/submodhub/internal/delivery"
)

const transferNodeBody = `{"revision":1,"node":{"id":"cloud-one","name":"Cloud","type":"cloudreve","enabled":true,"weight":1,"api_base_url":"https://disk.example/api/v3","username":"admin","password":"private-password","directory":"/SubmodHub","allowed_download_origins":["https://cdn.example"],"capabilities":["cloudreve"]}}`

func transferCall(h http.Handler, method, path, body string, cookie *http.Cookie, csrf, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://example.test"+path, strings.NewReader(body))
	if cookie != nil {
		r.AddCookie(cookie)
	}
	if csrf != "" {
		r.Header.Set("X-CSRF-Token", csrf)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// transferFixture seeds one GitHub API token, a proxy template, a two-group tag
// catalog and one Cloudreve node so both export and import see every shape.
func transferFixture(t *testing.T) (*Store, *http.Cookie, string, http.Handler) {
	t.Helper()
	s, admin, csrf, _, _ := createTestStoreWithAdmin(t)
	box, err := delivery.NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	s.DeliverySecrets = box
	h := NewStoreHandler(s)

	w := transferCall(h, http.MethodPatch, "/api/v1/admin/settings",
		`{"github_proxy_template":"https://proxy.example/{url}","github_sync_max_age":"4h30m","tag_catalog":[{"name":"工具","description":{"zh":"自动修复类"},"children":[{"name":"绘图"}]},{"name":"音乐"}],"github_token":"ghp_test_token_1234567890","revision":0}`,
		admin, csrf, "")
	if w.Code != http.StatusOK {
		t.Fatalf("seed settings = %d %s", w.Code, w.Body.String())
	}
	w = transferCall(h, http.MethodPost, "/api/v1/admin/download-nodes", transferNodeBody, admin, csrf, "")
	if w.Code != http.StatusCreated {
		t.Fatalf("seed node = %d %s", w.Code, w.Body.String())
	}
	return s, admin, csrf, h
}

func exportTransferDocument(t *testing.T, h http.Handler, cookie *http.Cookie) (settingsTransferDocument, []byte) {
	t.Helper()
	w := transferCall(h, http.MethodGet, "/api/v1/admin/settings/export", "", cookie, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("export = %d %s", w.Code, w.Body.String())
	}
	raw := w.Body.Bytes()
	var doc settingsTransferDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	return doc, raw
}

func importTransferDocument(t *testing.T, h http.Handler, cookie *http.Cookie, csrf string, doc settingsTransferDocument) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return transferCall(h, http.MethodPost, "/api/v1/admin/settings/import", string(raw), cookie, csrf, "")
}

func transferDocumentWithoutNodes() settingsTransferDocument {
	return settingsTransferDocument{
		Format:  settingsTransferFormat,
		Version: settingsTransferVersion,
		Settings: settingsTransferSettings{
			TagCatalog: []TagGroup{{Name: "工具"}, {Name: "音乐"}},
		},
	}
}

// The export is admin-only, needs no CSRF token because it is read-only, and
// never carries a credential even though the deployment stores both a GitHub
// token and a node password.
func TestSettingsExportShapeAndPermissions(t *testing.T) {
	_, admin, _, h := transferFixture(t)
	if w := transferCall(h, http.MethodGet, "/api/v1/admin/settings/export", "", nil, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous export = %d", w.Code)
	}
	// The fixture store also carries the normal-user session the shared helper
	// installs, so the same handler rejects a non-admin cookie.
	userCookie, _ := transferUserSession()
	if w := transferCall(h, http.MethodGet, "/api/v1/admin/settings/export", "", userCookie, "", ""); w.Code != http.StatusForbidden {
		t.Fatalf("normal user export = %d", w.Code)
	}
	if w := transferCall(h, http.MethodPost, "/api/v1/admin/settings/export", "", admin, "", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST export = %d", w.Code)
	}
	if w := transferCall(h, http.MethodGet, "/api/v1/admin/settings/import", "", admin, "", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET import = %d", w.Code)
	}
	w := transferCall(h, http.MethodGet, "/api/v1/admin/settings/export", "", admin, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("export = %d %s", w.Code, w.Body.String())
	}
	if !strings.HasPrefix(w.Header().Get("Content-Disposition"), `attachment; filename="submodhub-settings-`) {
		t.Fatalf("content disposition = %q", w.Header().Get("Content-Disposition"))
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("export must not be cached, got %q", got)
	}
	body := w.Body.String()
	for _, secret := range []string{"ghp_test_token_1234567890", "private-password", `"password"`, `"github_token"`} {
		if strings.Contains(body, secret) {
			t.Fatalf("export leaked %q: %s", secret, body)
		}
	}

	var doc settingsTransferDocument
	if err := json.Unmarshal([]byte(body), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Format != settingsTransferFormat || doc.Version != settingsTransferVersion || doc.ExportedAt.IsZero() {
		t.Fatalf("document identity = %+v", doc)
	}
	if doc.Settings.GitHubProxyTemplate != "https://proxy.example/{url}" || doc.Settings.GitHubSyncMaxAge != "4h30m0s" {
		t.Fatalf("settings = %+v", doc.Settings)
	}
	if got := tagGroupNames(doc.Settings.TagCatalog); strings.Join(got, ",") != "工具,音乐" {
		t.Fatalf("catalog = %v", got)
	}
	if doc.DownloadNodes == nil || len(*doc.DownloadNodes) != 1 {
		t.Fatalf("nodes = %+v", doc.DownloadNodes)
	}
	node := (*doc.DownloadNodes)[0]
	if node.ID != "cloud-one" || node.Type != "cloudreve" || !node.CredentialConfigured || node.Password != "" {
		t.Fatalf("node = %+v", node)
	}
}

// transferUserSession installs the normal-user session the shared fixture helper
// already created and returns its cookie and CSRF token.
func transferUserSession() (*http.Cookie, string) {
	userToken := strings.Repeat("b", 64)
	return &http.Cookie{Name: "submodhub_session", Value: userToken}, "user-csrf-token"
}

// Re-importing the document the server just produced is the primary workflow:
// it restores every non-secret field, keeps both stored credentials because the
// file deliberately omits them, and bumps the shared revision.
func TestSettingsImportRoundTripKeepsSecrets(t *testing.T) {
	s, admin, csrf, h := transferFixture(t)

	s.mu.RLock()
	beforeRevision := s.Catalog.Settings.Revision
	beforeCiphertext := s.Catalog.DeliveryNodes[0].CredentialCiphertext
	beforeNodeRevision := s.Catalog.DeliveryNodes[0].Revision
	beforeStatus := s.Catalog.DeliveryNodes[0].Status
	s.mu.RUnlock()

	doc, _ := exportTransferDocument(t, h, admin)
	w := importTransferDocument(t, h, admin, csrf, doc)
	if w.Code != http.StatusOK {
		t.Fatalf("import = %d %s", w.Code, w.Body.String())
	}
	var resp siteSettingsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Revision != beforeRevision+1 {
		t.Fatalf("revision = %d, want %d", resp.Revision, beforeRevision+1)
	}
	if !resp.GitHubTokenConfigured || !resp.GitHubTokenEncrypted {
		t.Fatalf("token state = %+v", resp)
	}

	s.mu.RLock()
	plain, err := s.DeliverySecrets.Open("cloud-one", s.Catalog.DeliveryNodes[0].CredentialCiphertext)
	token, tokenErr := s.DeliverySecrets.Open(githubTokenSecretID, s.Catalog.Settings.GitHubToken.Value)
	nodeRevision := s.Catalog.DeliveryNodes[0].Revision
	nodeCiphertext := s.Catalog.DeliveryNodes[0].CredentialCiphertext
	s.mu.RUnlock()
	if err != nil || plain != "private-password" {
		t.Fatalf("node credential after import = %q %v", plain, err)
	}
	if tokenErr != nil || token != "ghp_test_token_1234567890" {
		t.Fatalf("github token after import = %q %v", token, tokenErr)
	}
	if nodeCiphertext != beforeCiphertext {
		t.Fatal("an unchanged credential must not be re-sealed")
	}
	// An unchanged node keeps its revision: archive and app-asset mirrors are
	// bound to it, so bumping it on every import would re-upload everything.
	if nodeRevision != beforeNodeRevision {
		t.Fatalf("node revision = %d, want %d", nodeRevision, beforeNodeRevision)
	}
	if status := s.Catalog.DeliveryNodes[0].Status; status != beforeStatus {
		t.Fatalf("node status = %q, want %q", status, beforeStatus)
	}

	doc2, _ := exportTransferDocument(t, h, admin)
	doc2.ExportedAt = doc.ExportedAt
	if got, want := mustJSON(t, doc2), mustJSON(t, doc); got != want {
		t.Fatalf("round-trip export drifted:\n got %s\nwant %s", got, want)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// A backup restored onto the same deployment keeps working without secrets in
// the file; a backup restored onto a fresh deployment gets its credentials from
// the fields an operator is allowed to add by hand.
func TestSettingsImportRestoresFreshDeploymentWithSuppliedSecrets(t *testing.T) {
	_, admin, _, h := transferFixture(t)
	doc, _ := exportTransferDocument(t, h, admin)

	token := "ghp_restored_token_0987654321"
	doc.Settings.GitHubToken = &token
	nodes := *doc.DownloadNodes
	nodes[0].Password = "restored-password"
	doc.DownloadNodes = &nodes

	fresh, freshAdmin, freshCSRF, _, _ := createTestStoreWithAdmin(t)
	box, err := delivery.NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	fresh.DeliverySecrets = box
	freshHandler := NewStoreHandler(fresh)

	w := importTransferDocument(t, freshHandler, freshAdmin, freshCSRF, doc)
	if w.Code != http.StatusOK {
		t.Fatalf("import = %d %s", w.Code, w.Body.String())
	}

	fresh.mu.RLock()
	plainToken := ""
	if fresh.Catalog.Settings.GitHubToken != nil {
		plainToken, _ = box.Open(githubTokenSecretID, fresh.Catalog.Settings.GitHubToken.Value)
	}
	nodePlain := ""
	if len(fresh.Catalog.DeliveryNodes) == 1 {
		nodePlain, _ = box.Open("cloud-one", fresh.Catalog.DeliveryNodes[0].CredentialCiphertext)
	}
	revision := fresh.Catalog.Settings.Revision
	tpl := fresh.Catalog.Settings.GitHubProxyTemplate
	maxAge := fresh.Catalog.Settings.GitHubSyncMaxAge
	catalogLen := len(fresh.Catalog.Settings.TagCatalog)
	fresh.mu.RUnlock()

	if plainToken != token || nodePlain != "restored-password" {
		t.Fatalf("restored credentials = %q / %q", plainToken, nodePlain)
	}
	if revision != 1 || tpl != "https://proxy.example/{url}" || maxAge != "4h30m0s" || catalogLen != 2 {
		t.Fatalf("restored settings: rev=%d tpl=%q maxAge=%q catalog=%d", revision, tpl, maxAge, catalogLen)
	}

	// The fresh deployment now exports the same configuration it received. The
	// document's import-only token field is not part of an export, so it is
	// cleared before comparing.
	exported, _ := exportTransferDocument(t, freshHandler, freshAdmin)
	want := doc.Settings
	want.GitHubToken = nil
	if mustJSON(t, exported.Settings) != mustJSON(t, want) {
		t.Fatalf("fresh export settings drifted: %+v vs %+v", exported.Settings, want)
	}
}

// An import without a download_nodes field leaves the node list untouched; an
// explicit empty array is the way to remove every node.
func TestSettingsImportNodeListPresenceSemantics(t *testing.T) {
	_, admin, csrf, h := transferFixture(t)

	doc := transferDocumentWithoutNodes()
	doc.Settings.GitHubProxyTemplate = "https://proxy.example/{url}"
	doc.Settings.GitHubSyncMaxAge = "4h30m0s"
	if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusOK {
		t.Fatalf("import without nodes = %d %s", w.Code, w.Body.String())
	}
	exported, _ := exportTransferDocument(t, h, admin)
	if exported.DownloadNodes == nil || len(*exported.DownloadNodes) != 1 {
		t.Fatalf("absent download_nodes must keep the node: %+v", exported.DownloadNodes)
	}

	empty := []settingsTransferNode{}
	doc.DownloadNodes = &empty
	if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusOK {
		t.Fatalf("import with empty nodes = %d %s", w.Code, w.Body.String())
	}
	exported, _ = exportTransferDocument(t, h, admin)
	if exported.DownloadNodes == nil || len(*exported.DownloadNodes) != 0 {
		t.Fatalf("empty download_nodes must clear the list: %+v", exported.DownloadNodes)
	}
	settings := transferCall(h, http.MethodGet, "/api/v1/admin/download-nodes", "", admin, "", "")
	if strings.Contains(settings.Body.String(), "cloud-one") || !strings.Contains(settings.Body.String(), `"builtin"`) {
		t.Fatalf("node list after clear = %s", settings.Body.String())
	}
}

// Importing a catalog also prunes tags that vanished from it, records one audit
// event, and keeps the shared revision monotonic.
func TestSettingsImportPrunesTagsAndAudits(t *testing.T) {
	s, admin, csrf, h := transferFixture(t)
	s.mu.Lock()
	s.Catalog.Mods = []Mod{
		{ID: "mod_keep", Title: "Keep", Category: "submod", Tags: []string{"工具", "旧标签"}},
		{ID: "mod_clean", Title: "Clean", Category: "submod", Tags: []string{"旧标签"}},
	}
	s.mu.Unlock()

	before := s.Catalog.Settings.Revision
	doc := transferDocumentWithoutNodes()
	doc.Settings.GitHubProxyTemplate = "https://proxy.example/{url}"
	doc.Settings.TagCatalog = []TagGroup{{Name: "工具"}, {Name: "音乐"}}
	if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusOK {
		t.Fatalf("import = %d %s", w.Code, w.Body.String())
	}

	s.mu.RLock()
	keep := s.Catalog.Mods[0].Tags
	clean := s.Catalog.Mods[1].Tags
	audit := s.Catalog.SettingsAudit[len(s.Catalog.SettingsAudit)-1]
	s.mu.RUnlock()
	if strings.Join(keep, ",") != "工具" || len(clean) != 0 {
		t.Fatalf("pruned tags = %v / %v", keep, clean)
	}
	// Both mods lost a tag, which is what PrunedModTags counts.
	if !audit.TagsChanged || audit.PrunedModTags != 2 || audit.Revision != before+1 {
		t.Fatalf("audit = %+v", audit)
	}
}

// A failed save must leave settings, nodes, pruned tags and the audit trail
// exactly as they were before the import.
func TestSettingsImportRollsBackWhenSaveFails(t *testing.T) {
	s, admin, csrf, h := transferFixture(t)
	s.mu.Lock()
	s.Catalog.Mods = []Mod{{ID: "mod_keep", Title: "Keep", Category: "submod", Tags: []string{"工具", "旧标签"}}}
	s.mu.Unlock()

	beforeDoc, _ := exportTransferDocument(t, h, admin)
	beforeRevision := s.Catalog.Settings.Revision
	beforeAuditLen := len(s.Catalog.SettingsAudit)

	empty := []settingsTransferNode{}
	doc := transferDocumentWithoutNodes()
	doc.Settings.GitHubProxyTemplate = "https://other.example/{url}"
	doc.Settings.TagCatalog = []TagGroup{{Name: "音乐"}}
	doc.DownloadNodes = &empty

	// A file where the data directory should be makes saveLocked fail.
	notDir := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(notDir, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	originalDir := s.DataDir
	s.DataDir = notDir
	s.mu.Unlock()
	w := importTransferDocument(t, h, admin, csrf, doc)
	s.mu.Lock()
	s.DataDir = originalDir
	s.mu.Unlock()
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), "storage_error") {
		t.Fatalf("failed save import = %d %s", w.Code, w.Body.String())
	}

	s.mu.RLock()
	after := settingsTransferDocument{
		Settings: settingsTransferSettings{
			GitHubProxyTemplate: s.Catalog.Settings.GitHubProxyTemplate,
			GitHubSyncMaxAge:    s.Catalog.Settings.GitHubSyncMaxAge,
			TagCatalog:          s.Catalog.Settings.TagCatalog,
		},
	}
	revision := s.Catalog.Settings.Revision
	auditLen := len(s.Catalog.SettingsAudit)
	nodeCount := len(s.Catalog.DeliveryNodes)
	tags := s.Catalog.Mods[0].Tags
	s.mu.RUnlock()

	if mustJSON(t, after.Settings) != mustJSON(t, beforeDoc.Settings) {
		t.Fatalf("settings survived rollback: %+v", after.Settings)
	}
	if revision != beforeRevision || auditLen != beforeAuditLen {
		t.Fatalf("revision/audit survived rollback: rev=%d audit=%d", revision, auditLen)
	}
	if nodeCount != 1 || strings.Join(tags, ",") != "工具,旧标签" {
		t.Fatalf("nodes/tags survived rollback: nodes=%d tags=%v", nodeCount, tags)
	}
}

// Every rejected document looks the same to the admin: a 4xx with a stable code
// and nothing applied.
func TestSettingsImportRejectsInvalidDocuments(t *testing.T) {
	node := func(id, kind string) settingsTransferNode {
		if kind == "github_relay" {
			return settingsTransferNode{ID: id, Name: "Relay", Type: "github_relay", Enabled: true, Weight: 1,
				BaseURL: "https://relay.example", Capabilities: []string{"github"}, Password: strings.Repeat("k", 32)}
		}
		return settingsTransferNode{ID: id, Name: "Cloud", Type: "cloudreve", Enabled: true, Weight: 1,
			APIBaseURL: "https://disk.example/api/v3", Username: "admin", Directory: "/SubmodHub",
			AllowedDownloadOrigins: []string{"https://cdn.example"}, Capabilities: []string{"cloudreve"}}
	}
	withNode := func(n settingsTransferNode) settingsTransferDocument {
		doc := transferDocumentWithoutNodes()
		nodes := []settingsTransferNode{n}
		doc.DownloadNodes = &nodes
		return doc
	}

	t.Run("bad format", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		doc := transferDocumentWithoutNodes()
		doc.Format = "something-else"
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "unsupported_settings_document") {
			t.Fatalf("bad format = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("bad version", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		doc := transferDocumentWithoutNodes()
		doc.Version = settingsTransferVersion + 1
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "unsupported_settings_document") {
			t.Fatalf("bad version = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("unknown field", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		body := `{"format":"submodhub-settings","version":1,"settings":{"github_proxy_template":"","github_sync_max_age":"","tag_catalog":[{"name":"工具"}],"surprise":true}}`
		w := transferCall(h, http.MethodPost, "/api/v1/admin/settings/import", body, admin, csrf, "")
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "validation_failed") {
			t.Fatalf("unknown field = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("proxy", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		doc := transferDocumentWithoutNodes()
		doc.Settings.GitHubProxyTemplate = "http://proxy.example/{url}"
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_github_proxy") {
			t.Fatalf("proxy = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("sync window", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		doc := transferDocumentWithoutNodes()
		doc.Settings.GitHubSyncMaxAge = "10 minutes"
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_github_sync_max_age") {
			t.Fatalf("sync window = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("catalog", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		doc := transferDocumentWithoutNodes()
		doc.Settings.TagCatalog = nil
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_tag_catalog") {
			t.Fatalf("catalog = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("duplicate node", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		doc := transferDocumentWithoutNodes()
		nodes := []settingsTransferNode{node("dup", "cloudreve"), node("dup", "cloudreve")}
		doc.DownloadNodes = &nodes
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "duplicate_download_node") {
			t.Fatalf("duplicate node = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("node type change", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		// cloud-one already exists as cloudreve in the fixture.
		doc := withNode(node("cloud-one", "github_relay"))
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "node_type_immutable") {
			t.Fatalf("node type = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("missing credential", func(t *testing.T) {
		_, admin, csrf, h := transferFixture(t)
		fresh := node("brand-new", "cloudreve")
		doc := withNode(fresh)
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "credential_required") {
			t.Fatalf("missing credential = %d %s", w.Code, w.Body.String())
		}
	})
	t.Run("env locked window", func(t *testing.T) {
		s, admin, csrf, h := transferFixture(t)
		pinned := 30 * time.Minute
		s.GitHubSyncMaxAgeOverride = &pinned
		doc := transferDocumentWithoutNodes()
		if w := importTransferDocument(t, h, admin, csrf, doc); w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "github_sync_max_age_env_override") {
			t.Fatalf("env lock = %d %s", w.Code, w.Body.String())
		}
	})
}

func TestSettingsImportAuthAndCSRF(t *testing.T) {
	_, admin, csrf, h := transferFixture(t)
	doc := transferDocumentWithoutNodes()
	raw := mustJSON(t, doc)

	if w := transferCall(h, http.MethodPost, "/api/v1/admin/settings/import", raw, nil, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous = %d", w.Code)
	}
	userCookie, userCSRF := transferUserSession()
	if w := transferCall(h, http.MethodPost, "/api/v1/admin/settings/import", raw, userCookie, userCSRF, ""); w.Code != http.StatusForbidden {
		t.Fatalf("normal user = %d", w.Code)
	}
	if w := transferCall(h, http.MethodPost, "/api/v1/admin/settings/import", raw, admin, "", ""); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "csrf_invalid") {
		t.Fatalf("missing csrf = %d %s", w.Code, w.Body.String())
	}
	if w := transferCall(h, http.MethodPost, "/api/v1/admin/settings/import", raw, admin, csrf, "https://evil.test"); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "cross_origin_forbidden") {
		t.Fatalf("cross origin = %d %s", w.Code, w.Body.String())
	}
}
