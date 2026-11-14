package github

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

var (
	ErrRateLimited = errors.New("github api rate limit exceeded")
	ErrNotFound    = errors.New("github repository or release not found")
	ErrTooLarge    = errors.New("archive size exceeds maximum allowed limit")
)

type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("github api error (%d): %s", e.StatusCode, e.Message)
}

type RateLimitError struct {
	StatusCode int
	ResetAt    time.Time
	RetryAfter time.Duration
	Message    string
}

func (e *RateLimitError) Error() string {
	if !e.ResetAt.IsZero() {
		return fmt.Sprintf("github api rate limit exceeded (reset at %s): %s", e.ResetAt.UTC().Format(time.RFC3339), e.Message)
	}
	if e.RetryAfter > 0 {
		return fmt.Sprintf("github api rate limit exceeded (retry after %s): %s", e.RetryAfter, e.Message)
	}
	return fmt.Sprintf("github api rate limit exceeded: %s", e.Message)
}

func (e *RateLimitError) Is(target error) bool {
	return target == ErrRateLimited
}

func AsRateLimitError(err error) (*RateLimitError, bool) {
	var rlErr *RateLimitError
	if errors.As(err, &rlErr) {
		return rlErr, true
	}
	return nil, false
}

func parseRateLimitError(res *http.Response) *RateLimitError {
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	msg := strings.TrimSpace(string(body))
	if msg == "" {
		msg = http.StatusText(res.StatusCode)
	}

	var resetAt time.Time
	var retryAfter time.Duration

	if resetHeader := res.Header.Get("X-Ratelimit-Reset"); resetHeader != "" {
		if sec, err := strconv.ParseInt(strings.TrimSpace(resetHeader), 10, 64); err == nil && sec > 0 {
			resetAt = time.Unix(sec, 0)
		}
	}

	if retryHeader := res.Header.Get("Retry-After"); retryHeader != "" {
		retryHeader = strings.TrimSpace(retryHeader)
		if sec, err := strconv.ParseInt(retryHeader, 10, 64); err == nil && sec > 0 {
			retryAfter = time.Duration(sec) * time.Second
		} else if parsedTime, err := http.ParseTime(retryHeader); err == nil {
			if dur := time.Until(parsedTime); dur > 0 {
				retryAfter = dur
			}
			if resetAt.IsZero() {
				resetAt = parsedTime
			}
		}
	}

	return &RateLimitError{
		StatusCode: res.StatusCode,
		ResetAt:    resetAt,
		RetryAfter: retryAfter,
		Message:    msg,
	}
}

func ParseNextPageURL(linkHeader string) string {
	if strings.TrimSpace(linkHeader) == "" {
		return ""
	}
	for _, part := range strings.Split(linkHeader, ",") {
		part = strings.TrimSpace(part)
		start := strings.Index(part, "<")
		end := strings.Index(part, ">")
		if start >= 0 && end > start+1 {
			params := part[end+1:]
			for _, param := range strings.Split(params, ";") {
				param = strings.TrimSpace(param)
				paramNoSpace := strings.ReplaceAll(param, " ", "")
				if strings.HasPrefix(strings.ToLower(paramNoSpace), "rel=") {
					val := strings.TrimPrefix(strings.ToLower(paramNoSpace), "rel=")
					val = strings.Trim(val, "\"'")
					if val == "next" {
						return strings.TrimSpace(part[start+1 : end])
					}
				}
			}
		}
	}
	return ""
}

func IsRateLimited(err error) bool {
	if errors.Is(err, ErrRateLimited) {
		return true
	}
	var rlErr *RateLimitError
	if errors.As(err, &rlErr) {
		return true
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == http.StatusForbidden || apiErr.StatusCode == http.StatusTooManyRequests
	}
	return false
}

func IsNotFound(err error) bool {
	if errors.Is(err, ErrNotFound) {
		return true
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == http.StatusNotFound
	}
	return false
}

type Asset struct {
	ID                 int64  `json:"id"`
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
	ContentType        string `json:"content_type"`
}

type Release struct {
	ID          int64      `json:"id"`
	TagName     string     `json:"tag_name"`
	Name        string     `json:"name"`
	Body        string     `json:"body"`
	Draft       bool       `json:"draft"`
	Prerelease  bool       `json:"prerelease"`
	CreatedAt   time.Time  `json:"created_at"`
	PublishedAt *time.Time `json:"published_at"`
	ZipballURL  string     `json:"zipball_url"`
	Assets      []Asset    `json:"assets"`
}

