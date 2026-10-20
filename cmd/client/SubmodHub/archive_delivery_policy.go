package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func validateArchiveDeliveryURL(base *url.URL, raw string, origins []string) (*url.URL, error) {
	reject := errors.New("cross_origin_archive_url_rejected")
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
		return nil, errors.New("insecure_archive_url_rejected")
	}
	host := strings.Trim(target.Hostname(), "[]")
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
		return nil, reject
	}
	if ip := net.ParseIP(host); ip != nil && privateDeliveryIP(ip) {
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
func privateDeliveryIP(ip net.IP) bool {
	v4 := ip.To4()
	cgnat := v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || !ip.IsGlobalUnicast() || cgnat
}
func archiveDeliveryClient(base *url.URL, origins []string) *http.Client {
	dialer := &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// External archives never use environment proxies or an API cookie jar.
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, errors.New("download_destination_invalid")
		}
		if strings.EqualFold(address, base.Host) || strings.EqualFold(host, base.Hostname()) && port == "443" && base.Port() == "" {
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
			if privateDeliveryIP(ip.IP) {
				return nil, errors.New("private_download_destination_rejected")
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}
	return &http.Client{Transport: transport, Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 4 {
			return errors.New("too_many_redirects")
		}
		if _, err := validateArchiveDeliveryURL(base, req.URL.String(), origins); err != nil {
			return err
		}
		req.Header.Del("Authorization")
		req.Header.Del("Cookie")
		req.Header.Del("Proxy-Authorization")
		req.Header.Del("Referer")
		return nil
	}}
}
