package cloudreve

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestRemoteChunkUsesOnlyUploadCredentialAndNeverRedirects(t *testing.T) {
	redirectHits := 0
	redirect := false
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirectHits++; fmt.Fprint(w, `{"code":0}`) }))
	defer sink.Close()
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "scoped-upload-credential" || r.URL.Query().Get("chunk") != "2" || r.ContentLength != 5 {
			t.Error("credential or chunk boundary violation")
		}
		b, _ := io.ReadAll(r.Body)
		if string(b) != "chunk" {
			t.Error("chunk changed")
		}
		if redirect {
			http.Redirect(w, r, sink.URL, http.StatusTemporaryRedirect)
			return
		}
		fmt.Fprint(w, `{"code":0}`)
	}))
	defer remote.Close()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "api_session", Value: "sensitive", Path: "/"})
		fmt.Fprint(w, `{"code":0,"data":{"objects":[]}}`)
	}))
	defer api.Close()
	c, _ := New(Config{BaseURL: api.URL, AllowInsecureForTesting: true, AllowedDownloadOrigins: []string{remote.URL, sink.URL}})
	c.List(context.Background(), "/")
	u, _ := url.Parse(api.URL)
	if len(c.http.Jar.Cookies(u)) == 0 {
		t.Fatal("test lacks API session cookie")
	}
	if err := c.remoteChunk(context.Background(), remote.URL, "scoped-upload-credential", 2, strings.NewReader("chunk"), 5); err != nil {
		t.Fatal(err)
	}
	redirect = true
	if err := c.remoteChunk(context.Background(), remote.URL, "scoped-upload-credential", 2, strings.NewReader("chunk"), 5); err == nil || redirectHits != 0 {
		t.Fatal("upload credential followed redirect")
	}
	if err := c.remoteChunk(context.Background(), "http://unlisted.invalid", "secret", 0, strings.NewReader("a"), 1); err == nil {
		t.Fatal("unlisted origin accepted")
	}
}
