// Package cloudreve implements the Cloudreve v3 cookie-authenticated API.
// Provider response text and request URLs must never be included in errors.
package cloudreve

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var ErrUnknownExpiry = errors.New("cloudreve_download_expiry_unknown")
var ErrAuthentication = errors.New("cloudreve_authentication_failed")

type Config struct {
	BaseURL                 string
	Username                string
	Password                string
	AllowedDownloadOrigins  []string
	Timeout                 time.Duration
	AllowInsecureForTesting bool
}
type Client struct {
	cfg           Config
	base          *url.URL
	http          *http.Client
	mu            metadataMutex
	authenticated bool
}
type Object struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Size int64  `json:"size"`
	Path string `json:"path"`
}
type Listing struct {
	Objects []Object `json:"objects"`
	Policy  struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	} `json:"policy"`
}
type Link struct {
	URL       string
	ExpiresAt time.Time
}
type envelope struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
}
type apiError int

func (e apiError) Error() string { return fmt.Sprintf("cloudreve_business_%d", int(e)) }
func New(cfg Config) (*Client, error) {
	u, err := url.Parse(cfg.BaseURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(cfg.AllowInsecureForTesting && u.Scheme == "http")) {
		return nil, errors.New("cloudreve_invalid_api_url")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	jar, _ := cookiejar.New(nil)
	return &Client{cfg: cfg, base: u, http: &http.Client{Jar: jar, Timeout: cfg.Timeout, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		return errors.New("cloudreve_api_redirect_forbidden")
	}}}, nil
}

// raw never follows API redirects; cookies cannot reach storage hosts.
func (c *Client) raw(ctx context.Context, method, path string, body io.Reader, contentType string, out any) error {
	u := *c.base
	u.Path = strings.TrimRight(c.base.Path, "/") + path
	u.RawPath = ""
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return errors.New("cloudreve_request_invalid")
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("cloudreve_transport_failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 {
		return ErrAuthentication
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("cloudreve_http_%d", resp.StatusCode)
	}
	var env envelope
	if err = json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&env); err != nil {
		return errors.New("cloudreve_response_invalid")
	}
	if env.Code == 401 || env.Code == 40023 {
		return ErrAuthentication
	}
	if env.Code != 0 {
		return apiError(env.Code)
	}
	if out != nil && len(env.Data) > 0 && string(env.Data) != "null" {
		if json.Unmarshal(env.Data, out) != nil {
			return errors.New("cloudreve_response_invalid")
		}
	}
	return nil
}
func (c *Client) login(ctx context.Context) error {
	b, _ := json.Marshal(map[string]string{"userName": c.cfg.Username, "Password": c.cfg.Password})
	if err := c.raw(ctx, "POST", "/user/session", bytes.NewReader(b), "application/json", nil); err != nil {
		return err
	}
	c.authenticated = true
	return nil
}

// do serializes authentication and retries only replayable API metadata calls once.
func (c *Client) do(ctx context.Context, method, path string, payload any, out any) error {
	if err := c.mu.LockContext(ctx); err != nil {
		return err
	}
	defer c.mu.Unlock()
	if !c.authenticated {
		if err := c.login(ctx); err != nil {
			return err
		}
	}
	var b []byte
	if payload != nil {
		b, _ = json.Marshal(payload)
	}
	for attempt := 0; attempt < 2; attempt++ {
		err := c.raw(ctx, method, path, bytes.NewReader(b), "application/json", out)
		if err != ErrAuthentication {
			return err
		}
		c.authenticated = false
		if attempt == 1 {
			return err
		}
		if err = c.login(ctx); err != nil {
			return err
		}
	}
	return ErrAuthentication
}
func (c *Client) List(ctx context.Context, path string) (Listing, error) {
	var out Listing
	err := c.do(ctx, "GET", "/directory"+path, nil, &out)
	return out, err
}
func (c *Client) CreateDirectory(ctx context.Context, path string) error {
	return c.do(ctx, "PUT", "/directory", map[string]string{"path": path}, nil)
}
func (c *Client) Download(ctx context.Context, id string) (Link, error) {
	var raw json.RawMessage
	if err := c.do(ctx, "PUT", "/file/download/"+url.PathEscape(id), nil, &raw); err != nil {
		return Link{}, err
	}
	var address string
	if json.Unmarshal(raw, &address) != nil {
		return Link{}, errors.New("cloudreve_download_response_invalid")
	}
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return Link{}, errors.New("cloudreve_download_url_forbidden")
	}
	allowed := false
	for _, origin := range c.cfg.AllowedDownloadOrigins {
		if strings.EqualFold(origin, u.Scheme+"://"+u.Host) {
			allowed = true
		}
	}
	if !allowed {
		return Link{}, errors.New("cloudreve_download_origin_forbidden")
	}
	// Cloudreve v3 pkg/auth/hmac.go signs path + ':' + Unix seconds.
	// The authenticated API is the issuer; this parses its expiry, not a
	// client-side verification of the provider's private HMAC key.
	parts := strings.Split(u.Query().Get("sign"), ":")
	if len(parts) != 2 || len(u.Query()["sign"]) != 1 {
		return Link{}, ErrUnknownExpiry
	}
	mac, decodeErr := base64.URLEncoding.DecodeString(parts[0])
	expires, parseErr := strconv.ParseInt(parts[1], 10, 64)
	if decodeErr != nil || len(mac) != 32 || parseErr != nil || expires <= time.Now().Add(30*time.Second).Unix() {
		return Link{}, ErrUnknownExpiry
	}
	return Link{URL: address, ExpiresAt: time.Unix(expires, 0).UTC()}, nil
}
