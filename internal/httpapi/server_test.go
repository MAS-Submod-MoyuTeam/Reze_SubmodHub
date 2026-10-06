package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCatalogAndDownloadContract(t *testing.T) {
	c := Catalog{Mods: []Mod{{ID: "m1", Title: "Rain", Summary: "dialogue", Category: "submod", LatestVersionID: "v1"}}, Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", Version: "1.0.0", State: "published", SHA256: "0123456789abcdef", SizeBytes: 42}}}
	s := httptest.NewServer(New(c))
	defer s.Close()
	res, err := s.Client().Get(s.URL + "/api/v1/mods?q=rain")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	res, err = s.Client().Get(s.URL + "/api/v1/versions/v1/download")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("status %d", res.StatusCode)
	}
}

func TestArchiveUploadPersistsAndDownloads(t *testing.T) {
	dir := t.TempDir()
	archive := makeZip(t)
	store, err := NewStore(dir, Catalog{Mods: []Mod{{ID: "m1", Title: "Rain", Category: "submod", LatestVersionID: "v1"}}, Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", Version: "1.0.0", State: "uploaded"}}})
	if err != nil {
		t.Fatal(err)
	}
	store.UploadToken = "test-token"
	ts := httptest.NewServer(NewStoreHandler(store))
	defer ts.Close()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("archive", "fixture.zip")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(archive)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/author/versions/v1/archive", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer test-token")
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 201 {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("status %d: %s", res.StatusCode, b)
	}
	var result struct {
		SHA256 string `json:"sha256"`
		Size   int64  `json:"size_bytes"`
	}
	_ = json.NewDecoder(res.Body).Decode(&result)
	if result.Size == 0 || result.SHA256 == "" {
		t.Fatalf("bad result: %+v", result)
	}
	res, err = ts.Client().Get(ts.URL + "/api/v1/archives/v1")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unpublished archive status %d", res.StatusCode)
	}
	res.Body.Close()
	store.mu.Lock()
	v := store.Catalog.Versions["v1"]
	v.State = "published"
	store.Catalog.Versions["v1"] = v
	store.mu.Unlock()
	res, err = ts.Client().Get(ts.URL + "/api/v1/archives/v1")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	got, _ := io.ReadAll(res.Body)
	if !bytes.Equal(got, archive) {
		t.Fatalf("download differs: %d/%d", len(got), len(archive))
	}
	if _, err := os.Stat(filepath.Join(dir, "catalog.json")); err != nil {
		t.Fatal(err)
	}
}

