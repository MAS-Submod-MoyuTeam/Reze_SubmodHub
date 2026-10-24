package github_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/github"
)

// The repository-root VERSION file is the release-version source of truth. It
// lives on raw.githubusercontent.com, which is outside the REST rate limit, so
// reading it is how the server can notice a new release without spending quota.
func TestFetchRepoVersionReadsRepositoryRootFile(t *testing.T) {
	var tried []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tried = append(tried, r.URL.Path)
		if r.URL.Path == "/octocat/hello/HEAD/"+github.VersionFileName {
			fmt.Fprint(w, "  0.9.14\n")
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	version, err := client.FetchRepoVersion(context.Background(), "octocat", "hello")
	if err != nil {
		t.Fatalf("fetch version: %v", err)
	}
	if version != "0.9.14" {
		t.Fatalf("version = %q, want 0.9.14", version)
	}
	want := []string{"/octocat/hello/HEAD/" + github.VersionFileName}
	if strings.Join(tried, ",") != strings.Join(want, ",") {
		t.Fatalf("probed %v, want %v", tried, want)
	}
}

func TestFetchRepoVersionFallsBackToNamedBranches(t *testing.T) {
	var tried []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tried = append(tried, r.URL.Path)
		if r.URL.Path == "/octocat/hello/main/"+github.VersionFileName {
			fmt.Fprint(w, "v1.0.0\n")
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	version, err := client.FetchRepoVersion(context.Background(), "octocat", "hello")
	if err != nil {
		t.Fatalf("fetch version: %v", err)
	}
	// The probe never returns a tag name: callers compare it against a tag, so
	// the leading "v" must be normalised away here.
	if version != "1.0.0" {
		t.Fatalf("version = %q, want 1.0.0", version)
	}
	want := []string{
		"/octocat/hello/HEAD/" + github.VersionFileName,
		"/octocat/hello/main/" + github.VersionFileName,
	}
	if strings.Join(tried, ",") != strings.Join(want, ",") {
		t.Fatalf("probed %v, want %v", tried, want)
	}
}

func TestFetchRepoVersionReportsMissingFileAsNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	if _, err := client.FetchRepoVersion(context.Background(), "octocat", "hello"); !errors.Is(err, github.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// A file that exists but does not hold a version must not be reported as a
// version, and must not look missing either.
func TestFetchRepoVersionRejectsUntrustedContent(t *testing.T) {
	cases := map[string]string{
		"empty":          "   \n",
		"two lines":      "0.9.13\n0.9.14\n",
		"two components": "1.2\n",
		"not a version":  "release\n",
		"trailing words": "0.9.13 stable\n",
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, body)
			}))
			defer server.Close()

			client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
			_, err := client.FetchRepoVersion(context.Background(), "octocat", "hello")
			if !errors.Is(err, github.ErrInvalidVersionFile) {
				t.Fatalf("expected ErrInvalidVersionFile, got %v", err)
			}
			if errors.Is(err, github.ErrNotFound) {
				t.Fatalf("a broken file must not look missing: %v", err)
			}
		})
	}
}

// FetchRepoVersionAt answers "does this ref exist?" and must not fall back to a
// branch: the caller is asking about one tag, and a branch fallback would answer
// a different question while looking like a yes.
func TestFetchRepoVersionAtProbesExactlyOneRef(t *testing.T) {
	var tried []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tried = append(tried, r.URL.Path)
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	_, err := client.FetchRepoVersionAt(context.Background(), "octocat", "hello", "v9.9.10")
	if !errors.Is(err, github.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
	want := []string{"/octocat/hello/v9.9.10/" + github.VersionFileName}
	if strings.Join(tried, ",") != strings.Join(want, ",") {
		t.Fatalf("probed %v, want %v", tried, want)
	}
}

func TestFetchRepoVersionAtReturnsTheTaggedValue(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/octocat/hello/v9.9.10/"+github.VersionFileName {
			fmt.Fprint(w, "9.9.10\n")
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	version, err := client.FetchRepoVersionAt(context.Background(), "octocat", "hello", "v9.9.10")
	if err != nil {
		t.Fatalf("fetch version: %v", err)
	}
	if version != "9.9.10" {
		t.Fatalf("version = %q, want 9.9.10", version)
	}
}

// roundTripFunc lets a test observe the exact request without opening a socket.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// The VERSION probe must address the content host and must never carry the REST
// API token: raw.githubusercontent.com is a delivery origin, not an API.
func TestFetchRepoVersionNeverSendsToken(t *testing.T) {
	var gotURL, gotAuth string
	client := github.NewClient(
		github.WithToken("secret-token"),
		github.WithHTTPClient(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			gotURL = r.URL.String()
			gotAuth = r.Header.Get("Authorization")
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{},
				Body:       io.NopCloser(strings.NewReader("0.9.13\n")),
				Request:    r,
			}, nil
		})}),
	)

	version, err := client.FetchRepoVersion(context.Background(), "octocat", "hello")
	if err != nil {
		t.Fatalf("fetch version: %v", err)
	}
	if version != "0.9.13" {
		t.Fatalf("version = %q", version)
	}
	if want := "https://raw.githubusercontent.com/octocat/hello/HEAD/" + github.VersionFileName; gotURL != want {
		t.Fatalf("probe url = %q, want %q", gotURL, want)
	}
	if gotAuth != "" {
		t.Fatalf("probe leaked Authorization: %q", gotAuth)
	}
}
