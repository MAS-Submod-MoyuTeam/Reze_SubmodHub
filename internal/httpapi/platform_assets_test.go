package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
	packagezip "github.com/reze/submodhub/internal/package"
)

// makePlatformZip builds a ZIP whose single script carries a platform marker, so
// two platform archives differ in content and therefore in hash.
func makePlatformZip(t *testing.T, marker string) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	f, err := w.Create("Submods/example.rpy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("init python:\n    pass  # " + marker + "\n")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// newPlatformTestStore builds a store with one author-owned mod and a version
// that accepts uploads. A caller that passes its own state keeps it, so a test
// can also start from a published or uploaded version.
func newPlatformTestStore(t *testing.T, version Version) *Store {
	t.Helper()
	version.ID = "v1"
	version.ModID = "m1"
	if version.State == "" {
		version.State = "draft"
	}
	if version.Version == "" {
		version.Version = "1.0.0"
	}
	store, err := NewStore(t.TempDir(), Catalog{
		Mods:     []Mod{{ID: "m1", Title: "Mod", Category: "submod", Author: Author{ID: "author"}, LatestVersionID: "v1"}},
		Versions: map[string]Version{"v1": version},
	})
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func uploadPlatformArchive(t *testing.T, server *httptest.Server, token, versionID, platform, fileName string, body []byte) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("archive", fileName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatal(err)
	}
	_ = writer.Close()
	url := server.URL + "/api/v1/author/versions/" + versionID + "/archive"
	if platform != "" {
		url += "?platform=" + platform
	}
	req, err := http.NewRequest(http.MethodPost, url, &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// Two platform uploads must produce two independent files; the version-wide
// hash and size must stop describing anything, because no single archive is the
// whole version any more.
func TestUploadPerPlatformArchivesKeepsFilesApart(t *testing.T) {
	store := newPlatformTestStore(t, Version{})
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	windows := makePlatformZip(t, "windows")
	android := makePlatformZip(t, "android")

	for _, upload := range []struct {
		platform string
		name     string
		body     []byte
	}{
		{"windows", "MyMod-windows.zip", windows},
		{"android", "MyMod-android.zip", android},
	} {
		res := uploadPlatformArchive(t, server, token, "v1", upload.platform, upload.name, upload.body)
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("%s upload status = %d", upload.platform, res.StatusCode)
		}
		var payload struct {
			Platform       string              `json:"platform"`
			PlatformAssets []PlatformAssetRule `json:"platform_assets"`
			SizeBytes      int64               `json:"size_bytes"`
		}
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if payload.Platform != upload.platform {
			t.Fatalf("response platform = %q", payload.Platform)
		}
		if len(payload.PlatformAssets) == 0 {
			t.Fatalf("%s upload reported no platform assets", upload.platform)
		}
	}

	stored := store.Catalog.Versions["v1"]
	if len(stored.PlatformAssets) != 2 {
		t.Fatalf("expected 2 platform assets, got %d", len(stored.PlatformAssets))
	}
	if stored.ArchivePath != "" || stored.SHA256 != "" || stored.SizeBytes != 0 {
		t.Fatalf("per-platform version kept a version-wide archive: path=%q sha=%q size=%d", stored.ArchivePath, stored.SHA256, stored.SizeBytes)
	}
	if stored.PlatformAssets[0].Platform != "windows" || stored.PlatformAssets[1].Platform != "android" {
		t.Fatalf("platform order = %s, %s", stored.PlatformAssets[0].Platform, stored.PlatformAssets[1].Platform)
	}
	if stored.PlatformAssets[0].SHA256 == stored.PlatformAssets[1].SHA256 {
		t.Fatal("two different archives were recorded with the same hash")
	}
	for _, file := range stored.PlatformAssets {
		if !validArchiveFile(file.ArchivePath) {
			t.Fatalf("%s archive missing on disk: %q", file.Platform, file.ArchivePath)
		}
	}
}

// Re-uploading one platform replaces only that platform's bytes and removes the
// superseded file, leaving the other platform untouched.
func TestUploadPerPlatformReplacesOnlyThatPlatform(t *testing.T) {
	store := newPlatformTestStore(t, Version{})
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	for _, platform := range []string{"windows", "android"} {
		res := uploadPlatformArchive(t, server, token, "v1", platform, "MyMod-"+platform+".zip", makeZip(t))
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("initial %s upload status = %d", platform, res.StatusCode)
		}
		res.Body.Close()
	}
	before := store.Catalog.Versions["v1"]
	var androidPath, oldWindowsPath string
	for _, file := range before.PlatformAssets {
		if file.Platform == "android" {
			androidPath = file.ArchivePath
		} else {
			oldWindowsPath = file.ArchivePath
		}
	}

	res := uploadPlatformArchive(t, server, token, "v1", "windows", "MyMod-windows.zip", bytes.Replace(makeZip(t), []byte("pass"), []byte("pass  # v2"), 1))
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("replacement upload status = %d", res.StatusCode)
	}
	res.Body.Close()

	after := store.Catalog.Versions["v1"]
	if len(after.PlatformAssets) != 2 {
		t.Fatalf("expected 2 platform assets after replacement, got %d", len(after.PlatformAssets))
	}
	for _, file := range after.PlatformAssets {
		if file.Platform == "android" && file.ArchivePath != androidPath {
			t.Fatalf("android archive changed during a windows upload: %q -> %q", androidPath, file.ArchivePath)
		}
	}
	if _, err := os.Stat(oldWindowsPath); !os.IsNotExist(err) {
		t.Fatalf("superseded windows archive was not removed: %v", err)
	}
}

