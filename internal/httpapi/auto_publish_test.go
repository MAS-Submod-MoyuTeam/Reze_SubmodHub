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

func TestAutoPublishSubmissionWithoutReviewer(t *testing.T) {
	for _, category := range []string{"submod", "spritepack"} {
		t.Run(category, func(t *testing.T) {
			dir := t.TempDir()
			archivePath := filepath.Join(dir, "archives", "candidate.zip")
			if err := os.MkdirAll(filepath.Dir(archivePath), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(archivePath, createTestZip(t, "init python:\n    pass\n"), 0600); err != nil {
				t.Fatal(err)
			}
			store, err := NewStore(dir, Catalog{
				Mods: []Mod{{ID: "m1", Category: category, Author: Author{ID: "author"}}},
				Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", Version: "1.0.0", State: "uploaded", ArchivePath: archivePath, ScanReportID: "scan_v1"}},
				ScanReports: map[string]packagezip.Report{"scan_v1": {}},
			})
			if err != nil {
				t.Fatal(err)
			}
			store.AutoPublish = true
			token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
			server := httptest.NewServer(NewStoreHandler(store))
			defer server.Close()
			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/author/versions/v1/submit", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
			res, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			var sub Submission
			if err := json.NewDecoder(res.Body).Decode(&sub); err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != 201 || sub.State != "published" || sub.PublishedAt == nil {
				t.Fatalf("submission not automatically published: status=%d submission=%+v", res.StatusCode, sub)
			}
			if store.Catalog.Versions["v1"].State != "published" || store.Catalog.Mods[0].LatestVersionID != "v1" {
				t.Fatal("automatic publication did not update the catalog")
			}
		})
	}
}
