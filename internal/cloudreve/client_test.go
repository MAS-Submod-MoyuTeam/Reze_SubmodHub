package cloudreve

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestParameterErrorDoesNotRelogin(t *testing.T) {
	logins := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "session") {
			logins++
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		fmt.Fprint(w, `{"code":40001}`)
	}))
	defer srv.Close()
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})
	_, err := c.List(context.Background(), "/")
	if err == nil || err.Error() != "cloudreve_business_40001" || logins != 1 {
		t.Fatalf("wrong classification: %v logins=%d", err, logins)
	}
}

func TestV3SignedExpiry(t *testing.T) {
	expires := time.Now().Add(8 * time.Minute).Unix()
	sign := base64.URLEncoding.EncodeToString(make([]byte, 32)) + fmt.Sprintf(":%d", expires)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "session") {
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": "https://cdn.example/api/v3/slave/download/0/file/name?sign=" + sign})
	}))
	defer srv.Close()
	c, _ := New(Config{BaseURL: srv.URL, AllowedDownloadOrigins: []string{"https://cdn.example"}, AllowInsecureForTesting: true})
	link, err := c.Download(context.Background(), "id")
	if err != nil {
		t.Fatal(err)
	}
	if link.ExpiresAt.Unix() != expires {
		t.Fatalf("invented expiry: %v", link.ExpiresAt)
	}
}

func TestLocalChunkUploadStreamsAndReconciles(t *testing.T) {
	data := []byte("PK-test-archive")
	var received bytes.Buffer
	var uploaded bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "session"):
			fmt.Fprint(w, `{"code":0}`)
		case r.Method == "GET" && strings.Contains(r.URL.Path, "directory"):
			if uploaded {
				fmt.Fprintf(w, `{"code":0,"data":{"objects":[{"id":"obj","name":"archive.zip","type":"file","size":%d}],"policy":{"id":"p","type":"local"}}}`, len(data))
			} else {
				fmt.Fprint(w, `{"code":0,"data":{"objects":[],"policy":{"id":"p","type":"local"}}}`)
			}
		case r.Method == "PUT" && strings.HasSuffix(r.URL.Path, "upload"):
			fmt.Fprint(w, `{"code":0,"data":{"sessionID":"session-id","chunkSize":4}}`)
		case r.Method == "POST" && strings.Contains(r.URL.Path, "upload/session-id/"):
			b, _ := io.ReadAll(r.Body)
			if len(b) > 4 {
				t.Error("chunk too large")
			}
			received.Write(b)
			uploaded = received.Len() == len(data)
			fmt.Fprint(w, `{"code":0}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			fmt.Fprint(w, `{"code":500}`)
		}
	}))
	defer srv.Close()
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})
	obj, err := c.Upload(context.Background(), "/project", "archive.zip", bytes.NewReader(data), int64(len(data)))
	if err != nil || obj.ID != "obj" || !bytes.Equal(data, received.Bytes()) {
		t.Fatalf("upload: %v %+v %s", err, obj, received.String())
	}
	// A retry after metadata persistence failed finds the object by deterministic name.
	obj, err = c.Upload(context.Background(), "/project", "archive.zip", bytes.NewReader(data), int64(len(data)))
	if err != nil || obj.ID != "obj" || received.Len() != len(data) {
		t.Fatal("duplicate upload on reconciliation")
	}
}

func TestSessionRetryAndSecretRedaction(t *testing.T) {
	var logins atomic.Int32
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v3/user/session" {
			logins.Add(1)
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "private-cookie", Path: "/"})
			fmt.Fprint(w, `{"code":0,"data":{}}`)
			return
		}
		if _, err := r.Cookie("session"); err != nil {
			t.Error("missing session")
		}
		if calls.Add(1) == 1 {
			fmt.Fprint(w, `{"code":401,"msg":"private-password private-cookie"}`)
			return
		}
		fmt.Fprint(w, `{"code":0,"data":{"objects":[]}}`)
	}))
	defer srv.Close()
	c, err := New(Config{BaseURL: srv.URL + "/api/v3", Username: "user", Password: "private-password", AllowInsecureForTesting: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.List(context.Background(), "/"); err != nil {
		t.Fatal(err)
	}
	if logins.Load() != 2 || calls.Load() != 2 {
		t.Fatalf("logins=%d calls=%d", logins.Load(), calls.Load())
	}
}

func TestErrorsNeverEchoProviderMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"code":40001,"msg":"secret-password cookie signed-url"}`)
	}))
	defer srv.Close()
	c, _ := New(Config{BaseURL: srv.URL, Password: "secret-password", AllowInsecureForTesting: true})
	_, err := c.List(context.Background(), "/")
	if err == nil || strings.Contains(err.Error(), "secret-password") || strings.Contains(err.Error(), "signed-url") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestRejectAuthenticatedRedirect(t *testing.T) {
	var leaked atomic.Bool
	dst := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked.Store(true) }))
	defer dst.Close()
	src := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, dst.URL, http.StatusTemporaryRedirect)
	}))
	defer src.Close()
	c, _ := New(Config{BaseURL: src.URL, AllowInsecureForTesting: true})
	if _, err := c.List(context.Background(), "/"); err == nil {
		t.Fatal("redirect accepted")
	}
	if leaked.Load() {
		t.Fatal("authenticated API redirected")
	}
}

func TestDownloadRequiresReliableExpiry(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "session") {
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		fmt.Fprint(w, `{"code":0,"data":"https://cdn.example/file?sign=unknown"}`)
	}))
	defer srv.Close()
	c, _ := New(Config{BaseURL: srv.URL, AllowedDownloadOrigins: []string{"https://cdn.example"}, AllowInsecureForTesting: true})
	if _, err := c.Download(context.Background(), "file"); err != ErrUnknownExpiry {
		t.Fatalf("got %v", err)
	}
}

func TestTimeoutAndCookieIsolation(t *testing.T) {
	var loginCookies atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "session") {
			if r.Header.Get("Cookie") != "" {
				loginCookies.Add(1)
			}
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "isolated", Path: "/"})
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(100 * time.Millisecond):
			fmt.Fprint(w, `{"code":0,"data":{"objects":[]}}`)
		}
	}))
	defer srv.Close()
	for i := 0; i < 2; i++ {
		c, _ := New(Config{BaseURL: srv.URL, Timeout: 20 * time.Millisecond, AllowInsecureForTesting: true})
		if _, err := c.List(context.Background(), "/"); err == nil {
			t.Fatal("timeout absent")
		}
	}
	if loginCookies.Load() != 0 {
		t.Fatal("session shared across clients")
	}
}
