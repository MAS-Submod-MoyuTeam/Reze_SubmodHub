package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
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
		Groups   []publicTagWire `json:"groups"`
		Revision uint64          `json:"revision"`
	}
	if err := json.NewDecoder(publicRes.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	publicRes.Body.Close()
	if publicRes.StatusCode != 200 || len(public.Groups) != 12 || public.Revision != 0 {
		t.Fatalf("public catalog = %d %+v", publicRes.StatusCode, public)
	}
	if got := publicRes.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("public catalog must not be cached, got %q", got)
	}

	// Saving a hierarchical catalog persists and is visible to the public read.
	res, decoded := patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF,
		`{"tag_catalog":[{"name":"工具","children":[{"name":"绘图"},{"name":"脚本"}]},{"name":"音乐"}],"revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("save tag catalog = %d %+v", res.StatusCode, decoded)
	}
	publicRes, err = http.Get(server.URL + "/api/v1/tags")
	if err != nil {
		t.Fatal(err)
	}
	public = struct {
		Groups   []publicTagWire `json:"groups"`
		Revision uint64          `json:"revision"`
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
		{"parent equals child", `{"tag_catalog":[{"name":"工具","children":[{"name":"工具"}]}],"revision":0}`},
		{"child shared by two parents", `{"tag_catalog":[{"name":"工具","children":[{"name":"绘图"}]},{"name":"功能","children":[{"name":"绘图"}]}],"revision":0}`},
		{"too many children", `{"tag_catalog":[{"name":"工具","children":[{"name":"a"},{"name":"b"},{"name":"c"},{"name":"d"},{"name":"e"},{"name":"f"},{"name":"g"}]}],"revision":0}`},
		{"control char", `{"tag_catalog":[{"name":"工\t具"}],"revision":0}`},
		{"description too long", `{"tag_catalog":[{"name":"工具","description":{"zh":"` + strings.Repeat("描", 61) + `"}}],"revision":0}`},
		{"child description too long", `{"tag_catalog":[{"name":"工具","children":[{"name":"绘图","description":{"zh":"` + strings.Repeat("描", 61) + `"}}]}],"revision":0}`},
		{"description control char", `{"tag_catalog":[{"name":"工具","description":{"zh":"两\n行"}}],"revision":0}`},
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
		`{"tag_catalog":[{"name":" 工具 ","children":[{"name":"绘图"},{"name":" 绘图 "}]}],"revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("normalizing save = %d %+v", res.StatusCode, decoded)
	}
	if group := store.Catalog.Settings.TagCatalog; len(group) != 1 || group[0].Name != "工具" || len(group[0].Children) != 1 || group[0].Children[0].Name != "绘图" {
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
		{Name: "工具", Children: []TagChild{{Name: "绘图"}, {Name: "脚本"}}},
		{Name: "音乐"},
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	token := strings.Repeat("c", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "flarum:9", DisplayName: "Author"}, GroupIDs: []string{}, CSRF: "csrf", Expires: time.Now().Add(time.Hour)}

	base := `{"title":"Demo","summary":{"zh":"s"},"description":{"zh":"d"},"category":"submod","supported_platforms":["windows"],"mas_version_range":"","recommended_priority":1`

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
		`{"title":"Demo","summary":{"zh":"s"},"description":{"zh":"d"},"category":"submod","tags":["nope"],"supported_platforms":["windows"],"recommended_priority":1}`)
	if res.StatusCode != 400 {
		t.Fatalf("unknown tag on edit = %d, want 400", res.StatusCode)
	}
	res, _ = authorModRequest(t, http.MethodPatch, server.URL+"/api/v1/author/mods/"+mod.ID, token,
		`{"title":"Demo","summary":{"zh":"s"},"description":{"zh":"d"},"category":"submod","tags":[],"supported_platforms":["windows"],"recommended_priority":1}`)
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
		`{"title":"Demo","summary":{"zh":"s"},"description":{"zh":"d"},"category":"submod","tags":["工具"],"supported_platforms":["windows"],"recommended_priority":1}`)
	if res.StatusCode != 200 || strings.Join(updated.Tags, ",") != "工具" {
		t.Fatalf("parent-only edit = %d %v", res.StatusCode, updated.Tags)
	}

	// The cap counts parents that were completed from children.
	store.mu.Lock()
	store.Catalog.Settings.TagCatalog = []TagGroup{
		{Name: "A", Children: []TagChild{{Name: "a1"}, {Name: "a2"}, {Name: "a3"}, {Name: "a4"}, {Name: "a5"}}},
		{Name: "B", Children: []TagChild{{Name: "b1"}, {Name: "b2"}, {Name: "b3"}, {Name: "b4"}, {Name: "b5"}}},
	}
	store.mu.Unlock()
	res, _ = authorModRequest(t, http.MethodPatch, server.URL+"/api/v1/author/mods/"+mod.ID, token,
		`{"title":"Demo","summary":{"zh":"s"},"description":{"zh":"d"},"category":"submod","tags":["a1","a2","a3","a4","a5","b1","b2"],"supported_platforms":["windows"],"recommended_priority":1}`)
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
		`{"tag_catalog":[{"name":"工具","children":[{"name":"绘图"}]}],"revision":0}`)
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

