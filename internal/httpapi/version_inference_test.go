package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	packagezip "github.com/reze/submodhub/internal/package"
)

func TestCandidateVersionCanBeInferredFromUploadedSubmod(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m1", Author: Author{ID: "author"}}}, Versions: map[string]Version{}})
	if err != nil {
		t.Fatal(err)
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	ts := httptest.NewServer(NewStoreHandler(s))
	defer ts.Close()
	request := func(method, path string, body []byte, contentType string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(body))
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		res, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res := request(http.MethodPost, "/api/v1/author/mods/m1/versions", []byte(`{"version":"","release_notes":""}`), "application/json")
	if res.StatusCode != 201 {
		t.Fatalf("empty draft status %d", res.StatusCode)
	}
	var v Version
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if v.CreatedAt == nil || v.CreatedAt.IsZero() {
		t.Fatal("new candidate version has no creation timestamp")
	}
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	entry, _ := zw.Create("game/Submods/Dialogue Packs/dialogue_pack_head.rpy")
	_, _ = entry.Write([]byte("init -990 python:\n    store.mas_submod_utils.Submod(\n        author=\"P\",\n        name=\"话题整合包\",\n        version='1.27.1', dependencies={\"Core\": (\"1.0.0\", \"2.0.0\")},\n    )\n"))
	_ = zw.Close()
	var upload bytes.Buffer
	mw := multipart.NewWriter(&upload)
	part, _ := mw.CreateFormFile("archive", "dialogue-packs.zip")
	_, _ = part.Write(archive.Bytes())
	_ = mw.Close()
	res = request(http.MethodPost, "/api/v1/author/versions/"+v.ID+"/archive", upload.Bytes(), mw.FormDataContentType())
	if res.StatusCode != 201 {
		t.Fatalf("upload status %d", res.StatusCode)
	}
	var uploaded struct {
		Version string `json:"version"`
	}
	_ = json.NewDecoder(res.Body).Decode(&uploaded)
	res.Body.Close()
	if uploaded.Version != "1.27.1" || s.Catalog.Versions[v.ID].Version != "1.27.1" {
		t.Fatalf("inferred version=%q, saved=%q", uploaded.Version, s.Catalog.Versions[v.ID].Version)
	}
	if len(s.Catalog.Versions[v.ID].Dependencies) != 1 || s.Catalog.Versions[v.ID].Dependencies[0].ModID != "Core" || s.Catalog.Versions[v.ID].Dependencies[0].VersionRange != ">=1.0.0 <=2.0.0" {
		t.Fatalf("dependencies=%+v", s.Catalog.Versions[v.ID].Dependencies)
	}
}

func TestAmbiguousOrMissingVersionRequiresManualEntryBeforeSubmit(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "archives", "v1.zip")
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
	s, err := NewStore(dir, Catalog{Mods: []Mod{{ID: "m1", Author: Author{ID: "author"}}}, Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", State: "uploaded", ReleaseNotes: "keep", ArchivePath: archivePath, ScanReportID: "scan_v1"}}, ScanReports: map[string]packagezip.Report{"scan_v1": {}}})
	if err != nil {
		t.Fatal(err)
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	ts := httptest.NewServer(NewStoreHandler(s))
	defer ts.Close()
	call := func(method, path, body string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, ts.URL+path, bytes.NewBufferString(body))
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		res, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res := call(http.MethodPost, "/api/v1/author/versions/v1/submit", `{"mark_latest":true}`)
	if res.StatusCode != 400 {
		t.Fatalf("empty version submit=%d", res.StatusCode)
	}
	res.Body.Close()
	res = call(http.MethodPatch, "/api/v1/author/versions/v1/edit", `{"version":"1.27.1","release_notes":""}`)
	if res.StatusCode != 200 {
		t.Fatalf("manual version edit=%d", res.StatusCode)
	}
	res.Body.Close()
	if s.Catalog.Versions["v1"].ReleaseNotes != "keep" {
		t.Fatalf("uploaded release notes changed: %q", s.Catalog.Versions["v1"].ReleaseNotes)
	}
	res = call(http.MethodPost, "/api/v1/author/versions/v1/submit", `{"mark_latest":true}`)
	if res.StatusCode != 201 {
		t.Fatalf("submit after manual entry=%d", res.StatusCode)
	}
	res.Body.Close()
}
