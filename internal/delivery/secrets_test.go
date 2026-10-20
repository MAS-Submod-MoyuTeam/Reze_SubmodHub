package delivery

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

func TestSecretsAuthenticatedAndBoundToNode(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))
	box, err := NewSecrets(key)
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := box.Seal("node-a", "private-password")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(encrypted, "private-password") {
		t.Fatal("plaintext persisted")
	}
	plain, err := box.Open("node-a", encrypted)
	if err != nil || plain != "private-password" {
		t.Fatalf("roundtrip: %v", err)
	}
	if _, err = box.Open("node-b", encrypted); err == nil {
		t.Fatal("ciphertext moved between nodes")
	}
	other, _ := NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32)))
	if _, err = other.Open("node-a", encrypted); err == nil {
		t.Fatal("wrong key accepted")
	}
	second, _ := box.Seal("node-a", "private-password")
	if second == encrypted {
		t.Fatal("nonce reused")
	}
}
func TestSecretsMissingKeyCannotSave(t *testing.T) {
	for _, key := range []string{"", "plaintext", "c2hvcnQ="} {
		box, err := NewSecrets(key)
		if err == nil && box != nil {
			t.Fatalf("invalid key accepted: %q", key)
		}
	}
	var box *Secrets
	if _, err := box.Seal("node", "password"); err == nil {
		t.Fatal("missing master key accepted")
	}
}
func TestSecretsRejectMalformedCiphertext(t *testing.T) {
	box, _ := NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)))
	for _, ciphertext := range []string{"", "abc", "v1:AAAA", "v2:AAAA"} {
		if _, err := box.Open("node", ciphertext); err == nil {
			t.Fatal("malformed ciphertext accepted")
		}
	}
}
