package github_test

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

// quotaHeaders returns the rate-limit headers GitHub sends on every API
// response for an authenticated token.
func quotaHeaders(limit, remaining, reset int64) http.Header {
	header := http.Header{}
	header.Set("X-Ratelimit-Limit", strconv.FormatInt(limit, 10))
	header.Set("X-Ratelimit-Remaining", strconv.FormatInt(remaining, 10))
	header.Set("X-Ratelimit-Reset", strconv.FormatInt(reset, 10))
	return header
}

func TestRequestObserverReportsAuthenticatedAPIRequests(t *testing.T) {
	var observations []github.APIRequestObservation
	client := github.NewClient(
		github.WithToken("ghp_observer"),
		github.WithRequestObserver(func(obs github.APIRequestObservation) {
			observations = append(observations, obs)
		}),
		github.WithHTTPClient(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     quotaHeaders(5000, 4993, 1800000000),
				Body:       io.NopCloser(strings.NewReader(`{"tag_name":"v1.2.3"}`)),
				Request:    r,
			}, nil
		})}),
	)

	if _, err := client.LatestRelease(context.Background(), "owner", "repo"); err != nil {
		t.Fatalf("latest release: %v", err)
	}

	if len(observations) != 1 {
		t.Fatalf("observations = %d, want 1", len(observations))
	}
	obs := observations[0]
	if obs.Status != http.StatusOK {
		t.Fatalf("status = %d", obs.Status)
	}
	if !strings.HasSuffix(obs.Endpoint, "/repos/owner/repo/releases/latest") {
		t.Fatalf("endpoint = %q", obs.Endpoint)
	}
	if obs.RateLimit == nil {
		t.Fatal("quota headers were not reported")
	}
	if obs.RateLimit.Limit != 5000 || obs.RateLimit.Used != 7 {
		t.Fatalf("rate limit = %+v, want limit 5000 used 7", *obs.RateLimit)
	}
	if want := time.Unix(1800000000, 0).UTC(); !obs.RateLimit.ResetAt.Equal(want) {
		t.Fatalf("reset at = %s, want %s", obs.RateLimit.ResetAt, want)
	}
}

// Anonymous traffic spends the shared per-IP bucket, not a token's quota, so the
// settings page must not attribute it to the current token.
func TestRequestObserverStaysSilentWithoutToken(t *testing.T) {
	called := false
	client := github.NewClient(
		github.WithRequestObserver(func(github.APIRequestObservation) { called = true }),
		github.WithHTTPClient(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     quotaHeaders(60, 59, 1800000000),
				Body:       io.NopCloser(strings.NewReader(`{"tag_name":"v1.2.3"}`)),
				Request:    r,
			}, nil
		})}),
	)

	if _, err := client.LatestRelease(context.Background(), "owner", "repo"); err != nil {
		t.Fatalf("latest release: %v", err)
	}
	if called {
		t.Fatal("anonymous request was reported as token usage")
	}
}

// Asset downloads are delivery traffic and never carry the token, so counting
// them would overstate what the token spent.
func TestRequestObserverSkipsAssetDownloads(t *testing.T) {
	called := false
	client := github.NewClient(
		github.WithToken("ghp_observer"),
		github.WithRequestObserver(func(github.APIRequestObservation) { called = true }),
		github.WithHTTPClient(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{},
				Body:       io.NopCloser(strings.NewReader("archive-bytes")),
				Request:    r,
			}, nil
		})}),
	)

	res, err := client.OpenArchiveStream(context.Background(), "https://objects.githubusercontent.com/asset.zip")
	if err != nil {
		t.Fatalf("open archive stream: %v", err)
	}
	_ = res.Body.Close()
	if called {
		t.Fatal("asset download was reported as token usage")
	}
}

// A redirect is not the request GitHub charges for; only the response the client
// finally reads is.
func TestRequestObserverReportsTheFollowedResponseOnce(t *testing.T) {
	var observations []github.APIRequestObservation
	attempt := 0
	client := github.NewClient(
		github.WithToken("ghp_observer"),
		github.WithRequestObserver(func(obs github.APIRequestObservation) {
			observations = append(observations, obs)
		}),
		github.WithHTTPClient(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			attempt++
			if attempt == 1 {
				header := http.Header{}
				header.Set("Location", "https://api.github.com/repositories/42/releases/latest")
				return &http.Response{
					StatusCode: http.StatusMovedPermanently,
					Header:     header,
					Body:       io.NopCloser(strings.NewReader("")),
					Request:    r,
				}, nil
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     quotaHeaders(5000, 4999, 1800000000),
				Body:       io.NopCloser(strings.NewReader(`{"tag_name":"v1.2.3"}`)),
				Request:    r,
			}, nil
		})}),
	)

	if _, err := client.LatestRelease(context.Background(), "owner", "repo"); err != nil {
		t.Fatalf("latest release: %v", err)
	}
	if len(observations) != 1 {
		t.Fatalf("observations = %d, want exactly the followed response", len(observations))
	}
	if observations[0].RateLimit == nil || observations[0].RateLimit.Used != 1 {
		t.Fatalf("followed response quota = %+v", observations[0].RateLimit)
	}
}

// A relay proxy may forward the body but drop the quota headers. The request is
// still real, so it is reported; only the quota figures are missing.
func TestRequestObserverReportsRequestWithoutQuotaHeaders(t *testing.T) {
	var observations []github.APIRequestObservation
	client := github.NewClient(
		github.WithToken("ghp_observer"),
		github.WithRequestObserver(func(obs github.APIRequestObservation) {
			observations = append(observations, obs)
		}),
		github.WithHTTPClient(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{},
				Body:       io.NopCloser(strings.NewReader(`{"tag_name":"v1.2.3"}`)),
				Request:    r,
			}, nil
		})}),
	)

	if _, err := client.LatestRelease(context.Background(), "owner", "repo"); err != nil {
		t.Fatalf("latest release: %v", err)
	}
	if len(observations) != 1 {
		t.Fatalf("observations = %d, want 1", len(observations))
	}
	if observations[0].RateLimit != nil {
		t.Fatalf("quota should stay unknown: %+v", *observations[0].RateLimit)
	}
}
