package github

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"syscall"
	"time"
)

var (
	ErrInvalidProxyTemplate  = errors.New("invalid github proxy template")
	ErrDisallowedHost        = errors.New("disallowed upstream github host")
	ErrDisallowedDestination = errors.New("disallowed proxy destination or private ip")
	ErrTooManyRedirects      = errors.New("stopped after 10 redirects")
)

var AllowedGitHubHosts = map[string]bool{
	"api.github.com":                       true,
	"github.com":                           true,
	"codeload.github.com":                  true,
	"release-assets.githubusercontent.com": true,
	"objects.githubusercontent.com":        true,
}

var placeholderRegex = regexp.MustCompile(`\{[^\}]+\}`)

// ValidateProxyTemplate validates the proxy template format.
func ValidateProxyTemplate(tpl string) error {
	trimmed := strings.TrimSpace(tpl)
	if trimmed == "" {
		return nil
	}

	matches := placeholderRegex.FindAllString(trimmed, -1)
	if len(matches) != 1 {
		return fmt.Errorf("%w: template must contain exactly one placeholder, got %d", ErrInvalidProxyTemplate, len(matches))
	}
	ph := matches[0]
	if ph != "{url}" && ph != "{url_encoded}" {
		return fmt.Errorf("%w: unknown placeholder %s, only {url} or {url_encoded} is allowed", ErrInvalidProxyTemplate, ph)
	}

	// Replace placeholder with a dummy path to test URL parsing
	testURL := strings.Replace(trimmed, ph, "api.github.com/test", 1)
	parsed, err := url.Parse(testURL)
	if err != nil {
		return fmt.Errorf("%w: malformed url: %v", ErrInvalidProxyTemplate, err)
	}

	if parsed.Scheme != "https" {
		return fmt.Errorf("%w: proxy template scheme must be https", ErrInvalidProxyTemplate)
	}
	if parsed.Host == "" {
		return fmt.Errorf("%w: proxy template host cannot be empty", ErrInvalidProxyTemplate)
	}
	if parsed.User != nil {
		return fmt.Errorf("%w: proxy template must not contain userinfo", ErrInvalidProxyTemplate)
	}
	if parsed.Fragment != "" {
		return fmt.Errorf("%w: proxy template must not contain fragment", ErrInvalidProxyTemplate)
	}

	return nil
}

// IsAllowedGitHubHost returns true if the host is an allowed upstream GitHub host.
func IsAllowedGitHubHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if colon := strings.Index(h, ":"); colon != -1 {
		h = h[:colon]
	}
	return AllowedGitHubHosts[h]
}

// IsProxiedURL returns true if the url matches the prefix of the proxy template.
func IsProxiedURL(tpl string, targetURL string) bool {
	trimmedTpl := strings.TrimSpace(tpl)
	if trimmedTpl == "" {
		return false
	}
	if idx := strings.Index(trimmedTpl, "{url}"); idx != -1 {
		prefix := trimmedTpl[:idx]
		if prefix != "" && strings.HasPrefix(targetURL, prefix) {
			return true
		}
	}
	if idx := strings.Index(trimmedTpl, "{url_encoded}"); idx != -1 {
		prefix := trimmedTpl[:idx]
		if prefix != "" && strings.HasPrefix(targetURL, prefix) {
			return true
		}
	}
	return false
}

// RewriteGitHubURL applies the proxy template to an upstream GitHub target URL.
func RewriteGitHubURL(tpl string, targetURL string, allowInsecureTestHosts bool) (string, error) {
	trimmedTpl := strings.TrimSpace(tpl)
	if trimmedTpl == "" {
		parsedTarget, err := url.Parse(targetURL)
		if err != nil {
			return "", fmt.Errorf("invalid target url: %w", err)
		}
		if !allowInsecureTestHosts {
			if parsedTarget.Scheme != "https" {
				return "", fmt.Errorf("%w: target url must be https: %s", ErrDisallowedHost, targetURL)
			}
			if !IsAllowedGitHubHost(parsedTarget.Host) {
				return "", fmt.Errorf("%w: host %s is not an allowed github host", ErrDisallowedHost, parsedTarget.Host)
			}
		}
		return targetURL, nil
	}

	// If already rewritten according to the template, return as is
	if IsProxiedURL(trimmedTpl, targetURL) {
		return targetURL, nil
	}

	parsedTarget, err := url.Parse(targetURL)
	if err != nil {
		return "", fmt.Errorf("invalid target url: %w", err)
	}

	if !allowInsecureTestHosts {
		if parsedTarget.Scheme != "https" {
			return "", fmt.Errorf("%w: target url must be https: %s", ErrDisallowedHost, targetURL)
		}
		if !IsAllowedGitHubHost(parsedTarget.Host) {
			return "", fmt.Errorf("%w: host %s is not an allowed github host", ErrDisallowedHost, parsedTarget.Host)
		}
		if err := ValidateProxyTemplate(trimmedTpl); err != nil {
			return "", err
		}
	}

	if strings.Contains(trimmedTpl, "{url}") {
		return strings.Replace(trimmedTpl, "{url}", targetURL, 1), nil
	}
	if strings.Contains(trimmedTpl, "{url_encoded}") {
		return strings.Replace(trimmedTpl, "{url_encoded}", url.QueryEscape(targetURL), 1), nil
	}

	return "", fmt.Errorf("%w: missing {url} or {url_encoded} placeholder", ErrInvalidProxyTemplate)
}

func isPrivateOrLocalIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		return ipv4.IsLoopback() || ipv4.IsPrivate() || ipv4.IsLinkLocalUnicast() || ipv4.IsLinkLocalMulticast() || ipv4.IsMulticast() || ipv4.IsUnspecified()
	}
	return false
}

// NewSafeHTTPTransport returns an http.RoundTripper that validates IPs against SSRF.
func NewSafeHTTPTransport(allowInsecureTestHosts bool) http.RoundTripper {
	if allowInsecureTestHosts {
		return &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		}
	}

	dialer := &net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(network, address string, c syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip != nil && isPrivateOrLocalIP(ip) {
				return fmt.Errorf("%w: %s", ErrDisallowedDestination, host)
			}
			return nil
		},
	}

	return &http.Transport{
		Proxy:                 nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("no ip resolved for %s", host)
			}
			for _, ip := range ips {
				if isPrivateOrLocalIP(ip) {
					return nil, fmt.Errorf("%w: resolved to %s", ErrDisallowedDestination, ip.String())
				}
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
		},
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ForceAttemptHTTP2:     true,
	}
}