// A version is either version-wide or per-platform. Mixing the two shapes would
// leave the catalog claiming files that no longer exist.
func TestUploadRejectsMixedArchiveShapes(t *testing.T) {
	store := newPlatformTestStore(t, Version{})
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res := uploadPlatformArchive(t, server, token, "v1", "", "MyMod.zip", makeZip(t))
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("version-wide upload status = %d", res.StatusCode)
	}
	res.Body.Close()

	res = uploadPlatformArchive(t, server, token, "v1", "windows", "MyMod-windows.zip", makeZip(t))
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("platform upload over a version-wide archive status = %d", res.StatusCode)
	}
	expectCode(t, res, "archive_shape_conflict")

	store2 := newPlatformTestStore(t, Version{})
	store2.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server2 := httptest.NewServer(NewStoreHandler(store2))
	defer server2.Close()
	res = uploadPlatformArchive(t, server2, token, "v1", "android", "MyMod-android.zip", makeZip(t))
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("platform upload status = %d", res.StatusCode)
	}
	res.Body.Close()
	res = uploadPlatformArchive(t, server2, token, "v1", "", "MyMod.zip", makeZip(t))
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("version-wide upload over platform archives status = %d", res.StatusCode)
	}
	expectCode(t, res, "archive_shape_conflict")
}

// A file whose name names another platform is refused instead of being published
// under a label its bytes do not match.
func TestUploadRejectsPlatformNameMismatch(t *testing.T) {
	store := newPlatformTestStore(t, Version{})
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res := uploadPlatformArchive(t, server, token, "v1", "windows", "MyMod-android.zip", makeZip(t))
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("mismatched upload status = %d", res.StatusCode)
	}
	expectCode(t, res, "platform_mismatch")

	res = uploadPlatformArchive(t, server, token, "v1", "linux", "MyMod-linux.zip", makeZip(t))
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("unsupported platform status = %d", res.StatusCode)
	}
	expectCode(t, res, "unsupported_platform")
}

