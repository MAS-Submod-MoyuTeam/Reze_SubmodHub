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
	"reflect"
	"strings"
	"testing"
	"time"
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

func TestArchiveDownloadCountPersists(t *testing.T) {
	dir := t.TempDir()
	archive := makeZip(t)
	path := filepath.Join(dir, "archives", "v1.zip")
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, archive, 0o640); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(dir, Catalog{Mods: []Mod{{ID: "m1", Title: "Rain", LatestVersionID: "v1"}}, Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", State: "published", ArchivePath: path, SizeBytes: int64(len(archive))}}})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(NewStoreHandler(store))
	defer ts.Close()
	for _, path := range []string{"/api/v1/versions/v1/download", "/api/v1/archives/v1"} {
		res, err := ts.Client().Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
	reloaded, err := NewStore(dir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.Catalog.Mods[0].DownloadsCount; got != 1 {
		t.Fatalf("downloads = %d, want 1", got)
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

func TestModImagesUploadAndPublicListingIndependentOfVersion(t *testing.T) {
	dir := t.TempDir()
	mod := Mod{ID: "m1", Title: "Images", Author: Author{ID: "author"}, Category: "submod", LatestVersionID: "v1"}
	store, err := NewStore(dir, Catalog{Mods: []Mod{mod}, Versions: map[string]Version{"v1": {ID: "v1", ModID: "m1", Version: "1.0.0", State: "uploaded"}}})
	if err != nil {
		t.Fatal(err)
	}
	store.sessions = map[string]authSession{"session": {User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}}
	ts := httptest.NewServer(NewStoreHandler(store))
	defer ts.Close()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("images", "one.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("\x89PNG\r\n\x1a\n"))
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/author/mods/m1/images", &body)
	req.Header.Set("Cookie", "submodhub_session="+strings.Repeat("a", 64))
	store.sessions[sessionKey(strings.Repeat("a", 64))] = store.sessions["session"]
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload status %d", res.StatusCode)
	}
	res.Body.Close()
	res, err = ts.Client().Get(ts.URL + "/api/v1/mods/m1/images")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unpublished images status %d", res.StatusCode)
	}
	store.Catalog.Mods[0].ImagePaths = []string{filepath.Join(dir, "images", "m1", "00.png")}
	if err := os.MkdirAll(filepath.Dir(store.Catalog.Mods[0].ImagePaths[0]), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.Catalog.Mods[0].ImagePaths[0], []byte("\x89PNG\r\n\x1a\n"), 0640); err != nil {
		t.Fatal(err)
	}
	store.Catalog.Versions["v1"] = Version{ID: "v1", ModID: "m1", Version: "1.0.0", State: "published"}
	store.Catalog.Mods[0].LatestVersionID = "v1"
	if err := store.saveLocked(); err != nil {
		t.Fatal(err)
	}
	res, err = ts.Client().Get(ts.URL + "/api/v1/mods/m1/images")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("public images status %d", res.StatusCode)
	}
	var payload struct {
		Items []struct {
			URL string `json:"url"`
		} `json:"items"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 1 || payload.Items[0].URL == "" {
		t.Fatalf("images payload %+v", payload)
	}
	store.Catalog.Versions["v1"] = Version{ID: "v1", ModID: "m1", Version: "2.0.0", State: "published"}
	store.Catalog.Mods[0].LatestVersion = "2.0.0"
	store.Catalog.Mods[0].LatestVersionID = "v1"
	res, err = ts.Client().Get(ts.URL + "/api/v1/mods/m1/images")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("images after version update status %d", res.StatusCode)
	}
}

func TestAuthorCanReorderExistingModImages(t *testing.T) {
	dir := t.TempDir()
	imageDir := filepath.Join(dir, "images", "m1")
	if err := os.MkdirAll(imageDir, 0750); err != nil {
		t.Fatal(err)
	}
	paths := []string{filepath.Join(imageDir, "00.png"), filepath.Join(imageDir, "01.jpg"), filepath.Join(imageDir, "02.webp")}
	for _, path := range paths {
		if err := os.WriteFile(path, []byte("image"), 0640); err != nil {
			t.Fatal(err)
		}
	}
	store, err := NewStore(dir, Catalog{Mods: []Mod{{ID: "m1", Title: "Images", Author: Author{ID: "author"}, ImagePaths: paths}}, Versions: map[string]Version{}})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("r", 64)
	store.sessions = map[string]authSession{sessionKey(token): {User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}}
	ts := httptest.NewServer(NewStoreHandler(store))
	defer ts.Close()
	body := bytes.NewBufferString(`{"filenames":["02.webp","00.png","01.jpg"]}`)
	req, _ := http.NewRequest(http.MethodPatch, ts.URL+"/api/v1/author/mods/m1/images", body)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reorder status %d", res.StatusCode)
	}
	if got := store.Catalog.Mods[0].ImagePaths; !reflect.DeepEqual(got, []string{paths[2], paths[0], paths[1]}) {
		t.Fatalf("image order = %#v", got)
	}
}

func TestAuthorCanDeleteAnExistingModImageBySavingRemainingOrder(t *testing.T) {
	dir := t.TempDir()
	imageDir := filepath.Join(dir, "images", "m1")
	if err := os.MkdirAll(imageDir, 0750); err != nil {
		t.Fatal(err)
	}
	paths := []string{filepath.Join(imageDir, "00.png"), filepath.Join(imageDir, "01.jpg")}
	for _, path := range paths {
		if err := os.WriteFile(path, []byte("image"), 0640); err != nil {
			t.Fatal(err)
		}
	}
	store, err := NewStore(dir, Catalog{Mods: []Mod{{ID: "m1", Author: Author{ID: "author"}, ImagePaths: paths}}, Versions: map[string]Version{}})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("d", 64)
	store.sessions = map[string]authSession{sessionKey(token): {User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}}
	ts := httptest.NewServer(NewStoreHandler(store))
	defer ts.Close()
	req, _ := http.NewRequest(http.MethodPatch, ts.URL+"/api/v1/author/mods/m1/images", strings.NewReader(`{"filenames":["00.png"]}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("delete image status %d", res.StatusCode)
	}
	if _, err := os.Stat(paths[1]); !os.IsNotExist(err) {
		t.Fatalf("deleted image remains: %v", err)
	}
	if !reflect.DeepEqual(store.Catalog.Mods[0].ImagePaths, []string{paths[0]}) {
		t.Fatalf("remaining images = %#v", store.Catalog.Mods[0].ImagePaths)
	}
}

func TestAuthorCanUnpublishModAndDeleteDraftMod(t *testing.T) {
	dir := t.TempDir()
	store, err := NewStore(dir, Catalog{Mods: []Mod{{ID: "pub", Title: "Published", Author: Author{ID: "author"}, Category: "submod", LatestVersionID: "v1"}, {ID: "draft", Title: "Draft", Author: Author{ID: "author"}, Category: "submod"}}, Versions: map[string]Version{"v1": {ID: "v1", ModID: "pub", State: "published"}, "dv": {ID: "dv", ModID: "draft", State: "draft"}}})
	if err != nil {
		t.Fatal(err)
	}
	store.sessions = map[string]authSession{"session": {User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}}
	key := strings.Repeat("b", 64)
	store.sessions[sessionKey(key)] = store.sessions["session"]
	ts := httptest.NewServer(NewStoreHandler(store))
	defer ts.Close()
	request := func(method, path string) *http.Response {
		req, _ := http.NewRequest(method, ts.URL+path, nil)
		req.Header.Set("Cookie", "submodhub_session="+key)
		res, _ := ts.Client().Do(req)
		return res
	}
	res := request(http.MethodPost, "/api/v1/author/mods/pub/unpublish")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unpublish status %d", res.StatusCode)
	}
	res.Body.Close()
	res = request(http.MethodGet, "/api/v1/mods/pub")
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("hidden mod status %d", res.StatusCode)
	}
	res.Body.Close()
	res = request(http.MethodDelete, "/api/v1/author/mods/draft")
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete draft status %d", res.StatusCode)
	}
	res.Body.Close()
	if _, ok := store.Catalog.Mods[0], true; !ok {
		t.Fatal("test")
	}
	for _, mod := range store.Catalog.Mods {
		if mod.ID == "draft" {
			t.Fatal("draft mod remains")
		}
	}
	res = request(http.MethodDelete, "/api/v1/author/mods/pub")
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("published mod delete status %d", res.StatusCode)
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
