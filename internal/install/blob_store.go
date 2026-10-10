package install

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type BlobStore struct {
	dir string
}

func NewBlobStore(dir string) *BlobStore {
	return &BlobStore{dir: filepath.Clean(dir)}
}

func (s *BlobStore) Path(hash string) string {
	if len(hash) < 2 {
		return filepath.Join(s.dir, "invalid", hash)
	}
	return filepath.Join(s.dir, hash[:2], hash)
}

func (s *BlobStore) Exists(hash string) bool {
	if hash == "" {
		return false
	}
	info, err := os.Stat(s.Path(hash))
	return err == nil && !info.IsDir()
}

func (s *BlobStore) Put(content []byte) (string, error) {
	h := sha256.Sum256(content)
	hash := hex.EncodeToString(h[:])
	dest := s.Path(hash)

	if s.Exists(hash) {
		return hash, nil
	}

	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}

	tmp := dest + fmt.Sprintf(".tmp.%d", time.Now().UnixNano())
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return "", err
	}

	if err := os.Rename(tmp, dest); err != nil {
		// Another concurrent write might have placed it
		if s.Exists(hash) {
			_ = os.Remove(tmp)
			return hash, nil
		}
		_ = os.Remove(tmp)
		return "", err
	}
	return hash, nil
}

func (s *BlobStore) Get(hash string) ([]byte, error) {
	if hash == "" {
		return nil, &Error{Code: "missing_blob", Err: errors.New("empty hash")}
	}
	dest := s.Path(hash)
	b, err := os.ReadFile(dest)
	if os.IsNotExist(err) {
		return nil, &Error{Code: "missing_blob", Path: dest, Err: fmt.Errorf("blob %s not found", hash)}
	}
	if err != nil {
		return nil, err
	}

	h := sha256.Sum256(b)
	actual := hex.EncodeToString(h[:])
	if !strings.EqualFold(actual, hash) {
		return nil, &Error{Code: "corrupt_blob", Path: dest, Err: fmt.Errorf("expected hash %s, got %s", hash, actual)}
	}
	return b, nil
}

func (s *BlobStore) Verify(hash string) error {
	_, err := s.Get(hash)
	return err
}
