package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
