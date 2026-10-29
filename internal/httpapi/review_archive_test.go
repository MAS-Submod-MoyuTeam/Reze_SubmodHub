package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A reviewer can read the file tree and the scan report of a pending version but
// has no way to open the package itself: the public archive endpoint serves
// published versions only. Manual inspection needs the bytes.
func TestReviewArchiveDownloadServesPendingBytes(t *testing.T) {
	store, archive, _ := newReviewArchiveStore(t)
	server := newReviewArchiveServer(store)
	defer server.Close()

	res := reviewArchiveGet(t, server, "/api/v1/review/submissions/sub_1/archive", adminReviewToken)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.StatusCode, body)
	}
	if !bytes.Equal(body, archive) {
		t.Fatalf("served %d bytes, want the stored %d", len(body), len(archive))
	}
	if got := res.Header.Get("X-Archive-SHA256"); got != sha256Hex(archive) {
		t.Fatalf("X-Archive-SHA256 = %q", got)
	}
	if got := res.Header.Get("Content-Type"); got != "application/zip" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := res.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want the private bytes to stay out of shared caches", got)
	}
	if got := res.Header.Get("Content-Length"); got != strconv.Itoa(len(archive)) {
		t.Fatalf("Content-Length = %q", got)
	}
	if got := res.Header.Get("Content-Disposition"); !strings.Contains(got, `filename="m1_1.2.3.zip"`) {
		t.Fatalf("Content-Disposition = %q", got)
	}
	// A single-archive version is all-platform, so naming a platform is a no-op;
	// naming one that does not exist is still rejected, as on the public endpoint.
	res = reviewArchiveGet(t, server, "/api/v1/review/submissions/sub_1/archive?platform=windows", adminReviewToken)
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !bytes.Equal(body, archive) {
		t.Fatalf("platform no-op: status = %d", res.StatusCode)
	}
	res = reviewArchiveGet(t, server, "/api/v1/review/submissions/sub_1/archive?platform=linux", adminReviewToken)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown platform status = %d, want 404", res.StatusCode)
	}
	// Inspecting a submission is not a catalog download; the counter tracks readers.
	store.mu.RLock()
	downloads := store.Catalog.Mods[0].DownloadsCount
	store.mu.RUnlock()
	if downloads != 0 {
		t.Fatalf("admin inspection counted %d downloads", downloads)
	}
}

// The route is inside the review workspace, so it answers only to administrators:
// an author must not be able to read another author's pending package early.
func TestReviewArchiveDownloadRequiresAdministrator(t *testing.T) {
	store, _, _ := newReviewArchiveStore(t)
	seedReviewSession(store, strings.Repeat("b", 64), "user")
	server := newReviewArchiveServer(store)
	defer server.Close()

	for _, test := range []struct {
		name, path, token string
		want              int
	}{
		{"anonymous", "/api/v1/review/submissions/sub_1/archive", "", http.StatusUnauthorized},
		{"non-admin", "/api/v1/review/submissions/sub_1/archive", strings.Repeat("b", 64), http.StatusForbidden},
		{"unknown submission", "/api/v1/review/submissions/sub_missing/archive", adminReviewToken, http.StatusNotFound},
		{"wrong method", "/api/v1/review/submissions/sub_1/archive", adminReviewToken, http.StatusMethodNotAllowed},
	} {
		method := http.MethodGet
		if test.name == "wrong method" {
			method = http.MethodPost
		}
		res := reviewArchiveRequest(t, server, method, test.path, test.token)
		res.Body.Close()
		if res.StatusCode != test.want {
			t.Errorf("%s: status = %d, want %d", test.name, res.StatusCode, test.want)
		}
	}
}

// A per-platform version ships one build per platform. Serving either build
// without being asked would hand the reviewer the wrong package to inspect.
func TestReviewArchiveDownloadPerPlatform(t *testing.T) {
	store, _, _ := newReviewArchiveStore(t)
	windows, android := []byte("windows-build"), []byte("android-build")
	windowsPath := writeReviewArchive(t, store.DataDir, "v1-windows.zip", windows)
	androidPath := writeReviewArchive(t, store.DataDir, "v1-android.zip", android)
	store.mu.Lock()
	store.Catalog.Versions["v1"] = Version{
		ID: "v1", ModID: "m1", Version: "1.2.3", State: "ready_for_review",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", ArchivePath: windowsPath, SizeBytes: int64(len(windows)), SHA256: sha256Hex(windows)},
			{Platform: "android", ArchivePath: androidPath, SizeBytes: int64(len(android)), SHA256: sha256Hex(android)},
		},
	}
	store.mu.Unlock()
	server := newReviewArchiveServer(store)
	defer server.Close()

	res := reviewArchiveGet(t, server, "/api/v1/review/submissions/sub_1/archive", adminReviewToken)
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("platform-less status = %d, want 400", res.StatusCode)
	}
	res = reviewArchiveGet(t, server, "/api/v1/review/submissions/sub_1/archive?platform=linux", adminReviewToken)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown platform status = %d, want 404", res.StatusCode)
	}
	for platform, want := range map[string][]byte{"windows": windows, "android": android} {
		res = reviewArchiveGet(t, server, "/api/v1/review/submissions/sub_1/archive?platform="+platform, adminReviewToken)
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK || !bytes.Equal(body, want) {
			t.Fatalf("%s: status = %d, body = %q", platform, res.StatusCode, body)
		}
		if got := res.Header.Get("X-Archive-Platform"); got != platform {
			t.Fatalf("%s: X-Archive-Platform = %q", platform, got)
		}
		if got := res.Header.Get("Content-Disposition"); !strings.Contains(got, "_"+platform+".zip") {
			t.Fatalf("%s: Content-Disposition = %q", platform, got)
		}
	}
}