// RateLimitSnapshot is the quota state GitHub reported on one response for the
// token that authenticated it. Used is derived from limit and remaining because
// those two headers are the pair every rate-limited resource returns; reading a
// third header would give the same number a second owner.
type RateLimitSnapshot struct {
	Limit   int
	Used    int
	ResetAt time.Time
}

// APIRequestObservation describes one authenticated API request a Client sent.
// It exists so a caller can report quota usage without ever handling the token
// again, and without inspecting responses itself.
type APIRequestObservation struct {
	Endpoint string
	Status   int
	// RateLimit is nil when the response carried no quota headers, which happens
	// behind a relay proxy that does not forward them. Callers must keep their
	// previous observation instead of reporting a zeroed bucket.
	RateLimit *RateLimitSnapshot
	At        time.Time
}

// parseRateLimitSnapshot reads the quota headers of an API response.
func parseRateLimitSnapshot(res *http.Response) *RateLimitSnapshot {
	limit, limitErr := strconv.Atoi(strings.TrimSpace(res.Header.Get("X-Ratelimit-Limit")))
	remaining, remainingErr := strconv.Atoi(strings.TrimSpace(res.Header.Get("X-Ratelimit-Remaining")))
	if limitErr != nil || remainingErr != nil || limit <= 0 || remaining < 0 || remaining > limit {
		return nil
	}
	snapshot := &RateLimitSnapshot{Limit: limit, Used: limit - remaining}
	if sec, err := strconv.ParseInt(strings.TrimSpace(res.Header.Get("X-Ratelimit-Reset")), 10, 64); err == nil && sec > 0 {
		snapshot.ResetAt = time.Unix(sec, 0).UTC()
	}
	return snapshot
}

type Client struct {
	baseURL                string
	httpClient             *http.Client
	userAgent              string
	proxyTemplate          string
	token                  string
	allowInsecureTestHosts bool
	observer               func(APIRequestObservation)
}

type Option func(*Client)

func WithBaseURL(baseURL string) Option {
	return func(c *Client) {
		c.baseURL = strings.TrimRight(baseURL, "/")
		if c.baseURL != "" && c.baseURL != "https://api.github.com" {
			c.allowInsecureTestHosts = true
		}
	}
}

func WithHTTPClient(client *http.Client) Option {
	return func(c *Client) {
		c.httpClient = client
	}
}

func WithUserAgent(userAgent string) Option {
	return func(c *Client) {
		c.userAgent = userAgent
	}
}

func WithProxyTemplate(proxyTemplate string) Option {
	return func(c *Client) {
		c.proxyTemplate = strings.TrimSpace(proxyTemplate)
	}
}

func WithAllowInsecureTestHosts(allow bool) Option {
	return func(c *Client) {
		c.allowInsecureTestHosts = allow
	}
}

// WithToken authenticates REST API requests. Anonymous requests share one
// 60/hour bucket per IP, which cannot survive a catalog with more than a handful
// of GitHub-backed mods; an authenticated token raises it to 5000/hour.
// The token is only sent to the configured API base, never to asset hosts.
func WithToken(token string) Option {
	return func(c *Client) {
		c.token = strings.TrimSpace(token)
	}
}

// WithRequestObserver reports every authenticated API request this client sends.
// Only requests that actually carried the token are reported, so the observer
// counts quota-relevant traffic and never sees asset-download traffic.
func WithRequestObserver(observer func(APIRequestObservation)) Option {
	return func(c *Client) {
		c.observer = observer
	}
}

func (c *Client) ProxyTemplate() string {
	return c.proxyTemplate
}

func (c *Client) BaseURL() string {
	return c.baseURL
}

func (c *Client) AllowInsecureTestHosts() bool {
	return c.allowInsecureTestHosts
}

