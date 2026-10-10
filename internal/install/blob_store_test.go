package install

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestBlobStorePutGetVerify(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "blobs")
	store := NewBlobStore(dir)

	content := []byte("hello blob store")
	hash := sha256.Sum256(content)
	hashHex := hex.EncodeToString(hash[:])

	// Put
	returnedHash, err := store.Put(content)
	if err != nil {
		t.Fatalf("put failed: %v", err)
	}
	if returnedHash != hashHex {
		t.Fatalf("expected hash %s, got %s", hashHex, returnedHash)
	}

	// Exists
	if !store.Exists(hashHex) {
		t.Fatalf("expected blob %s to exist", hashHex)
	}

	// Get
	got, err := store.Get(hashHex)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if string(got) != string(content) {
		t.Fatalf("expected %q, got %q", content, got)
	}

	// Verify
	if err := store.Verify(hashHex); err != nil {
		t.Fatalf("verify failed: %v", err)
	}

	// Verify missing blob
	err = store.Verify("0000000000000000000000000000000000000000000000000000000000000000")
	if err == nil || !IsCode(err, "missing_blob") {
		t.Fatalf("expected missing_blob error, got %v", err)
	}

	// Corrupt blob test
	p := store.Path(hashHex)
	if err := os.WriteFile(p, []byte("corrupted!"), 0o644); err != nil {
		t.Fatal(err)
	}
	err = store.Verify(hashHex)
	if err == nil || !IsCode(err, "corrupt_blob") {
		t.Fatalf("expected corrupt_blob error, got %v", err)
	}
}

func TestBlobStoreEmptyContent(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "blobs")
	store := NewBlobStore(dir)

	empty := []byte{}
	hash := sha256.Sum256(empty)
	hashHex := hex.EncodeToString(hash[:])

	h, err := store.Put(empty)
	if err != nil {
		t.Fatalf("put empty failed: %v", err)
	}
	if h != hashHex {
		t.Fatalf("expected %s, got %s", hashHex, h)
	}
	got, err := store.Get(hashHex)
	if err != nil {
		t.Fatalf("get empty failed: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected 0 bytes, got %d", len(got))
	}
}
