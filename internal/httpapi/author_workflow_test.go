package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The generated workflow is what authors actually copy, so it has to name the
// hub that served it and the exact endpoint that exists.
func TestAuthorWorkflowSnippetTargetsTheServingHub(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "mod_gh", Title: "GH", Category: "submod",
		Author: Author{ID: "author_1"}, SourceType: "github_releases",
		GitHubOwner: "reze", GitHubRepo: "demo",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/author/mods/mod_gh/github-workflow", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	var payload struct {
		Path      string `json:"path"`
		Content   string `json:"content"`
		NotifyURL string `json:"notify_url"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Path != AuthorWorkflowPath {
		t.Fatalf("expected the GitHub workflow path, got %q", payload.Path)
	}
	// The snippet must be copy-paste runnable against this server.
	if !strings.Contains(payload.Content, payload.NotifyURL) {
		t.Fatalf("generated workflow does not call %q:\n%s", payload.NotifyURL, payload.Content)
	}
	if !strings.Contains(payload.Content, server.URL) {
		t.Fatalf("generated workflow does not target the serving hub %q", server.URL)
	}
	if !strings.Contains(payload.Content, "types: [published]") {
		t.Fatal("drafts must not notify: the trigger has to be published only")
	}
	// No secret is involved, and the file must parse as YAML for GitHub to run it.
	if strings.Contains(payload.Content, "secrets.") {
		t.Fatal("the generated workflow must not require author configuration")
	}
}

// A mod that is not GitHub-backed has nothing to notify about.
func TestAuthorWorkflowRejectsNonGitHubMod(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "mod_local", Title: "L", Category: "submod",
		Author: Author{ID: "author_1"}, SourceType: "local",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("b", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/author/mods/mod_local/github-workflow", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.StatusCode)
	}
}

// The draft form has no mod yet, so the template route must serve the same body
// the per-mod route would, without any mod existing.
func TestAuthorWorkflowTemplateNeedsNoMod(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/author/workflow-template", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	var payload struct {
		Path      string `json:"path"`
		Content   string `json:"content"`
		NotifyURL string `json:"notify_url"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Path != AuthorWorkflowPath {
		t.Fatalf("path = %q, want %q", payload.Path, AuthorWorkflowPath)
	}
	if !strings.Contains(payload.Content, payload.NotifyURL) {
		t.Fatalf("content does not call the notify URL it advertises (%q)", payload.NotifyURL)
	}
	if !strings.Contains(payload.Content, "types: [published]") {
		t.Fatal("template must trigger on published releases only")
	}
	if strings.Contains(payload.Content, "secrets.") {
		t.Fatal("template must not reference repository secrets")
	}
}

// The template is author-facing guidance, not public data: an anonymous caller
// gets the same 401 the rest of /author/* gives.
func TestAuthorWorkflowTemplateRequiresSession(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res, err := server.Client().Get(server.URL + "/api/v1/author/workflow-template")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.StatusCode)
	}
}

