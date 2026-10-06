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

func TestRejectedVersionCanBeRevisedInPlaceAndResubmitted(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "archives", "v1.zip")
	if err := os.MkdirAll(filepath.Dir(archivePath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archivePath, []byte("old archive"), 0600); err != nil {
		t.Fatal(err)
	}
	oldReport := packagezip.Report{Warnings: []string{"old warning"}}
	store, err := NewStore(dir, Catalog{
		Mods:        []Mod{{ID: "m1", Title: "Demo", Author: Author{ID: "author"}}},
		Versions:    map[string]Version{"v1": {ID: "v1", ModID: "m1", Version: "1.0.0", State: "rejected", ReleaseNotes: "old notes", ArchivePath: archivePath, ScanReportID: "scan_v1", Dependencies: []Dependency{{ModID: "Old", Required: true}}}},
		ScanReports: map[string]packagezip.Report{"scan_v1": oldReport},
		Submissions: []Submission{{ID: "sub_old", ModID: "m1", VersionID: "v1", AuthorID: "author", State: "rejected", Reason: "fix this", CreatedAt: time.Now().UTC()}},
	})
	if err != nil {
		t.Fatal(err)
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Roles: []string{"admin"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()
	call := func(method, path string, body []byte, contentType string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res := call(http.MethodPatch, "/api/v1/author/versions/v1/edit", []byte(`{"version":"1.0.1","release_notes":"fixed notes","dependencies":[{"mod_id":"Core","version_range":">1.0.0","required":true}]}`), "application/json")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("edit rejected status = %d", res.StatusCode)
	}
	res.Body.Close()
	if got := store.Catalog.Versions["v1"]; got.State != "rejected" || got.Version != "1.0.1" || got.ReleaseNotes != "fixed notes" || got.Dependencies[0].ModID != "Core" {
		t.Fatalf("edited version = %+v", got)
	}
	res = call(http.MethodPost, "/api/v1/author/versions/v1/submit", []byte(`{"mark_latest":true}`), "application/json")
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("submit before replacement = %d", res.StatusCode)
	}
	res.Body.Close()
	var invalidUpload bytes.Buffer
	invalidWriter := multipart.NewWriter(&invalidUpload)
	invalidPart, err := invalidWriter.CreateFormFile("archive", "invalid.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := invalidPart.Write([]byte("not a zip")); err != nil {
		t.Fatal(err)
	}
	if err := invalidWriter.Close(); err != nil {
		t.Fatal(err)
	}
	res = call(http.MethodPost, "/api/v1/author/versions/v1/archive", invalidUpload.Bytes(), invalidWriter.FormDataContentType())
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid replacement status = %d", res.StatusCode)
	}
	res.Body.Close()
	if _, err := os.Stat(archivePath); err != nil {
		t.Fatalf("failed replacement removed old archive: %v", err)
	}
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	entry, err := zw.Create("game/Submods/Demo/main.rpy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("init python:\n    pass\n")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	var upload bytes.Buffer
	mw := multipart.NewWriter(&upload)
	part, err := mw.CreateFormFile("archive", "revised.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(archive.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	res = call(http.MethodPost, "/api/v1/author/versions/v1/archive", upload.Bytes(), mw.FormDataContentType())
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("replace archive status = %d", res.StatusCode)
	}
	res.Body.Close()
	if got := store.Catalog.Versions["v1"]; got.State != "uploaded" || got.ID != "v1" || got.ArchivePath == archivePath {
		t.Fatalf("revised upload = %+v", got)
	}
	var secondUpload bytes.Buffer
	secondWriter := multipart.NewWriter(&secondUpload)
	secondPart, err := secondWriter.CreateFormFile("archive", "revised-again.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := secondPart.Write(archive.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := secondWriter.Close(); err != nil {
		t.Fatal(err)
	}
	res = call(http.MethodPost, "/api/v1/author/versions/v1/archive", secondUpload.Bytes(), secondWriter.FormDataContentType())
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("uploaded replacement status = %d", res.StatusCode)
	}
	res.Body.Close()
	if _, err := os.Stat(archivePath); !os.IsNotExist(err) {
		t.Fatalf("old archive still exists: %v", err)
	}
	res = call(http.MethodGet, "/api/v1/review/submissions/sub_old", nil, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("old review status = %d", res.StatusCode)
	}
	var detail struct {
		Version    Version           `json:"version"`
		ScanReport packagezip.Report `json:"scan_report"`
		Submission Submission        `json:"submission"`
	}
	if err := json.NewDecoder(res.Body).Decode(&detail); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if detail.Version.Version != "1.0.0" || detail.Version.ReleaseNotes != "old notes" || detail.Version.ArchivePath != "" || detail.ScanReport.Warnings[0] != "old warning" || detail.Submission.Reason != "fix this" {
		t.Fatalf("old review changed: %+v", detail)
	}
	res = call(http.MethodPost, "/api/v1/author/versions/v1/submit", []byte(`{"mark_latest":true}`), "application/json")
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("resubmit status = %d", res.StatusCode)
	}
	res.Body.Close()
	if len(store.Catalog.Submissions) != 2 || store.Catalog.Submissions[0].State != "rejected" || store.Catalog.Submissions[1].VersionID != "v1" {
		t.Fatalf("review history = %+v", store.Catalog.Submissions)
	}
}
