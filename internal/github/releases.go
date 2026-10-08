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

func IsRateLimited(err error) bool {
	if errors.Is(err, ErrRateLimited) {
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
	baseURL    string
	httpClient *http.Client
	userAgent  string
}

type Option func(*Client)

func WithBaseURL(baseURL string) Option {
	return func(c *Client) {
		c.baseURL = strings.TrimRight(baseURL, "/")
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

func NewClient(opts ...Option) *Client {
	c := &Client{
		baseURL: "https://api.github.com",
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
		userAgent: "SubmodHub-ReleaseSync/1.0",
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

func (c *Client) ListReleases(ctx context.Context, owner, repo, etag string) ([]Release, string, bool, error) {
	relURL := fmt.Sprintf("%s/repos/%s/%s/releases", c.baseURL, url.PathEscape(owner), url.PathEscape(repo))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, relURL, nil)
	if err != nil {
		return nil, "", false, fmt.Errorf("create request failed: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", c.userAgent)
	if strings.TrimSpace(etag) != "" {
		req.Header.Set("If-None-Match", strings.TrimSpace(etag))
	}

	res, err := c.httpClient.Do(req)
	if err != nil {
		return nil, "", false, fmt.Errorf("http request failed: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusNotModified {
		return nil, etag, true, nil
	}
	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
		return nil, "", false, ErrRateLimited
	}
	if res.StatusCode == http.StatusNotFound {
		return nil, "", false, ErrNotFound
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return nil, "", false, &APIError{StatusCode: res.StatusCode, Message: string(body)}
	}

	newETag := res.Header.Get("ETag")
	var allReleases []Release
	if err := json.NewDecoder(res.Body).Decode(&allReleases); err != nil {
		return nil, "", false, fmt.Errorf("decode releases response failed: %w", err)
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
	tmpFile, err := os.CreateTemp("", "submodhub-gh-*.zip")
	if err != nil {
		return "", "", 0, fmt.Errorf("create temp file failed: %w", err)
	}
	tmpPath := tmpFile.Name()

	cleanup := func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		cleanup()
		return "", "", 0, fmt.Errorf("create download request failed: %w", err)
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", c.userAgent)

	res, err := c.httpClient.Do(req)
	if err != nil {
		cleanup()
		return "", "", 0, fmt.Errorf("download request failed: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		cleanup()
		if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
			return "", "", 0, ErrRateLimited
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
