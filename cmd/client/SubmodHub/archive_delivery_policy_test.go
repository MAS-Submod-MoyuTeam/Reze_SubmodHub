package main

import (
	"net/url"
	"testing"
)

func TestArchiveDeliveryURLPolicy(t *testing.T) {
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
		_, err := validateArchiveDeliveryURL(base, tc.raw, tc.origins)
		if (err == nil) != tc.ok {
			t.Errorf("%s: err=%v want allowed=%v", tc.raw, err, tc.ok)
		}
	}
}
