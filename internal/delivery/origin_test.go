package delivery

import (
	"net/http"
	"net/http/httptest"
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

// TestDeliveryOriginClientTrustsOnlyTheConfiguredAPIHost pins the dial policy:
// the API's own host bypasses the private-address rule (a self-hosted API may
// legitimately serve downloads from a LAN address), and nothing else does.
func TestDeliveryOriginClientTrustsOnlyTheConfiguredAPIHost(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer target.Close()

	base, _ := url.Parse(target.URL)
	client := NewOriginClient(base, nil, 4)
	res, err := client.Get(target.URL)
	if err != nil {
		t.Fatalf("same-origin dial must be allowed: %v", err)
	}
	res.Body.Close()

	// A base on another port does not grant the bypass: the target is a private
	// address, so the private-address rule applies.
	otherBase, _ := url.Parse("http://127.0.0.1:1")
	strict := NewOriginClient(otherBase, nil, 4)
	if _, err := strict.Get(target.URL); err == nil {
		t.Fatal("a private destination must be rejected")
	}

	// Without a base there is no same-origin exception at all.
	noBase := NewOriginClient(nil, nil, 4)
	if _, err := noBase.Get(target.URL); err == nil {
		t.Fatal("a private destination must be rejected without a base")
	}
}

func TestDeliveryOriginEffectivePort(t *testing.T) {
	cases := map[string]string{
		"https://api.example":      "443",
		"https://api.example:8443": "8443",
		"http://100.72.137.92":     "80",
		"http://10.0.0.5:8080":     "8080",
	}
	for raw, want := range cases {
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("parse %s: %v", raw, err)
		}
		if got := originEffectivePort(parsed); got != want {
			t.Fatalf("%s -> %q, want %q", raw, got, want)
		}
	}
}
