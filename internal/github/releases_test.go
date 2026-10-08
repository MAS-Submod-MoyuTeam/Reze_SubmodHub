package github

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseNextPageURL(t *testing.T) {
	tests := []struct {
		name     string
		header   string
		expected string
	}{
		{
			name:     "empty",
			header:   "",
			expected: "",
		},
		{
			name:     "no rel next",
			header:   `<https://api.github.com/repos/o/r/releases?page=1>; rel="prev", <https://api.github.com/repos/o/r/releases?page=5>; rel="last"`,
			expected: "",
		},
		{
			name:     "standard rel next",
			header:   `<https://api.github.com/repos/o/r/releases?page=2&per_page=100>; rel="next", <https://api.github.com/repos/o/r/releases?page=5&per_page=100>; rel="last"`,
			expected: "https://api.github.com/repos/o/r/releases?page=2&per_page=100",
		},
		{
			name:     "rel next with single quotes and spaces",
			header:   `<https://example.com/next-page>; rel = 'next'`,
			expected: "https://example.com/next-page",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseNextPageURL(tt.header)
			if got != tt.expected {
				t.Errorf("ParseNextPageURL(%q) = %q, want %q", tt.header, got, tt.expected)
			}
		})
	}
}

func TestClientListReleases(t *testing.T) {
	etagSent := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("missing User-Agent")
		}
		if r.URL.Path != "/repos/octocat/hello-world/releases" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("If-None-Match") == `"etag-123"` {
			etagSent = true
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"etag-123"`)
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `[
			{
				"id": 101,
				"tag_name": "v1.0.0",
				"name": "First Release",
				"body": "Notes for v1.0.0",
				"draft": false,
				"prerelease": false,
				"zipball_url": "https://api.github.com/repos/octocat/hello-world/zipball/v1.0.0",
				"assets": [
					{
						"id": 201,
						"name": "mod-1.0.0.zip",
						"size": 1024,
						"browser_download_url": "https://example.com/mod-1.0.0.zip"
					}
				]
			},
			{
				"id": 102,
				"tag_name": "v1.1.0-draft",
				"name": "Draft Release",
				"body": "Draft",
				"draft": true,
				"zipball_url": "",
				"assets": []
			}
		]`)
	}))
	defer server.Close()

	client := NewClient(WithBaseURL(server.URL), WithHTTPClient(server.Client()))

	// 1. Initial list
	releases, etag, notModified, err := client.ListReleases(context.Background(), "octocat", "hello-world", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notModified {
		t.Fatal("expected notModified to be false")
	}
	if etag != `"etag-123"` {
		t.Fatalf("expected etag \"etag-123\", got %q", etag)
	}
	// Draft releases should be filtered out
	if len(releases) != 1 {
		t.Fatalf("expected 1 published release, got %d", len(releases))
	}
	if releases[0].TagName != "v1.0.0" || releases[0].ID != 101 {
		t.Fatalf("unexpected release: %+v", releases[0])
	}

	// 2. Request with ETag (should return 304 Not Modified)
	releases304, etag304, notMod304, err := client.ListReleases(context.Background(), "octocat", "hello-world", `"etag-123"`)
	if err != nil {
		t.Fatalf("unexpected error on 304: %v", err)
	}
	if !notMod304 {
		t.Fatal("expected notModified to be true")
	}
	if len(releases304) != 0 {
		t.Fatalf("expected 0 releases on 304, got %d", len(releases304))
	}
	if etag304 != `"etag-123"` {
		t.Fatalf("expected preserved etag, got %q", etag304)
	}
	if !etagSent {
		t.Fatal("If-None-Match header was not sent")
	}
}

func TestClientListReleasesPagination(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/octocat/multi/releases" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("page") == "2" {
			// Page 2
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `[
				{"id": 3, "tag_name": "v1.2.0", "name": "Rel 3", "draft": false},
				{"id": 4, "tag_name": "v1.3.0-draft", "name": "Rel 4 Draft", "draft": true}
			]`)
			return
		}

		// Page 1
		w.Header().Set("ETag", `"etag-page1"`)
		w.Header().Set("Link", fmt.Sprintf(`<%s/repos/octocat/multi/releases?page=2&per_page=100>; rel="next"`, server.URL))
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `[
			{"id": 1, "tag_name": "v1.0.0", "name": "Rel 1", "draft": false},
			{"id": 2, "tag_name": "v1.1.0", "name": "Rel 2", "draft": false}
		]`)
	}))
	defer server.Close()

	client := NewClient(WithBaseURL(server.URL), WithHTTPClient(server.Client()))
	releases, etag, notModified, err := client.ListReleases(context.Background(), "octocat", "multi", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notModified {
		t.Fatal("expected notModified to be false")
	}
	if etag != `"etag-page1"` {
		t.Fatalf("expected etag \"etag-page1\", got %q", etag)
	}
	// Total 3 published releases across pages 1 and 2 (excluding 1 draft)
	if len(releases) != 3 {
		t.Fatalf("expected 3 published releases from multi-page response, got %d", len(releases))
	}
	if releases[0].TagName != "v1.0.0" || releases[1].TagName != "v1.1.0" || releases[2].TagName != "v1.2.0" {
		t.Fatalf("unexpected releases list: %+v", releases)
	}
}

func TestClientListReleasesRateLimitHeaders(t *testing.T) {
	resetEpoch := time.Now().Add(30 * time.Minute).Unix()
	server429 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Ratelimit-Reset", fmt.Sprintf("%d", resetEpoch))
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"message":"API rate limit exceeded for 1.2.3.4"}`)
	}))
	defer server429.Close()

	client := NewClient(WithBaseURL(server429.URL), WithHTTPClient(server429.Client()))
	_, _, _, err := client.ListReleases(context.Background(), "octocat", "hello", "")
	if err == nil {
		t.Fatal("expected rate limited error, got nil")
	}
	if !IsRateLimited(err) {
		t.Fatalf("expected IsRateLimited(err) == true, got %v", err)
	}
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("expected errors.Is(err, ErrRateLimited) == true")
	}

	rlErr, ok := AsRateLimitError(err)
	if !ok {
		t.Fatalf("expected AsRateLimitError to succeed, got %v", err)
	}
	if rlErr.ResetAt.Unix() != resetEpoch {
		t.Fatalf("expected ResetAt unix %d, got %d", resetEpoch, rlErr.ResetAt.Unix())
	}
	if rlErr.RetryAfter != 120*time.Second {
		t.Fatalf("expected RetryAfter 120s, got %v", rlErr.RetryAfter)
	}
}

