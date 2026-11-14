package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/reze/submodhub/internal/github"
)

// githubUsageWindow is the rolling window behind the settings page's "requests
// in the last hour" figure. GitHub charges a token per clock hour; this window
// is rolling instead so the number never drops by a whole hour's worth of
// requests at one boundary.
const githubUsageWindow = time.Hour

// githubUsageSlots is the number of one-minute buckets the tracker keeps. Sixty
// slots cover the window exactly: the current minute plus the previous 59.
const githubUsageSlots = int(githubUsageWindow / time.Minute)

// githubUsageBucket is one minute of counted requests. minute is the absolute
// minute number, so a recycled slot can never be mistaken for the current one.
type githubUsageBucket struct {
	minute int64
	count  int
}

// githubUsageTracker counts the API requests this process sends with the
// installed token and remembers the quota GitHub reported on the newest
// response.
//
// The token itself never enters the tracker. Only a fingerprint of it does, so a
// rotation resets the numbers without the state holding a credential.
//
// The tracker keeps a private mutex instead of borrowing Store.mu: observations
// arrive from inside GitHub calls, which may already run under the store lock,
// and taking that lock again there would deadlock behind a waiting writer.
type githubUsageTracker struct {
	mu sync.Mutex
	// now is nil in production; only tests that need a stable clock set it.
	now        func() time.Time
	tokenFP    string
	buckets    [githubUsageSlots]githubUsageBucket
	limit      int
	used       int
	resetAt    time.Time
	observedAt time.Time
}

// githubTokenUsage describes what the installed token has spent. The settings
// page shows it so an operator can tell a healthy quota from an exhausted one
// without reading logs.
type githubTokenUsage struct {
	// RequestsLastHour counts the API requests this process sent with the token
	// during the last 60 minutes, including conditional requests that GitHub
	// does not charge. It restarts at zero when the process restarts or the
	// token is replaced.
	RequestsLastHour int `json:"requests_last_hour"`
	// RateLimit is the quota GitHub reported on the newest authenticated
	// response. It is absent until one is observed, and stays absent when a
	// relay proxy strips the quota headers.
	RateLimit *githubTokenRateLimit `json:"rate_limit,omitempty"`
}

// githubTokenRateLimit mirrors GitHub's own accounting for the token's current
// hourly window. Unlike RequestsLastHour it also covers other services that
// share the same token, which is what decides whether the next sync is refused.
type githubTokenRateLimit struct {
	Limit      int        `json:"limit"`
	Used       int        `json:"used"`
	ResetAt    *time.Time `json:"reset_at,omitempty"`
	ObservedAt time.Time  `json:"observed_at"`
}

// githubTokenFingerprint identifies a token without keeping it. An empty token
// has no fingerprint: anonymous traffic spends the shared IP bucket, not a
// token's quota, so it is never counted here.
func githubTokenFingerprint(token string) string {
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:8])
}

func (t *githubUsageTracker) clock() time.Time {
	if t.now != nil {
		return t.now().UTC()
	}
	return time.Now().UTC()
}

// observe records one authenticated API request sent with token.
func (t *githubUsageTracker) observe(token string, obs github.APIRequestObservation) {
	at := obs.At.UTC()
	if at.IsZero() {
		at = t.clock()
	}
	minute := at.Unix() / 60

	t.mu.Lock()
	defer t.mu.Unlock()
	t.adoptLocked(githubTokenFingerprint(token))

	index := int(((minute % int64(githubUsageSlots)) + int64(githubUsageSlots)) % int64(githubUsageSlots))
	bucket := &t.buckets[index]
	if bucket.minute == minute {
		bucket.count++
	} else {
		*bucket = githubUsageBucket{minute: minute, count: 1}
	}

	// A response without quota headers must not erase what the previous one
	// reported: behind a relay proxy the headers may simply be dropped.
	if obs.RateLimit != nil {
		t.limit = obs.RateLimit.Limit
		t.used = obs.RateLimit.Used
		t.resetAt = obs.RateLimit.ResetAt
		t.observedAt = at
	}
}

// adoptLocked drops every number when the installed token is no longer the one
// they were counted for, because a different token spends a different bucket.
func (t *githubUsageTracker) adoptLocked(fingerprint string) {
	if t.tokenFP == fingerprint {
		return
	}
	t.tokenFP = fingerprint
	t.buckets = [githubUsageSlots]githubUsageBucket{}
	t.limit = 0
	t.used = 0
	t.resetAt = time.Time{}
	t.observedAt = time.Time{}
}

// view renders the numbers that belong to token. A token the tracker has never
// observed gets zeroes rather than the previous token's figures, so the page
// never attributes one token's traffic to another.
func (t *githubUsageTracker) view(token string) *githubTokenUsage {
	fingerprint := githubTokenFingerprint(token)
	current := t.clock().Unix() / 60

	t.mu.Lock()
	defer t.mu.Unlock()
	if fingerprint != t.tokenFP {
		return &githubTokenUsage{}
	}

	oldest := current - int64(githubUsageSlots-1)
	requests := 0
	for _, bucket := range t.buckets {
		if bucket.count > 0 && bucket.minute >= oldest && bucket.minute <= current {
			requests += bucket.count
		}
	}

	usage := &githubTokenUsage{RequestsLastHour: requests}
	if t.limit > 0 && !t.observedAt.IsZero() {
		rateLimit := &githubTokenRateLimit{Limit: t.limit, Used: t.used, ObservedAt: t.observedAt}
		if !t.resetAt.IsZero() {
			resetAt := t.resetAt
			rateLimit.ResetAt = &resetAt
		}
		usage.RateLimit = rateLimit
	}
	return usage
}
