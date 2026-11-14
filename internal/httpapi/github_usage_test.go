package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

func trackedObservation(at time.Time) github.APIRequestObservation {
	return github.APIRequestObservation{
		Endpoint:  "https://api.github.com/repos/owner/repo/releases",
		Status:    http.StatusOK,
		RateLimit: &github.RateLimitSnapshot{Limit: 5000, Used: 12, ResetAt: time.Unix(1800000000, 0).UTC()},
		At:        at,
	}
}

// The settings page answers "how many requests did this token cost us in the
// last hour", which is a rolling window, not GitHub's clock hour.
func TestGitHubUsageTrackerCountsRollingHour(t *testing.T) {
	clock := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	tracker := &githubUsageTracker{now: func() time.Time { return clock }}
	const token = "ghp_rolling"

	tracker.observe(token, trackedObservation(clock))
	tracker.observe(token, trackedObservation(clock.Add(30*time.Minute)))
	clock = clock.Add(30 * time.Minute)
	if got := tracker.view(token).RequestsLastHour; got != 2 {
		t.Fatalf("requests in window = %d, want 2", got)
	}

	// 61 minutes after the first request only the later one is still inside.
	clock = clock.Add(31 * time.Minute)
	if got := tracker.view(token).RequestsLastHour; got != 1 {
		t.Fatalf("requests in window = %d, want 1 after one request aged out", got)
	}

	clock = clock.Add(60 * time.Minute)
	if got := tracker.view(token).RequestsLastHour; got != 0 {
		t.Fatalf("requests in window = %d, want 0 once everything aged out", got)
	}
}

// Two requests exactly one window apart land in the same ring slot; the older
// count must be replaced, never added to the newer one.
func TestGitHubUsageTrackerRecyclesMinuteSlots(t *testing.T) {
	start := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	clock := start
	tracker := &githubUsageTracker{now: func() time.Time { return clock }}
	const token = "ghp_slots"

	tracker.observe(token, trackedObservation(start))
	clock = start.Add(githubUsageWindow)
	tracker.observe(token, trackedObservation(clock))

	if got := tracker.view(token).RequestsLastHour; got != 1 {
		t.Fatalf("requests in window = %d, want 1", got)
	}
}

// A replaced token spends a different bucket, so its predecessor's figures must
// not be reported as the current token's usage.
func TestGitHubUsageTrackerResetsOnTokenRotation(t *testing.T) {
	clock := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	tracker := &githubUsageTracker{now: func() time.Time { return clock }}

	tracker.observe("ghp_first", trackedObservation(clock))
	first := tracker.view("ghp_first")
	if first.RequestsLastHour != 1 || first.RateLimit == nil {
		t.Fatalf("first token usage = %+v", first)
	}

	replaced := tracker.view("ghp_second")
	if replaced.RequestsLastHour != 0 {
		t.Fatalf("replaced token reported %d requests, want 0", replaced.RequestsLastHour)
	}
	if replaced.RateLimit != nil {
		t.Fatalf("replaced token inherited a quota reading: %+v", replaced.RateLimit)
	}

	tracker.observe("ghp_second", github.APIRequestObservation{At: clock})
	second := tracker.view("ghp_second")
	if second.RequestsLastHour != 1 {
		t.Fatalf("second token requests = %d, want 1", second.RequestsLastHour)
	}
	if second.RateLimit != nil {
		t.Fatalf("second token inherited a quota reading: %+v", second.RateLimit)
	}
}

// A relay proxy can forward a response without the quota headers. The newest
// reading must survive those responses instead of being zeroed.
func TestGitHubUsageTrackerKeepsQuotaWhenHeadersAreMissing(t *testing.T) {
	clock := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	tracker := &githubUsageTracker{now: func() time.Time { return clock }}
	const token = "ghp_quota"

	tracker.observe(token, trackedObservation(clock))
	clock = clock.Add(time.Minute)
	tracker.observe(token, github.APIRequestObservation{At: clock})

	usage := tracker.view(token)
	if usage.RequestsLastHour != 2 {
		t.Fatalf("requests = %d, want 2", usage.RequestsLastHour)
	}
	if usage.RateLimit == nil {
		t.Fatal("quota reading was lost when a response carried no headers")
	}
	if usage.RateLimit.Used != 12 || usage.RateLimit.Limit != 5000 {
		t.Fatalf("quota = %+v", *usage.RateLimit)
	}
	if usage.RateLimit.ResetAt == nil || !usage.RateLimit.ResetAt.Equal(time.Unix(1800000000, 0).UTC()) {
		t.Fatalf("reset at = %v", usage.RateLimit.ResetAt)
	}
	if usage.RateLimit.ObservedAt.IsZero() {
		t.Fatal("quota reading lost its observation time")
	}
}

