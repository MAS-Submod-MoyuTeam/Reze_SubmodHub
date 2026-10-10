package install

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestTransactionRollbackOnFaultInjection(t *testing.T) {
	steps := []string{
		"after_prepared",
		"after_file_1",
		"after_manifest",
		"before_committed",
	}

	for _, faultStep := range steps {
		t.Run("Fault_"+faultStep, func(t *testing.T) {
			root := t.TempDir()
			stateDir := filepath.Join(t.TempDir(), "state")

			origFile := filepath.Join(root, "game", "original.txt")
			_ = os.MkdirAll(filepath.Dir(origFile), 0o755)
			_ = os.WriteFile(origFile, []byte("orig content"), 0o644)

			installer := New(root, stateDir)

			// Set fault injection
			installer.faultHook = func(step string) error {
				if step == faultStep {
					return errors.New("simulated crash at " + step)
				}
				return nil
			}

			newFile := filepath.Join(root, "game", "new.txt")
			err := installer.Apply(Operation{
				ID: "faulty_op",
				Changes: []Change{
					{Path: "game/original.txt", Content: []byte("overwritten")},
					{Path: "game/new.txt", Content: []byte("new file")},
				},
			})
			if err == nil {
				t.Fatalf("expected error from fault injection %s, got nil", faultStep)
			}

			// Perform recovery
			if err := installer.RecoverPending(); err != nil {
				t.Fatalf("RecoverPending failed: %v", err)
			}

			// Original file must be restored
			origGot, err := os.ReadFile(origFile)
			if err != nil || string(origGot) != "orig content" {
				t.Fatalf("origFile not restored: got %q, err=%v", origGot, err)
			}

			// Newly added file must be deleted
			if _, err := os.Stat(newFile); !os.IsNotExist(err) {
				t.Fatalf("new file was not removed during rollback: %v", err)
			}
		})
	}
}

func TestTransactionDuplicateOperationIDRejected(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	installer := New(root, stateDir)

	op := Operation{
		ID: "op_duplicate",
		Changes: []Change{
			{Path: "game/test.txt", Content: []byte("hello")},
		},
	}
	if err := installer.Apply(op); err != nil {
		t.Fatal(err)
	}

	// Try applying same op ID again
	err := installer.Apply(op)
	if err == nil || !IsCode(err, "operation_id_conflict") {
		t.Fatalf("expected operation_id_conflict, got %v", err)
	}
}

func TestTransactionMultiProcessLocking(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst1 := New(root, stateDir)
	inst2 := New(root, stateDir)

	lock, err := inst1.acquireLock()
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()

	// inst2 attempting to acquire lock must fail with instance_busy
	_, err = inst2.acquireLock()
	if err == nil || !IsCode(err, "instance_busy") {
		t.Fatalf("expected instance_busy error, got %v", err)
	}
}

func TestTransactionRevalidatesDiskDriftInsideLock(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)

	origFile := filepath.Join(root, "game", "drift_target.txt")
	_ = os.MkdirAll(filepath.Dir(origFile), 0o755)
	_ = os.WriteFile(origFile, []byte("initial"), 0o644)

	manifest := NewManifest()
	blobs := inst.GetBlobs()
	_, _ = blobs.Put([]byte("new content"))

	plan, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID: "op_drift_test",
		Files: []PlannedFile{
			{Path: "game/drift_target.txt", Content: []byte("new content")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatal(err)
	}

	// External modification on disk AFTER plan was created
	_ = os.WriteFile(origFile, []byte("user edited behind our back"), 0o644)

	// Execute must fail with external_change!
	err = tx.Execute()
	if err == nil || !IsCode(err, "external_change") {
		t.Fatalf("expected external_change error, got %v", err)
	}

	// Disk must NOT be overwritten with "new content"
	got, _ := os.ReadFile(origFile)
	if string(got) != "user edited behind our back" {
		t.Fatalf("user edit was overwritten: %q", got)
	}
}

func TestTransactionRevalidatesGenerationInsideLock(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)

	manifest := NewManifest()
	manifest.Generation = 1
	_ = manifest.Save(filepath.Join(stateDir, "manifest.json"))

	blobs := inst.GetBlobs()
	_, _ = blobs.Put([]byte("content"))

	plan, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID: "op_gen_test",
		Files: []PlannedFile{
			{Path: "game/gen_test.txt", Content: []byte("content")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Another operation updates manifest generation to 2 on disk
	manifest2 := manifest.Clone()
	manifest2.Generation = 2
	_ = manifest2.Save(filepath.Join(stateDir, "manifest.json"))

	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatal(err)
	}

	err = tx.Execute()
	if err == nil || !IsCode(err, "plan_stale") {
		t.Fatalf("expected plan_stale error, got %v", err)
	}
}

