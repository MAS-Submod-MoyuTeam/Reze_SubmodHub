package delivery

import (
	"strings"
	"testing"
	"time"
)

func TestTicketsBindAudienceExpiryAndSource(t *testing.T) {
	key := strings.Repeat("k", 32)
	claim := Ticket{Audience: "node", VersionID: "v", SourceURL: "https://github.com/owner/repo/releases/download/v1/archive.zip", SHA256: strings.Repeat("a", 64), SizeBytes: 42, ExpiresAt: time.Now().Add(time.Minute).Unix()}
	token, err := SignTicket(key, claim)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyTicket(key, "node", token, time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		key, audience, token string
		now                  time.Time
	}{{"wrong", "node", token, time.Now()}, {key, "other", token, time.Now()}, {key, "node", token, time.Now().Add(2 * time.Minute)}, {key, "node", token + "x", time.Now()}} {
		if _, err = VerifyTicket(tc.key, tc.audience, tc.token, tc.now); err == nil {
			t.Fatal("invalid ticket accepted")
		}
	}
	for _, source := range []string{"https://evil.example/file", "http://github.com/file", "https://user:password@github.com/file", "https://github.com:443/file", "https://127.0.0.1/file"} {
		claim.SourceURL = source
		if _, err = SignTicket(key, claim); err == nil {
			t.Fatalf("unsafe source accepted %s", source)
		}
	}
}
