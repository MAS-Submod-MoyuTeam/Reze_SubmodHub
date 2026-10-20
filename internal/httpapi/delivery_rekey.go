package httpapi

import (
	"errors"
	"slices"

	"github.com/reze/submodhub/internal/delivery"
)

// ReencryptDeliveryCredentials is an explicit offline administration operation.
// Stop the API and back up metadata plus both keys before invoking it.
func (s *Store) ReencryptDeliveryCredentials(next *delivery.Secrets) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if next == nil || s.DeliverySecrets == nil {
		return errors.New("delivery_master_key_unavailable")
	}
	previous := s.Catalog.DeliveryNodes
	updated := slices.Clone(previous)
	for i, n := range updated {
		if n.CredentialCiphertext == "" {
			continue
		}
		plain, err := s.DeliverySecrets.Open(n.ID, n.CredentialCiphertext)
		if err != nil {
			return errors.New("delivery_rekey_decryption_failed")
		}
		ciphertext, err := next.Seal(n.ID, plain)
		if err != nil {
			return errors.New("delivery_rekey_encryption_failed")
		}
		updated[i].CredentialCiphertext = ciphertext
	}
	s.Catalog.DeliveryNodes = updated
	if err := s.saveLocked(); err != nil {
		s.Catalog.DeliveryNodes = previous
		return errors.New("delivery_rekey_storage_failed")
	}
	s.DeliverySecrets = next
	s.deliveryRuntime.mu.Lock()
	s.deliveryRuntime.clients = nil
	s.deliveryRuntime.links = nil
	s.deliveryRuntime.mu.Unlock()
	return nil
}
