package cloudreve

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnsureDirectoryDoesNotCreateForHTTP404OrRoot(t *testing.T) {
	for _, tc := range []struct {
		name, directory string
		http404         bool
	}{{"HTTP routing error", "/SubmodHub", true}, {"missing root", "/", false}} {
		t.Run(tc.name, func(t *testing.T) {
			creates := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/user/session" {
					w.Write([]byte(`{"code":0}`))
					return
				}
				if r.Method == "PUT" {
					creates++
					w.Write([]byte(`{"code":0}`))
					return
				}
				if tc.http404 {
					w.WriteHeader(404)
				} else {
					w.Write([]byte(`{"code":404}`))
				}
			}))
			defer server.Close()
			client, _ := New(Config{BaseURL: server.URL, AllowInsecureForTesting: true})
			if _, err := client.EnsureDirectory(context.Background(), tc.directory); err == nil {
				t.Fatal("unexpected success")
			}
			if creates != 0 {
				t.Fatal("created directory on non-directory error")
			}
		})
	}
}