func TestAtomicInstanceLockStalePIDCleaned(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	_ = os.MkdirAll(stateDir, 0o755)

	lockFile := filepath.Join(stateDir, "lock")
	// Non-existent PID
	_ = os.WriteFile(lockFile, []byte("9999999\n"), 0o600)

	inst := New(root, stateDir)
	lock, err := inst.acquireLock()
	if err != nil {
		t.Fatalf("failed to acquire lock with dead PID: %v", err)
	}
	defer lock.Release()

	// Verify lock file now contains current process PID
	b, _ := os.ReadFile(lockFile)
	if !strings.Contains(string(b), strconv.Itoa(os.Getpid())) {
		t.Fatalf("lock file did not update to current pid: %s", string(b))
	}
}

func TestRollbackReceiptFailureNotMarkedRolledBack(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)

	// Create a directory where receipt file should be, causing os.WriteFile to fail
	receiptDir := filepath.Join(t.TempDir(), "receipt_dir")
	_ = os.MkdirAll(receiptDir, 0o755)

	j := TxJournal{
		OperationID: "op_receipt_fail",
		PlanID:      "plan_1",
		Phase:       "prepared",
		ReceiptPath: receiptDir,
		OldReceipt:  []byte(`{"test":1}`),
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	_ = os.MkdirAll(filepath.Join(stateDir, "journals"), 0o755)
	_ = saveJournalFile(filepath.Join(stateDir, "journals", "op_receipt_fail.json"), &j)

	err := inst.RollbackJournal(&j)
	if err == nil {
		t.Fatal("expected RollbackJournal to fail on unwriteable receipt")
	}

	if j.Phase == "rolled_back" {
		t.Fatal("journal was incorrectly marked rolled_back despite receipt failure")
	}

	savedBytes, rerr := os.ReadFile(filepath.Join(stateDir, "journals", "op_receipt_fail.json"))
	if rerr != nil {
		t.Fatal(rerr)
	}
	var savedJ TxJournal
	_ = json.Unmarshal(savedBytes, &savedJ)
	if savedJ.Phase == "rolled_back" {
		t.Fatal("saved journal on disk was marked rolled_back despite failure")
	}
}

func TestTransactionRollbackInsideLockOnExecuteFailure(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	origFile := filepath.Join(root, "game", "mod.rpy")
	_ = os.MkdirAll(filepath.Dir(origFile), 0o755)
	_ = os.WriteFile(origFile, []byte("original"), 0o644)

	inst := New(root, stateDir)
	inst.faultHook = func(step string) error {
		if step == "after_manifest" {
			return errors.New("simulated crash after manifest")
		}
		return nil
	}

	blobs := inst.GetBlobs()
	_, _ = blobs.Put([]byte("new content"))

	manifest := NewManifest()
	_ = manifest.Save(filepath.Join(stateDir, "manifest.json"))

	plan, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_fail_inside_lock",
		InstallationID: "mod1",
		ModID:          "mod1",
		Files: []PlannedFile{
			{Path: "game/mod.rpy", Content: []byte("new content")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatal(err)
	}

	err = tx.Execute()
	if err == nil {
		t.Fatal("expected Execute to fail")
	}

	// Disk file MUST be rolled back immediately without calling RecoverPending
	got, _ := os.ReadFile(origFile)
	if string(got) != "original" {
		t.Fatalf("expected original content, got %s", got)
	}

	// Journal MUST be marked rolled_back
	savedBytes, _ := os.ReadFile(filepath.Join(stateDir, "journals", "op_fail_inside_lock.json"))
	var savedJ TxJournal
	_ = json.Unmarshal(savedBytes, &savedJ)
	if savedJ.Phase != "rolled_back" {
		t.Fatalf("journal was not rolled_back in lock: phase=%s", savedJ.Phase)
	}

	// Lock MUST be released (subsequent transaction succeeds)
	plan2, _ := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_next",
		InstallationID: "mod1",
		ModID:          "mod1",
		Files: []PlannedFile{
			{Path: "game/mod.rpy", Content: []byte("new content")},
		},
	})
	inst.faultHook = nil
	tx2, err := inst.NewTransaction(plan2)
	if err != nil {
		t.Fatalf("subsequent transaction failed: %v", err)
	}
	defer tx2.Close()
	if err := tx2.Execute(); err != nil {
		t.Fatalf("subsequent execute failed: %v", err)
	}
}
