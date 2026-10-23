package delivery

import (
	"net/http"
	"net/url"
	"testing"
)

func TestDeliveryOriginURLPolicy(t *testing.T) {
	base, _ := url.Parse("https://api.example/api/v1")
	for _, tc := range []struct {
		raw     string
		origins []string
		ok      bool
	}{
		{"/api/v1/archives/v", nil, true},
		{"https://cdn.example/archive", []string{"https://cdn.example"}, true},
		{"https://cdn.example/archive", nil, false},
		{"//cdn.example/archive", []string{"https://cdn.example"}, false},
		{"https://user:secret@cdn.example/archive", []string{"https://cdn.example"}, false},
		{"http://cdn.example/archive", []string{"http://cdn.example"}, false},
		{"https://127.0.0.1/archive", []string{"https://127.0.0.1"}, false},
		{"https://10.0.0.1/archive", []string{"https://10.0.0.1"}, false},
		{"https://api.example@evil.example/archive", []string{"https://api.example"}, false},
	} {
		_, err := ValidateOriginURL(base, tc.raw, tc.origins)
		if (err == nil) != tc.ok {
			t.Errorf("%s: err=%v want allowed=%v", tc.raw, err, tc.ok)
		}
	}
}

func TestDeliveryOriginClientRejectsPrivateAndUndeclaredRedirects(t *testing.T) {
	base, _ := url.Parse("https://api.example/api/v1")
	client := NewOriginClient(base, []string{"https://cdn.example"}, 4)
	if client.Transport == nil || client.CheckRedirect == nil {
		t.Fatal("origin client must pin transport and redirect policy")
	}
	for _, raw := range []string{"https://127.0.0.1/archive", "https://evil.example/archive"} {
		req, err := http.NewRequest(http.MethodGet, raw, nil)
		if err != nil {
			t.Fatalf("build request: %v", err)
		}
		if err := client.CheckRedirect(req, []*http.Request{{}}); err == nil {
			t.Fatalf("%s must be rejected as a redirect destination", raw)
		}
	}
	req, err := http.NewRequest(http.MethodGet, "https://cdn.example/archive", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if err := client.CheckRedirect(req, []*http.Request{{}}); err != nil {
		t.Fatalf("declared origin must be allowed: %v", err)
	}
}