// The workflow embeds the mod's own regexes: without them the notification
// cannot tell a publishable release from a docs-only one.
func TestAuthorWorkflowEmbedsTheModsPlatformRegexes(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{
		{
			ID: "mod_split", Title: "Split", Category: "submod",
			Author: Author{ID: "author_1"}, SourceType: "github_releases",
			GitHubOwner: "reze", GitHubRepo: "split",
			GitHubPlatformAssets: []GitHubPlatformRule{
				{Platform: "windows", Regex: `MyMod-windows\.zip$`},
				{Platform: "android", Regex: `MyMod-android\.zip$`},
			},
		},
		{
			ID: "mod_shared", Title: "Shared", Category: "submod",
			Author: Author{ID: "author_1"}, SourceType: "github_releases",
			GitHubOwner: "reze", GitHubRepo: "shared",
			GitHubAssetRegex: `^MyMod.*\.zip$`,
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	fetch := func(modID string) (string, workflowPlatformRules) {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/author/mods/"+modID+"/github-workflow", nil)
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var payload struct {
			Content string                `json:"content"`
			Rules   workflowPlatformRules `json:"rules"`
		}
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload.Content, payload.Rules
	}

	splitBody, splitRules := fetch("mod_split")
	if splitRules.Windows == "" || splitRules.Android == "" {
		t.Fatalf("split rules not reported: %+v", splitRules)
	}
	if !strings.Contains(splitBody, "MyMod-windows") || !strings.Contains(splitBody, "MyMod-android") {
		t.Fatalf("workflow does not embed the per-platform regexes: %s", splitBody)
	}

	sharedBody, sharedRules := fetch("mod_shared")
	if sharedRules.Shared == "" || sharedRules.Windows != "" {
		t.Fatalf("shared rules not reported correctly: %+v", sharedRules)
	}
	if !strings.Contains(sharedBody, "MyMod") {
		t.Fatalf("workflow does not embed the shared regex: %s", sharedBody)
	}
}

// The template route takes the regexes as query parameters so the draft form can
// preview the exact file it is about to hand out.
func TestAuthorWorkflowTemplateEmbedsQueryRegexes(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet,
		server.URL+"/api/v1/author/workflow-template?windows=MyMod-windows&android=MyMod-android", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var payload struct {
		Content string                `json:"content"`
		Rules   workflowPlatformRules `json:"rules"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Rules.Windows != "MyMod-windows" || payload.Rules.Android != "MyMod-android" {
		t.Fatalf("query regexes not echoed: %+v", payload.Rules)
	}
	if !strings.Contains(payload.Content, "MyMod-windows") {
		t.Fatalf("template does not embed the query regexes: %s", payload.Content)
	}
}

// A malformed pattern must be reported rather than stored, or the workflow would
// carry something the hub cannot compile.
func TestWorkflowRuleSetRejectsBrokenRegex(t *testing.T) {
	if err := validateWorkflowRuleSet(workflowPlatformRules{Windows: "MyMod-["}); err == nil {
		t.Fatal("expected a broken regex to be rejected")
	}
	if err := validateWorkflowRuleSet(workflowPlatformRules{Shared: `^MyMod.*\.zip$`, Android: `a`}); err != nil {
		t.Fatalf("valid patterns rejected: %v", err)
	}
	if err := validateWorkflowRuleSet(workflowPlatformRules{}); err != nil {
		t.Fatalf("an empty rule set is the legacy case and must be allowed: %v", err)
	}
}

// A regex containing backslashes must survive into the workflow as valid JSON.
// YAML single-quoting would emit them verbatim and produce an unparseable body,
// which is exactly the kind of breakage an author cannot diagnose from outside.
func TestAuthorWorkflowKeepsBackslashesJSONSafe(t *testing.T) {
	pattern := `^MyMod-\d+\.\d+\.zip$`
	body := renderAuthorWorkflow("https://hub.example", workflowPlatformRules{Shared: pattern})

	if strings.Contains(body, "REZEHUB_RULES: '") {
		t.Fatalf("rules must not use YAML single quotes, which pass backslashes through verbatim:\n%s", body)
	}
	// The embedded line is a JSON object whose "shared" value must decode back to
	// the exact pattern the author typed.
	start := strings.Index(body, `{"shared":`)
	if start < 0 {
		t.Fatalf("workflow does not embed the rules object:\n%s", body)
	}
	end := strings.Index(body[start:], "}") + start + 1
	var decoded workflowPlatformRules
	if err := json.Unmarshal([]byte(body[start:end]), &decoded); err != nil {
		t.Fatalf("embedded rules are not valid JSON: %v", err)
	}
	if decoded.Shared != pattern {
		t.Fatalf("pattern round-trip lost information: got %q want %q", decoded.Shared, pattern)
	}
}

// A source-only mod has no asset name to embed, but the notification is still
// the only push signal it can get: the file must be offered and must say that
// the Release source archive is the package instead of describing patterns the
// author never entered.
func TestAuthorWorkflowAdaptsToSourceOnlyMod(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "mod_source", Title: "Source", Category: "submod",
		Author: Author{ID: "author_1"}, SourceType: "github_releases",
		GitHubOwner: "reze", GitHubRepo: "source",
		GitHubSourceCode: true,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/author/mods/mod_source/github-workflow", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for a source-only mod, got %d", res.StatusCode)
	}
	var payload struct {
		Content string                `json:"content"`
		Rules   workflowPlatformRules `json:"rules"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Rules.Shared != "" || !payload.Rules.SharedSourceCode {
		t.Fatalf("source-only rules not reported: %+v", payload.Rules)
	}
	if !strings.Contains(payload.Content, `"shared_source_code":true`) {
		t.Fatalf("workflow does not embed the source-archive fallback:\n%s", payload.Content)
	}
	if !strings.Contains(payload.Content, "source archive") {
		t.Fatalf("workflow never mentions the source archive:\n%s", payload.Content)
	}
	if strings.Contains(payload.Content, "The PC/Android patterns below") {
		t.Fatalf("source-only workflow still claims the author configured patterns:\n%s", payload.Content)
	}
}

// Split delivery applies the fallback per platform, so the flag has to be
// carried per platform as well.
func TestAuthorWorkflowReportsPerPlatformSourceArchive(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "mod_split_source", Title: "Split source", Category: "submod",
		Author: Author{ID: "author_1"}, SourceType: "github_releases",
		GitHubOwner: "reze", GitHubRepo: "split-source",
		GitHubPlatformAssets: []GitHubPlatformRule{
			{Platform: "windows", Regex: `MyMod-windows\.zip$`},
			{Platform: "android", SourceCode: true},
		},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/author/mods/mod_split_source/github-workflow", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var payload struct {
		Content string                `json:"content"`
		Rules   workflowPlatformRules `json:"rules"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Rules.WindowsSourceCode || !payload.Rules.AndroidSourceCode {
		t.Fatalf("per-platform source fallback not reported: %+v", payload.Rules)
	}
	if !strings.Contains(payload.Content, `"android_source_code":true`) {
		t.Fatalf("workflow does not embed the android fallback:\n%s", payload.Content)
	}
}

// The draft form has no stored mod, so it must be able to describe a
// source-archive fallback through the template parameters.
func TestAuthorWorkflowTemplateAcceptsSourceCodeFlags(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/author/workflow-template?shared_source_code=1", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	var payload struct {
		Content string                `json:"content"`
		Rules   workflowPlatformRules `json:"rules"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Rules.SharedSourceCode {
		t.Fatalf("template ignored the source-code flag: %+v", payload.Rules)
	}
	if !strings.Contains(payload.Content, `"shared_source_code":true`) {
		t.Fatalf("template does not embed the source-code flag:\n%s", payload.Content)
	}
}