func TestPublicVersionHidesDraftAndArchivePath(t *testing.T) {
	dir := t.TempDir()
	store, err := NewStore(dir, Catalog{
		Mods: []Mod{{ID: "m1", Title: "Rain", LatestVersionID: "v1"}},
		Versions: map[string]Version{
			"v1": {ID: "v1", ModID: "m1", State: "published", ArchivePath: filepath.Join(dir, "archives", "v1.zip")},
			"v2": {ID: "v2", ModID: "m1", State: "ready_for_review", ArchivePath: filepath.Join(dir, "archives", "v2.zip")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(NewStoreHandler(store))
	defer ts.Close()
	res, err := ts.Client().Get(ts.URL + "/api/v1/mods/m1/versions/v2")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("draft status %d", res.StatusCode)
	}
	res, err = ts.Client().Get(ts.URL + "/api/v1/mods/m1/versions/v1")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if bytes.Contains(b, []byte("archive_path")) || bytes.Contains(b, []byte(dir)) {
		t.Fatalf("public response leaks storage path: %s", b)
	}
}

func TestPostgresArchiveStoreDoesNotImportLocalCatalog(t *testing.T) {
	dir := t.TempDir()
	legacy := []byte(`{"mods":[{"id":"legacy","title":"Old"}],"versions":{}}`)
	if err := os.WriteFile(filepath.Join(dir, "catalog.json"), legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := newArchiveStore(dir, Catalog{Mods: []Mod{}, Versions: map[string]Version{}})
	if err != nil {
		t.Fatal(err)
	}
	if len(store.Catalog.Mods) != 0 {
		t.Fatalf("postgres store imported local catalog: %+v", store.Catalog.Mods)
	}
}

func TestCatalogOmitsModsWithoutPublishedLatestVersion(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{ID: "published", Title: "Ready", LatestVersionID: "v1"},
			{ID: "draft", Title: "Private", LatestVersionID: "v2"},
		},
		Versions: map[string]Version{
			"v1": {ID: "v1", ModID: "published", State: "published"},
			"v2": {ID: "v2", ModID: "draft", State: "ready_for_review"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(NewStoreHandler(store))
	defer ts.Close()
	res, err := ts.Client().Get(ts.URL + "/api/v1/mods")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var page struct {
		Items []Mod `json:"items"`
	}
	if err := json.NewDecoder(res.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != "published" {
		t.Fatalf("public catalog includes drafts: %+v", page.Items)
	}
	res, err = ts.Client().Get(ts.URL + "/api/v1/mods/draft")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("draft detail status %d", res.StatusCode)
	}
}

func TestCatalogFiltersAndPaginatesPublishedMods(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{ID: "m3", Title: "Rain Three", Category: "submod", Tags: []string{"rain"}, SupportedPlatforms: []string{"windows"}, LatestVersionID: "v3"},
			{ID: "m1", Title: "Rain One", Category: "submod", Tags: []string{"rain"}, SupportedPlatforms: []string{"windows"}, LatestVersionID: "v1"},
			{ID: "m2", Title: "Rain Two", Category: "submod", Tags: []string{"rain"}, SupportedPlatforms: []string{"windows"}, LatestVersionID: "v2"},
			{ID: "hidden", Title: "Rain Hidden", Category: "submod", Tags: []string{"rain"}, SupportedPlatforms: []string{"windows"}, LatestVersionID: "vh"},
			{ID: "sprite", Title: "Rain Sprite", Category: "spritepack", Tags: []string{"rain"}, SupportedPlatforms: []string{"android"}, LatestVersionID: "vs"},
		},
		Versions: map[string]Version{
			"v1": {ID: "v1", ModID: "m1", State: "published"},
			"v2": {ID: "v2", ModID: "m2", State: "published"},
			"v3": {ID: "v3", ModID: "m3", State: "published"},
			"vh": {ID: "vh", ModID: "hidden", State: "draft"},
			"vs": {ID: "vs", ModID: "sprite", State: "published"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()
	query := "?q=rain&category=submod&platform=windows&tag=rain&limit=2"
	res, err := server.Client().Get(server.URL + "/api/v1/mods" + query)
	if err != nil {
		t.Fatal(err)
	}
	var first struct {
		Items      []Mod   `json:"items"`
		NextCursor *string `json:"next_cursor"`
	}
	if err := json.NewDecoder(res.Body).Decode(&first); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 || len(first.Items) != 2 || first.Items[0].ID != "m1" || first.Items[1].ID != "m2" || first.NextCursor == nil {
		t.Fatalf("first page: %+v, status %d", first, res.StatusCode)
	}
	res, err = server.Client().Get(server.URL + "/api/v1/mods" + query + "&cursor=" + *first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	var second struct {
		Items      []Mod   `json:"items"`
		NextCursor *string `json:"next_cursor"`
	}
	if err := json.NewDecoder(res.Body).Decode(&second); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 || len(second.Items) != 1 || second.Items[0].ID != "m3" || second.NextCursor != nil {
		t.Fatalf("second page: %+v, status %d", second, res.StatusCode)
	}
}

func TestCatalogRejectsBadPagination(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()
	for _, query := range []string{"?limit=0", "?limit=101", "?cursor=invalid"} {
		res, err := server.Client().Get(server.URL + "/api/v1/mods" + query)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 400 {
			t.Fatalf("%s status %d", query, res.StatusCode)
		}
	}
}

func makeZip(t *testing.T) []byte {
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	f, _ := w.Create("Submods/example.rpy")
	_, _ = f.Write([]byte("init python:\n    pass\n"))
	_ = w.Close()
	return b.Bytes()
}