func TestClientListReleasesErrorClassification(t *testing.T) {
	// Rate limit test
	server429 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"message":"API rate limit exceeded"}`)
	}))
	defer server429.Close()

	client429 := NewClient(WithBaseURL(server429.URL), WithHTTPClient(server429.Client()))
	_, _, _, err := client429.ListReleases(context.Background(), "octocat", "hello", "")
	if !IsRateLimited(err) {
		t.Fatalf("expected rate limited error, got: %v", err)
	}

	// 404 test
	server404 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server404.Close()

	client404 := NewClient(WithBaseURL(server404.URL), WithHTTPClient(server404.Client()))
	_, _, _, err404 := client404.ListReleases(context.Background(), "octocat", "missing", "")
	if !IsNotFound(err404) {
		t.Fatalf("expected not found error, got: %v", err404)
	}
}

func TestSourceCodeZipballDownloadAcceptsZip(t *testing.T) {
	zipData := []byte("PK\x03\x04test")
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/owner/repo/zipball/v1.0.0" {
			if r.Header.Get("Accept") == "application/octet-stream" {
				w.WriteHeader(http.StatusUnsupportedMediaType)
				return
			}
			http.Redirect(w, r, server.URL+"/archive.zip", http.StatusFound)
			return
		}
		if r.URL.Path == "/archive.zip" {
			_, _ = w.Write(zipData)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient(WithBaseURL(server.URL), WithHTTPClient(server.Client()))
	path, _, _, err := client.DownloadToTemp(context.Background(), server.URL+"/repos/owner/repo/zipball/v1.0.0", 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(zipData) {
		t.Fatalf("zipball download mismatch: %q, %v", got, err)
	}
}

func TestClientDownloadToTemp(t *testing.T) {
	data := []byte("this is simulated zip file content")
	hash := sha256.Sum256(data)
	expectedHash := hex.EncodeToString(hash[:])

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}))
	defer server.Close()

	client := NewClient(WithBaseURL(server.URL), WithHTTPClient(server.Client()))

	// Normal download
	path, sha, size, err := client.DownloadToTemp(context.Background(), server.URL+"/download", 1024*1024)
	if err != nil {
		t.Fatalf("unexpected download error: %v", err)
	}
	defer os.Remove(path)

	if sha != expectedHash {
		t.Fatalf("expected sha %s, got %s", expectedHash, sha)
	}
	if size != int64(len(data)) {
		t.Fatalf("expected size %d, got %d", len(data), size)
	}
	readBack, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(readBack) != string(data) {
		t.Fatalf("downloaded content mismatch")
	}

	// Download exceeding max size
	_, _, _, errExceed := client.DownloadToTemp(context.Background(), server.URL+"/download", int64(len(data)-5))
	if errExceed == nil || !strings.Contains(errExceed.Error(), "exceed") {
		t.Fatalf("expected size limit exceeded error, got %v", errExceed)
	}
}
