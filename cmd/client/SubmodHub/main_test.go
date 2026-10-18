//go:build !browser

package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopAssetsRoutesAPIToServer(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RequestURI() != "/api/v1/mods?cursor=next" {
			t.Errorf("unexpected API path: %s", r.URL.RequestURI())
		}
		if got, want := r.Host, strings.TrimPrefix(server.URL, "http://"); got != want {
			t.Errorf("upstream Host = %q, want %q", got, want)
		}
		if got, want := r.Header.Get("X-Forwarded-Host"), "wails.localhost"; got != want {
			t.Errorf("X-Forwarded-Host = %q, want %q", got, want)
		}
		_, _ = io.WriteString(w, "catalog")
	}))
	defer server.Close()

	frontend := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "frontend")
	})
	handler, err := desktopAssets(server.URL, frontend)
	if err != nil {
		t.Fatal(err)
	}

	for path, want := range map[string]string{
		"/api/v1/mods?cursor=next": "catalog",
		"/":                        "frontend",
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Host = "wails.localhost"
		handler.ServeHTTP(response, request)
		if response.Body.String() != want {
			t.Errorf("%s: got %q, want %q", path, response.Body.String(), want)
		}
	}
}

func TestDesktopAssetsRejectsInvalidAPIURL(t *testing.T) {
	for _, address := range []string{"", "rezehub.0721play.icu", "file:///tmp/api"} {
		if _, err := desktopAssets(address, http.NotFoundHandler()); err == nil {
			t.Errorf("accepted invalid API URL %q", address)
		}
	}
}
