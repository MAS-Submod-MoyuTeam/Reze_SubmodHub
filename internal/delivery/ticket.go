package delivery

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
)

type Ticket struct {
	Audience  string `json:"aud"`
	VersionID string `json:"version_id"`
	SourceURL string `json:"source_url"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
	ExpiresAt int64  `json:"exp"`
}

var ErrTicket = errors.New("delivery_ticket_invalid")

func (t Ticket) valid() bool {
	u, err := url.Parse(t.SourceURL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || u.Port() != "" || !github.IsAllowedGitHubHost(u.Host) {
		return false
	}
	digest, err := hex.DecodeString(t.SHA256)
	return err == nil && len(digest) == 32 && t.Audience != "" && t.VersionID != "" && t.SizeBytes > 0 && t.SizeBytes <= 128<<20
}
func SignTicket(key string, t Ticket) (string, error) {
	if len(key) < 32 || !t.valid() || t.ExpiresAt <= time.Now().Unix() || t.ExpiresAt > time.Now().Add(5*time.Minute).Unix() {
		return "", ErrTicket
	}
	b, err := json.Marshal(t)
	if err != nil {
		return "", ErrTicket
	}
	payload := base64.RawURLEncoding.EncodeToString(b)
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
func VerifyTicket(key, audience, token string, now time.Time) (Ticket, error) {
	var t Ticket
	if len(key) < 32 || len(token) > 8192 {
		return t, ErrTicket
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return t, ErrTicket
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return t, ErrTicket
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(parts[0]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return t, ErrTicket
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(b, &t) != nil || !t.valid() || t.Audience != audience || t.ExpiresAt <= now.Unix() || t.ExpiresAt > now.Add(5*time.Minute).Unix() {
		return Ticket{}, ErrTicket
	}
	return t, nil
}