// A per-platform version has no default build: asking for one without naming a
// platform must fail loudly instead of installing another platform's package.
func TestPlatformRequestWithoutPlatformIsRejected(t *testing.T) {
	dir := t.TempDir()
	windowsPath := filepath.Join(dir, "v1-windows.zip")
	androidPath := filepath.Join(dir, "v1-android.zip")
	for _, path := range []string{windowsPath, androidPath} {
		if err := os.WriteFile(path, makePlatformZip(t, filepath.Base(path)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	store := newPlatformTestStore(t, Version{State: "published"})
	store.Catalog.Versions["v1"] = Version{
		ID: "v1", ModID: "m1", Version: "1.0.0", State: "published",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", ArchivePath: windowsPath, SizeBytes: 11, SHA256: "windows-hash"},
			{Platform: "android", ArchivePath: androidPath, SizeBytes: 22, SHA256: "android-hash"},
		},
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	for _, path := range []string{"/api/v1/versions/v1/download", "/api/v1/archives/v1"} {
		res, err := server.Client().Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s without a platform = %d, want 400", path, res.StatusCode)
		}
		expectCode(t, res, "platform_required")
	}

	// A single-file version keeps serving without a platform query.
	store.Catalog.Versions["v1"] = Version{ID: "v1", ModID: "m1", Version: "1.0.0", State: "published", ArchivePath: windowsPath, SizeBytes: int64(len(makePlatformZip(t, "v1-windows.zip"))), SHA256: "windows-hash"}
	res, err := server.Client().Get(server.URL + "/api/v1/archives/v1")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("single-file archive without a platform = %d", res.StatusCode)
	}
}

// A platform whose asset regex matched nothing falls back to the release zipball;
// that platform must still end up with downloadable bytes of its own.
func TestImportPlatformCandidateStoresSourceCodeFallback(t *testing.T) {
	store := newPlatformTestStore(t, Version{Version: "0.9.0", State: "published"})
	zipball := makePlatformZip(t, "zipball")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(zipball)
	}))
	defer upstream.Close()

	release := github.Release{
		ID:         7,
		TagName:    "v1.0.0",
		ZipballURL: upstream.URL + "/zipball/v1.0.0",
		Assets: []github.Asset{
			{ID: 1, Name: "MyMod-windows.zip", Size: int64(len(zipball)), BrowserDownloadURL: upstream.URL + "/download/MyMod-windows.zip"},
		},
	}
	mod := store.Catalog.Mods[0]
	platforms, err := selectPlatformsForRelease(release, []GitHubPlatformRule{
		{Platform: "windows", Regex: "windows"},
		{Platform: "android", Regex: "android", SourceCode: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	client := github.NewClient(github.WithAllowInsecureTestHosts(true))
	result, created := store.importCandidate(context.Background(), client, mod, releaseCandidate{
		Version: "v1.0.0", ReleaseID: release.ID, Owner: "o", Repo: "r", Platforms: platforms,
	}, time.Now())
	if !created {
		t.Fatalf("import failed: %+v", result)
	}

	stored := store.Catalog.Versions[result.VersionID]
	if len(stored.PlatformAssets) != 2 {
		t.Fatalf("expected 2 platform assets, got %d", len(stored.PlatformAssets))
	}
	for _, file := range stored.PlatformAssets {
		if file.SHA256 == "" {
			t.Fatalf("%s has no hash", file.Platform)
		}
		if !validArchiveFile(file.ArchivePath) {
			t.Fatalf("%s has no stored archive: %q", file.Platform, file.ArchivePath)
		}
		info, statErr := os.Stat(file.ArchivePath)
		if statErr != nil || info.Size() != file.SizeBytes {
			t.Fatalf("%s recorded size %d does not match the stored file (%v)", file.Platform, file.SizeBytes, statErr)
		}
	}

	// Both platforms must actually serve their bytes. The archive endpoint only
	// serves the latest published version, so point the mod at this import.
	store.mu.Lock()
	store.Catalog.Mods[0].LatestVersionID = stored.ID
	store.Catalog.Mods[0].Unpublished = false
	store.Catalog.Versions[stored.ID] = withPublished(stored)
	store.mu.Unlock()
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()
	for _, platform := range SupportedPlatforms {
		res, getErr := server.Client().Get(server.URL + "/api/v1/archives/" + stored.ID + "?platform=" + platform)
		if getErr != nil {
			t.Fatal(getErr)
		}
		if res.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(res.Body)
			res.Body.Close()
			t.Fatalf("%s archive = %d: %s", platform, res.StatusCode, body)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		file, _ := stored.platformFileFor(platform)
		if int64(len(body)) != file.SizeBytes {
			t.Fatalf("%s served %d bytes, recorded %d", platform, len(body), file.SizeBytes)
		}
	}
}

// Uploading both platforms through the API must leave each platform's own scan
// report behind, and the version must then be submittable.
//
// The submit gate requires a report per declared platform, so an upload path that
// only wrote the version summary's report would make every per-platform version
// permanently unsubmittable — and, worse, would overwrite the windows report with
// android's bytes on an android re-upload.
func TestUploadedPlatformVersionCanBeSubmitted(t *testing.T) {
	store := newPlatformTestStore(t, Version{})
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	for _, platform := range []string{"windows", "android"} {
		res := uploadPlatformArchive(t, server, token, "v1", platform, "MyMod-"+platform+".zip", makePlatformZip(t, platform))
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("%s upload status = %d", platform, res.StatusCode)
		}
		res.Body.Close()
	}

	// Each platform owns its report under its own key.
	windowsReport, hasWindows := store.Catalog.ScanReports["scan_v1-windows"]
	androidReport, hasAndroid := store.Catalog.ScanReports["scan_v1-android"]
	if !hasWindows || !hasAndroid {
		t.Fatalf("missing platform scan reports: windows=%v android=%v", hasWindows, hasAndroid)
	}
	if len(windowsReport.Files) == 0 || len(androidReport.Files) == 0 {
		t.Fatalf("platform reports carry no files: windows=%d android=%d", len(windowsReport.Files), len(androidReport.Files))
	}
	// The two archives differ, so a report copied across platforms is detectable.
	if windowsReport.Files[0].Size == androidReport.Files[0].Size && windowsReport.Files[0].SHA256 == androidReport.Files[0].SHA256 {
		t.Fatal("windows and android reports describe the same file")
	}

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
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("submit after two platform uploads = %d: %s", res.StatusCode, body)
	}
	if len(store.Catalog.Submissions) != 1 {
		t.Fatalf("expected 1 submission, got %d", len(store.Catalog.Submissions))
	}
}

// Re-uploading one platform of a version that is already back with the author
// must not rewrite the other platform's report: a reviewer reading the windows
// report must never see android's file list.
func TestReplacingOnePlatformKeepsTheOtherPlatformReport(t *testing.T) {
	store := newPlatformTestStore(t, Version{})
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	for _, platform := range []string{"windows", "android"} {
		res := uploadPlatformArchive(t, server, token, "v1", platform, "MyMod-"+platform+".zip", makePlatformZip(t, platform))
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("%s upload status = %d", platform, res.StatusCode)
		}
		res.Body.Close()
	}
	before := store.Catalog.ScanReports["scan_v1-windows"]

	// Android is rebuilt and re-uploaded after review sent the version back.
	res := uploadPlatformArchive(t, server, token, "v1", "android", "MyMod-android.zip", makePlatformZip(t, "android-v2"))
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("android re-upload status = %d", res.StatusCode)
	}
	res.Body.Close()

	after := store.Catalog.ScanReports["scan_v1-windows"]
	if len(after.Files) != len(before.Files) || after.Files[0].SHA256 != before.Files[0].SHA256 {
		t.Fatalf("windows report changed during an android upload: %+v -> %+v", before.Files, after.Files)
	}
	if store.Catalog.Versions["v1"].ScanReportID != "scan_v1-windows" {
		t.Fatalf("summary report = %q", store.Catalog.Versions["v1"].ScanReportID)
	}
}

