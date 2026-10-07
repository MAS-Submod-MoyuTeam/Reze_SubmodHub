package httpapi

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	packagezip "github.com/reze/submodhub/internal/package"
)

func TestSpritepackUploadReturnsJSONDefinedSets(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{
		Mods:     []Mod{{ID: "m1", Category: "spritepack", Author: Author{ID: "author"}}},
		Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", Version: "current", State: "draft"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("b", 64)
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("archive", "spritepacks.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(spriteFixture(t)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/author/versions/v1/archive", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res := httptest.NewRecorder()
	NewStoreHandler(s).ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("upload %d %s", res.Code, res.Body.String())
	}
	var result struct {
		ScanReport packagezip.Report `json:"scan_report"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.ScanReport.SpriteSets) != 2 || result.ScanReport.SpriteSets[0].Items[0].DisplayName != "A" {
		t.Fatalf("scan result: %+v", result.ScanReport.SpriteSets)
	}
}

func TestSpritepackUploadRejectsAnotherAuthor(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{
		Mods:     []Mod{{ID: "m1", Category: "spritepack", Author: Author{ID: "author"}}},
		Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", State: "draft"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("c", 64)
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "other"}, Expires: time.Now().Add(time.Hour)}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/author/versions/v1/archive", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res := httptest.NewRecorder()
	NewStoreHandler(s).ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("upload by another author: %d", res.Code)
	}
}

func spriteFixture(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	w := zip.NewWriter(&buffer)
	for name, content := range map[string]string{
		"A/mod_assets/monika/j/a.json":      `{"name":"a","select_info":{"display_name":"A","thumb":"a"}}`,
		"A/mod_assets/thumbs/clothes-a.png": "preview-a",
		"B/mod_assets/monika/j/b.json":      `{"name":"b","select_info":{"display_name":"B"}}`,
		"B/gifts/b.gift":                    "",
	} {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(f, content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestPublishedSpritepackListsSetsAndDownloadsSelection(t *testing.T) {
	b := spriteFixture(t)
	report, err := packagezip.ScanSpriteArchive(bytes.NewReader(b), int64(len(b)), packagezip.Limits{})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dataDir, "archives"), 0o700); err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(dataDir, "archives", "current.zip")
	if err := os.WriteFile(archivePath, b, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := NewStore(dataDir, Catalog{
		Mods:        []Mod{{ID: "m1", Category: "spritepack", LatestVersionID: "v1"}},
		Versions:    map[string]Version{"v1": {ID: "v1", ModID: "m1", State: "published", ArchivePath: archivePath, ScanReportID: "scan_v1"}},
		ScanReports: map[string]packagezip.Report{"scan_v1": report},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(s))
	defer server.Close()
	res, err := http.Get(server.URL + "/api/v1/spritepacks/m1")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("manifest status %d", res.StatusCode)
	}
	var manifest struct {
		Sets []struct {
			ID    string `json:"id"`
			Items []struct {
				DisplayName string `json:"display_name"`
				PreviewURL  string `json:"preview_url"`
			} `json:"items"`
		} `json:"sets"`
	}
	if err := json.NewDecoder(res.Body).Decode(&manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Sets) != 2 || manifest.Sets[0].Items[0].DisplayName != "A" || manifest.Sets[0].Items[0].PreviewURL == "" {
		t.Fatalf("manifest %+v", manifest)
	}
	preview, err := http.Get(server.URL + manifest.Sets[0].Items[0].PreviewURL)
	if err != nil {
		t.Fatal(err)
	}
	previewBytes, _ := io.ReadAll(preview.Body)
	preview.Body.Close()
	if preview.StatusCode != http.StatusOK || string(previewBytes) != "preview-a" {
		t.Fatalf("preview %d %q", preview.StatusCode, previewBytes)
	}
	selected, err := http.Get(server.URL + "/api/v1/spritepacks/m1/download?sets=" + manifest.Sets[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	selectedBytes, _ := io.ReadAll(selected.Body)
	selected.Body.Close()
	if selected.StatusCode != http.StatusOK {
		t.Fatalf("download %d %s", selected.StatusCode, selectedBytes)
	}
	hash := sha256.Sum256(selectedBytes)
	if selected.Header.Get("X-Archive-SHA256") != hex.EncodeToString(hash[:]) {
		t.Fatal("missing verified selection hash")
	}
	z, err := zip.NewReader(bytes.NewReader(selectedBytes), int64(len(selectedBytes)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range z.File {
		if strings.HasSuffix(f.Name, "a.json") {
			t.Fatal("download included another set")
		}
	}
	bad, err := http.Get(server.URL + "/api/v1/spritepacks/m1/download?sets=invalid")
	if err != nil {
		t.Fatal(err)
	}
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid selection status %d", bad.StatusCode)
	}
}

func TestLegacyPublishedSpritepackBuildsSetIndexOnRead(t *testing.T) {
	b := spriteFixture(t)
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "archives"), 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "archives", "legacy.zip")
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := NewStore(dir, Catalog{
		Mods:        []Mod{{ID: "m1", Category: "spritepack", LatestVersionID: "v1"}},
		Versions:    map[string]Version{"v1": {ID: "v1", ModID: "m1", State: "published", ArchivePath: path, ScanReportID: "scan_v1"}},
		ScanReports: map[string]packagezip.Report{"scan_v1": {}},
	})
	if err != nil {
		t.Fatal(err)
	}
	res := httptest.NewRecorder()
	NewStoreHandler(s).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v1/spritepacks/m1", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("legacy manifest %d %s", res.Code, res.Body.String())
	}
	if len(s.Catalog.ScanReports["scan_v1"].SpriteSets) != 2 {
		t.Fatal("legacy index was not retained")
	}
}

func TestApprovingSpritepackReplacementRetiresOldArchive(t *testing.T) {
	b := spriteFixture(t)
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "archives"), 0o700); err != nil {
		t.Fatal(err)
	}
	oldPath := filepath.Join(dir, "archives", "old.zip")
	newPath := filepath.Join(dir, "archives", "new.zip")
	for _, path := range []string{oldPath, newPath} {
		if err := os.WriteFile(path, b, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	s, err := NewStore(dir, Catalog{
		Mods: []Mod{{ID: "m1", Category: "spritepack", LatestVersionID: "old", Author: Author{ID: "author"}}},
		Versions: map[string]Version{
			"old": {ID: "old", ModID: "m1", State: "published", ArchivePath: oldPath, ScanReportID: "scan_old"},
			"new": {ID: "new", ModID: "m1", State: "ready_for_review", ArchivePath: newPath, ScanReportID: "scan_new"},
		},
		ScanReports: map[string]packagezip.Report{"scan_old": {}, "scan_new": {}},
		Submissions: []Submission{{ID: "sub_old", ModID: "m1", VersionID: "old", State: "published", CreatedAt: now}, {ID: "sub_new", ModID: "m1", VersionID: "new", State: "ready_for_review", CreatedAt: now}},
	})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "admin"}, Roles: []string{"admin"}, Expires: now.Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(s))
	defer server.Close()
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/review/submissions/sub_new/decision", strings.NewReader(`{"decision":"approve","reason":"ok"}`))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("approval %d", res.StatusCode)
	}
	if _, ok := s.Catalog.Versions["old"]; ok {
		t.Fatal("old version still stored")
	}
	if s.Catalog.Mods[0].LatestVersionID != "new" {
		t.Fatal("new archive not current")
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatalf("old archive still exists: %v", err)
	}
	if s.Catalog.Submissions[0].VersionSnapshot == nil {
		t.Fatal("review history lost old version snapshot")
	}
	historyReq, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/review/submissions/sub_old", nil)
	historyReq.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	history, err := server.Client().Do(historyReq)
	if err != nil {
		t.Fatal(err)
	}
	defer history.Body.Close()
	var oldDetail struct {
		Version Version `json:"version"`
	}
	if err := json.NewDecoder(history.Body).Decode(&oldDetail); err != nil {
		t.Fatal(err)
	}
	if history.StatusCode != http.StatusOK || oldDetail.Version.ID != "old" {
		t.Fatalf("old review history: %d %+v", history.StatusCode, oldDetail.Version)
	}
}
