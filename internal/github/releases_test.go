package github

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

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
