package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func patchAdminSettingsJSON(t *testing.T, url string, cookie *http.Cookie, csrf, body string) (*http.Response, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPatch, url+"/api/v1/admin/settings", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	req.Header.Set("X-CSRF-Token", csrf)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var decoded map[string]any
	raw, _ := io.ReadAll(res.Body)
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &decoded)
	}
	return res, decoded
}

func tagCatalogFromBody(t *testing.T, body io.Reader) []TagGroup {
	t.Helper()
	var payload struct {
		TagCatalog []TagGroup `json:"tag_catalog"`
	}
	if err := json.NewDecoder(body).Decode(&payload); err != nil {
		t.Fatalf("decode tag catalog: %v", err)
	}
	return payload.TagCatalog
}

func tagGroupNames(groups []TagGroup) []string {
	names := make([]string, 0, len(groups))
	for _, g := range groups {
		names = append(names, g.Name)
	}
	return names
}

// The catalog is born with the twelve default main tags, readable without a
// login, and reflects later admin edits.
func TestTagCatalogDefaultsAndPublicEndpoint(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/admin/settings", nil)
	req.AddCookie(adminCookie)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	groups := tagCatalogFromBody(t, res.Body)
	res.Body.Close()
	want := []string{"工具", "话题", "功能", "UI", "音乐", "背景", "杂项", "小游戏", "窗口反应", "整活", "浪漫", "ai"}
	if strings.Join(tagGroupNames(groups), ",") != strings.Join(want, ",") {
		t.Fatalf("default catalog = %v, want %v", tagGroupNames(groups), want)
	}
	for _, g := range groups {
		if len(g.Children) != 0 {
			t.Fatalf("default catalog must be childless, got %v -> %v", g.Name, g.Children)
		}
	}

	// Public read works anonymously and carries the settings revision.
	publicRes, err := http.Get(server.URL + "/api/v1/tags")
	if err != nil {
		t.Fatal(err)
	}
	var public struct {
		Groups   []TagGroup `json:"groups"`
		Revision uint64     `json:"revision"`
	}
	if err := json.NewDecoder(publicRes.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	publicRes.Body.Close()
	if publicRes.StatusCode != 200 || len(public.Groups) != 12 || public.Revision != 0 {
		t.Fatalf("public catalog = %d %+v", publicRes.StatusCode, public)
	}

	// Saving a hierarchical catalog persists and is visible to the public read.
	res, decoded := patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF,
		`{"tag_catalog":[{"name":"工具","children":["绘图","脚本"]},{"name":"音乐"}],"revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("save tag catalog = %d %+v", res.StatusCode, decoded)
	}
	publicRes, err = http.Get(server.URL + "/api/v1/tags")
	if err != nil {
		t.Fatal(err)
	}
	public = struct {
		Groups   []TagGroup `json:"groups"`
		Revision uint64     `json:"revision"`
	}{}
	if err := json.NewDecoder(publicRes.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	publicRes.Body.Close()
	if len(public.Groups) != 2 || public.Groups[0].Name != "工具" || len(public.Groups[0].Children) != 2 || public.Revision != 1 {
		t.Fatalf("catalog after save = %+v", public)
	}

	// A reload keeps the saved catalog instead of falling back to defaults.
	reopened, err := NewStore(store.DataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	reopened.mu.RLock()
	persisted := reopened.effectiveTagCatalogLocked()
	reopened.mu.RUnlock()
	if len(persisted) != 2 || persisted[0].Name != "工具" {
		t.Fatalf("catalog was not persisted: %+v", persisted)
	}
}

func TestAdminTagCatalogValidation(t *testing.T) {
	store, adminCookie, adminCSRF, userCookie, userCSRF := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res, _ := patchAdminSettingsJSON(t, server.URL, userCookie, userCSRF, `{"tag_catalog":[{"name":"工具"}],"revision":0}`)
	if res.StatusCode != 403 {
		t.Fatalf("non-admin catalog edit = %d, want 403", res.StatusCode)
	}

	cases := []struct {
		name string
		body string
	}{
		{"empty catalog", `{"tag_catalog":[],"revision":0}`},
		{"blank parent", `{"tag_catalog":[{"name":"  "}],"revision":0}`},
		{"too long", `{"tag_catalog":[{"name":"` + strings.Repeat("标", 25) + `"}],"revision":0}`},
		{"comma", `{"tag_catalog":[{"name":"工,具"}],"revision":0}`},
		{"hash", `{"tag_catalog":[{"name":"#工具"}],"revision":0}`},
		{"duplicate parent", `{"tag_catalog":[{"name":"工具"},{"name":"工具"}],"revision":0}`},
		{"parent equals child", `{"tag_catalog":[{"name":"工具","children":["工具"]}],"revision":0}`},
		{"child shared by two parents", `{"tag_catalog":[{"name":"工具","children":["绘图"]},{"name":"功能","children":["绘图"]}],"revision":0}`},
		{"too many children", `{"tag_catalog":[{"name":"工具","children":["a","b","c","d","e","f","g"]}],"revision":0}`},
		{"control char", `{"tag_catalog":[{"name":"工\t具"}],"revision":0}`},
	}
	for _, tc := range cases {
		res, decoded := patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF, tc.body)
		if res.StatusCode != 400 {
			t.Fatalf("%s: status = %d, want 400 (%+v)", tc.name, res.StatusCode, decoded)
		}
		if decoded["code"] != "invalid_tag_catalog" {
			t.Fatalf("%s: code = %v, want invalid_tag_catalog", tc.name, decoded["code"])
		}
	}

	// Duplicates and padding are normalized instead of rejected.
	res, decoded := patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF,
		`{"tag_catalog":[{"name":" 工具 ","children":["绘图"," 绘图 "]}],"revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("normalizing save = %d %+v", res.StatusCode, decoded)
	}
	if group := store.Catalog.Settings.TagCatalog; len(group) != 1 || group[0].Name != "工具" || len(group[0].Children) != 1 || group[0].Children[0] != "绘图" {
		t.Fatalf("catalog was not normalized: %+v", group)
	}

	// A non-catalog settings field must still be editable on its own.
	res, decoded = patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF, `{"github_proxy_template":"","revision":1}`)
	if res.StatusCode != 200 {
		t.Fatalf("unrelated settings edit = %d %+v", res.StatusCode, decoded)
	}

	// Empty patch still reports the same validation error as before.
	res, decoded = patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF, `{"revision":2}`)
	if res.StatusCode != 400 || decoded["code"] != "validation_failed" {
		t.Fatalf("empty patch = %d %+v", res.StatusCode, decoded)
	}
}

