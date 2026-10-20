package httpapi

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// An admin-configured origin is the only destination this transport can dial.
// Environment proxies retain their ordinary routing and TLS verification; a
// configured private node is permitted without weakening GitHub source rules.
func configuredNodeTransport(raw string) (*http.Transport, error) {
	configured, err := url.Parse(raw)
	if err != nil || configured.Scheme != "https" || configured.Host == "" || configured.User != nil {
		return nil, errors.New("node_origin_invalid")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		if req.URL.Scheme != configured.Scheme || !strings.EqualFold(req.URL.Host, configured.Host) {
			return nil, errors.New("node_origin_forbidden")
		}
		return http.ProxyFromEnvironment(req)
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialer.DialContext(ctx, network, address)
	}
	return transport, nil
}
