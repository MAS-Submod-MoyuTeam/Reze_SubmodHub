package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/reze/submodhub/internal/github"
)

func TestGitHubRelayScenarios(t *testing.T) {
	dataDir := t.TempDir()
	store, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}

	rawZip := []byte("PK\x03\x04" + strings.Repeat("content-bytes-12345", 10))
	hash := sha256.Sum256(rawZip)
	hashHex := hex.EncodeToString(hash[:])

	var ghHits int32
	var proxyHits int32

	var mockGH *httptest.Server
	mockGH = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&ghHits, 1)
		switch {
		case strings.HasSuffix(r.URL.Path, "/ok.zip"):
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(rawZip)
		case strings.HasSuffix(r.URL.Path, "/changed.zip"):
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("PK\x03\x04different-content-bytes"))
		case strings.HasSuffix(r.URL.Path, "/rate-limited.zip"):
			w.Header().Set("Retry-After", "120")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte("rate limited"))
		case strings.HasSuffix(r.URL.Path, "/missing.zip"):
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockGH.Close()

	var mockProxy *httptest.Server
	mockProxy = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&proxyHits, 1)
		target := strings.TrimPrefix(r.URL.RequestURI(), "/")
		if !strings.HasPrefix(target, "http") {
			target = "http://" + target
		}
		targetURL, _ := url.Parse(target)
		fReq, _ := http.NewRequest(r.Method, targetURL.String(), nil)
		fRes, err := http.DefaultTransport.RoundTrip(fReq)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		defer fRes.Body.Close()
		for k, vals := range fRes.Header {
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(fRes.StatusCode)
		_, _ = io.Copy(w, fRes.Body)
	}))
	defer mockProxy.Close()

	// Configure Store proxy settings and test client
	store.Catalog.Settings.GitHubProxyTemplate = mockProxy.URL + "/{url}"
	store.GitHubClient = github.NewClient(
		github.WithBaseURL(mockGH.URL),
		github.WithAllowInsecureTestHosts(true),
	)

	// Create local archive for legacy version testing
	localZipPath := filepath.Join(dataDir, "local-legacy.zip")
	if err := os.WriteFile(localZipPath, rawZip, 0644); err != nil {
		t.Fatal(err)
	}

	// Setup catalog versions
	store.Catalog.Versions = map[string]Version{
		"v-relay-ok": {
			ID:          "v-relay-ok",
			ModID:       "mod-1",
			Version:     "1.0.0",
			State:       "published",
			SizeBytes:   int64(len(rawZip)),
			SHA256:      hashHex,
			ArchivePath: filepath.Join(dataDir, "placeholder-v-relay-ok.zip"),
			SourceType:  "github_releases",
			GitHubSource: &VersionSourceLocation{
				Owner:       "octocat",
				Repo:        "test",
				ReleaseID:   1,
				AssetID:     10,
				FileName:    "mod.zip",
				DownloadURL: mockGH.URL + "/ok.zip",
			},
		},
		"v-legacy": {
			ID:          "v-legacy",
			ModID:       "mod-1",
			Version:     "0.9.0",
			State:       "published",
			SizeBytes:   int64(len(rawZip)),
			SHA256:      hashHex,
			ArchivePath: localZipPath,
			SourceType:  "github_releases",
			// GitHubSource is nil (legacy)
		},
		"v-unpublished": {
			ID:          "v-unpublished",
			ModID:       "mod-1",
			Version:     "1.1.0-draft",
			State:       "submitted",
			SizeBytes:   int64(len(rawZip)),
			SHA256:      hashHex,
			ArchivePath: localZipPath,
			GitHubSource: &VersionSourceLocation{
				Owner:       "octocat",
				Repo:        "test",
				DownloadURL: mockGH.URL + "/ok.zip",
			},
		},
		"v-changed": {
			ID:          "v-changed",
			ModID:       "mod-1",
			Version:     "1.0.1",
			State:       "published",
			SizeBytes:   int64(len(rawZip)),
			SHA256:      hashHex,
			ArchivePath: filepath.Join(dataDir, "placeholder-changed.zip"),
			SourceType:  "github_releases",
			GitHubSource: &VersionSourceLocation{
				Owner:       "octocat",
				Repo:        "test",
				DownloadURL: mockGH.URL + "/changed.zip",
			},
		},
		"v-429": {
			ID:          "v-429",
			ModID:       "mod-1",
			Version:     "1.0.2",
			State:       "published",
			SizeBytes:   int64(len(rawZip)),
			SHA256:      hashHex,
			ArchivePath: filepath.Join(dataDir, "placeholder-429.zip"),
			SourceType:  "github_releases",
			GitHubSource: &VersionSourceLocation{
				Owner:       "octocat",
				Repo:        "test",
				DownloadURL: mockGH.URL + "/rate-limited.zip",
			},
		},
		"v-404": {
			ID:          "v-404",
			ModID:       "mod-1",
			Version:     "1.0.3",
			State:       "published",
			SizeBytes:   int64(len(rawZip)),
			SHA256:      hashHex,
			ArchivePath: filepath.Join(dataDir, "placeholder-404.zip"),
			SourceType:  "github_releases",
			GitHubSource: &VersionSourceLocation{
				Owner:       "octocat",
				Repo:        "test",
				DownloadURL: mockGH.URL + "/missing.zip",
			},
		},
	}
	store.Catalog.Mods = []Mod{
		{
			ID:              "mod-1",
			Title:           "Test Mod",
			LatestVersionID: "v-relay-ok",
			Author:          Author{ID: "flarum:1", DisplayName: "author"},
		},
	}

	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	// 1. Success relay download: GET /api/v1/archives/v-relay-ok
	res, err := http.Get(server.URL + "/api/v1/archives/v-relay-ok")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 {
		t.Fatalf("expected 200 for v-relay-ok, got %d", res.StatusCode)
	}
	body, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if string(body) != string(rawZip) {
		t.Fatalf("downloaded content mismatch")
	}
	if res.Header.Get("X-Archive-SHA256") != hashHex {
		t.Fatalf("expected X-Archive-SHA256 %s, got %s", hashHex, res.Header.Get("X-Archive-SHA256"))
	}
	if atomic.LoadInt32(&proxyHits) == 0 {
		t.Fatal("expected proxy hits > 0 for relay download")
	}

	// 2. Legacy version with nil GitHubSource: should serve from local and NOT hit proxy/GH
	atomic.StoreInt32(&proxyHits, 0)
	resLegacy, err := http.Get(server.URL + "/api/v1/archives/v-legacy")
	if err != nil {
		t.Fatal(err)
	}
	if resLegacy.StatusCode != 200 {
		t.Fatalf("expected 200 for v-legacy, got %d", resLegacy.StatusCode)
	}
	legacyBody, _ := io.ReadAll(resLegacy.Body)
	_ = resLegacy.Body.Close()
	if string(legacyBody) != string(rawZip) {
		t.Fatalf("legacy content mismatch")
	}
	if atomic.LoadInt32(&proxyHits) != 0 {
		t.Fatal("expected 0 proxy hits for legacy local archive")
	}

	// 3. Unpublished version: should return 404
	resUnpub, err := http.Get(server.URL + "/api/v1/archives/v-unpublished")
	if err != nil {
		t.Fatal(err)
	}
	if resUnpub.StatusCode != 404 {
		t.Fatalf("expected 404 for unpublished version, got %d", resUnpub.StatusCode)
	}

	// 4. Hash mismatch / upstream archive changed: should return 502 upstream_archive_changed
	resChanged, err := http.Get(server.URL + "/api/v1/archives/v-changed")
	if err != nil {
		t.Fatal(err)
	}
	if resChanged.StatusCode != 502 {
		t.Fatalf("expected 502 for changed archive, got %d", resChanged.StatusCode)
	}
	var errResp struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(resChanged.Body).Decode(&errResp)
	if errResp.Code != "upstream_archive_changed" {
		t.Fatalf("expected code upstream_archive_changed, got %q", errResp.Code)
	}

	// 5. Upstream 429 rate limited: should return 503 github_upstream_rate_limited with Retry-After
	res429, err := http.Get(server.URL + "/api/v1/archives/v-429")
	if err != nil {
		t.Fatal(err)
	}
	if res429.StatusCode != 503 {
		t.Fatalf("expected 503 for 429, got %d", res429.StatusCode)
	}
	if res429.Header.Get("Retry-After") != "120" {
		t.Fatalf("expected Retry-After 120, got %q", res429.Header.Get("Retry-After"))
	}

	// 6. Upstream 404 missing: should return 502 github_upstream_failed
	res404, err := http.Get(server.URL + "/api/v1/archives/v-404")
	if err != nil {
		t.Fatal(err)
	}
	if res404.StatusCode != 502 {
		t.Fatalf("expected 502 for missing upstream, got %d", res404.StatusCode)
	}

	// 7. HEAD request: should return metadata without triggering proxy download
	atomic.StoreInt32(&proxyHits, 0)
	headRes, err := http.Head(server.URL + "/api/v1/archives/v-relay-ok")
	if err != nil {
		t.Fatal(err)
	}
	if headRes.StatusCode != 200 {
		t.Fatalf("expected 200 for HEAD, got %d", headRes.StatusCode)
	}
	if headRes.Header.Get("X-Archive-SHA256") != hashHex {
		t.Fatalf("expected sha %s, got %s", hashHex, headRes.Header.Get("X-Archive-SHA256"))
	}
	if atomic.LoadInt32(&proxyHits) != 0 {
		t.Fatal("expected HEAD request not to trigger proxy download")
	}

	// 8. Descriptor contract test: only local endpoint, sha256, size; no upstream URL or proxy leaked
	descRes, err := http.Get(server.URL + "/api/v1/versions/v-relay-ok/download")
	if err != nil {
		t.Fatal(err)
	}
	if descRes.StatusCode != 200 {
		t.Fatalf("expected 200 for download descriptor, got %d", descRes.StatusCode)
	}
	descBody, _ := io.ReadAll(descRes.Body)
	descStr := string(descBody)
	if strings.Contains(descStr, mockGH.URL) || strings.Contains(descStr, mockProxy.URL) {
		t.Fatalf("descriptor leaked upstream or proxy URL: %s", descStr)
	}
}