func authorModRequest(t *testing.T, method, url, cookie, body string) (*http.Response, Mod) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: cookie})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var mod Mod
	_ = json.NewDecoder(res.Body).Decode(&mod)
	return res, mod
}

func TestModTagsValidationAndParentCompletion(t *testing.T) {
	store, _, _, _, _ := createTestStoreWithAdmin(t)
	store.Catalog.Settings.TagCatalog = []TagGroup{
		{Name: "工具", Children: []string{"绘图", "脚本"}},
		{Name: "音乐"},
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	token := strings.Repeat("c", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "flarum:9", DisplayName: "Author"}, Roles: []string{"author"}, CSRF: "csrf", Expires: time.Now().Add(time.Hour)}

	base := `{"title":"Demo","summary":"s","description":"d","category":"submod","supported_platforms":["windows"],"mas_version_range":"","recommended_priority":1`

	// No tag at all is rejected: every mod must carry at least one.
	res, _ := authorModRequest(t, http.MethodPost, server.URL+"/api/v1/author/mods", token, base+`,"tags":[]}`)
	if res.StatusCode != 400 {
		t.Fatalf("missing tags = %d, want 400", res.StatusCode)
	}

	// A name outside the catalog is rejected.
	res, _ = authorModRequest(t, http.MethodPost, server.URL+"/api/v1/author/mods", token, base+`,"tags":["dialogue"]}`)
	if res.StatusCode != 400 {
		t.Fatalf("unknown tag = %d, want 400", res.StatusCode)
	}
	store.mu.RLock()
	if len(store.Catalog.Mods) != 0 {
		store.mu.RUnlock()
		t.Fatalf("rejected drafts must not be stored: %+v", store.Catalog.Mods)
	}
	store.mu.RUnlock()

	// Picking a child completes its parent, dedupes, and follows catalog order.
	res, mod := authorModRequest(t, http.MethodPost, server.URL+"/api/v1/author/mods", token, base+`,"tags":[" 脚本 ","音乐","脚本"]}`)
	if res.StatusCode != 201 {
		t.Fatalf("valid draft = %d", res.StatusCode)
	}
	if strings.Join(mod.Tags, ",") != "工具,脚本,音乐" {
		t.Fatalf("normalized tags = %v, want [工具 脚本 音乐]", mod.Tags)
	}

	// Editing rejects unknown tags and empty tags without touching the stored mod.
	res, _ = authorModRequest(t, http.MethodPatch, server.URL+"/api/v1/author/mods/"+mod.ID, token,
		`{"title":"Demo","summary":"s","description":"d","category":"submod","tags":["nope"],"supported_platforms":["windows"],"recommended_priority":1}`)
	if res.StatusCode != 400 {
		t.Fatalf("unknown tag on edit = %d, want 400", res.StatusCode)
	}
	res, _ = authorModRequest(t, http.MethodPatch, server.URL+"/api/v1/author/mods/"+mod.ID, token,
		`{"title":"Demo","summary":"s","description":"d","category":"submod","tags":[],"supported_platforms":["windows"],"recommended_priority":1}`)
	if res.StatusCode != 400 {
		t.Fatalf("empty tags on edit = %d, want 400", res.StatusCode)
	}
	store.mu.RLock()
	stored := store.Catalog.Mods[0].Tags
	store.mu.RUnlock()
	if strings.Join(stored, ",") != "工具,脚本,音乐" {
		t.Fatalf("rejected edit changed tags: %v", stored)
	}

	// Selecting the parent alone is allowed.
	res, updated := authorModRequest(t, http.MethodPatch, server.URL+"/api/v1/author/mods/"+mod.ID, token,
		`{"title":"Demo","summary":"s","description":"d","category":"submod","tags":["工具"],"supported_platforms":["windows"],"recommended_priority":1}`)
	if res.StatusCode != 200 || strings.Join(updated.Tags, ",") != "工具" {
		t.Fatalf("parent-only edit = %d %v", res.StatusCode, updated.Tags)
	}

	// The cap counts parents that were completed from children.
	store.mu.Lock()
	store.Catalog.Settings.TagCatalog = []TagGroup{
		{Name: "A", Children: []string{"a1", "a2", "a3", "a4", "a5"}},
		{Name: "B", Children: []string{"b1", "b2", "b3", "b4", "b5"}},
	}
	store.mu.Unlock()
	res, _ = authorModRequest(t, http.MethodPatch, server.URL+"/api/v1/author/mods/"+mod.ID, token,
		`{"title":"Demo","summary":"s","description":"d","category":"submod","tags":["a1","a2","a3","a4","a5","b1","b2"],"supported_platforms":["windows"],"recommended_priority":1}`)
	if res.StatusCode != 400 {
		t.Fatalf("over cap = %d, want 400", res.StatusCode)
	}
}

