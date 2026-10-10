package install

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSafeAtomicRenameRotation(t *testing.T) {
	for _, replacementFails := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "restore"}[replacementFails], func(t *testing.T) {
			dir := t.TempDir()
			src, dest := filepath.Join(dir, "source"), filepath.Join(dir, "target")
			if err := os.WriteFile(src, []byte("new"), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(dest, []byte("original"), 0o644); err != nil {
				t.Fatal(err)
			}
			first := true
			err := safeAtomicRenameWith(src, dest, func(from, to string) error {
				if from == src && to == dest && (first || replacementFails) {
					first = false
					return errors.New("simulated replacement failure")
				}
				return os.Rename(from, to)
			})
			if (err != nil) != replacementFails {
				t.Fatalf("unexpected error: %v", err)
			}
			data, readErr := os.ReadFile(dest)
			expected := "new"
			if replacementFails {
				expected = "original"
			}
			if readErr != nil || string(data) != expected {
				t.Fatalf("target %q, %v", data, readErr)
			}
			backups, err := filepath.Glob(filepath.Join(dir, ".submodhub.old-*"))
			if err != nil || len(backups) != 0 {
				t.Fatalf("backup not cleaned: %v, %v", backups, err)
			}
		})
	}
}

func TestRollbackJournalIsIdempotent(t *testing.T) {
	root, state := t.TempDir(), t.TempDir()
	inst := New(root, state)
	beforeHash, err := inst.GetBlobs().Put([]byte("before"))
	if err != nil {
		t.Fatal(err)
	}
	afterHash, err := inst.GetBlobs().Put([]byte("after"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(state, "journals"), 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "file.rpy")
	if err := os.WriteFile(path, []byte("after"), 0o644); err != nil {
		t.Fatal(err)
	}
	journal := &TxJournal{OperationID: "idempotent", Phase: "prepared", BeforeFiles: map[string]FileBeforeState{"file.rpy": {DisplayPath: "file.rpy", Existed: true, Hash: beforeHash}}, AfterFiles: map[string]FileAfterState{"file.rpy": {DisplayPath: "file.rpy", Exists: true, Hash: afterHash}}}
	for attempt := 0; attempt < 2; attempt++ {
		if err := inst.RollbackJournal(journal); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "before" {
		t.Fatalf("rollback %q, %v", data, err)
	}
}

func TestSafeAtomicRenameMissingSourcePreservesDestination(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "target")
	if err := os.WriteFile(dest, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := safeAtomicRename(filepath.Join(dir, "missing"), dest); err == nil {
		t.Fatal("expected failure")
	}
	data, err := os.ReadFile(dest)
	if err != nil || string(data) != "original" {
		t.Fatalf("destination lost: %q, %v", data, err)
	}
}

func TestCanonicalPathStateDirectoryCasing(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows case-insensitive paths")
	}
	for _, path := range []string{".SubmodHub/state/manifest.json", ".submodhub/STATE/journals/op.json", ".SUBMODHUB/STATE"} {
		if _, _, err := CanonicalPath(path, ".submodhub/state"); err == nil {
			t.Fatalf("allowed state path %s", path)
		}
	}
}

func TestRollbackJournalRejectsDrift(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))
	beforeHash, err := inst.GetBlobs().Put([]byte("before"))
	if err != nil {
		t.Fatal(err)
	}
	afterHash, err := inst.GetBlobs().Put([]byte("after"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "file.rpy")
	if err := os.WriteFile(path, []byte("external"), 0o644); err != nil {
		t.Fatal(err)
	}
	journal := &TxJournal{OperationID: "drift", Phase: "prepared", BeforeFiles: map[string]FileBeforeState{"file.rpy": {DisplayPath: "file.rpy", Existed: true, Hash: beforeHash}}, AfterFiles: map[string]FileAfterState{"file.rpy": {DisplayPath: "file.rpy", Exists: true, Hash: afterHash}}}
	if err := inst.RollbackJournal(journal); err == nil {
		t.Fatal("expected drift rejection")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "external" {
		t.Fatalf("external content overwritten: %q, %v", data, err)
	}
	if journal.Phase != "prepared" {
		t.Fatal("journal evidence changed")
	}
}