// Descriptions are catalog data, not UI-only decoration: the admin writes them
// once, the public catalog returns them, and an edit counts as a revision bump
// so cached clients notice the sentence changed.
func TestTagCatalogDescriptionsPersistAndArePublic(t *testing.T) {
	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res, decoded := patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF,
		`{"tag_catalog":[{"name":" 工具 ","display_name":{"en":" Tools "},"description":{"zh":" 自动修复与诊断类模组 ","en":"Auto fixes and diagnostics"},"children":[{"name":"绘图","display_name":{"en":"Drawing"},"description":{"zh":"生成与编辑图片"}}]},{"name":"音乐","description":{"zh":""}}],"revision":0}`)
	if res.StatusCode != 200 {
		t.Fatalf("save catalog with descriptions = %d %+v", res.StatusCode, decoded)
	}

	publicRes, err := http.Get(server.URL + "/api/v1/tags")
	if err != nil {
		t.Fatal(err)
	}
	var public struct {
		Groups   []publicTagWire `json:"groups"`
		Revision uint64          `json:"revision"`
		Lang     string          `json:"lang"`
	}
	if err := json.NewDecoder(publicRes.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	publicRes.Body.Close()

	if len(public.Groups) != 2 {
		t.Fatalf("groups = %+v", public.Groups)
	}
	// Trimmed on the way in, preserved on the way out.
	if public.Groups[0].Description["zh"] != "自动修复与诊断类模组" {
		t.Fatalf("main description = %q", public.Groups[0].Description)
	}
	if public.Groups[0].DescriptionText != "自动修复与诊断类模组" {
		t.Fatalf("main description_text = %q", public.Groups[0].DescriptionText)
	}
	if public.Groups[0].DisplayName.For("en") != "Tools" || public.Groups[0].Label != "工具" {
		t.Fatalf("main display name = %+v label = %q", public.Groups[0].DisplayName, public.Groups[0].Label)
	}
	if len(public.Groups[0].Children) != 1 || public.Groups[0].Children[0].Description.For("zh") != "生成与编辑图片" {
		t.Fatalf("child description = %+v", public.Groups[0].Children)
	}
	// An empty description is dropped rather than stored as "".
	if len(public.Groups[1].Description) != 0 {
		t.Fatalf("blank description should stay empty, got %+v", public.Groups[1].Description)
	}
	// A group with no localized label falls back to its canonical name.
	if public.Groups[1].Label != "音乐" {
		t.Fatalf("untranslated label = %q, want the canonical name", public.Groups[1].Label)
	}

	// Editing only a description is still a catalog change: the audit trail has
	// to say so, otherwise "who changed the wording" is unanswerable.
	before := public.Revision
	res, decoded = patchAdminSettingsJSON(t, server.URL, adminCookie, adminCSRF,
		`{"tag_catalog":[{"name":"工具","description":{"zh":"换了一句解释"},"children":[{"name":"绘图","description":{"zh":"生成与编辑图片"}}]},{"name":"音乐"}],"revision":`+strconv.FormatUint(before, 10)+`}`)
	if res.StatusCode != 200 {
		t.Fatalf("description-only edit = %d %+v", res.StatusCode, decoded)
	}
	audit := store.Catalog.SettingsAudit
	if len(audit) == 0 || !audit[len(audit)-1].TagsChanged {
		t.Fatalf("a description edit must be recorded as a tag change: %+v", audit)
	}
	if got := store.Catalog.Settings.TagCatalog[0].Description.For("zh"); got != "换了一句解释" {
		t.Fatalf("stored description = %q", got)
	}
}

