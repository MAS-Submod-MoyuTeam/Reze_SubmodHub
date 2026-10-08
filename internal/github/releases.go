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

type Client struct {
	baseURL                string
	httpClient             *http.Client
	userAgent              string
	proxyTemplate          string
	allowInsecureTestHosts bool
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

func (c *Client) DownloadToTemp(ctx context.Context, downloadURL string, maxSizeBytes int64) (string, string, int64, error) {
	const defaultMaxDownloadTime = 5 * time.Minute
	const defaultMaxArchiveSize = 128 * 1024 * 1024 // 128 MiB

	if maxSizeBytes <= 0 || maxSizeBytes > defaultMaxArchiveSize {
		maxSizeBytes = defaultMaxArchiveSize
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

	headers := map[string]string{
		"Accept":     "*/*",
		"User-Agent": c.userAgent,
	}

	res, err := c.executeRequest(ctx, downloadURL, headers)
	if err != nil {
		cleanup()
		return "", "", 0, fmt.Errorf("download request failed: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		cleanup()
		if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
			return "", "", 0, parseRateLimitError(res)
		}
		if res.StatusCode == http.StatusNotFound {
			return "", "", 0, ErrNotFound
		}
		return "", "", 0, fmt.Errorf("download returned status %d", res.StatusCode)
	}

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