// A deleted version keeps its submission but no bytes, and a rejection freezes
// the reviewed build into a snapshot. Neither has an archive the server can
// prove belongs to the page, so the page must say so instead of offering a
// download that cannot succeed.
func TestReviewArchiveUnavailableForFrozenOrDeletedVersion(t *testing.T) {
	store, _, path := newReviewArchiveStore(t)
	store.mu.Lock()
	store.Catalog.Submissions[0].State = "rejected"
	store.Catalog.Submissions[0].VersionSnapshot = &Version{ID: "v1", ModID: "m1", Version: "1.2.3", State: "rejected", SHA256: sha256Hex([]byte("stale"))}
	store.mu.Unlock()
	server := newReviewArchiveServer(store)
	defer server.Close()

	if availability := reviewArchiveAvailabilityOf(t, server, "sub_1"); availability.Shared || len(availability.Platforms) != 0 {
		t.Fatalf("rejected snapshot advertises %+v", availability)
	}
	res := reviewArchiveGet(t, server, "/api/v1/review/submissions/sub_1/archive", adminReviewToken)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("rejected snapshot status = %d, want 404", res.StatusCode)
	}

	store.mu.Lock()
	store.Catalog.Submissions[0].State = "ready_for_review"
	store.Catalog.Submissions[0].VersionSnapshot = nil
	store.mu.Unlock()
	if availability := reviewArchiveAvailabilityOf(t, server, "sub_1"); !availability.Shared {
		t.Fatalf("live archive not advertised: %+v", availability)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if availability := reviewArchiveAvailabilityOf(t, server, "sub_1"); availability.Shared {
		t.Fatalf("missing file still advertised: %+v", availability)
	}
}

// The review page renders one download control per build it can actually fetch,
// so the detail payload has to name the builds whose bytes exist.
func TestReviewDetailAdvertisesPerPlatformArchives(t *testing.T) {
	store, _, _ := newReviewArchiveStore(t)
	windowsPath := writeReviewArchive(t, store.DataDir, "v1-windows.zip", []byte("windows-build"))
	store.mu.Lock()
	store.Catalog.Versions["v1"] = Version{
		ID: "v1", ModID: "m1", Version: "1.2.3", State: "ready_for_review",
		PlatformAssets: []PlatformAssetRule{
			{Platform: "windows", ArchivePath: windowsPath, SizeBytes: 13, SHA256: sha256Hex([]byte("windows-build"))},
			{Platform: "android", ArchivePath: filepath.Join(store.DataDir, "archives", "gone.zip"), SizeBytes: 13, SHA256: "android"},
		},
	}
	store.mu.Unlock()
	server := newReviewArchiveServer(store)
	defer server.Close()

	availability := reviewArchiveAvailabilityOf(t, server, "sub_1")
	if availability.Shared {
		t.Fatalf("per-platform version advertised a shared archive: %+v", availability)
	}
	if len(availability.Platforms) != 1 || availability.Platforms[0] != "windows" {
		t.Fatalf("builds = %+v, want only windows", availability.Platforms)
	}
	res := reviewArchiveGet(t, server, "/api/v1/review/submissions/sub_1/archive?platform=android", adminReviewToken)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unstoreable android status = %d, want 404", res.StatusCode)
	}
}

const adminReviewToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func newReviewArchiveStore(t *testing.T) (*Store, []byte, string) {
	t.Helper()
	dir := t.TempDir()
	archive := makeZip(t)
	path := writeReviewArchive(t, dir, "v1.zip", archive)
	store, err := NewStore(dir, Catalog{
		Mods: []Mod{{ID: "m1", Title: "Mod", Category: "submod", Author: Author{ID: "author"}, LatestVersionID: "v1"}},
		Versions: map[string]Version{"v1": {
			ID: "v1", ModID: "m1", Version: "1.2.3", State: "ready_for_review",
			ArchivePath: path, SizeBytes: int64(len(archive)), SHA256: sha256Hex(archive),
		}},
		Submissions: []Submission{{
			ID: "sub_1", ModID: "m1", VersionID: "v1", AuthorID: "author", State: "ready_for_review", CreatedAt: time.Now(),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	seedReviewSession(store, adminReviewToken, "admin")
	return store, archive, path
}

func newReviewArchiveServer(store *Store) *httptest.Server {
	return httptest.NewServer(NewStoreHandler(store))
}

func seedReviewSession(store *Store, token, role string) {
	store.sessions[sessionKey(token)] = authSession{User: authUser{ID: role}, Roles: []string{role}, Expires: time.Now().Add(time.Hour)}
}

func writeReviewArchive(t *testing.T, dataDir, name string, body []byte) string {
	t.Helper()
	dir := filepath.Join(dataDir, "archives")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, body, 0o640); err != nil {
		t.Fatal(err)
	}
	return path
}

func reviewArchiveGet(t *testing.T, server *httptest.Server, path, token string) *http.Response {
	t.Helper()
	return reviewArchiveRequest(t, server, http.MethodGet, path, token)
}

func reviewArchiveRequest(t *testing.T, server *httptest.Server, method, path, token string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, server.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func reviewArchiveAvailabilityOf(t *testing.T, server *httptest.Server, submissionID string) reviewArchiveAvailability {
	t.Helper()
	res := reviewArchiveGet(t, server, "/api/v1/review/submissions/"+submissionID, adminReviewToken)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("detail status = %d: %s", res.StatusCode, body)
	}
	var payload struct {
		Availability reviewArchiveAvailability `json:"archive_availability"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload.Availability
}

func sha256Hex(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}
