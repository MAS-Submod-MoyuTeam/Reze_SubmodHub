package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	packagezip "github.com/reze/submodhub/internal/package"
)

func TestAuthorWorkspaceListsOnlyOwnedDraftsWithoutArchivePaths(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{ID: "mine", Title: "Mine", Author: Author{ID: "author"}},
			{ID: "other", Title: "Other", Author: Author{ID: "someone-else"}},
		},
		Versions: map[string]Version{
			"draft": {ID: "draft", ModID: "mine", State: "uploaded", ScanReportID: "scan_draft", ArchivePath: "/private/archive.zip"},
			"hidden": {ID: "hidden", ModID: "other", State: "uploaded", ScanReportID: "scan_hidden"},
		},
		ScanReports: map[string]packagezip.Report{
			"scan_draft": {Warnings: []string{"binary content: game/Submods/mine/helper.dll"}},
			"scan_hidden": {Warnings: []string{"private report"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/author/mods", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	var result struct {
		Items []struct {
			Mod      Mod `json:"mod"`
			Versions []struct {
				ID          string `json:"id"`
				ArchivePath string `json:"archive_path"`
			} `json:"versions"`
			ScanReports map[string]packagezip.Report `json:"scan_reports"`
		} `json:"items"`
	}
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Mod.ID != "mine" || len(result.Items[0].Versions) != 1 || result.Items[0].Versions[0].ID != "draft" || result.Items[0].Versions[0].ArchivePath != "" {
		t.Fatalf("unexpected author workspace: %+v", result.Items)
	}
	if len(result.Items[0].ScanReports) != 1 || result.Items[0].ScanReports["scan_draft"].Warnings[0] != "binary content: game/Submods/mine/helper.dll" {
		t.Fatalf("author scan report missing or leaked: %+v", result.Items[0].ScanReports)
	}
}

func TestAdminCanUnpublishOtherAuthorModAndPreserveArtifacts(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "archives", "archive.zip")
	if err := os.MkdirAll(filepath.Dir(archivePath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archivePath, []byte("dummy zip"), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(dir, Catalog{
		Mods: []Mod{
			{
				ID:                  "other-mod",
				Title:               "Other Mod",
				Summary:             "A mod by someone else",
				Author:              Author{ID: "author-user", DisplayName: "Author"},
				Category:            "submod",
				LatestVersionID:     "v1",
				ImagePaths:          []string{"/tmp/img1.png"},
				RecommendedPriority: 10,
				SupportedPlatforms:  []string{"windows", "linux"},
				MASVersionRange:     ">=0.12.0",
			},
		},
		Versions: map[string]Version{
			"v1": {
				ID:          "v1",
				ModID:       "other-mod",
				Version:     "1.0.0",
				State:       "published",
				ArchivePath: archivePath,
				SizeBytes:   1024,
				SHA256:      "abcdef",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	adminToken := "1111111111111111111111111111111111111111111111111111111111111111"
	userToken := "2222222222222222222222222222222222222222222222222222222222222222"

	store.sessions[sessionKey(adminToken)] = authSession{
		User:    authUser{ID: "admin-user", Username: "admin", DisplayName: "Admin"},
		Roles:   []string{"admin"},
		Expires: time.Now().Add(time.Hour),
	}
	store.sessions[sessionKey(userToken)] = authSession{
		User:    authUser{ID: "random-user", Username: "random", DisplayName: "Random"},
		Roles:   []string{"user"},
		Expires: time.Now().Add(time.Hour),
	}

	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// 1. Unauthenticated request: POST /api/v1/author/mods/other-mod/unpublish -> 401 Unauthorized
	reqUnauth, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/author/mods/other-mod/unpublish", nil)
	resUnauth, err := server.Client().Do(reqUnauth)
	if err != nil {
		t.Fatal(err)
	}
	resUnauth.Body.Close()
	if resUnauth.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated unpublish, got %d", resUnauth.StatusCode)
	}

	// 2. Non-author ordinary user request: POST /api/v1/author/mods/other-mod/unpublish -> 404 Not Found (existing error semantic)
	reqUser, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/author/mods/other-mod/unpublish", nil)
	reqUser.AddCookie(&http.Cookie{Name: "submodhub_session", Value: userToken})
	resUser, err := server.Client().Do(reqUser)
	if err != nil {
		t.Fatal(err)
	}
	resUser.Body.Close()
	if resUser.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for non-author regular user unpublish, got %d", resUser.StatusCode)
	}

	// 3. Admin user request: POST /api/v1/author/mods/other-mod/unpublish -> 200 OK
	reqAdmin, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/author/mods/other-mod/unpublish", nil)
	reqAdmin.AddCookie(&http.Cookie{Name: "submodhub_session", Value: adminToken})
	resAdmin, err := server.Client().Do(reqAdmin)
	if err != nil {
		t.Fatal(err)
	}
	defer resAdmin.Body.Close()
	if resAdmin.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for admin unpublish, got %d", resAdmin.StatusCode)
	}

	// 4. Public catalog does not return unpublished mod
	resCatalog, err := http.Get(server.URL + "/api/v1/mods")
	if err != nil {
		t.Fatal(err)
	}
	defer resCatalog.Body.Close()
	var catResp struct {
		Items []Mod `json:"items"`
	}
	if err := json.NewDecoder(resCatalog.Body).Decode(&catResp); err != nil {
		t.Fatal(err)
	}
	if len(catResp.Items) != 0 {
		t.Fatalf("expected public catalog to have 0 items after unpublish, got %d", len(catResp.Items))
	}

	// 5. Public mod detail returns 404
	resModDetail, err := http.Get(server.URL + "/api/v1/mods/other-mod")
	if err != nil {
		t.Fatal(err)
	}
	resModDetail.Body.Close()
	if resModDetail.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for public mod detail after unpublish, got %d", resModDetail.StatusCode)
	}

	// 6. Verify version state is preserved (NOT changed to "unpublished" at version level)
	store.mu.RLock()
	defer store.mu.RUnlock()
	v1, exists := store.Catalog.Versions["v1"]
	if !exists {
		t.Fatal("version v1 should exist")
	}
	if v1.State != "published" {
		t.Fatalf("expected version v1 state to remain 'published', got %q", v1.State)
	}
	if v1.ArchivePath != archivePath {
		t.Fatalf("expected version archive path to be preserved, got %q", v1.ArchivePath)
	}

	// 7. Verify mod images are preserved
	var targetMod *Mod
	for i := range store.Catalog.Mods {
		if store.Catalog.Mods[i].ID == "other-mod" {
			targetMod = &store.Catalog.Mods[i]
			break
		}
	}
	if targetMod == nil {
		t.Fatal("target mod should exist in store catalog")
	}
	if !targetMod.Unpublished {
		t.Fatal("expected target mod to have Unpublished = true")
	}
	if len(targetMod.ImagePaths) != 1 || targetMod.ImagePaths[0] != "/tmp/img1.png" {
		t.Fatalf("expected mod images to be preserved, got %+v", targetMod.ImagePaths)
	}
}