func TestTagCatalogSavePrunesModTags(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	store.mu.Lock()
	store.Catalog.Mods = []Mod{
		{ID: "mod_keep", Title: "Keep", Category: "submod", Tags: []string{"工具", "旧标签"}},
		{ID: "mod_clean", Title: "Clean", Category: "submod", Tags: []string{"旧标签"}},
		{ID: "mod_untouched", Title: "Untouched", Category: "submod", Tags: []string{"工具"}},
	}
	store.mu.Unlock()
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res, decoded := patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF,
		`{"tag_catalog":[{"name":"工具","children":["绘图"]}],"revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("save catalog = %d %+v", res.StatusCode, decoded)
	}

	store.mu.RLock()
	keep := store.Catalog.Mods[0].Tags
	cleaned := store.Catalog.Mods[1].Tags
	untouched := store.Catalog.Mods[2].Tags
	audit := store.Catalog.SettingsAudit[len(store.Catalog.SettingsAudit)-1]
	store.mu.RUnlock()

	if strings.Join(keep, ",") != "工具" || len(cleaned) != 0 || strings.Join(untouched, ",") != "工具" {
		t.Fatalf("pruned tags = %v / %v / %v", keep, cleaned, untouched)
	}
	if !audit.TagsChanged || audit.PrunedModTags != 2 {
		t.Fatalf("audit = %+v, want TagsChanged with 2 pruned mods", audit)
	}
}
