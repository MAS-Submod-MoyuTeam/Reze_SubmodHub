package github

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestValidateProxyTemplate(t *testing.T) {
	tests := []struct {
		name    string
		tpl     string
		wantErr bool
	}{
		{name: "empty is valid (direct)", tpl: "", wantErr: false},
		{name: "whitespace only is valid (direct)", tpl: "   ", wantErr: false},
		{name: "valid standard url placeholder", tpl: "https://proxy.example/{url}", wantErr: false},
		{name: "valid url_encoded placeholder", tpl: "https://proxy.example/fetch?url={url_encoded}", wantErr: false},
		{name: "valid path and query", tpl: "https://gh-proxy.com/v1/{url}", wantErr: false},
		{name: "http proxy host port", tpl: "100.106.239.85:7890", wantErr: false},
		{name: "http proxy url", tpl: "http://100.106.239.85:7890", wantErr: false},
		{name: "http proxy missing port", tpl: "http://100.106.239.85", wantErr: true},
		{name: "http proxy with path", tpl: "http://100.106.239.85:7890/unsafe", wantErr: true},
		{name: "http proxy with credentials", tpl: "http://admin:secret@100.106.239.85:7890", wantErr: true},
		{name: "non-https http scheme", tpl: "http://proxy.example/{url}", wantErr: true},
		{name: "missing placeholder", tpl: "https://proxy.example/relay", wantErr: true},
		{name: "multiple url placeholders", tpl: "https://proxy.example/{url}/{url}", wantErr: true},
		{name: "multiple url_encoded placeholders", tpl: "https://proxy.example/{url_encoded}/{url_encoded}", wantErr: true},
		{name: "both placeholders", tpl: "https://proxy.example/{url}?q={url_encoded}", wantErr: true},
		{name: "userinfo present", tpl: "https://admin:secret@proxy.example/{url}", wantErr: true},
		{name: "fragment present", tpl: "https://proxy.example/{url}#frag", wantErr: true},
		{name: "unknown placeholder", tpl: "https://proxy.example/{target}", wantErr: true},
		{name: "invalid url", tpl: "://not-a-valid-url/{url}", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateProxyTemplate(tt.tpl)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateProxyTemplate(%q) error = %v, wantErr %v", tt.tpl, err, tt.wantErr)
			}
		})
	}
}

func TestRewriteGitHubURL(t *testing.T) {
	tests := []struct {
		name      string
		tpl       string
		targetURL string
		wantURL   string
		wantErr   bool
	}{
		{
			name:      "empty template direct",
			tpl:       "",
			targetURL: "https://api.github.com/repos/owner/repo/releases",
			wantURL:   "https://api.github.com/repos/owner/repo/releases",
			wantErr:   false,
		},
		{
			name:      "url placeholder rewrite",
			tpl:       "https://proxy.example/{url}",
			targetURL: "https://api.github.com/repos/owner/repo/releases",
			wantURL:   "https://proxy.example/https://api.github.com/repos/owner/repo/releases",
			wantErr:   false,
		},
		{
			name:      "http proxy keeps GitHub URL unchanged",
			tpl:       "100.106.239.85:7890",
			targetURL: "https://api.github.com/repos/owner/repo/releases",
			wantURL:   "https://api.github.com/repos/owner/repo/releases",
		},
		{
			name:      "url_encoded placeholder rewrite",
			tpl:       "https://proxy.example/fetch?url={url_encoded}",
			targetURL: "https://api.github.com/repos/owner/repo/releases",
			wantURL:   "https://proxy.example/fetch?url=https%3A%2F%2Fapi.github.com%2Frepos%2Fowner%2Frepo%2Freleases",
			wantErr:   false,
		},
		{
			name:      "disallowed host rejected",
			tpl:       "https://proxy.example/{url}",
			targetURL: "https://attacker.example.com/payload",
			wantErr:   true,
		},
		{
			name:      "non-https target rejected",
			tpl:       "https://proxy.example/{url}",
			targetURL: "http://api.github.com/repos/owner/repo",
			wantErr:   true,
		},
		{
			name:      "allowed codeload host",
			tpl:       "https://proxy.example/{url}",
			targetURL: "https://codeload.github.com/owner/repo/zip/refs/tags/v1.0",
			wantURL:   "https://proxy.example/https://codeload.github.com/owner/repo/zip/refs/tags/v1.0",
			wantErr:   false,
		},
		{
			name:      "allowed objects githubusercontent host",
			tpl:       "https://proxy.example/{url}",
			targetURL: "https://objects.githubusercontent.com/github-production-release-asset-2e65be/123/asset.zip",
			wantURL:   "https://proxy.example/https://objects.githubusercontent.com/github-production-release-asset-2e65be/123/asset.zip",
			wantErr:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := RewriteGitHubURL(tt.tpl, tt.targetURL, false)
			if (err != nil) != tt.wantErr {
				t.Fatalf("RewriteGitHubURL(%q, %q) error = %v, wantErr %v", tt.tpl, tt.targetURL, err, tt.wantErr)
			}
			if !tt.wantErr && got != tt.wantURL {
				t.Errorf("RewriteGitHubURL() = %q, want %q", got, tt.wantURL)
			}
		})
	}
}

