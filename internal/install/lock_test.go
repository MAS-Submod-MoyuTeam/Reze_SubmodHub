package install

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestOSFileLockExclusivity(t *testing.T) {
	dir := t.TempDir()
	lockPath := filepath.Join(dir, "test.lock")

	f1, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f1.Close()

	if err := lockOSFile(f1); err != nil {
		t.Fatalf("first lock failed: %v", err)
	}

	// Second handle on same file must fail with errLockBusy
	f2, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f2.Close()

	err = lockOSFile(f2)
	if !errors.Is(err, errLockBusy) {
		t.Fatalf("expected errLockBusy, got %v", err)
	}

	// Unlock f1
	if err := unlockOSFile(f1); err != nil {
		t.Fatalf("unlock failed: %v", err)
	}

	// Now f2 must succeed
	if err := lockOSFile(f2); err != nil {
		t.Fatalf("second lock after unlock failed: %v", err)
	}
	_ = unlockOSFile(f2)
}