// Every seeded tag carries an English display name, otherwise a fresh English
// deployment would show only Chinese labels.
func TestDefaultTagCatalogSeedsEnglishDisplayNames(t *testing.T) {
	for _, group := range defaultTagCatalog() {
		if group.DisplayName.For("en") == "" {
			t.Fatalf("seeded tag %q has no English display name", group.Name)
		}
		if group.DisplayName.For("zh") == "" {
			t.Fatalf("seeded tag %q has no Chinese display name", group.Name)
		}
	}
	if got := defaultTagCatalog()[0].DisplayName.For("en"); got != "Tools" {
		t.Fatalf("工具 display name = %q, want Tools", got)
	}
}

// A catalog entry with no localized label still renders: the label is the
// requested language's own value when present, otherwise the canonical Name.
func TestTagDisplayNameFallsBackToCanonicalName(t *testing.T) {
	catalog, err := normalizeTagCatalog([]TagGroup{
		{Name: "工具", DisplayName: LocalizedText{"en": "Tools"}},
		{Name: "自定义", DisplayName: LocalizedText{"zh": "自定义标签"}},
		{Name: "无标签"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := tagLabel(catalog[0].Name, catalog[0].DisplayName, "en"); got != "Tools" {
		t.Fatalf("en label = %q, want Tools", got)
	}
	if got := tagLabel(catalog[0].Name, catalog[0].DisplayName, "zh"); got != "工具" {
		t.Fatalf("zh label must fall back to Name, got %q", got)
	}
	// 只写了中文标签名的条目，英文读者看到存储名：两种语言里至少有一种是
	// 有意义的，而把中文译文硬塞进英文界面只会让人以为整个站点都是中文的。
	if got := tagLabel(catalog[1].Name, catalog[1].DisplayName, "zh"); got != "自定义标签" {
		t.Fatalf("zh label = %q, want 自定义标签", got)
	}
	if got := tagLabel(catalog[1].Name, catalog[1].DisplayName, "en"); got != "自定义" {
		t.Fatalf("en label must fall back to the canonical name, got %q", got)
	}
	if got := tagLabel(catalog[2].Name, catalog[2].DisplayName, "en"); got != "无标签" {
		t.Fatalf("unlabelled tag must fall back to Name, got %q", got)
	}
}

// An unknown language key would be stored and then never rendered, so the admin
// edit is rejected with the same 400 code the mod fields use.
func TestTagCatalogRejectsUnknownLanguage(t *testing.T) {
	_, err := normalizeTagCatalog([]TagGroup{{Name: "工具", Description: LocalizedText{"ja": "ツール"}}})
	if err == nil {
		t.Fatal("expected an unknown-language failure")
	}
	var v *tagViolation
	if !errors.As(err, &v) || v.code != "invalid_tag_catalog" {
		t.Fatalf("violation = %#v", err)
	}
	if _, err := normalizeTagCatalog([]TagGroup{{Name: "工具", DisplayName: LocalizedText{"EN": "Tools"}}}); err == nil {
		t.Fatal("a non-canonical language key must be rejected instead of silently ignored")
	}
}

// The public catalog honours ?lang=: the resolved language is reported and the
// convenience label follows it, while the localized objects stay intact.
func TestPublicTagCatalogResolvesRequestedLanguage(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	for _, tc := range []struct {
		name   string
		query  string
		header string
		want   string
		label  string
	}{
		{"default", "", "", "zh", "工具"},
		{"explicit en", "?lang=en", "", "en", "Tools"},
		{"explicit zh", "?lang=zh-CN", "", "zh", "工具"},
		{"accept-language", "", "en-US,en;q=0.9", "en", "Tools"},
		{"query wins over header", "?lang=zh", "en-US,en;q=0.9", "zh", "工具"},
		{"unknown falls back", "?lang=ja", "", "zh", "工具"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/tags"+tc.query, nil)
			if tc.header != "" {
				req.Header.Set("Accept-Language", tc.header)
			}
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			var payload struct {
				Groups []publicTagWire `json:"groups"`
				Lang   string          `json:"lang"`
			}
			if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if payload.Lang != tc.want {
				t.Fatalf("lang = %q, want %q", payload.Lang, tc.want)
			}
			if len(payload.Groups) == 0 || payload.Groups[0].Label != tc.label {
				t.Fatalf("first label = %+v, want %q", payload.Groups[0], tc.label)
			}
			// The localized object is never stripped down to one language.
			if got := payload.Groups[0].DisplayName["en"]; got != "Tools" {
				t.Fatalf("english display name = %q, want the full object", got)
			}
		})
	}
}