func NewClient(opts ...Option) *Client {
	c := &Client{
		baseURL:   "https://api.github.com",
		userAgent: "SubmodHub-ReleaseSync/1.0",
	}
	for _, opt := range opts {
		opt(c)
	}

	if c.httpClient == nil {
		transport := NewSafeHTTPTransport(c.allowInsecureTestHosts)
		if proxyURL, isHTTPProxy, err := httpProxyURL(c.proxyTemplate); isHTTPProxy && err == nil {
			transport = NewHTTPProxyTransport(proxyURL)
		}
		c.httpClient = &http.Client{
			Timeout:   60 * time.Second,
			Transport: transport,
		}
	} else if c.httpClient.Transport == nil {
		c.httpClient.Transport = NewSafeHTTPTransport(c.allowInsecureTestHosts)
	}

	return c
}

// executeRequest executes an HTTP GET with proxy rewriting and explicit redirect handling,
// ensuring redirects and pagination URLs go through the proxy when configured.
func isRedirectStatus(status int) bool {
	return status == http.StatusMovedPermanently ||
		status == http.StatusFound ||
		status == http.StatusSeeOther ||
		status == http.StatusTemporaryRedirect ||
		status == http.StatusPermanentRedirect
}

// observe reports one final (non-redirect) response to the request observer.
// Only requests that carried the token are reported: asset downloads and
// anonymous traffic do not spend the token's quota, so counting them would
// misdescribe what the settings page shows.
func (c *Client) observe(endpoint string, res *http.Response) {
	if c.observer == nil || c.token == "" || !strings.HasPrefix(endpoint, c.baseURL) {
		return
	}
	c.observer(APIRequestObservation{
		Endpoint:  endpoint,
		Status:    res.StatusCode,
		RateLimit: parseRateLimitSnapshot(res),
		At:        time.Now().UTC(),
	})
}

func (c *Client) executeStreamRequest(ctx context.Context, targetURL string, headers map[string]string) (*http.Response, error) {
	currURL := targetURL

	clientCopy := *c.httpClient
	clientCopy.Timeout = 0
	clientCopy.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}

	const maxRedirectAttempts = 10
	for redirectCount := 0; redirectCount <= maxRedirectAttempts; redirectCount++ {
		effectiveURL, err := RewriteGitHubURL(c.proxyTemplate, currURL, c.allowInsecureTestHosts)
		if err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, effectiveURL, nil)
		if err != nil {
			return nil, fmt.Errorf("create request failed: %w", err)
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		// Authenticate API traffic only. Asset and manifest hosts are content
		// delivery origins and must never see the token.
		if c.token != "" && strings.HasPrefix(currURL, c.baseURL) {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}

		res, err := clientCopy.Do(req)
		if err != nil {
			return nil, fmt.Errorf("http request failed: %w", err)
		}

		if isRedirectStatus(res.StatusCode) {
			loc := res.Header.Get("Location")
			_ = res.Body.Close()
			if loc == "" {
				return nil, fmt.Errorf("redirect with empty Location header (status %d)", res.StatusCode)
			}
			if redirectCount == maxRedirectAttempts {
				return nil, ErrTooManyRedirects
			}

			baseParsed, err := url.Parse(currURL)
			if err != nil {
				return nil, fmt.Errorf("parse base url %q failed: %w", currURL, err)
			}
			relParsed, err := url.Parse(loc)
			if err != nil {
				return nil, fmt.Errorf("parse redirect url %q failed: %w", loc, err)
			}
			nextURL := baseParsed.ResolveReference(relParsed).String()
			currURL = nextURL
			continue
		}

		// Report the final response before it is classified: a 401/403/404 is
		// still a request GitHub may have charged to the token.
		c.observe(currURL, res)

		if res.StatusCode < 200 || res.StatusCode >= 300 {
			defer res.Body.Close()
			if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
				return nil, parseRateLimitError(res)
			}
			if res.StatusCode == http.StatusNotFound {
				return nil, ErrNotFound
			}
			body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
			return nil, &APIError{StatusCode: res.StatusCode, Message: strings.TrimSpace(string(body))}
		}

		return res, nil
	}

	return nil, ErrTooManyRedirects
}

// OpenArchiveStream opens an HTTP stream to download an archive from GitHub,
// applying proxy rewriting and following redirects safely.
// The caller is responsible for closing the returned Response.Body.
// The request is bound to ctx without http.Client.Timeout constraints.
func (c *Client) OpenArchiveStream(ctx context.Context, downloadURL string) (*http.Response, error) {
	headers := map[string]string{
		"Accept":     "*/*",
		"User-Agent": c.userAgent,
	}
	return c.executeStreamRequest(ctx, downloadURL, headers)
}