func TestFakeGitHubAndFakeProxyIntegration(t *testing.T) {
	var directGitHubHits int32
	var proxyHits int32

	zipData := []byte("mock zip payload content for proxy test")
	zipHash := sha256.Sum256(zipData)
	zipHashHex := hex.EncodeToString(zipHash[:])

	var fakeGitHub *httptest.Server
	fakeGitHub = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Via-Proxy") != "true" {
			atomic.AddInt32(&directGitHubHits, 1)
		}

		switch {
		case r.URL.Path == "/repos/owner/test/releases" && r.URL.Query().Get("page") == "":
			w.Header().Set("ETag", `"page1-etag"`)
			w.Header().Set("Link", fmt.Sprintf(`<%s/repos/owner/test/releases?page=2>; rel="next"`, fakeGitHub.URL))
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `[
				{
					"id": 1,
					"tag_name": "v1.0",
					"name": "v1.0",
					"draft": false,
					"assets": [
						{
							"id": 11,
							"name": "mod.zip",
							"size": `+fmt.Sprintf("%d", len(zipData))+`,
							"browser_download_url": "`+fakeGitHub.URL+`/download/mod.zip"
						}
					]
				}
			]`)
		case r.URL.Path == "/repos/owner/test/releases" && r.URL.Query().Get("page") == "2":
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `[
				{
					"id": 2,
					"tag_name": "v2.0",
					"name": "v2.0",
					"draft": false,
					"assets": []
				}
			]`)
		case r.URL.Path == "/download/mod.zip":
			http.Redirect(w, r, fakeGitHub.URL+"/cdn/mod.zip", http.StatusFound)
		case r.URL.Path == "/cdn/mod.zip":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	defer fakeGitHub.Close()

	fakeProxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&proxyHits, 1)

		targetRaw := strings.TrimPrefix(r.URL.RequestURI(), "/")
		if unescaped, err := url.QueryUnescape(targetRaw); err == nil && strings.HasPrefix(unescaped, "http") {
			targetRaw = unescaped
		}
		targetParsed, err := url.Parse(targetRaw)
		if err != nil {
			http.Error(w, "bad proxy target", http.StatusBadRequest)
			return
		}

		proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetParsed.String(), nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		proxyReq.Header = r.Header.Clone()
		proxyReq.Header.Set("X-Via-Proxy", "true")

		resp, err := http.DefaultTransport.RoundTrip(proxyReq)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		for k, vals := range resp.Header {
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	}))
	defer fakeProxy.Close()

	proxyTemplate := fakeProxy.URL + "/{url}"
	client := NewClient(
		WithBaseURL(fakeGitHub.URL),
		WithProxyTemplate(proxyTemplate),
		WithAllowInsecureTestHosts(true),
	)

	// 1. List Releases (verifies API + Link pagination goes through proxy)
	releases, etag, notModified, err := client.ListReleases(context.Background(), "owner", "test", "")
	if err != nil {
		t.Fatalf("ListReleases via proxy failed: %v", err)
	}
	if notModified || etag != `"page1-etag"` {
		t.Fatalf("unexpected etag %q, notMod=%v", etag, notModified)
	}
	if len(releases) != 2 {
		t.Fatalf("expected 2 releases across pages, got %d", len(releases))
	}

	// 2. Download ZIP (verifies download + CDN redirect goes through proxy)
	downloadURL := releases[0].Assets[0].BrowserDownloadURL
	tmpPath, sha, size, err := client.DownloadToTemp(context.Background(), downloadURL, 1024*1024)
	if err != nil {
		t.Fatalf("DownloadToTemp via proxy failed: %v", err)
	}
	defer os.Remove(tmpPath)

	if sha != zipHashHex {
		t.Fatalf("expected sha %s, got %s", zipHashHex, sha)
	}
	if size != int64(len(zipData)) {
		t.Fatalf("expected size %d, got %d", len(zipData), size)
	}

	if directHits := atomic.LoadInt32(&directGitHubHits); directHits != 0 {
		t.Fatalf("expected direct hits to GitHub to be 0, but got %d!", directHits)
	}
	if hits := atomic.LoadInt32(&proxyHits); hits == 0 {
		t.Fatal("expected proxy hits > 0, got 0")
	}
}

