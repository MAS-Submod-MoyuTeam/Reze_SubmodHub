//go:build !browser

package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDesktopAssetsRoutesAPIToServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RequestURI() != "/api/v1/mods?cursor=next" {
			t.Errorf("unexpected API path: %s", r.URL.RequestURI())
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
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Body.String() != want {
			t.Errorf("%s: got %q, want %q", path, response.Body.String(), want)
		}
	}
}

func TestDesktopAssetsRejectsInvalidAPIURL(t *testing.T) {
	for _, address := range []string{"", "100.72.137.92:18082", "file:///tmp/api"} {
		if _, err := desktopAssets(address, http.NotFoundHandler()); err == nil {
			t.Errorf("accepted invalid API URL %q", address)
		}
	}
}
