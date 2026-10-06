package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestSubmitRequiresUploadedArchive(t *testing.T) {
	for _, archivePath := range []string{"", filepath.Join(t.TempDir(), "missing.zip")} {
		t.Run(archivePath, func(t *testing.T) {
			store, err := NewStore(t.TempDir(), Catalog{
				Mods:     []Mod{{ID: "m1", Author: Author{ID: "author"}}},
				Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", Version: "1.0.0", State: "uploaded", ArchivePath: archivePath}},
			})
			if err != nil {
				t.Fatal(err)
			}
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
			var body struct {
				Code string `json:"code"`
			}
			if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != http.StatusConflict || body.Code != "archive_required" {
				t.Fatalf("response = %d %s", res.StatusCode, body.Code)
			}
			if len(store.Catalog.Submissions) != 0 || store.Catalog.Versions["v1"].State != "uploaded" {
				t.Fatal("missing archive entered review queue")
			}
		})
	}
}
