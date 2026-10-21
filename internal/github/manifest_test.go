package github_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/github"
)

func TestParseManifestAcceptsDocumentedShape(t *testing.T) {
	body := []byte(`
# rezehub, non-API version discovery
schema: 1
releases:
  - version: " 1.2.0 "
    url: https://github.com/octocat/hello/releases/download/v1.2.0/Mod-1.2.0.zip
    sha256: ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789
    notes: "首个版本"
  - version: 1.3.0
    url: https://github.com/octocat/hello/releases/download/v1.3.0/Mod-1.3.0.zip
`)
	m, err := github.ParseManifest(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if m.Schema != github.ManifestSchemaVersion {
		t.Fatalf("schema = %d, want %d", m.Schema, github.ManifestSchemaVersion)
	}
	if len(m.Releases) != 2 {
		t.Fatalf("releases = %d, want 2", len(m.Releases))
	}
	if m.Releases[0].Version != "1.2.0" {
		t.Fatalf("version was not trimmed: %q", m.Releases[0].Version)
	}
	if m.Releases[0].SHA256 != strings.ToLower(m.Releases[0].SHA256) {
		t.Fatalf("sha256 was not normalised: %q", m.Releases[0].SHA256)
	}
	if m.Releases[1].Notes != "" {
		t.Fatalf("optional notes should default to empty, got %q", m.Releases[1].Notes)
	}
}

func TestParseManifestRejectsUntrustworthyDocuments(t *testing.T) {
	good := "url: https://github.com/o/r/releases/download/v1/x.zip"
	cases := map[string]string{
		"empty file":        "   \n",
		"unknown key":       "releases:\n  - version: 1.0.0\n    " + good + "\n    oops: 1\n",
		"future schema":     "schema: 2\nreleases: []\n",
		"missing version":   "releases:\n  - " + good + "\n",
		"missing url":       "releases:\n  - version: 1.0.0\n",
		"duplicate version": "releases:\n  - version: 1.0.0\n    " + good + "\n  - version: 1.0.0\n    " + good + "\n",
		"non-https url":     "releases:\n  - version: 1.0.0\n    url: http://example.com/x.zip\n",
		"non-zip url":       "releases:\n  - version: 1.0.0\n    url: https://github.com/o/r/releases/download/v1/x.tar.gz\n",
		"short sha256":      "releases:\n  - version: 1.0.0\n    " + good + "\n    sha256: abc\n",
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := github.ParseManifest([]byte(body)); !errors.Is(err, github.ErrInvalidManifest) {
				t.Fatalf("expected ErrInvalidManifest, got %v", err)
			}
		})
	}
}

func TestFetchManifestFallsBackToNamedBranches(t *testing.T) {
	var tried []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tried = append(tried, r.URL.Path)
		if r.URL.Path == "/octocat/hello/main/"+github.ManifestFileName {
			fmt.Fprint(w, "schema: 1\nreleases: []\n")
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	m, digest, err := client.FetchManifest(context.Background(), "octocat", "hello")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(m.Releases) != 0 || digest == "" {
		t.Fatalf("unexpected manifest: %+v digest=%q", m, digest)
	}
	want := []string{
		"/octocat/hello/HEAD/" + github.ManifestFileName,
		"/octocat/hello/main/" + github.ManifestFileName,
	}
	if strings.Join(tried, ",") != strings.Join(want, ",") {
		t.Fatalf("probed %v, want %v", tried, want)
	}
}

func TestFetchManifestReportsMissingFileAsNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	if _, _, err := client.FetchManifest(context.Background(), "octocat", "hello"); !errors.Is(err, github.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// A malformed manifest must not be reported as a missing one: the author needs
// to know the file exists but is wrong.
func TestFetchManifestReportsParseErrorSeparately(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "schema: 1\nreleases:\n  - version: 1.0.0\n")
	}))
	defer server.Close()

	client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	_, _, err := client.FetchManifest(context.Background(), "octocat", "hello")
	if !errors.Is(err, github.ErrInvalidManifest) {
		t.Fatalf("expected ErrInvalidManifest, got %v", err)
	}
	if errors.Is(err, github.ErrNotFound) {
		t.Fatalf("a broken manifest must not look missing: %v", err)
	}
}

func TestClientSendsTokenOnlyToAPIHost(t *testing.T) {
	var apiAuth, contentAuth string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiAuth = r.Header.Get("Authorization")
		fmt.Fprint(w, "[]")
	}))
	defer api.Close()
	// A separate origin stands in for the asset CDN.
	assets := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte("zip"))
	}))
	defer assets.Close()

	client := github.NewClient(
		github.WithBaseURL(api.URL),
		github.WithHTTPClient(api.Client()),
		github.WithToken("secret-token"),
	)
	if _, _, _, err := client.ListReleases(context.Background(), "octocat", "hello", ""); err != nil {
		t.Fatalf("list releases: %v", err)
	}
	if apiAuth != "Bearer secret-token" {
		t.Fatalf("API request Authorization = %q", apiAuth)
	}
	// The asset host is a different origin: the token must not leak there.
	if _, _, _, err := client.DownloadToTemp(context.Background(), assets.URL+"/asset.zip", 1<<20); err != nil {
		t.Fatalf("download: %v", err)
	}
	if contentAuth != "" {
		t.Fatalf("asset request leaked Authorization: %q", contentAuth)
	}
}