func (c *Client) executeRequest(ctx context.Context, targetURL string, headers map[string]string) (*http.Response, error) {
	currURL := targetURL

	clientCopy := *c.httpClient
	clientCopy.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}

	const maxRedirectAttempts = 10
	for redirectCount := 0; redirectCount <= maxRedirectAttempts; redirectCount++ {
		effectiveURL, err := RewriteGitHubURL(c.proxyTemplate, currURL, c.allowInsecureTestHosts)
		if err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, effectiveURL, nil)
		if err != nil {
			return nil, fmt.Errorf("create request failed: %w", err)
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		// Authenticate API traffic only. Asset and manifest hosts are content
		// delivery origins and must never see the token.
		if c.token != "" && strings.HasPrefix(currURL, c.baseURL) {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}

		res, err := clientCopy.Do(req)
		if err != nil {
			return nil, fmt.Errorf("http request failed: %w", err)
		}

		if isRedirectStatus(res.StatusCode) {
			loc := res.Header.Get("Location")
			_ = res.Body.Close()
			if loc == "" {
				return nil, fmt.Errorf("redirect with empty Location header (status %d)", res.StatusCode)
			}
			if redirectCount == maxRedirectAttempts {
				return nil, ErrTooManyRedirects
			}

			baseParsed, err := url.Parse(currURL)
			if err != nil {
				return nil, fmt.Errorf("parse base url %q failed: %w", currURL, err)
			}
			relParsed, err := url.Parse(loc)
			if err != nil {
				return nil, fmt.Errorf("parse redirect url %q failed: %w", loc, err)
			}
			nextURL := baseParsed.ResolveReference(relParsed).String()
			currURL = nextURL
			continue
		}

		c.observe(currURL, res)

		return res, nil
	}

	return nil, ErrTooManyRedirects
}

func (c *Client) LatestRelease(ctx context.Context, owner, repo string) (*Release, error) {
	endpoint := fmt.Sprintf("%s/repos/%s/%s/releases/latest", c.baseURL, url.PathEscape(owner), url.PathEscape(repo))
	res, err := c.executeRequest(ctx, endpoint, map[string]string{"Accept": "application/vnd.github+json", "User-Agent": c.userAgent})
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
		return nil, parseRateLimitError(res)
	}
	if res.StatusCode != http.StatusOK {
		return nil, &APIError{StatusCode: res.StatusCode, Message: "latest release lookup failed"}
	}
	var release Release
	if err := json.NewDecoder(res.Body).Decode(&release); err != nil {
		return nil, err
	}
	return &release, nil
}

func (c *Client) ListReleases(ctx context.Context, owner, repo, etag string) ([]Release, string, bool, error) {
	relURL := fmt.Sprintf("%s/repos/%s/%s/releases?per_page=100", c.baseURL, url.PathEscape(owner), url.PathEscape(repo))

	headers := map[string]string{
		"Accept":     "application/vnd.github+json",
		"User-Agent": c.userAgent,
	}
	if strings.TrimSpace(etag) != "" {
		headers["If-None-Match"] = strings.TrimSpace(etag)
	}

	res, err := c.executeRequest(ctx, relURL, headers)
	if err != nil {
		return nil, "", false, err
	}

	if res.StatusCode == http.StatusNotModified {
		_ = res.Body.Close()
		return nil, etag, true, nil
	}
	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
		defer res.Body.Close()
		return nil, "", false, parseRateLimitError(res)
	}
	if res.StatusCode == http.StatusNotFound {
		_ = res.Body.Close()
		return nil, "", false, ErrNotFound
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		defer res.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return nil, "", false, &APIError{StatusCode: res.StatusCode, Message: string(body)}
	}

	newETag := res.Header.Get("ETag")
	var pageReleases []Release
	if err := json.NewDecoder(res.Body).Decode(&pageReleases); err != nil {
		_ = res.Body.Close()
		return nil, "", false, fmt.Errorf("decode releases response failed: %w", err)
	}
	nextURL := ParseNextPageURL(res.Header.Get("Link"))
	_ = res.Body.Close()

	var allReleases []Release
	allReleases = append(allReleases, pageReleases...)

	// Follow pagination if multiple pages exist (up to 20 pages / 2000 releases safety ceiling)
	const maxPages = 20
	for page := 2; nextURL != "" && page <= maxPages; page++ {
		if strings.HasPrefix(nextURL, "/") {
			nextURL = c.baseURL + nextURL
		}
		nextRes, err := c.executeRequest(ctx, nextURL, map[string]string{
			"Accept":     "application/vnd.github+json",
			"User-Agent": c.userAgent,
		})
		if err != nil {
			return nil, "", false, fmt.Errorf("next page request failed: %w", err)
		}

		if nextRes.StatusCode == http.StatusForbidden || nextRes.StatusCode == http.StatusTooManyRequests {
			defer nextRes.Body.Close()
			return nil, "", false, parseRateLimitError(nextRes)
		}
		if nextRes.StatusCode < 200 || nextRes.StatusCode >= 300 {
			defer nextRes.Body.Close()
			body, _ := io.ReadAll(io.LimitReader(nextRes.Body, 4096))
			return nil, "", false, &APIError{StatusCode: nextRes.StatusCode, Message: string(body)}
		}

		var nextPageReleases []Release
		if err := json.NewDecoder(nextRes.Body).Decode(&nextPageReleases); err != nil {
			_ = nextRes.Body.Close()
			return nil, "", false, fmt.Errorf("decode next page releases failed: %w", err)
		}
		nextURL = ParseNextPageURL(nextRes.Header.Get("Link"))
		_ = nextRes.Body.Close()

		allReleases = append(allReleases, nextPageReleases...)
	}

	// Filter out draft releases
	published := make([]Release, 0, len(allReleases))
	for _, r := range allReleases {
		if !r.Draft {
			published = append(published, r)
		}
	}

	return published, newETag, false, nil
}