// Without a token there is no token quota to report, so the field stays out of
// the response instead of showing a meaningless zero.
func TestAdminSettingsOmitsTokenUsageWithoutToken(t *testing.T) {
	store, adminCookie, _, _, _ := createTestStoreWithAdmin(t)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	view := getAdminSettings(t, server, adminCookie)
	if _, ok := view["github_token_usage"]; ok {
		t.Fatalf("anonymous settings carried token usage: %v", view["github_token_usage"])
	}
}

// End to end: a real API call through the store's own client factory is what the
// settings page reports, including the quota GitHub sent back with it.
func TestAdminSettingsReportsGitHubTokenUsage(t *testing.T) {
	apiCalls := 0
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiCalls++
		w.Header().Set("X-Ratelimit-Limit", "5000")
		w.Header().Set("X-Ratelimit-Remaining", fmt.Sprintf("%d", 5000-apiCalls))
		w.Header().Set("X-Ratelimit-Reset", "1800000000")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v1.0.0","name":"v1.0.0","assets":[]}`))
	}))
	defer ghServer.Close()

	store, adminCookie, adminCSRF, _, _ := createTestStoreWithAdmin(t)
	store.GitHubClient = github.NewClient(
		github.WithBaseURL(ghServer.URL),
		github.WithAllowInsecureTestHosts(true),
	)
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	const token = "ghp_usagetoken1234"
	res, body := patchAdminSettings(t, server, adminCookie, adminCSRF, fmt.Sprintf(`{"github_token":%q,"revision":0}`, token))
	if res.StatusCode != 200 {
		t.Fatalf("PATCH token = %d (%v)", res.StatusCode, body)
	}

	// A freshly saved token has not spent anything yet.
	before := tokenUsageFromSettings(t, server, adminCookie)
	if before.RequestsLastHour != 0 {
		t.Fatalf("fresh token reported %d requests", before.RequestsLastHour)
	}
	if before.RateLimit != nil {
		t.Fatalf("fresh token reported a quota reading: %+v", before.RateLimit)
	}

	client := store.githubClient()
	for i := 0; i < 2; i++ {
		if _, err := client.LatestRelease(context.Background(), "owner", "repo"); err != nil {
			t.Fatalf("latest release: %v", err)
		}
	}

	usage := tokenUsageFromSettings(t, server, adminCookie)
	if usage.RequestsLastHour != 2 {
		t.Fatalf("requests in last hour = %d, want 2", usage.RequestsLastHour)
	}
	if usage.RateLimit == nil {
		t.Fatal("quota reading missing")
	}
	if usage.RateLimit.Limit != 5000 || usage.RateLimit.Used != 2 {
		t.Fatalf("quota = %+v, want limit 5000 used 2", *usage.RateLimit)
	}
	if usage.RateLimit.ResetAt == nil || !usage.RateLimit.ResetAt.Equal(time.Unix(1800000000, 0).UTC()) {
		t.Fatalf("reset at = %v", usage.RateLimit.ResetAt)
	}
}

func tokenUsageFromSettings(t *testing.T, server *httptest.Server, cookie *http.Cookie) githubTokenUsage {
	t.Helper()
	view := getAdminSettings(t, server, cookie)
	raw, ok := view["github_token_usage"]
	if !ok {
		t.Fatalf("settings response has no github_token_usage: %v", view)
	}
	fields, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("github_token_usage is not an object: %v", raw)
	}
	usage := githubTokenUsage{RequestsLastHour: int(fields["requests_last_hour"].(float64))}
	if rateLimit, ok := fields["rate_limit"].(map[string]any); ok {
		usage.RateLimit = &githubTokenRateLimit{
			Limit:      int(rateLimit["limit"].(float64)),
			Used:       int(rateLimit["used"].(float64)),
			ObservedAt: time.Now(),
		}
		if reset, ok := rateLimit["reset_at"].(string); ok {
			parsed, err := time.Parse(time.RFC3339, reset)
			if err != nil {
				t.Fatalf("reset_at %q is not RFC3339: %v", reset, err)
			}
			usage.RateLimit.ResetAt = &parsed
		}
	}
	return usage
}