// A reviewer must be able to open every platform's report before deciding: the
// summary report alone would let a second platform pass unexamined, which is
// exactly what the per-platform submit gate exists to prevent.
func TestReviewDetailExposesEveryPlatformReport(t *testing.T) {
	store := newPlatformTestStore(t, Version{State: "ready_for_review"})
	dir := store.DataDir
	if err := os.MkdirAll(filepath.Join(dir, "archives"), 0o750); err != nil {
		t.Fatal(err)
	}
	windowsPath := filepath.Join(dir, "archives", "v1-windows.zip")
	androidPath := filepath.Join(dir, "archives", "v1-android.zip")
	for _, path := range []string{windowsPath, androidPath} {
		if err := os.WriteFile(path, makeZip(t), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	store.mu.Lock()
	store.Catalog.Versions["v1"] = Version{
		ID: "v1", ModID: "m1", Version: "1.0.0", State: "ready_for_review",
		ScanReportID: "scan_v1-windows",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", ArchivePath: windowsPath, SizeBytes: 10, SHA256: "w"},
			{Platform: "android", ArchivePath: androidPath, SizeBytes: 20, SHA256: "a"},
		},
	}
	if store.Catalog.ScanReports == nil {
		store.Catalog.ScanReports = map[string]packagezip.Report{}
	}
	store.Catalog.ScanReports["scan_v1-windows"] = packagezip.Report{Files: []packagezip.File{{Source: "windows.rpy"}}}
	store.Catalog.ScanReports["scan_v1-android"] = packagezip.Report{Files: []packagezip.File{{Source: "android.rpy"}}}
	store.Catalog.Submissions = append(store.Catalog.Submissions, Submission{
		ID: "sub_1", ModID: "m1", VersionID: "v1", AuthorID: "author", State: "ready_for_review", CreatedAt: time.Now(),
	})
	store.mu.Unlock()

	adminToken := strings.Repeat("d", 64)
	store.sessions[sessionKey(adminToken)] = authSession{User: authUser{ID: "admin"}, Roles: []string{"admin"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/review/submissions/sub_1", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: adminToken})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var payload struct {
		ScanReport  *packagezip.Report           `json:"scan_report"`
		ScanReports map[string]packagezip.Report `json:"scan_reports"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("review detail status = %d", res.StatusCode)
	}
	if payload.ScanReport == nil || len(payload.ScanReport.Files) == 0 || payload.ScanReport.Files[0].Source != "windows.rpy" {
		t.Fatalf("summary report = %+v, want the windows report", payload.ScanReport)
	}
	for _, key := range []string{"scan_v1-windows", "scan_v1-android"} {
		if _, ok := payload.ScanReports[key]; !ok {
			t.Fatalf("review detail is missing %s: %+v", key, payload.ScanReports)
		}
	}
	if got := payload.ScanReports["scan_v1-android"].Files[0].Source; got != "android.rpy" {
		t.Fatalf("android report describes %q", got)
	}
}

// The submit gate must check the scan report of every platform, not just the one
// the version summary happens to point at.
func TestSubmitRequiresEveryPlatformScanReport(t *testing.T) {
	store := newPlatformTestStore(t, Version{
		State:        "uploaded",
		ScanReportID: "scan_v1-windows",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", SizeBytes: int64(len(makeZip(t))), SHA256: "a"},
			{Platform: "android", SizeBytes: int64(len(makeZip(t))), SHA256: "b"},
		},
	})
	// The store rewrites stored archive paths into its own archives directory, so
	// the files have to exist there for the submit gate to accept them.
	store.mu.Lock()
	version := store.Catalog.Versions["v1"]
	for i := range version.PlatformAssets {
		file := filepath.Join(store.DataDir, "archives", version.PlatformAssets[i].Platform+".zip")
		if err := os.WriteFile(file, makeZip(t), 0o600); err != nil {
			store.mu.Unlock()
			t.Fatal(err)
		}
		version.PlatformAssets[i].ArchivePath = file
	}
	// Only the summary platform was scanned; android has no report of its own.
	if store.Catalog.ScanReports == nil {
		store.Catalog.ScanReports = map[string]packagezip.Report{}
	}
	store.Catalog.ScanReports["scan_v1-windows"] = packagezip.Report{}
	store.Catalog.Versions["v1"] = version
	store.mu.Unlock()
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
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusConflict || body.Code != "scan_required" {
		t.Fatalf("response = %d %s", res.StatusCode, body.Code)
	}
	if !strings.Contains(body.Message, "android") {
		t.Fatalf("gate did not name the unscanned platform: %q", body.Message)
	}
	if len(store.Catalog.Submissions) != 0 {
		t.Fatal("a version with an unscanned platform entered review")
	}
}

// The version summary always points at the first supported platform it ships,
// whichever platform was uploaded last.
func TestSummaryScanReportFollowsPlatformOrder(t *testing.T) {
	store := newPlatformTestStore(t, Version{})
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// Upload android first so "last upload wins" would be the wrong answer.
	for _, platform := range []string{"android", "windows"} {
		res := uploadPlatformArchive(t, server, token, "v1", platform, "MyMod-"+platform+".zip", makePlatformZip(t, platform))
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("upload %s = %d", platform, res.StatusCode)
		}
		res.Body.Close()
	}
	if got := store.Catalog.Versions["v1"].ScanReportID; got != "scan_v1-windows" {
		t.Fatalf("summary scan report = %q, want scan_v1-windows", got)
	}

	// Replacing only android must not move the summary off windows.
	res := uploadPlatformArchive(t, server, token, "v1", "android", "MyMod-android.zip", makePlatformZip(t, "android-v2"))
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("android re-upload = %d", res.StatusCode)
	}
	res.Body.Close()
	if got := store.Catalog.Versions["v1"].ScanReportID; got != "scan_v1-windows" {
		t.Fatalf("summary scan report after android upload = %q, want scan_v1-windows", got)
	}
}

// withPublished marks a version published, so the public archive endpoint serves
// it. The helper exists because the import path leaves the version for review
// unless auto-publish is on.
func withPublished(v Version) Version {
	v.State = "published"
	return v
}

func expectCode(t *testing.T, res *http.Response, want string) {
	t.Helper()
	defer res.Body.Close()
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Code != want {
		t.Fatalf("error code = %q, want %q", body.Code, want)
	}
}

// The submit gate must check every claimed platform, not just the first path.
func TestSubmitRequiresEveryPlatformArchive(t *testing.T) {
	dir := t.TempDir()
	present := filepath.Join(dir, "windows.zip")
	if err := os.WriteFile(present, makeZip(t), 0o600); err != nil {
		t.Fatal(err)
	}
	store := newPlatformTestStore(t, Version{
		State:        "uploaded",
		ScanReportID: "scan_v1-windows",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", ArchivePath: present, SizeBytes: 10, SHA256: "a"},
			{Platform: "android", ArchivePath: filepath.Join(dir, "missing-android.zip"), SizeBytes: 10, SHA256: "b"},
		},
	})
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
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusConflict || body.Code != "archive_required" {
		t.Fatalf("response = %d %s", res.StatusCode, body.Code)
	}
	if !strings.Contains(body.Message, "android") {
		t.Fatalf("gate did not name the missing platform: %q", body.Message)
	}
	if len(store.Catalog.Submissions) != 0 {
		t.Fatal("version with a missing platform archive entered review")
	}
}

// The download descriptor and the archive endpoint must both resolve the
// requested platform, and both hashes must differ.
func TestDownloadDescriptorAndArchivePerPlatform(t *testing.T) {
	store := newPlatformTestStore(t, Version{State: "published"})
	store.Catalog.Mods[0].Unpublished = false
	store.Catalog.Mods[0].LatestVersionID = "v2"
	store.Catalog.Versions["v2"] = Version{ID: "v2", ModID: "m1", Version: "2.0.0", State: "published", ArchivePath: "", SizeBytes: 1, SHA256: "latest"}
	dir := store.DataDir
	if err := os.MkdirAll(filepath.Join(dir, "archives"), 0o750); err != nil {
		t.Fatal(err)
	}
	windowsPath := filepath.Join(dir, "archives", "v1-windows.zip")
	androidPath := filepath.Join(dir, "archives", "v1-android.zip")
	if err := os.WriteFile(windowsPath, nil, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(androidPath, nil, 0o640); err != nil {
		t.Fatal(err)
	}
	store.Catalog.Versions["v1"] = Version{
		ID: "v1", ModID: "m1", Version: "1.0.0", State: "published",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", ArchivePath: windowsPath, SizeBytes: 11, SHA256: "windows-hash"},
			{Platform: "android", ArchivePath: androidPath, SizeBytes: 22, SHA256: "android-hash"},
		},
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	for _, want := range []struct {
		platform string
		sha      string
		size     int64
	}{
		{"windows", "windows-hash", 11},
		{"android", "android-hash", 22},
	} {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/versions/v1/download?platform="+want.platform, nil)
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var raw map[string]any
		if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s descriptor status = %d body=%v", want.platform, res.StatusCode, raw)
		}
		var description downloadDescription
		encoded, _ := json.Marshal(raw)
		_ = json.Unmarshal(encoded, &description)
		if description.Platform != want.platform || description.SHA256 != want.sha || description.SizeBytes != want.size {
			t.Fatalf("%s descriptor = %+v", want.platform, description)
		}
		if !strings.Contains(description.URL, "platform="+want.platform) {
			t.Fatalf("%s descriptor URL does not carry the platform: %q", want.platform, description.URL)
		}
		if description.CompletionToken == "" {
			t.Fatalf("%s descriptor has no completion token", want.platform)
		}
	}

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/versions/v1/download?platform=linux", nil)
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown platform descriptor status = %d", res.StatusCode)
	}
	expectCode(t, res, "platform_not_found")
}

// A version that ships one shared archive serves every platform. A client that
// always names its own platform — the Android and Windows builds do — must get
// that shared file, not a 404 for a platform the version does not split.
func TestSharedArchiveAcceptsPlatformQuery(t *testing.T) {
	store := newPlatformTestStore(t, Version{State: "published"})
	dir := store.DataDir
	if err := os.MkdirAll(filepath.Join(dir, "archives"), 0o750); err != nil {
		t.Fatal(err)
	}
	sharedPath := filepath.Join(dir, "archives", "v1.zip")
	if err := os.WriteFile(sharedPath, []byte("shared"), 0o640); err != nil {
		t.Fatal(err)
	}
	store.Catalog.Versions["v1"] = Version{
		ID: "v1", ModID: "m1", Version: "1.0.0", State: "published",
		ArchivePath: sharedPath, SizeBytes: 6, SHA256: "shared-hash",
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	for _, platform := range []string{"", "windows", "android"} {
		url := server.URL + "/api/v1/versions/v1/download"
		if platform != "" {
			url += "?platform=" + platform
		}
		req, _ := http.NewRequest(http.MethodGet, url, nil)
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var raw map[string]any
		if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("platform=%q descriptor status = %d body=%v", platform, res.StatusCode, raw)
		}
		var description downloadDescription
		encoded, _ := json.Marshal(raw)
		_ = json.Unmarshal(encoded, &description)
		// The shared archive is the whole version, so the descriptor must not claim
		// it belongs to a single platform, and the URL must not narrow it either.
		if description.Platform != "" {
			t.Fatalf("platform=%q descriptor claimed platform %q", platform, description.Platform)
		}
		if description.SHA256 != "shared-hash" || description.SizeBytes != 6 {
			t.Fatalf("platform=%q descriptor = %+v", platform, description)
		}
		if strings.Contains(description.URL, "platform=") {
			t.Fatalf("platform=%q descriptor narrowed a shared archive: %q", platform, description.URL)
		}
	}

	// A name that is not a platform at all is still refused, even when the version
	// would serve it: the client asked for something this server cannot describe.
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/versions/v1/download?platform=linux", nil)
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown platform on a shared archive = %d", res.StatusCode)
	}
	expectCode(t, res, "platform_not_found")
}

// A descriptor issued for one platform cannot be completed with another
// platform's hash, because the receipt binds the resolved bytes.
func TestCompletionReceiptBindsPlatformBytes(t *testing.T) {
	store := newPlatformTestStore(t, Version{State: "published"})
	store.Catalog.Versions["v1"] = Version{
		ID: "v1", ModID: "m1", Version: "1.0.0", State: "published",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", SizeBytes: 11, SHA256: "windows-hash"},
			{Platform: "android", SizeBytes: 22, SHA256: "android-hash"},
		},
	}
	v := store.Catalog.Versions["v1"]
	windows, found := v.platformFileFor("windows")
	if !found {
		t.Fatal("windows file missing from fixture")
	}
	// The receipt a descriptor issues for "windows" carries that platform's hash
	// and size, so a completion report is checked against those exact bytes.
	issued := v
	issued.SHA256 = windows.SHA256
	issued.SizeBytes = windows.SizeBytes
	issued.PlatformAssets = nil
	store.Catalog.Versions["v1"] = issued
	token, err := store.issueDownloadAttempt(issued)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.recordCompletion(token, "v1", "windows-hash", 11); err != nil {
		t.Fatalf("completion for the issued platform bytes failed: %v", err)
	}
	second, err := store.issueDownloadAttempt(issued)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.recordCompletion(second, "v1", "android-hash", 22); err == nil {
		t.Fatal("a receipt was satisfied by another platform's bytes")
	}
}

// Per-platform versions are not mirrored: a mirror record keys on one hash, so
// mirroring them would serve one platform as if it were the whole version.
func TestMirrorCandidateExcludesPlatformVersions(t *testing.T) {
	catalog := Catalog{Mods: []Mod{{ID: "m", LatestVersionID: "v"}}}
	if mirrorCandidate(catalog, Version{ID: "v", ModID: "m", State: "published", ArchivePath: "a.zip", SHA256: "h"}) != true {
		t.Fatal("version-wide published archive should be mirrorable")
	}
	if mirrorCandidate(catalog, Version{ID: "v", ModID: "m", State: "published", SHA256: "h", PlatformAssets: []PlatformAssetRule{{Platform: "windows", SHA256: "h", SizeBytes: 1}}}) {
		t.Fatal("per-platform version was offered to the mirror")
	}
}

// Platform inference drives the author form's example filename and the upload
// guard, so its answers are part of the contract.
func TestInferPlatformTags(t *testing.T) {
	cases := []struct {
		name string
		want []string
	}{
		{"MyMod-windows.zip", []string{"windows"}},
		{"MyMod_android_v1.zip", []string{"android"}},
		{"MyMod.Windows.Android.zip", []string{"windows", "android"}},
		{"MyMod.zip", nil},
		{"MyMod.apk", []string{"android"}},
		{"MyMod.exe", []string{"windows"}},
		{"androidmyzip.zip", nil},
	}
	for _, tc := range cases {
		got := InferPlatformTags(tc.name)
		if strings.Join(got, ",") != strings.Join(tc.want, ",") {
			t.Fatalf("%s => %v, want %v", tc.name, got, tc.want)
		}
	}
}

// Author-declared platform rules normalize, deduplicate and reject bad input.
func TestNormalizePlatformRules(t *testing.T) {
	rules, err := normalizePlatformRules([]GitHubPlatformRule{
		{Platform: "Android", Regex: "android"},
		{Platform: "win", Regex: "windows"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rules) != 2 || rules[0].Platform != "windows" || rules[1].Platform != "android" {
		t.Fatalf("normalized rules = %+v", rules)
	}
	if _, err := normalizePlatformRules([]GitHubPlatformRule{{Platform: "linux", Regex: "x"}}); err == nil {
		t.Fatal("unsupported platform accepted")
	}
	if _, err := normalizePlatformRules([]GitHubPlatformRule{{Platform: "windows", Regex: "x"}, {Platform: "windows", Regex: "y"}}); err == nil {
		t.Fatal("duplicate platform accepted")
	}
	if _, err := normalizePlatformRules([]GitHubPlatformRule{{Platform: "windows", Regex: "[unclosed"}}); err == nil {
		t.Fatal("invalid regex accepted")
	}
}

// Per-platform discovery replaces the shared regex and must not fall back to it.
func TestSourceConfigPlatformModeValidation(t *testing.T) {
	base := sourceConfigInput{SourceType: "github_releases", Owner: "octocat", Repo: "hello"}
	if err := validateSourceConfig(base); err == nil {
		t.Fatal("github source without a matcher was accepted")
	}
	withPlatforms := base
	withPlatforms.PlatformMode = true
	withPlatforms.PlatformRules = []GitHubPlatformRule{
		{Platform: "windows", Regex: "windows"},
		{Platform: "android", Regex: "android"},
	}
	if err := validateSourceConfig(withPlatforms); err != nil {
		t.Fatalf("valid platform config rejected: %v", err)
	}
	emptyRegex := base
	emptyRegex.PlatformMode = true
	emptyRegex.PlatformRules = []GitHubPlatformRule{{Platform: "windows"}}
	if err := validateSourceConfig(emptyRegex); err == nil {
		t.Fatal("platform without a matcher or source-code fallback was accepted")
	}
	sourceFallback := base
	sourceFallback.PlatformMode = true
	sourceFallback.PlatformRules = []GitHubPlatformRule{{Platform: "windows", SourceCode: true}}
	if err := validateSourceConfig(sourceFallback); err != nil {
		t.Fatalf("source-code fallback platform rejected: %v", err)
	}
	noRules := base
	noRules.PlatformMode = true
	if err := validateSourceConfig(noRules); err == nil {
		t.Fatal("platform mode without any rule was accepted")
	}
	// The shared regex still works when no platform rule is declared.
	shared := base
	shared.AssetRegex = `.*\.zip`
	if err := validateSourceConfig(shared); err != nil {
		t.Fatalf("shared regex rejected: %v", err)
	}
}

// The catalog platform set is derived, not copied from the request: active
// split rules name exactly the supported platforms, while a shared archive or a
// manifest serves every platform. Local mods keep the author's declaration.
func TestEffectiveSupportedPlatformsFollowsSourceConfig(t *testing.T) {
	local := Mod{SupportedPlatforms: []string{"windows", "linux"}}
	if got := local.effectiveSupportedPlatforms(); !slices.Equal(got, []string{"windows", "linux"}) {
		t.Fatalf("local platforms = %v", got)
	}
	shared := Mod{SourceType: "github_releases", SupportedPlatforms: []string{"android"}}
	if got := shared.effectiveSupportedPlatforms(); !slices.Equal(got, SupportedPlatforms) {
		t.Fatalf("shared archive must serve every platform, got %v", got)
	}
	manifest := Mod{
		SourceType:           "github_releases",
		GitHubManifest:       true,
		GitHubPlatformAssets: []GitHubPlatformRule{{Platform: "android", Regex: "a"}},
	}
	if got := manifest.effectiveSupportedPlatforms(); !slices.Equal(got, SupportedPlatforms) {
		t.Fatalf("manifest discovery ignores platform rules, got %v", got)
	}
	splitAndroid := Mod{
		SourceType:           "github_releases",
		GitHubPlatformAssets: []GitHubPlatformRule{{Platform: "android", Regex: "a"}},
	}
	if got := splitAndroid.effectiveSupportedPlatforms(); !slices.Equal(got, []string{"android"}) {
		t.Fatalf("split android platforms = %v", got)
	}
	splitBoth := Mod{
		SourceType: "github_releases",
		GitHubPlatformAssets: []GitHubPlatformRule{
			{Platform: "android", Regex: "a"},
			{Platform: "windows", Regex: "w"},
		},
	}
	if got := splitBoth.effectiveSupportedPlatforms(); !slices.Equal(got, []string{"windows", "android"}) {
		t.Fatalf("split both platforms = %v", got)
	}
}

// Saving through the API must not leave supported_platforms disagreeing with
// the platform rules: only Android configured means only Android advertised, a
// metadata-only edit keeps that set, and switching back to a shared file
// restores both platforms.
func TestSavedPlatformSetFollowsSourceConfiguration(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	store.sessions[sessionKey(token)] = authSession{
		User:    authUser{ID: "author", DisplayName: "Author"},
		Roles:   []string{"admin"},
		CSRF:    "csrf",
		Expires: time.Now().Add(time.Hour),
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()
	do := func(method, path, body string) Mod {
		t.Helper()
		req, _ := http.NewRequest(method, server.URL+path, bytes.NewBufferString(body))
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode > 299 {
			t.Fatalf("%s %s: status %d", method, path, res.StatusCode)
		}
		var mod Mod
		if err := json.NewDecoder(res.Body).Decode(&mod); err != nil {
			t.Fatal(err)
		}
		return mod
	}

	created := do(http.MethodPost, "/api/v1/author/mods", `{
		"title": "Android Only", "summary": "s", "description": "d", "category": "submod",
		"tags": ["工具"], "supported_platforms": ["windows", "android"],
		"source_type": "github_releases", "github_owner": "octocat", "github_repo": "hello",
		"github_platform_assets": [{"platform": "android", "regex": "a\\.zip$"}]
	}`)
	if !slices.Equal(created.SupportedPlatforms, []string{"android"}) {
		t.Fatalf("create advertised %v, want only android", created.SupportedPlatforms)
	}

	edited := do(http.MethodPatch, "/api/v1/author/mods/"+created.ID, `{
		"title": "Android Only v2", "summary": "s", "description": "d", "category": "submod",
		"tags": ["工具"]
	}`)
	if !slices.Equal(edited.SupportedPlatforms, []string{"android"}) {
		t.Fatalf("metadata-only edit advertised %v, want only android", edited.SupportedPlatforms)
	}

	shared := do(http.MethodPatch, "/api/v1/author/mods/"+created.ID+"/source", `{
		"source_type": "github_releases", "github_owner": "octocat", "github_repo": "hello",
		"github_asset_regex": ".*\\.zip$", "github_platform_assets": []
	}`)
	if !slices.Equal(shared.SupportedPlatforms, SupportedPlatforms) {
		t.Fatalf("shared file advertised %v, want every platform", shared.SupportedPlatforms)
	}
}

// A release must serve every declared platform, or none of them.
func TestSelectPlatformsForReleaseRequiresEveryPlatform(t *testing.T) {
	release := github.Release{
		TagName: "v1",
		Assets: []github.Asset{
			{ID: 1, Name: "MyMod-windows.zip", Size: 10, BrowserDownloadURL: "https://example/MyMod-windows.zip"},
		},
	}
	rules := []GitHubPlatformRule{
		{Platform: "windows", Regex: "windows"},
		{Platform: "android", Regex: "android"},
	}
	if _, err := selectPlatformsForRelease(release, rules); err == nil {
		t.Fatal("release missing a declared platform was accepted")
	}
	release.Assets = append(release.Assets, github.Asset{ID: 2, Name: "MyMod-android.zip", Size: 20, BrowserDownloadURL: "https://example/MyMod-android.zip"})
	selected, err := selectPlatformsForRelease(release, rules)
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 2 {
		t.Fatalf("selected %d platforms", len(selected))
	}
	if selected[0].Platform != "windows" || selected[0].Asset.AssetName != "MyMod-windows.zip" {
		t.Fatalf("windows selection = %+v", selected[0])
	}
}

// The archive endpoint serves the file of the requested platform, not the first.
func TestArchiveEndpointServesRequestedPlatform(t *testing.T) {
	dir := t.TempDir()
	windowsZip := makePlatformZip(t, "windows")
	androidZip := makePlatformZip(t, "android")
	windowsPath := filepath.Join(dir, "v1-windows.zip")
	androidPath := filepath.Join(dir, "v1-android.zip")
	if err := os.WriteFile(windowsPath, windowsZip, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(androidPath, androidZip, 0o600); err != nil {
		t.Fatal(err)
	}
	store := newPlatformTestStore(t, Version{State: "published"})
	store.Catalog.Versions["v1"] = Version{
		ID: "v1", ModID: "m1", Version: "1.0.0", State: "published",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", ArchivePath: windowsPath, SizeBytes: int64(len(windowsZip)), SHA256: "windows-hash"},
			{Platform: "android", ArchivePath: androidPath, SizeBytes: int64(len(androidZip)), SHA256: "android-hash"},
		},
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res, err := server.Client().Get(server.URL + "/api/v1/archives/v1?platform=android")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("archive status = %d", res.StatusCode)
	}
	if got := res.Header.Get("X-Archive-SHA256"); got != "android-hash" {
		t.Fatalf("archive hash header = %q", got)
	}
	if got := res.Header.Get("Content-Length"); got != strconv.Itoa(len(androidZip)) {
		t.Fatalf("archive length header = %q, want %d", got, len(androidZip))
	}
}

// The public payload must not leak per-platform storage paths.
func TestSanitizeForClientClearsPlatformPaths(t *testing.T) {
	v := Version{
		ID:    "v1",
		State: "published",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", ArchivePath: "/srv/data/archives/v1-windows-abc.zip", SizeBytes: 10, SHA256: "h"},
		},
	}
	clean := v.SanitizeForClient()
	if len(clean.PlatformAssets) != 1 || clean.PlatformAssets[0].ArchivePath != "" {
		t.Fatalf("sanitized platform assets leaked a path: %+v", clean.PlatformAssets)
	}
	if clean.PlatformAssets[0].SHA256 != "h" || clean.PlatformAssets[0].Platform != "windows" {
		t.Fatalf("sanitize dropped public platform fields: %+v", clean.PlatformAssets)
	}
}
