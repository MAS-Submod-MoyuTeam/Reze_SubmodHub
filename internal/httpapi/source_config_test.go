package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSourceConfigLegacyJSONDecodesAsLocal(t *testing.T) {
	legacyJSON := `{
		"id": "mod_legacy",
		"title": "Legacy Mod",
		"summary": "Summary",
		"author": {"id": "author1", "display_name": "Author 1"},
		"category": "submod"
	}`
	var mod Mod
	if err := json.Unmarshal([]byte(legacyJSON), &mod); err != nil {
		t.Fatalf("failed to unmarshal legacy mod JSON: %v", err)
	}
	if mod.GetSourceType() != "local" {
		t.Fatalf("expected legacy mod source type to be local, got %q", mod.GetSourceType())
	}
}

func TestSourceConfigCreateAndValidateGitHubSource(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author1", DisplayName: "Author One"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// 1. Invalid combinations: github_releases with invalid regex
	invalidPayloads := []string{
		// Invalid regex syntax
		`{"title":"T","summary":"S","category":"submod","source_type":"github_releases","github_owner":"octocat","github_repo":"hello","github_asset_regex":"[unclosed"}`,
		// Missing repo
		`{"title":"T","summary":"S","category":"submod","source_type":"github_releases","github_owner":"octocat","github_repo":"","github_asset_regex":".*\\.zip"}`,
		// Missing owner
		`{"title":"T","summary":"S","category":"submod","source_type":"github_releases","github_owner":"","github_repo":"hello","github_asset_regex":".*\\.zip"}`,
		// Invalid owner with path traversal/slash
		`{"title":"T","summary":"S","category":"submod","source_type":"github_releases","github_owner":"octo/cat","github_repo":"hello","github_asset_regex":".*\\.zip"}`,
		// Unknown source_type
		`{"title":"T","summary":"S","category":"submod","source_type":"gitlab","github_owner":"octocat","github_repo":"hello"}`,
		// Neither asset regex nor source code fallback enabled
		`{"title":"T","summary":"S","category":"submod","source_type":"github_releases","github_owner":"octocat","github_repo":"hello","github_asset_regex":"","github_source_code":false}`,
	}

	for i, payload := range invalidPayloads {
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/author/mods", bytes.NewBufferString(payload))
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("[%d] expected 400 for invalid payload %s, got %d", i, payload, res.StatusCode)
		}
		var errResp struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(res.Body).Decode(&errResp)
		res.Body.Close()
		if errResp.Code != "validation_failed" {
			t.Fatalf("[%d] expected error code validation_failed, got %s", i, errResp.Code)
		}
	}

	// 2. Valid GitHub configuration
	validPayload := `{
		"title": "GitHub Mod",
		"summary": "Summary",
		"category": "submod",
		"source_type": "github_releases",
		"github_owner": "octocat",
		"github_repo": "hello-world",
		"github_asset_regex": "^MyMod.*\\.zip$",
		"github_source_code": true
	}`
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/author/mods", bytes.NewBufferString(validPayload))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for valid github config, got %d", res.StatusCode)
	}
	var created Mod
	if err := json.NewDecoder(res.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	if created.SourceType != "github_releases" {
		t.Fatalf("expected source_type github_releases, got %q", created.SourceType)
	}
	if created.GitHubOwner != "octocat" || created.GitHubRepo != "hello-world" {
		t.Fatalf("unexpected repo coordinates: %s/%s", created.GitHubOwner, created.GitHubRepo)
	}
	if created.GitHubAssetRegex != `^MyMod.*\.zip$` || !created.GitHubSourceCode {
		t.Fatalf("unexpected asset regex or source code setting: %s, %v", created.GitHubAssetRegex, created.GitHubSourceCode)
	}

	// 3. Update mod with invalid regex via PATCH should fail
	patchInvalid := `{"title":"GitHub Mod","summary":"S","category":"submod","github_asset_regex":"[broken-regex"}`
	reqPatchInvalid, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/author/mods/"+created.ID, bytes.NewBufferString(patchInvalid))
	reqPatchInvalid.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	resPatchInvalid, err := server.Client().Do(reqPatchInvalid)
	if err != nil {
		t.Fatal(err)
	}
	if resPatchInvalid.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid patch regex, got %d", resPatchInvalid.StatusCode)
	}
	resPatchInvalid.Body.Close()

	// 4. Update mod to local via PATCH
	patchLocal := `{"title":"GitHub Mod","summary":"S","category":"submod","source_type":"local"}`
	reqPatchLocal, _ := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/author/mods/"+created.ID, bytes.NewBufferString(patchLocal))
	reqPatchLocal.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	resPatchLocal, err := server.Client().Do(reqPatchLocal)
	if err != nil {
		t.Fatal(err)
	}
	if resPatchLocal.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for switching to local, got %d", resPatchLocal.StatusCode)
	}
	var updated Mod
	_ = json.NewDecoder(resPatchLocal.Body).Decode(&updated)
	resPatchLocal.Body.Close()
	if updated.SourceType != "local" {
		t.Fatalf("expected updated source_type to be local, got %q", updated.SourceType)
	}
}

func TestSourceConfigPublicSanitization(t *testing.T) {
	now := time.Now().UTC()
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:                  "m1",
				Title:               "Public Mod",
				Summary:             "Summary",
				Category:            "submod",
				Author:              Author{ID: "author1", DisplayName: "Author One"},
				LatestVersionID:     "v1",
				SourceType:          "github_releases",
				GitHubOwner:         "octocat",
				GitHubRepo:          "hello-world",
				GitHubAssetRegex:    ".*\\.zip",
				GitHubLastSyncAt:    &now,
				GitHubLastSyncError: "rate limit exceeded",
				GitHubLastReleaseID: 12345,
			},
		},
		Versions: map[string]Version{
			"v1": {ID: "v1", ModID: "m1", Version: "1.0.0", State: "published"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// Public GET /api/v1/mods
	res, err := server.Client().Get(server.URL + "/api/v1/mods")
	if err != nil {
		t.Fatal(err)
	}
	var listResp struct {
		Items []Mod `json:"items"`
	}
	if err := json.NewDecoder(res.Body).Decode(&listResp); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	if len(listResp.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(listResp.Items))
	}
	item := listResp.Items[0]
	if item.GitHubLastSyncError != "" || item.GitHubLastSyncAt != nil || item.GitHubLastReleaseID != 0 {
		t.Fatalf("public listing leaked diagnostic sync fields: sync_err=%q, sync_at=%v, release_id=%d",
			item.GitHubLastSyncError, item.GitHubLastSyncAt, item.GitHubLastReleaseID)
	}
	if item.SourceType != "github_releases" || item.GitHubOwner != "octocat" || item.GitHubRepo != "hello-world" {
		t.Fatalf("public listing missing public source coordinates: %+v", item)
	}
}
