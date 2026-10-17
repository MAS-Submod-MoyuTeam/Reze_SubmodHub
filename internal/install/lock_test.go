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

func TestCustomLockPathExclusivity(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	customLockDir := t.TempDir()
	customLockPath := filepath.Join(customLockDir, "custom.lock")

	inst1 := New(root, stateDir)
	inst1.SetLockPath(customLockPath)
	inst2 := New(root, stateDir)
	inst2.SetLockPath(customLockPath)

	if inst1.LockPath() != customLockPath {
		t.Fatalf("expected LockPath %q, got %q", customLockPath, inst1.LockPath())
	}

	lock1, err := inst1.acquireLock()
	if err != nil {
		t.Fatalf("inst1 acquireLock failed: %v", err)
	}

	// Lock file must exist on disk and contain non-empty PID
	content, err := os.ReadFile(customLockPath)
	if err != nil {
		t.Fatalf("failed to read custom lock file: %v", err)
	}
	if len(content) == 0 {
		t.Fatal("expected non-empty PID in custom lock file")
	}

	// inst2 must fail with instance_busy
	_, err = inst2.acquireLock()
	if err == nil || !IsCode(err, "instance_busy") {
		t.Fatalf("expected instance_busy, got %v", err)
	}

	lock1.Release()

	// After release, inst2 can acquire
	lock2, err := inst2.acquireLock()
	if err != nil {
		t.Fatalf("inst2 acquireLock failed after release: %v", err)
	}
	lock2.Release()
}