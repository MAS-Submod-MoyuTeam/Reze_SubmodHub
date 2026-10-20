// Package delivery owns download authorization and encrypted node credentials.
package delivery

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

var ErrMasterKey = errors.New("delivery_master_key_unavailable")
var ErrSecret = errors.New("delivery_secret_invalid")

type Secrets struct{ aead cipher.AEAD }

// NewSecrets accepts exactly one base64 encoded 256-bit deployment key.
// There is deliberately no generated or plaintext fallback.
func NewSecrets(encoded string) (*Secrets, error) {
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(key) != 32 {
		return nil, ErrMasterKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, ErrMasterKey
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, ErrMasterKey
	}
	return &Secrets{aead: aead}, nil
}
func (s *Secrets) Seal(nodeID, plain string) (string, error) {
	if s == nil || s.aead == nil {
		return "", ErrMasterKey
	}
	if nodeID == "" || plain == "" {
		return "", ErrSecret
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", ErrSecret
	}
	ciphertext := s.aead.Seal(nonce, nonce, []byte(plain), []byte("submodhub/delivery/v1/"+nodeID))
	return "v1:" + base64.RawStdEncoding.EncodeToString(ciphertext), nil
}
func (s *Secrets) Open(nodeID, encoded string) (string, error) {
	if s == nil || s.aead == nil {
		return "", ErrMasterKey
	}
	if !strings.HasPrefix(encoded, "v1:") || nodeID == "" {
		return "", ErrSecret
	}
	b, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(encoded, "v1:"))
	if err != nil || len(b) < s.aead.NonceSize()+s.aead.Overhead() {
		return "", ErrSecret
	}
	plain, err := s.aead.Open(nil, b[:s.aead.NonceSize()], b[s.aead.NonceSize():], []byte("submodhub/delivery/v1/"+nodeID))
	if err != nil {
		return "", ErrSecret
	}
	return string(plain), nil
}
