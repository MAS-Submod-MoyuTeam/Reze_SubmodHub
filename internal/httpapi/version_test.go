package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/reze/submodhub/internal/version"
)

func TestVersionEndpointReportsBuildMetadata(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Versions: map[string]Version{}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res, err := server.Client().Get(server.URL + "/api/v1/version")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if got := res.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}

	var info version.Info
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		t.Fatalf("decode version response: %v", err)
	}
	if info.Version != version.Version {
		t.Fatalf("version = %q, want %q", info.Version, version.Version)
	}
	if info.GoVersion == "" || info.Platform == "" {
		t.Fatalf("expected go_version and platform, got %+v", info)
	}
}

func TestVersionEndpointRejectsWrites(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Versions: map[string]Version{}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/version", nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", res.StatusCode)
	}
	if got := res.Header.Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("Allow = %q, want %q", got, "GET, HEAD")
	}
}

func TestHealthzIncludesVersion(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{Versions: map[string]Version{}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()

	res, err := server.Client().Get(server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if got, _ := body["version"].(string); got != version.Version {
		t.Fatalf("healthz version = %q, want %q", got, version.Version)
	}
}
