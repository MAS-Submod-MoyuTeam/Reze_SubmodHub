package httpapi

import (
	"context"
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

func makeCustomZip(t *testing.T, filename, content string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	entry, err := zw.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestGitHubReleaseSourceE2EWorkflow(t *testing.T) {
	v100Zip := makeCustomZip(t, "game/Submods/e2e/main.rpy", `init python:
    pass
`)
	v110SourceZip := makeCustomZip(t, "game/Submods/e2e/v110.rpy", `init python:
    pass
`)
	v120ZipA := makeCustomZip(t, "game/Submods/e2e/v120a.rpy", `init python:
    pass
`)
	v120ZipB := makeCustomZip(t, "game/Submods/e2e/v120b.rpy", `init python:
    pass
`)

	etagHits := 0
	return429 := false

	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if return429 {
			w.WriteHeader(http.StatusTooManyRequests)
			fmt.Fprint(w, `{"message":"API rate limit exceeded"}`)
			return
		}

		if r.URL.Path == "/repos/myorg/mymod/releases" {
			if r.Header.Get("If-None-Match") == `"etag-final"` {
				etagHits++
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", `"etag-final"`)
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `[
				{
					"id": 100,
					"tag_name": "v1.0.0",
					"name": "Release 1.0.0",
					"body": "First release",
					"draft": false,
					"zipball_url": "",
					"assets": [
						{"id": 1, "name": "mymod-1.0.0.zip", "size": 1024, "browser_download_url": "%s/dl/v100.zip"}
					]
				},
				{
					"id": 110,
					"tag_name": "v1.1.0",
					"name": "Release 1.1.0",
					"body": "Source code only release",
					"draft": false,
					"zipball_url": "%s/dl/v110-src.zip",
					"assets": []
				},
				{
					"id": 120,
					"tag_name": "v1.2.0",
					"name": "Release 1.2.0",
					"body": "Multiple assets release",
					"draft": false,
					"zipball_url": "",
					"assets": [
						{"id": 3, "name": "mymod-1.2.0-z-extra.zip", "size": 1024, "browser_download_url": "%s/dl/v120z.zip"},
						{"id": 2, "name": "mymod-1.2.0-a-main.zip", "size": 1024, "browser_download_url": "%s/dl/v120a.zip"}
					]
				}
			]`, ghServer.URL, ghServer.URL, ghServer.URL, ghServer.URL)
			return
		}

		switch r.URL.Path {
		case "/dl/v100.zip":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(v100Zip)
		case "/dl/v110-src.zip":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(v110SourceZip)
		case "/dl/v120a.zip":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(v120ZipA)
		case "/dl/v120z.zip":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(v120ZipB)
		case "/dl/broken.zip":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	authorToken := strings.Repeat("e", 64)
	store.sessions[sessionKey(authorToken)] = authSession{User: authUser{ID: "author_e2e", DisplayName: "Author E2E"}, Expires: time.Now().Add(time.Hour)}

	apiServer := httptest.NewServer(NewStoreHandler(store))
	defer apiServer.Close()

	// 1. Author creates GitHub Releases mod draft
	createPayload := `{
		"title": "E2E GitHub Mod",
		"summary": "Testing full sync workflow",
		"category": "submod",
		"source_type": "github_releases",
		"github_owner": "myorg",
		"github_repo": "mymod",
		"github_asset_regex": "^mymod.*\\.zip$",
		"github_source_code": true
	}`
	req, _ := http.NewRequest(http.MethodPost, apiServer.URL+"/api/v1/author/mods", bytes.NewBufferString(createPayload))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	res, err := apiServer.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create mod failed: %d", res.StatusCode)
	}
	var createdMod Mod
	_ = json.NewDecoder(res.Body).Decode(&createdMod)
	res.Body.Close()

	// 2. In github_releases mode, POST /author/mods/{id}/versions is forbidden
	verReq, _ := http.NewRequest(http.MethodPost, apiServer.URL+"/api/v1/author/mods/"+createdMod.ID+"/versions", bytes.NewBufferString(`{"version":"0.1.0"}`))
	verReq.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	verRes, err := apiServer.Client().Do(verReq)
	if err != nil {
		t.Fatal(err)
	}
	if verRes.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 conflict, got %d", verRes.StatusCode)
	}
	verRes.Body.Close()

	// 3. Trigger manual sync via POST /api/v1/author/mods/{id}/github-sync
	syncReq, _ := http.NewRequest(http.MethodPost, apiServer.URL+"/api/v1/author/mods/"+createdMod.ID+"/github-sync", nil)
	syncReq.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	syncRes, err := apiServer.Client().Do(syncReq)
	if err != nil {
		t.Fatal(err)
	}
	if syncRes.StatusCode != http.StatusOK {
		t.Fatalf("sync failed with status: %d", syncRes.StatusCode)
	}
	var summary SyncSummary
	_ = json.NewDecoder(syncRes.Body).Decode(&summary)
	syncRes.Body.Close()

	// 3 versions should be created:
	// v1.0.0 (asset), v1.1.0 (source code fallback), v1.2.0 (stably chose a-main.zip)
	if summary.Created != 3 || summary.Failed != 0 {
		t.Fatalf("expected 3 created versions, got %+v", summary)
	}

	// Verify versions in store
	store.mu.RLock()
	if len(store.Catalog.Versions) != 3 {
		t.Fatalf("expected 3 versions in catalog, got %d", len(store.Catalog.Versions))
	}
	var v100, v110, v120 Version
	for _, v := range store.Catalog.Versions {
		switch v.Version {
		case "v1.0.0":
			v100 = v
		case "v1.1.0":
			v110 = v
		case "v1.2.0":
			v120 = v
		}
	}
	store.mu.RUnlock()

	if v100.GitHubReleaseID != 100 || v100.State != "ready_for_review" || v100.SHA256 == "" {
		t.Fatalf("v1.0.0 failed validation: %+v", v100)
	}
	if v110.GitHubReleaseID != 110 || v110.State != "ready_for_review" {
		t.Fatalf("v1.1.0 failed validation: %+v", v110)
	}
	if v120.GitHubReleaseID != 120 || v120.GitHubAssetID != 2 {
		t.Fatalf("v1.2.0 did not pick stable first asset (ID 2): %+v", v120)
	}

	// 4. Manual sync refreshes the list and skips already imported versions.
	syncReq2, _ := http.NewRequest(http.MethodPost, apiServer.URL+"/api/v1/author/mods/"+createdMod.ID+"/github-sync", nil)
	syncReq2.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	syncRes2, _ := apiServer.Client().Do(syncReq2)
	var summary2 SyncSummary
	_ = json.NewDecoder(syncRes2.Body).Decode(&summary2)
	syncRes2.Body.Close()
	if summary2.Created != 0 || summary2.Skipped != 3 {
		t.Fatalf("expected 0 created on second sync, got %+v", summary2)
	}
	if etagHits != 0 {
		t.Fatalf("manual sync must bypass ETag, got %d 304 hits", etagHits)
	}
	// Periodic sync still benefits from conditional requests.
	if _, err := store.SyncMod(context.Background(), createdMod.ID); err != nil {
		t.Fatal(err)
	}
	if etagHits != 1 {
		t.Fatalf("expected periodic sync to use ETag, got %d 304 hits", etagHits)
	}

	// 5. Handling HTTP 429 does not crash
	return429 = true
	syncReq429, _ := http.NewRequest(http.MethodPost, apiServer.URL+"/api/v1/author/mods/"+createdMod.ID+"/github-sync", nil)
	syncReq429.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	syncRes429, _ := apiServer.Client().Do(syncReq429)
	var summary429 SyncSummary
	_ = json.NewDecoder(syncRes429.Body).Decode(&summary429)
	syncRes429.Body.Close()
	if summary429.Failed == 0 || !strings.Contains(summary429.LastError, "rate limit") {
		t.Fatalf("expected rate limit error, got %+v", summary429)
	}
	return429 = false

	// 6. Switch mod back to local source
	patchLocalReq, _ := http.NewRequest(http.MethodPatch, apiServer.URL+"/api/v1/author/mods/"+createdMod.ID+"/source", bytes.NewBufferString(`{"source_type":"local"}`))
	patchLocalReq.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	patchLocalRes, _ := apiServer.Client().Do(patchLocalReq)
	if patchLocalRes.StatusCode != http.StatusOK {
		t.Fatalf("switch to local failed: %d", patchLocalRes.StatusCode)
	}
	patchLocalRes.Body.Close()

	// Now creating candidate version manually is allowed again!
	verReqLocal, _ := http.NewRequest(http.MethodPost, apiServer.URL+"/api/v1/author/mods/"+createdMod.ID+"/versions", bytes.NewBufferString(`{"version":"2.0.0-local"}`))
	verReqLocal.AddCookie(&http.Cookie{Name: "submodhub_session", Value: authorToken})
	verResLocal, _ := apiServer.Client().Do(verReqLocal)
	if verResLocal.StatusCode != http.StatusCreated {
		t.Fatalf("manual version creation should succeed on local mode: %d", verResLocal.StatusCode)
	}
	verResLocal.Body.Close()
}
