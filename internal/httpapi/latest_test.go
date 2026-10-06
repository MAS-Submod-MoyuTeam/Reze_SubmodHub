package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	packagezip "github.com/reze/submodhub/internal/package"
)

func TestAuthorChoosesLatestAtSubmissionAndCanChangePublishedLatest(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "archives", "new.zip")
	if err := os.MkdirAll(filepath.Dir(archivePath), 0700); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	entry, err := zw.Create("game/Submods/demo/main.rpy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("init python:\n    pass\n")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archivePath, archive.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	mod := Mod{ID: "mod_1", Author: Author{ID: "author"}, LatestVersionID: "old"}
	versions := map[string]Version{
		"old": {ID: "old", ModID: mod.ID, State: "published", Version: "1.0.0"},
		"new": {ID: "new", ModID: mod.ID, State: "uploaded", Version: "2.0.0", ArchivePath: archivePath, ScanReportID: "scan_new"},
	}
	s, err := NewStore(dir, Catalog{Mods: []Mod{mod}, Versions: versions, ScanReports: map[string]packagezip.Report{"scan_new": {}}})
	if err != nil {
		t.Fatal(err)
	}
	authorToken := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	adminToken := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	s.sessions[sessionKey(authorToken)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	s.sessions[sessionKey(adminToken)] = authSession{User: authUser{ID: "admin"}, Roles: []string{"admin"}, Expires: time.Now().Add(time.Hour)}
	ts := httptest.NewServer(NewStoreHandler(s))
	defer ts.Close()
	call := func(method, path, token, body string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, ts.URL+path, bytes.NewBufferString(body))
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		res, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res := call(http.MethodPost, "/api/v1/author/versions/new/submit", authorToken, `{"mark_latest":false}`)
	if res.StatusCode != 201 {
		t.Fatalf("submit: %d", res.StatusCode)
	}
	var sub Submission
	if err := json.NewDecoder(res.Body).Decode(&sub); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if sub.MarkLatest == nil || *sub.MarkLatest {
		t.Fatalf("author choice not saved: %+v", sub)
	}
	res = call(http.MethodPost, "/api/v1/review/submissions/"+sub.ID+"/decision", adminToken, `{"decision":"approve","reason":"ok"}`)
	if res.StatusCode != 200 {
		t.Fatalf("approve: %d", res.StatusCode)
	}
	res.Body.Close()
	if s.Catalog.Versions["new"].State != "published" {
		t.Fatalf("approval did not publish version: %+v", s.Catalog.Versions["new"])
	}
	if s.Catalog.Mods[0].LatestVersionID != "old" {
		t.Fatalf("reviewer overrode author choice: %s", s.Catalog.Mods[0].LatestVersionID)
	}
	res = call(http.MethodPost, "/api/v1/versions/new/mark-latest", authorToken, "")
	if res.StatusCode != 200 {
		t.Fatalf("mark latest: %d", res.StatusCode)
	}
	res.Body.Close()
	if s.Catalog.Mods[0].LatestVersionID != "new" {
		t.Fatalf("latest not changed: %s", s.Catalog.Mods[0].LatestVersionID)
	}
	res = call(http.MethodPost, "/api/v1/versions/old/mark-latest", adminToken, "")
	if res.StatusCode != 404 && res.StatusCode != 403 {
		t.Fatalf("non-author may change latest: %d", res.StatusCode)
	}
	res.Body.Close()
}
