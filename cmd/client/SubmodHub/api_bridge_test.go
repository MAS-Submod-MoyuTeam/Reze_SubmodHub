package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServeAssetDetailed_PreservesQueryParamsAndPassthroughHeaders(t *testing.T) {
	// Mock backend API server that mirrors httpapi/spritepacks behavior
	mockBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/spritepacks/mod1/preview" {
			set := r.URL.Query().Get("set")
			item := r.URL.Query().Get("item")

			if set == "" || item == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_selection","message":"invalid sprite item"}`))
				return
			}

			if set == "uniform" && item == "0" {
				w.Header().Set("Content-Type", "image/png")
				w.Header().Set("Cache-Control", "public, max-age=3600")
				w.WriteHeader(http.StatusOK)
				// PNG magic bytes header followed by dummy image data
				pngData := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01}
				_, _ = w.Write(pngData)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not_found"}`))
			return
		}

		http.NotFound(w, r)
	}))
	defer mockBackend.Close()

	// Configure handler proxying to mock backend
	handler, err := desktopAssets(mockBackend.URL, http.NotFoundHandler())
	if err != nil {
		t.Fatalf("failed to setup desktopAssets: %v", err)
	}
	setGlobalAssetHandler(handler)

	// 1. Request WITH query parameters: must return 200 OK, image/png, and PNG content
	statusCode, contentType, body, err := serveAssetDetailed(http.MethodGet, "/api/v1/spritepacks/mod1/preview?set=uniform&item=0", nil, nil)
	if err != nil {
		t.Fatalf("serveAssetDetailed failed: %v", err)
	}
	if statusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body: %s)", statusCode, string(body))
	}
	if !strings.HasPrefix(contentType, "image/png") {
		t.Fatalf("expected Content-Type image/png, got %q", contentType)
	}
	if len(body) < 8 || body[0] != 0x89 || body[1] != 'P' || body[2] != 'N' || body[3] != 'G' {
		t.Fatalf("expected valid PNG bytes, got %v", body)
	}

	// 2. Request WITHOUT query parameters: must return 400 Bad Request, application/json, and error JSON
	statusCode400, contentType400, body400, err := serveAssetDetailed(http.MethodGet, "/api/v1/spritepacks/mod1/preview", nil, nil)
	if err != nil {
		t.Fatalf("serveAssetDetailed without query returned unexpected error: %v", err)
	}
	if statusCode400 != http.StatusBadRequest {
		t.Fatalf("expected status 400 for missing query params, got %d", statusCode400)
	}
	if !strings.HasPrefix(contentType400, "application/json") {
		t.Fatalf("expected Content-Type application/json, got %q", contentType400)
	}
	if !strings.Contains(string(body400), "invalid_selection") {
		t.Fatalf("expected invalid_selection in body, got %s", string(body400))
	}

	// 3. Request with unknown item: must return 404 Not Found
	statusCode404, _, _, err := serveAssetDetailed(http.MethodGet, "/api/v1/spritepacks/mod1/preview?set=unknown&item=99", nil, nil)
	if err != nil {
		t.Fatalf("serveAssetDetailed returned unexpected error: %v", err)
	}
	if statusCode404 != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", statusCode404)
	}
}
