package httpapi

import (
	"bytes"
	"encoding/base64"
	"testing"

	"github.com/reze/submodhub/internal/delivery"
)

func TestReencryptDeliveryCredentialsAtomicAndRestart(t *testing.T) {
	old, _ := delivery.NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)))
	next, _ := delivery.NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32)))
	encrypted, _ := old.Seal("node", "secret")
	s, _ := NewStore(t.TempDir(), Catalog{DeliveryNodes: []DeliveryNode{{ID: "node", CredentialCiphertext: encrypted}}})
	s.DeliverySecrets = old
	if err := s.ReencryptDeliveryCredentials(next); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewStore(s.DataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = old.Open("node", reloaded.Catalog.DeliveryNodes[0].CredentialCiphertext); err == nil {
		t.Fatal("old key still works")
	}
	if plain, err := next.Open("node", reloaded.Catalog.DeliveryNodes[0].CredentialCiphertext); err != nil || plain != "secret" {
		t.Fatal("rekey lost credential")
	}
	before := s.Catalog.DeliveryNodes[0].CredentialCiphertext
	s.Catalog.DeliveryNodes = append(s.Catalog.DeliveryNodes, DeliveryNode{ID: "broken", CredentialCiphertext: "broken"})
	if err = s.ReencryptDeliveryCredentials(old); err == nil {
		t.Fatal("partial corrupt rotation accepted")
	}
	if s.Catalog.DeliveryNodes[0].CredentialCiphertext != before || s.DeliverySecrets != next {
		t.Fatal("partial rotation persisted")
	}
}
