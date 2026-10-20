package cloudreve

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnsureDirectoryCreatesOnlyMissingDirectory(t *testing.T) {
	for _, tc := range []struct {
		name        string
		initialCode int
		createCode  int
		afterCode   int
		wantCreate  bool
		wantError   bool
	}{
		{"existing", 0, 0, 0, false, false}, {"missing", 404, 0, 0, true, false}, {"concurrent creation", 404, 40004, 0, true, false}, {"permission denied", 403, 0, 0, false, true}, {"authentication denied", 40023, 0, 0, false, true}, {"creation denied", 404, 403, 404, true, true}, {"creation not visible", 404, 0, 404, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reads, creates := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/user/session" {
					w.Write([]byte(`{"code":0}`))
					return
				}
				if r.Method == "PUT" && r.URL.Path == "/directory" {
					creates++
					var p struct {
						Path string `json:"path"`
					}
					json.NewDecoder(r.Body).Decode(&p)
					if p.Path != "/SubmodHub" {
						t.Errorf("unexpected creation %q", p.Path)
					}
					json.NewEncoder(w).Encode(map[string]any{"code": tc.createCode})
					return
				}
				if r.Method != "GET" || r.URL.Path != "/directory/SubmodHub" {
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					w.WriteHeader(500)
					return
				}
				reads++
				code := tc.initialCode
				if creates > 0 {
					code = tc.afterCode
				}
				json.NewEncoder(w).Encode(map[string]any{"code": code, "data": map[string]any{"policy": map[string]string{"type": "remote"}}})
			}))
			defer server.Close()
			client, _ := New(Config{BaseURL: server.URL, AllowInsecureForTesting: true})
			listing, err := client.EnsureDirectory(context.Background(), "/SubmodHub")
			if (err != nil) != tc.wantError {
				t.Fatalf("error=%v", err)
			}
			if (creates > 0) != tc.wantCreate || creates > 1 {
				t.Fatalf("creates=%d", creates)
			}
			if !tc.wantError && listing.Policy.Type != "remote" {
				t.Fatal("directory not verified")
			}
		})
	}
}
