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
	dir      string
	syncHook func() error
}

func NewBlobStore(dir string) *BlobStore {
	return &BlobStore{dir: filepath.Clean(dir)}
}

func (s *BlobStore) SetSyncHook(hook func() error) {
	s.syncHook = hook
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

// Put stores content and returns its hash. A blob that already exists is not
// rewritten, but its modification time is refreshed: the retention sweep treats
// a blob as reclaimable only once nobody has needed its content for the whole
// retention window, and a re-staged preview or a repeated before-image is
// "needed now" even when the bytes were already on disk.
func (s *BlobStore) Put(content []byte) (string, error) {
	h := sha256.Sum256(content)
	hash := hex.EncodeToString(h[:])
	dest := s.Path(hash)

	if s.Exists(hash) {
		s.touch(dest)
		return hash, nil
	}

	if s.syncHook != nil {
		if err := s.syncHook(); err != nil {
			return "", fmt.Errorf("blob sync failed: %w", err)
		}
	}

	if err := writeAtomicFile(dest, content, 0o644); err != nil {
		// Another concurrent write might have placed it
		if s.Exists(hash) {
			return hash, nil
		}
		return "", err
	}
	return hash, nil
}

// touch refreshes a blob's modification time so retention cannot mistake a
// currently needed blob for an abandoned one. Best effort: a store on a
// read-only or timestamp-rejecting filesystem keeps the older stamp, and the
// sweep then simply keeps the blob for one more window.
func (s *BlobStore) touch(path string) {
	now := time.Now()
	_ = os.Chtimes(path, now, now)
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
