package delivery

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// This file owns the client-side delivery origin policy. Every subsystem that
// downloads API-declared delivery bytes (mod archives, app updates) uses these
// functions instead of re-implementing the checks.

// ValidateOriginURL resolves raw against the API base. Same-origin API paths
// remain allowed (built-in delivery). Every cross-origin destination must be
// HTTPS, must not address loopback/private/CGNAT space, and must match an
// origin the API explicitly announced.
func ValidateOriginURL(base *url.URL, raw string, origins []string) (*url.URL, error) {
	reject := errors.New("cross_origin_delivery_url_rejected")
	if base == nil {
		return nil, reject
	}
	if strings.HasPrefix(raw, "//") {
		return nil, errors.New("protocol_relative_url_rejected")
	}
	ref, err := url.Parse(raw)
	if err != nil || ref.User != nil || ref.Fragment != "" || ref.Opaque != "" {
		return nil, reject
	}
	target := base.ResolveReference(ref)
	if target.User != nil || target.Host == "" {
		return nil, reject
	}
	if strings.EqualFold(target.Host, base.Host) && target.Scheme == base.Scheme {
		return target, nil
	}
	if target.Scheme != "https" {
		return nil, errors.New("insecure_delivery_url_rejected")
	}
	host := strings.Trim(target.Hostname(), "[]")
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
		return nil, reject
	}
	if ip := net.ParseIP(host); ip != nil && PrivateIP(ip) {
		return nil, reject
	}
	origin := target.Scheme + "://" + target.Host
	for _, allowed := range origins {
		u, err := url.Parse(allowed)
		if err == nil && u.Scheme == "https" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && strings.EqualFold(origin, allowed) {
			return target, nil
		}
	}
	return nil, reject
}

// PrivateIP reports whether ip may not be reached by an external delivery
// download, including carrier-grade NAT space.
func PrivateIP(ip net.IP) bool {
	v4 := ip.To4()
	cgnat := v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || !ip.IsGlobalUnicast() || cgnat
}

// originEffectivePort is the port a dial uses for this base when the URL does
// not spell one out.
func originEffectivePort(u *url.URL) string {
	if port := u.Port(); port != "" {
		return port
	}
	if strings.EqualFold(u.Scheme, "http") {
		return "80"
	}
	return "443"
}

// NewOriginClient builds the HTTP client used for declared delivery bytes. It
// ignores environment proxies, carries no API cookies, resolves and rejects
// private destinations per hop, and validates every redirect against the same
// origin policy.
func NewOriginClient(base *url.URL, origins []string, maxRedirects int) *http.Client {
	if maxRedirects <= 0 {
		maxRedirects = 4
	}
	dialer := &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// External delivery never uses environment proxies or an API cookie jar.
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, errors.New("download_destination_invalid")
		}
		// The API's own host is trusted: a self-hosted deployment may serve both the
		// descriptor and the bytes from one private address. The comparison is
		// hostname + effective port, so a plain-http base without an explicit port
		// resolves to :80 instead of silently falling through to the private-address
		// rule (which would reject every same-host LAN download).
		if base != nil && strings.EqualFold(host, base.Hostname()) && port == originEffectivePort(base) {
			return dialer.DialContext(ctx, network, address)
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, errors.New("download_dns_failed")
		}
		if len(ips) == 0 {
			return nil, errors.New("download_dns_failed")
		}
		for _, ip := range ips {
			if PrivateIP(ip.IP) {
				return nil, errors.New("private_download_destination_rejected")
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}
	return &http.Client{Transport: transport, Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > maxRedirects {
			return errors.New("too_many_redirects")
		}
		if _, err := ValidateOriginURL(base, req.URL.String(), origins); err != nil {
			return err
		}
		req.Header.Del("Authorization")
		req.Header.Del("Cookie")
		req.Header.Del("Proxy-Authorization")
		req.Header.Del("Referer")
		return nil
	}}
}
