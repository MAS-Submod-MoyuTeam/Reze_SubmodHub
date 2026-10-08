package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
)

func TestGitHubSourceAPIAndPermissions(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:         "mod_1",
				Title:      "Demo Mod",
				Summary:    "Summary",
				Category:   "submod",
				Author:     Author{ID: "author_1", DisplayName: "Author One"},
				SourceType: "local",
			},
		},
		RoleGrants: map[string][]string{
			"admin_1": {"admin"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	authorToken := strings.Repeat("a", 64)
	otherToken := strings.Repeat("b", 64)
	adminToken := strings.Repeat("c", 64)

	store.sessions[sessionKey(authorToken)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	store.sessions[sessionKey(otherToken)] = authSession{User: authUser{ID: "other_user"}, Expires: time.Now().Add(time.Hour)}
	store.sessions[sessionKey(adminToken)] = authSession{User: authUser{ID: "admin_1"}, Expires: time.Now().Add(time.Hour)}

	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// 1. Other user forbidden from patching /source
	body := `{"source_type":"github_releases","github_owner":"octocat","github_repo":"hello","github_asset_regex":".*\\.zip"}`
	req, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/author/mods/mod_1/source", bytes.NewBufferString(body))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: otherToken})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author, got %d", res.StatusCode)
	}
	res.Body.Close()

	// 2. Author can patch /source
	req, _ = http.NewRequest(http.MethodPatch, server.URL+"/api/v1/author/mods/mod_1/source", bytes.NewBufferString(body))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	res, err = server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for author, got %d", res.StatusCode)
	}
	var mod Mod
	_ = json.NewDecoder(res.Body).Decode(&mod)
	res.Body.Close()
	if mod.SourceType != "github_releases" || mod.GitHubOwner != "octocat" {
		t.Fatalf("unexpected updated mod: %+v", mod)
	}

	// 3. In github_releases mode, POST /author/mods/{id}/versions is blocked with 409 github_source_managed
	verBody := `{"version":"1.0.0","release_notes":"notes"}`
	req, _ = http.NewRequest(http.MethodPost, server.URL+"/api/v1/author/mods/mod_1/versions", bytes.NewBufferString(verBody))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	res, err = server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 conflict, got %d", res.StatusCode)
	}
	var errResp struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(res.Body).Decode(&errResp)
	res.Body.Close()
	if errResp.Code != "github_source_managed" {
		t.Fatalf("expected code github_source_managed, got %q", errResp.Code)
	}
}

func TestPublicVersionEndpointsHideGitHubSourceURL(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{{
			ID:              "mod_1",
			Title:           "Demo Mod",
			LatestVersionID: "ver_1",
			Author:          Author{ID: "author_1"},
		}},
		Versions: map[string]Version{
			"ver_1": {
				ID:      "ver_1",
				ModID:   "mod_1",
				Version: "1.0.0",
				State:   "published",
				SHA256:  strings.Repeat("a", 64),
				GitHubSource: &VersionSourceLocation{
					DownloadURL: "https://github.com/octocat/demo/releases/download/v1/demo.zip?token=secret",
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	for _, endpoint := range []string{
		"/api/v1/mods/mod_1/versions/ver_1",
		"/api/v1/mods/mod_1/versions",
	} {
		res, err := server.Client().Get(server.URL + endpoint)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			res.Body.Close()
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s: expected 200, got %d", endpoint, res.StatusCode)
		}
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(encoded), "github_source") || strings.Contains(string(encoded), "releases/download") || strings.Contains(string(encoded), "secret") {
			t.Fatalf("GET %s exposed GitHub source details: %s", endpoint, encoded)
		}
	}
}

func TestGitHubManualSyncEndpoint(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	entry, _ := zw.Create("game/Submods/demo/main.rpy")
	_, _ = entry.Write([]byte("init python:\n    pass\n"))
	_ = zw.Close()
	zipData := buf.Bytes()

	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/hello/releases" {
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `[
				{
					"id": 888,
					"tag_name": "v1.5.0",
					"name": "Release 1.5.0",
					"assets": [
						{
							"id": 999,
							"name": "demo.zip",
							"size": 1024,
							"browser_download_url": "%s/download/demo.zip"
						}
					]
				}
			]`, ghServer.URL)
			return
		}
		if r.URL.Path == "/download/demo.zip" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(zipData)
			return
		}
		http.NotFound(w, r)
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:               "mod_1",
				Title:            "Demo Mod",
				Summary:          "Summary",
				Category:         "submod",
				Author:           Author{ID: "author_1", DisplayName: "Author One"},
				SourceType:       "github_releases",
				GitHubOwner:      "octocat",
				GitHubRepo:       "hello",
				GitHubAssetRegex: `.*\.zip`,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	authorToken := strings.Repeat("a", 64)
	store.sessions[sessionKey(authorToken)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}

	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// POST /api/v1/author/mods/mod_1/github-sync
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/author/mods/mod_1/github-sync", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	var summary SyncSummary
	if err := json.NewDecoder(res.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	if summary.Created != 1 || len(summary.Items) != 1 || summary.Items[0].Tag != "v1.5.0" {
		t.Fatalf("unexpected summary: %+v", summary)
	}
}

func TestGitHubManagedVersionEditRules(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:         "mod_1",
				Title:      "Demo",
				Category:   "submod",
				Author:     Author{ID: "author_1"},
				SourceType: "github_releases",
			},
		},
		Versions: map[string]Version{
			"ver_gh": {
				ID:           "ver_gh",
				ModID:        "mod_1",
				Version:      "v1.0.0",
				State:        "uploaded",
				SourceType:   "github_releases",
				ReleaseNotes: "Original notes",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	authorToken := strings.Repeat("a", 64)
	store.sessions[sessionKey(authorToken)] = authSession{User: authUser{ID: "author_1"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// 1. Attempting to change version tag fails with 409 github_source_managed
	editTagBody := `{"version":"v2.0.0","release_notes":"New notes"}`
	req, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/author/versions/ver_gh/edit", bytes.NewBufferString(editTagBody))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 conflict, got %d", res.StatusCode)
	}
	var errResp struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(res.Body).Decode(&errResp)
	res.Body.Close()
	if errResp.Code != "github_source_managed" {
		t.Fatalf("expected code github_source_managed, got %q", errResp.Code)
	}

	// 2. Keeping same tag and updating notes succeeds
	editNotesBody := `{"version":"v1.0.0","release_notes":"Updated notes"}`
	req, _ = http.NewRequest(http.MethodPatch, server.URL+"/api/v1/author/versions/ver_gh/edit", bytes.NewBufferString(editNotesBody))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	res, err = server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	var updated Version
	_ = json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if updated.ReleaseNotes != "Updated notes" || updated.Version != "v1.0.0" {
		t.Fatalf("unexpected edited version: %+v", updated)
	}
}