// MaxDownloadBytes is the hard ceiling for a single archive download. It exists
// so a caller cannot ask for an unbounded temp file; the deployment sets it from
// SUBMODHUB_MAX_ARCHIVE_SIZE at startup, so the archive limit and this guard never
// disagree. A caller passing a larger value is clamped to it.
var MaxDownloadBytes int64 = 1 << 30

func (c *Client) DownloadToTemp(ctx context.Context, downloadURL string, maxSizeBytes int64) (string, string, int64, error) {
	// At 30 minutes, 1 GiB needs only ~0.6 MB/s, so the timeout bounds a dead
	// connection rather than the package size. It must not be shorter than the
	// caller's own sync deadline, or the download dies first for no reason.
	const defaultMaxDownloadTime = 30 * time.Minute

	ceiling := MaxDownloadBytes
	if ceiling <= 0 {
		ceiling = 1 << 30
	}
	if maxSizeBytes <= 0 || maxSizeBytes > ceiling {
		maxSizeBytes = ceiling
	}

	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultMaxDownloadTime)
		defer cancel()
	}

	tmpFile, err := os.CreateTemp("", "submodhub-gh-*.zip")
	if err != nil {
		return "", "", 0, fmt.Errorf("create temp file failed: %w", err)
	}
	tmpPath := tmpFile.Name()

	cleanup := func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}

	res, err := c.OpenArchiveStream(ctx, downloadURL)
	if err != nil {
		cleanup()
		return "", "", 0, err
	}
	defer res.Body.Close()

	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)

	var totalRead int64
	buf := make([]byte, 32*1024)
	for {
		n, rErr := res.Body.Read(buf)
		if n > 0 {
			totalRead += int64(n)
			if maxSizeBytes > 0 && totalRead > maxSizeBytes {
				cleanup()
				return "", "", 0, fmt.Errorf("%w: downloaded %d bytes exceeds %d bytes", ErrTooLarge, totalRead, maxSizeBytes)
			}
			if _, wErr := writer.Write(buf[:n]); wErr != nil {
				cleanup()
				return "", "", 0, fmt.Errorf("write temp archive failed: %w", wErr)
			}
		}
		if rErr != nil {
			if errors.Is(rErr, io.EOF) {
				break
			}
			cleanup()
			return "", "", 0, fmt.Errorf("read stream failed: %w", rErr)
		}
	}

	if err := tmpFile.Close(); err != nil {
		cleanup()
		return "", "", 0, fmt.Errorf("close temp file failed: %w", err)
	}

	shaHex := hex.EncodeToString(hasher.Sum(nil))
	return tmpPath, shaHex, totalRead, nil
}