func TestHTTPForwardProxyUsedForAPIAndArchive(t *testing.T) {
	var proxyHits, directHits int32
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Via-HTTP-Proxy") != "true" {
			atomic.AddInt32(&directHits, 1)
		}
		if strings.HasSuffix(r.URL.Path, "/releases") {
			fmt.Fprintf(w, `[{"id":1,"tag_name":"v1.0.0","assets":[{"id":2,"name":"mod.zip","browser_download_url":%q}]}]`, upstream.URL+"/mod.zip")
			return
		}
		_, _ = w.Write([]byte("zip bytes"))
	}))
	defer upstream.Close()

	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&proxyHits, 1)
		if !r.URL.IsAbs() {
			t.Errorf("proxy did not receive absolute URL: %s", r.URL)
		}
		req := r.Clone(r.Context())
		req.RequestURI = ""
		req.Header.Set("X-Via-HTTP-Proxy", "true")
		res, err := http.DefaultTransport.RoundTrip(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer res.Body.Close()
		w.WriteHeader(res.StatusCode)
		_, _ = io.Copy(w, res.Body)
	}))
	defer proxy.Close()

	proxyAddress := strings.TrimPrefix(proxy.URL, "http://")
	client := NewClient(WithBaseURL(upstream.URL), WithProxyTemplate(proxyAddress), WithAllowInsecureTestHosts(true))
	releases, _, _, err := client.ListReleases(context.Background(), "owner", "repo", "")
	if err != nil || len(releases) != 1 {
		t.Fatalf("release API via proxy: releases=%d err=%v", len(releases), err)
	}
	path, _, _, err := client.DownloadToTemp(context.Background(), releases[0].Assets[0].BrowserDownloadURL, 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	if proxyHits != 2 || directHits != 0 {
		t.Fatalf("proxy hits=%d, direct hits=%d", proxyHits, directHits)
	}
}

func TestProxyErrorScenarios(t *testing.T) {
	// 1. Test RateLimit through proxy
	proxy429 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Ratelimit-Reset", "1800000000")
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"message":"rate limit from proxy"}`)
	}))
	defer proxy429.Close()

	client429 := NewClient(
		WithProxyTemplate(proxy429.URL+"/{url}"),
		WithAllowInsecureTestHosts(true),
	)
	_, _, _, err429 := client429.ListReleases(context.Background(), "owner", "repo", "")
	if err429 == nil || !IsRateLimited(err429) {
		t.Fatalf("expected rate limited error through proxy, got %v", err429)
	}

	// 2. Test Timeout through proxy does not switch to direct
	proxyTimeout := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer proxyTimeout.Close()

	ctxTimeout, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	clientTimeout := NewClient(
		WithProxyTemplate(proxyTimeout.URL+"/{url}"),
		WithAllowInsecureTestHosts(true),
	)
	_, _, _, errTimeout := clientTimeout.ListReleases(ctxTimeout, "owner", "repo", "")
	if errTimeout == nil {
		t.Fatal("expected timeout error through proxy, got nil")
	}

	// 3. Test Max Redirects exceeded
	var redirectLoopServer *httptest.Server
	redirectLoopServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, redirectLoopServer.URL+"/loop", http.StatusFound)
	}))
	defer redirectLoopServer.Close()

	clientLoop := NewClient(
		WithBaseURL(redirectLoopServer.URL),
		WithAllowInsecureTestHosts(true),
	)
	_, _, _, errLoop := clientLoop.ListReleases(context.Background(), "owner", "repo", "")
	if errLoop == nil || !errors.Is(errLoop, ErrTooManyRedirects) {
		t.Fatalf("expected ErrTooManyRedirects, got %v", errLoop)
	}

	// 4. Test SSRF prevention when allowInsecureTestHosts is false
	clientSSRF := NewClient(
		WithProxyTemplate("https://127.0.0.1:8080/{url}"),
	)
	_, _, _, errSSRF := clientSSRF.ListReleases(context.Background(), "owner", "repo", "")
	if errSSRF == nil {
		t.Fatal("expected SSRF error for 127.0.0.1, got nil")
	}
}
