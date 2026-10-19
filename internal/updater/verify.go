package updater

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

var (
	ErrHashMismatch      = errors.New("checksum mismatch")
	ErrSignatureInvalid  = errors.New("ed25519 signature invalid")
	ErrMissingHash       = errors.New("expected sha256 hash not provided")
	ErrChecksumNotFound  = errors.New("asset not found in checksums file")
)

// CalculateFileSHA256 computes the lowercase hex sha256 of the given file.
func CalculateFileSHA256(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// VerifyFileSHA256 checks if the file matches the expected hex SHA-256.
func VerifyFileSHA256(filePath string, expectedSHA256 string) error {
	expected := strings.ToLower(strings.TrimSpace(expectedSHA256))
	if expected == "" {
		return ErrMissingHash
	}
	actual, err := CalculateFileSHA256(filePath)
	if err != nil {
		return fmt.Errorf("failed to calculate sha256: %w", err)
	}
	if actual != expected {
		return fmt.Errorf("%w: expected %s, got %s", ErrHashMismatch, expected, actual)
	}
	return nil
}

// ParseChecksums parses the content of a SHA256SUMS.txt file.
// Format: <hash> <filename> or <hash> *<filename>
func ParseChecksums(content string) map[string]string {
	result := make(map[string]string)
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			hash := strings.ToLower(fields[0])
			fileName := strings.TrimPrefix(fields[1], "*")
			result[fileName] = hash
		}
	}
	return result
}

// VerifySignature verifies Ed25519 signature over file content if publicKey is provided.
func VerifySignature(filePath string, signature []byte, pubKey ed25519.PublicKey) error {
	if len(pubKey) == 0 {
		return nil // Signature verification skipped if no public key configured
	}
	content, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}
	if !ed25519.Verify(pubKey, content, signature) {
		return ErrSignatureInvalid
	}
	return nil
}
