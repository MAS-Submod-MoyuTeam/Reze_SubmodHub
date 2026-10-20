package delivery

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRelayRejectsTicketAndStreamsWithoutCredentials(t *testing.T) {
	key := strings.Repeat("k", 32)
	relay, err := NewRelay(RelayConfig{Audience: "n", Key: key, MaxConcurrent: 1})
	if err != nil {
		t.Fatal(err)
	}
	relay.open = func(ctx context.Context, source string) (*http.Response, error) {
		return &http.Response{StatusCode: 200, ContentLength: 4, Body: io.NopCloser(strings.NewReader("data")), Header: http.Header{}}, nil
	}
	w := httptest.NewRecorder()
	relay.ServeHTTP(w, httptest.NewRequest("GET", "/download?ticket=invalid", nil))
	if w.Code != 401 {
		t.Fatalf("forged: %d", w.Code)
	}
	token, err := SignTicket(key, Ticket{Audience: "n", VersionID: "v", SourceURL: "https://github.com/o/r/releases/download/v/a.zip", SHA256: strings.Repeat("a", 64), SizeBytes: 4, ExpiresAt: time.Now().Add(time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	relay.ServeHTTP(w, httptest.NewRequest("GET", "/download?ticket="+token, nil))
	if w.Code != 200 || w.Body.String() != "data" {
		t.Fatalf("stream: %d %s", w.Code, w.Body.String())
	}
	relay.slots <- struct{}{}
	defer func() { <-relay.slots }()
	w = httptest.NewRecorder()
	relay.ServeHTTP(w, httptest.NewRequest("GET", "/download?ticket="+token, nil))
	if w.Code != 503 {
		t.Fatalf("concurrency: %d", w.Code)
	}
}
