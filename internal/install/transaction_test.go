package install

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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

func TestTxPhaseTransitions(t *testing.T) {
	j := &TxJournal{
		OperationID: "test_transitions",
		Phase:       TxPhasePlanned,
	}

	// planned -> committed is illegal
	if err := j.TransitionTo(TxPhaseCommitted); err == nil || !IsCode(err, "transaction_invalid_state") {
		t.Fatalf("expected illegal transition from planned to committed, got %v", err)
	}

	// planned -> prepared is legal
	if err := j.TransitionTo(TxPhasePrepared); err != nil {
		t.Fatalf("expected legal transition to prepared, got %v", err)
	}

	// prepared -> applying is legal
	if err := j.TransitionTo(TxPhaseApplying); err != nil {
		t.Fatalf("expected legal transition to applying, got %v", err)
	}

	// applying -> committing is legal
	if err := j.TransitionTo(TxPhaseCommitting); err != nil {
		t.Fatalf("expected legal transition to committing, got %v", err)
	}

	// committing -> committed is legal
	if err := j.TransitionTo(TxPhaseCommitted); err != nil {
		t.Fatalf("expected legal transition to committed, got %v", err)
	}

	// committed is terminal: cannot transition to rolled_back or applying
	if err := j.TransitionTo(TxPhaseRolledBack); err == nil || !IsCode(err, "transaction_invalid_state") {
		t.Fatalf("expected terminal state for committed, got %v", err)
	}
	if err := j.TransitionTo(TxPhaseApplying); err == nil || !IsCode(err, "transaction_invalid_state") {
		t.Fatalf("expected terminal state for committed, got %v", err)
	}

	// rolled_back is also terminal
	j2 := &TxJournal{OperationID: "j2", Phase: TxPhaseRolledBack}
	if err := j2.TransitionTo(TxPhaseApplying); err == nil || !IsCode(err, "transaction_invalid_state") {
		t.Fatalf("expected terminal state for rolled_back, got %v", err)
	}
}

func TestTxFaultInjectionAndRestartRecovery(t *testing.T) {
	faultPoints := []string{
		"after_prepared",
		"after_file_1",
		"after_manifest",
		"after_receipt",
		"before_committed",
	}

	for _, faultPoint := range faultPoints {
		t.Run("RestartRecovery_"+faultPoint, func(t *testing.T) {
			root := t.TempDir()
			stateDir := filepath.Join(t.TempDir(), "state")
			_ = os.MkdirAll(stateDir, 0o755)

			origFile := filepath.Join(root, "game", "mod.rpy")
			_ = os.MkdirAll(filepath.Dir(origFile), 0o755)
			_ = os.WriteFile(origFile, []byte("before-mod"), 0o644)

			receiptPath := filepath.Join(stateDir, "receipt.json")
			_ = os.WriteFile(receiptPath, []byte(`[{"id":"initial"}]`), 0o600)

			manifest := NewManifest()
			_ = manifest.Save(filepath.Join(stateDir, "manifest.json"))

			inst := New(root, stateDir)
			inst.SetCrashWithoutRollback(true)
			inst.faultHook = func(step string) error {
				if step == faultPoint {
					return errors.New("simulated crash at " + step)
				}
				return nil
			}

			blobs := inst.GetBlobs()
			_, _ = blobs.Put([]byte("after-mod"))

			plan, err := PlanInstall(manifest, root, blobs, InstallOperation{
				OperationID:    "op_restart_" + faultPoint,
				InstallationID: "mod1",
				ModID:          "mod1",
				Title:          "Mod 1",
				Files: []PlannedFile{
					{Path: "game/mod.rpy", Content: []byte("after-mod")},
				},
			})
			if err != nil {
				t.Fatal(err)
			}

			tx, err := inst.NewTransaction(plan)
			if err != nil {
				t.Fatal(err)
			}
			tx.SetReceiptUpdate(receiptPath, []byte(`[{"id":"updated"}]`))

			// Execution fails due to fault injection
			err = tx.Execute()
			if err == nil {
				t.Fatalf("expected execution failure at %s", faultPoint)
			}

			// SIMULATE APP RESTART: Instantiate a brand new Installer
			restartedInst := New(root, stateDir)

			// RecoverPending on restart
			if err := restartedInst.RecoverPending(); err != nil {
				t.Fatalf("RecoverPending failed on restart: %v", err)
			}

			// Disk must be back to original
			diskContent, err := os.ReadFile(origFile)
			if err != nil || string(diskContent) != "before-mod" {
				t.Fatalf("disk not restored after restart: %q, err=%v", string(diskContent), err)
			}

			// Receipt must be back to initial
			recContent, _ := os.ReadFile(receiptPath)
			if string(recContent) != `[{"id":"initial"}]` {
				t.Fatalf("receipt not restored: %s", string(recContent))
			}

			// Journal must be rolled_back
			j, err := restartedInst.GetTxJournal("op_restart_" + faultPoint)
			if err != nil {
				t.Fatalf("failed to get journal: %v", err)
			}
			if j.Phase != TxPhaseRolledBack {
				t.Fatalf("journal not rolled_back after restart: %s", j.Phase)
			}
		})
	}
}

func TestTxExternalDriftBlocksRollbackAndEntersManualRecovery(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")

	filePath := filepath.Join(root, "game", "script.rpy")
	_ = os.MkdirAll(filepath.Dir(filePath), 0o755)
	_ = os.WriteFile(filePath, []byte("original content"), 0o644)

	inst := New(root, stateDir)
	blobs := inst.GetBlobs()
	beforeHash, _ := blobs.Put([]byte("original content"))
	afterHash, _ := blobs.Put([]byte("target content"))

	// Create a journal representing an interrupted operation
	j := &TxJournal{
		OperationID: "op_drift_test",
		PlanID:      "plan_drift",
		Phase:       TxPhaseApplying,
		BeforeFiles: map[string]FileBeforeState{
			"game/script.rpy": {DisplayPath: "game/script.rpy", Existed: true, Hash: beforeHash},
		},
		AfterFiles: map[string]FileAfterState{
			"game/script.rpy": {DisplayPath: "game/script.rpy", Exists: true, Hash: afterHash},
		},
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	_ = os.MkdirAll(filepath.Join(stateDir, "journals"), 0o755)
	_ = saveJournalFile(filepath.Join(stateDir, "journals", "op_drift_test.json"), j)

	// User externally modifies the file so it matches NEITHER before nor after
	_ = os.WriteFile(filePath, []byte("external user edits!"), 0o644)

	// RecoverPending must fail with external_change and transition journal to needs_manual_recovery
	err := inst.RecoverPending()
	if err == nil || !IsCode(err, "external_change") {
		t.Fatalf("expected external_change, got %v", err)
	}

	// File on disk must NOT be overwritten!
	diskData, _ := os.ReadFile(filePath)
	if string(diskData) != "external user edits!" {
		t.Fatalf("user edit was overwritten: %q", string(diskData))
	}

	// Journal on disk must have Phase = needs_manual_recovery
	savedJ, err := inst.GetTxJournal("op_drift_test")
	if err != nil {
		t.Fatal(err)
	}
	if savedJ.Phase != TxPhaseNeedsManualRecovery {
		t.Fatalf("expected phase needs_manual_recovery, got %s", savedJ.Phase)
	}
	if savedJ.ErrorCode != "external_change" {
		t.Fatalf("expected ErrorCode external_change, got %s", savedJ.ErrorCode)
	}
}

func TestTxCorruptJournalEntersManualRecovery(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	journalsDir := filepath.Join(stateDir, "journals")
	_ = os.MkdirAll(journalsDir, 0o755)

	// Write invalid JSON
	corruptPath := filepath.Join(journalsDir, "op_corrupt.json")
	_ = os.WriteFile(corruptPath, []byte(`{ not valid json ...`), 0o600)

	inst := New(root, stateDir)
	err := inst.RecoverPending()
	if err == nil || !IsCode(err, "transaction_journal_corrupt") {
		t.Fatalf("expected transaction_journal_corrupt, got %v", err)
	}

	// Corrupt journal should have been updated to needs_manual_recovery
	j, err := inst.GetTxJournal("op_corrupt")
	if err != nil {
		t.Fatal(err)
	}
	if j.Phase != TxPhaseNeedsManualRecovery {
		t.Fatalf("expected phase needs_manual_recovery, got %s", j.Phase)
	}
	if j.ErrorCode != "transaction_journal_corrupt" {
		t.Fatalf("expected error_code transaction_journal_corrupt, got %s", j.ErrorCode)
	}
}

func TestTxMissingBlobBlocksRollbackAndEntersManualRecovery(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")

	filePath := filepath.Join(root, "game", "submod.rpy")
	_ = os.MkdirAll(filepath.Dir(filePath), 0o755)
	_ = os.WriteFile(filePath, []byte("modified by op"), 0o644)

	inst := New(root, stateDir)
	// Missing blob hash (not in blob store)
	missingHash := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

	j := &TxJournal{
		OperationID: "op_missing_blob",
		PlanID:      "plan_1",
		Phase:       TxPhaseApplying,
		BeforeFiles: map[string]FileBeforeState{
			"game/submod.rpy": {DisplayPath: "game/submod.rpy", Existed: true, Hash: missingHash},
		},
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	_ = os.MkdirAll(filepath.Join(stateDir, "journals"), 0o755)
	_ = saveJournalFile(filepath.Join(stateDir, "journals", "op_missing_blob.json"), j)

	err := inst.RecoverPending()
	if err == nil || !IsCode(err, "transaction_missing_blob") {
		t.Fatalf("expected transaction_missing_blob, got %v", err)
	}

	// Disk file was not modified/deleted
	diskData, _ := os.ReadFile(filePath)
	if string(diskData) != "modified by op" {
		t.Fatalf("disk was unexpectedly altered: %s", string(diskData))
	}

	savedJ, err := inst.GetTxJournal("op_missing_blob")
	if err != nil {
		t.Fatal(err)
	}
	if savedJ.Phase != TxPhaseNeedsManualRecovery {
		t.Fatalf("expected phase needs_manual_recovery, got %s", savedJ.Phase)
	}
}

func TestTxRollbackIdempotent(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)

	j := &TxJournal{
		OperationID: "op_idempotent",
		Phase:       TxPhaseRolledBack,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	_ = os.MkdirAll(filepath.Join(stateDir, "journals"), 0o755)
	_ = saveJournalFile(filepath.Join(stateDir, "journals", "op_idempotent.json"), j)

	// Rolling back an already rolled-back journal returns nil
	if err := inst.RollbackJournal(j); err != nil {
		t.Fatalf("expected nil for idempotent rollback, got %v", err)
	}
	if err := inst.Rollback("op_idempotent"); err != nil {
		t.Fatalf("expected nil from Rollback(id), got %v", err)
	}
	if err := inst.Recover("op_idempotent"); err != nil {
		t.Fatalf("expected nil from Recover(id), got %v", err)
	}
}

func TestTxRollbackRejectsCommitted(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)

	j := &TxJournal{
		OperationID: "op_committed",
		Phase:       TxPhaseCommitted,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	_ = os.MkdirAll(filepath.Join(stateDir, "journals"), 0o755)
	_ = saveJournalFile(filepath.Join(stateDir, "journals", "op_committed.json"), j)

	err := inst.Rollback("op_committed")
	if err == nil || !IsCode(err, "transaction_invalid_state") {
		t.Fatalf("expected transaction_invalid_state on committed op, got %v", err)
	}
}

func TestTxCorruptedJournalPreservedAndRollbackCannotDeleteManifest(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	journalsDir := filepath.Join(stateDir, "journals")
	_ = os.MkdirAll(journalsDir, 0o755)

	// Create pre-existing manifest with real content
	manifestPath := filepath.Join(stateDir, "manifest.json")
	initialManifestContent := []byte(`{"version":1,"installations":{"inst_1":{"mod_id":"existing_mod"}}}`)
	if err := os.WriteFile(manifestPath, initialManifestContent, 0o644); err != nil {
		t.Fatal(err)
	}

	// Write invalid/corrupt journal file
	corruptRaw := []byte(`{ not valid json content at all ...`)
	corruptPath := filepath.Join(journalsDir, "op_corrupted.json")
	if err := os.WriteFile(corruptPath, corruptRaw, 0o600); err != nil {
		t.Fatal(err)
	}

	inst := New(root, stateDir)

	// 1. RecoverPending() must return transaction_journal_corrupt
	err := inst.RecoverPending()
	if err == nil || !IsCode(err, "transaction_journal_corrupt") {
		t.Fatalf("expected transaction_journal_corrupt, got %v", err)
	}

	// 2. The raw corrupted file MUST NOT be overwritten
	rawAfterRecover, err := os.ReadFile(corruptPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(rawAfterRecover) != string(corruptRaw) {
		t.Fatalf("corrupted journal was overwritten: got %q, want %q", string(rawAfterRecover), string(corruptRaw))
	}

	// 3. Diagnostics record must be created separately
	diagPath := filepath.Join(stateDir, "diagnostics", "op_corrupted.json")
	if _, err := os.Stat(diagPath); err != nil {
		t.Fatalf("expected diagnostic file to exist at %s, got: %v", diagPath, err)
	}

	// 4. Attempting rollback on corrupt journal MUST fail and not touch manifest
	rbErr := inst.Rollback("op_corrupted")
	if rbErr == nil || !IsCode(rbErr, "transaction_journal_corrupt") {
		t.Fatalf("expected rollback to fail on corrupt journal with transaction_journal_corrupt, got: %v", rbErr)
	}

	// 5. Manifest MUST NOT be deleted or modified
	manifestAfterRb, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("manifest was deleted or inaccessible: %v", err)
	}
	if string(manifestAfterRb) != string(initialManifestContent) {
		t.Fatalf("manifest content changed! got %q, want %q", string(manifestAfterRb), string(initialManifestContent))
	}

	// 6. Calling RecoverPending() again MUST continue to fail and block
	errAgain := inst.RecoverPending()
	if errAgain == nil || !IsCode(errAgain, "transaction_journal_corrupt") {
		t.Fatalf("expected RecoverPending to continue blocking with transaction_journal_corrupt, got %v", errAgain)
	}
}

func TestTxBeforeBlobSyncFailureAbortsPreparation(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")

	// Pre-create a file on disk
	gameDir := filepath.Join(root, "game")
	_ = os.MkdirAll(gameDir, 0o755)
	initialContent := "original mod file content before update"
	filePath := filepath.Join(gameDir, "script.rpy")
	if err := os.WriteFile(filePath, []byte(initialContent), 0o644); err != nil {
		t.Fatal(err)
	}

	inst := New(root, stateDir)
	manifest := NewManifest()
	blobs := inst.GetBlobs()

	newContent := []byte("new content to install")
	_, _ = blobs.Put(newContent)

	plan, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID: "op_sync_fail",
		Files: []PlannedFile{
			{Path: "game/script.rpy", Content: newContent},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Inject sync failure on blob store (fails when snapshotting before-image)
	inst.SetBlobSyncHook(func() error {
		return errors.New("simulated disk flush failure")
	})

	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatalf("failed to create transaction context: %v", err)
	}
	defer tx.Close()

	// Execute should fail during before-image snapshotting before entering prepared state
	execErr := tx.Execute()
	if execErr == nil || !strings.Contains(execErr.Error(), "simulated disk flush failure") {
		t.Fatalf("expected blob sync failure error, got: %v", execErr)
	}

	// Verify target file on disk was NEVER modified
	diskContent, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(diskContent) != initialContent {
		t.Fatalf("disk file was modified despite blob sync failure: got %q, want %q", string(diskContent), initialContent)
	}

	// Verify no journal was saved in prepared phase
	journalPath := filepath.Join(stateDir, "journals", "op_sync_fail.json")
	if _, err := os.Stat(journalPath); !os.IsNotExist(err) {
		t.Fatalf("journal should not have been saved in prepared phase, but exists at %s", journalPath)
	}
}

func TestTxLegacyJournalRollbackPreservesManifest(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	journalsDir := filepath.Join(stateDir, "journals")
	_ = os.MkdirAll(journalsDir, 0o755)

	inst := New(root, stateDir)

	oldManifestData := []byte(`{"generation": 1, "installations": {}}`)
	manifestPath := filepath.Join(stateDir, "manifest.json")
	_ = os.WriteFile(manifestPath, []byte(`{"generation": 2, "installations": {"mod1": {}}}`), 0o644)

	// Simulate legacy journal serialized without old_manifest_existed field
	legacyJSON := fmt.Sprintf(`{
		"operation_id": "op_legacy",
		"plan_id": "plan_legacy",
		"phase": "committing",
		"old_manifest": %q,
		"before_files": {},
		"after_files": {}
	}`, base64.StdEncoding.EncodeToString(oldManifestData))

	var j TxJournal
	if err := json.Unmarshal([]byte(legacyJSON), &j); err != nil {
		t.Fatal(err)
	}
	if j.OldManifestExisted {
		t.Fatal("expected OldManifestExisted to be false on legacy journal deserialization")
	}

	if err := inst.RollbackJournal(&j); err != nil {
		t.Fatalf("RollbackJournal failed: %v", err)
	}

	// Manifest must NOT have been deleted; it must have been restored to oldManifestData
	curManifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("expected manifest.json to exist after rollback, got: %v", err)
	}
	if string(curManifest) != string(oldManifestData) {
		t.Fatalf("manifest data mismatch: got %q, want %q", string(curManifest), string(oldManifestData))
	}
}

func TestTxPostManualRecoveryRollbackCleansUpMetadata(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	journalsDir := filepath.Join(stateDir, "journals")
	receiptPath := filepath.Join(stateDir, "receipts.json")
	_ = os.MkdirAll(journalsDir, 0o755)

	inst := New(root, stateDir)
	blobs := inst.GetBlobs()

	filePath := filepath.Join(root, "game", "mod.rpy")
	_ = os.MkdirAll(filepath.Dir(filePath), 0o755)
	fileContent := []byte("mod content")
	fileHash, _ := blobs.Put(fileContent)
	_ = os.WriteFile(filePath, fileContent, 0o644)

	manifestPath := filepath.Join(stateDir, "manifest.json")
	_ = os.WriteFile(manifestPath, []byte(`{"generation": 1}`), 0o644)
	_ = os.WriteFile(receiptPath, []byte(`[{"mod_id": "mod1"}]`), 0o600)

	// Journal representing a first install: manifest and receipt did NOT exist originally
	// Crash occurred at committing phase, and it entered needs_manual_recovery
	j := &TxJournal{
		OperationID:        "op_manual_rollback",
		PlanID:             "plan_1",
		Phase:              TxPhaseNeedsManualRecovery,
		OldManifestExisted: false,
		OldManifest:        nil,
		ReceiptPath:        receiptPath,
		OldReceiptExisted:  false,
		OldReceipt:         nil,
		BeforeFiles: map[string]FileBeforeState{
			"game/mod.rpy": {DisplayPath: "game/mod.rpy", Existed: false},
		},
		AfterFiles: map[string]FileAfterState{
			"game/mod.rpy": {DisplayPath: "game/mod.rpy", Exists: true, Hash: fileHash},
		},
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	_ = saveJournalFile(filepath.Join(journalsDir, "op_manual_rollback.json"), j)

	// User resolves decision and executes rollback
	if err := inst.RollbackJournal(j); err != nil {
		t.Fatalf("RollbackJournal failed: %v", err)
	}

	// 1. Target disk file should be removed
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed, but still exists", filePath)
	}

	// 2. Newly created manifest should be removed (not left behind)
	if _, err := os.Stat(manifestPath); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed after rollback, but still exists", manifestPath)
	}

	// 3. Newly created receipt should be removed (not left behind)
	if _, err := os.Stat(receiptPath); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed after rollback, but still exists", receiptPath)
	}

	// 4. Journal phase must be rolled_back
	if j.Phase != TxPhaseRolledBack {
		t.Fatalf("expected journal phase rolled_back, got: %s", j.Phase)
	}
}

func TestDecideRecoveryRechecksDiskAfterManualResolution(t *testing.T) {
	tempDir := t.TempDir()
	root := filepath.Join(tempDir, "mas")
	stateDir := filepath.Join(tempDir, "state")
	journalsDir := filepath.Join(stateDir, "journals")
	_ = os.MkdirAll(filepath.Join(root, "game"), 0o755)
	_ = os.MkdirAll(journalsDir, 0o755)

	blobs := NewBlobStore(filepath.Join(stateDir, "blobs"))
	inst := New(root, stateDir)

	origContent := []byte("original game code")
	origHash, _ := blobs.Put(origContent)
	filePath := filepath.Join(root, "game", "script.rpy")
	_ = os.WriteFile(filePath, []byte("externally drifted code"), 0o644)

	j := &TxJournal{
		OperationID: "op_recheck",
		PlanID:      "plan_recheck",
		Phase:       TxPhaseNeedsManualRecovery,
		BeforeFiles: map[string]FileBeforeState{
			"game/script.rpy": {DisplayPath: "game/script.rpy", Existed: true, Hash: origHash},
		},
		AfterFiles: map[string]FileAfterState{
			"game/script.rpy": {DisplayPath: "game/script.rpy", Exists: true, Hash: "mod_hash_xxx"},
		},
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	_ = saveJournalFile(filepath.Join(journalsDir, "op_recheck.json"), j)

	// 1. While conflict exists on disk, DecideRecovery must detect it and return manual_required
	action, err := inst.DecideRecovery(j)
	if action != RecoveryActionManualRequired {
		t.Fatalf("expected action manual_required while conflicted, got: %s", action)
	}
	if err == nil || !IsCode(err, "external_change") {
		t.Fatalf("expected external_change error, got: %v", err)
	}

	// 2. Pending recovery should also report error while conflict persists
	if recErr := inst.RecoverPending(); recErr == nil {
		t.Fatal("expected RecoverPending to fail while conflict persists")
	}

	// 3. User manually resolves conflict by restoring disk file to original state
	if err := os.WriteFile(filePath, origContent, 0o644); err != nil {
		t.Fatal(err)
	}

	// 4. DecideRecovery must re-check disk and return rollback
	action, err = inst.DecideRecovery(j)
	if action != RecoveryActionRollback {
		t.Fatalf("expected action rollback after conflict resolution, got: %s (err: %v)", action, err)
	}
	if err != nil {
		t.Fatalf("expected nil error after conflict resolution, got: %v", err)
	}

	// 5. RecoverPending should now safely roll back the transaction
	if err := inst.RecoverPending(); err != nil {
		t.Fatalf("expected RecoverPending to succeed after conflict resolution, got: %v", err)
	}

	savedJ, err := inst.GetTxJournal("op_recheck")
	if err != nil {
		t.Fatalf("failed to get journal: %v", err)
	}
	if savedJ.Phase != TxPhaseRolledBack {
		t.Fatalf("expected journal to be rolled_back, got: %s", savedJ.Phase)
	}
}

func TestDecideRecoveryBlocksCorruptJournal(t *testing.T) {
	tempDir := t.TempDir()
	root := filepath.Join(tempDir, "mas")
	stateDir := filepath.Join(tempDir, "state")
	inst := New(root, stateDir)

	// Incomplete recovery material (BeforeFiles is nil)
	jIncomplete := &TxJournal{
		OperationID: "op_corrupt",
		Phase:       TxPhaseNeedsManualRecovery,
		ErrorCode:   "transaction_recovery_incomplete",
		BeforeFiles: nil,
	}
	action, err := inst.DecideRecovery(jIncomplete)
	if action != RecoveryActionManualRequired {
		t.Fatalf("expected manual_required for corrupt journal, got: %s", action)
	}
	if err == nil {
		t.Fatal("expected error for corrupt journal")
	}
	if jIncomplete.HasRecoveryMaterial() {
		t.Fatal("expected HasRecoveryMaterial to be false for incomplete journal")
	}
}

func TestTransaction_Commit_RejectsSymlinkAncestorEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	stateDir := filepath.Join(root, ".submodhub")
	inst := New(root, stateDir)

	outsideSecret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideSecret, []byte("outside_original"), 0o644); err != nil {
		t.Fatal(err)
	}

	symlinkDir := filepath.Join(root, "game", "Submods", "escape_dir")
	if err := os.MkdirAll(filepath.Dir(symlinkDir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, symlinkDir); err != nil {
		t.Skip("Symlinks not supported in current environment:", err)
		return
	}

	hashTarget, err := inst.blobs.Put([]byte("malicious_write"))
	if err != nil {
		t.Fatal(err)
	}

	plan := &Plan{
		PlanID:      "plan_symlink_commit",
		OperationID: "op_symlink_commit",
		Generation:  1,
		Actions: []PlanAction{
			{
				Path:         "game/Submods/escape_dir/secret.txt",
				Key:          "game/submods/escape_dir/secret.txt",
				Action:       ActionWrite,
				TargetHash:   hashTarget,
				TargetExists: true,
			},
		},
		NewManifest: NewManifest(),
	}

	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatalf("NewTransaction failed: %v", err)
	}

	err = tx.Execute()
	if err == nil {
		t.Fatal("expected Execute to fail due to symlink ancestor escape, got nil")
	}
	if !strings.Contains(err.Error(), "symlink_target_out_of_bounds") {
		t.Fatalf("expected symlink_target_out_of_bounds error, got: %v", err)
	}

	// Verify outside file was NOT overwritten
	content, _ := os.ReadFile(outsideSecret)
	if string(content) != "outside_original" {
		t.Fatalf("outside file was modified: %s", string(content))
	}
}

func TestTransaction_RollbackAndRecover_RejectsSymlinkAncestorEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	stateDir := filepath.Join(root, ".submodhub")
	inst := New(root, stateDir)

	outsideSecret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideSecret, []byte("outside_original"), 0o644); err != nil {
		t.Fatal(err)
	}

	symlinkDir := filepath.Join(root, "game", "Submods", "escape_dir")
	if err := os.MkdirAll(filepath.Dir(symlinkDir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, symlinkDir); err != nil {
		t.Skip("Symlinks not supported in current environment:", err)
		return
	}

	blobHash, err := inst.blobs.Put([]byte("rollback_data"))
	if err != nil {
		t.Fatal(err)
	}

	journal := &TxJournal{
		OperationID: "op_symlink_recovery",
		PlanID:      "plan_symlink_recovery",
		Phase:       TxPhaseApplying,
		BeforeFiles: map[string]FileBeforeState{
			"game/submods/escape_dir/secret.txt": {
				DisplayPath: "game/Submods/escape_dir/secret.txt",
				Existed:     true,
				Hash:        blobHash,
			},
		},
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	txDir := filepath.Join(stateDir, "journals")
	_ = os.MkdirAll(txDir, 0o755)
	if err := saveJournalFile(filepath.Join(txDir, "op_symlink_recovery.json"), journal); err != nil {
		t.Fatal(err)
	}

	// 1. DecideRecovery should fail / require manual recovery due to symlink escape
	action, recErr := inst.DecideRecovery(journal)
	if action != RecoveryActionManualRequired {
		t.Fatalf("expected RecoveryActionManualRequired, got: %s (err: %v)", action, recErr)
	}
	if recErr == nil || !strings.Contains(recErr.Error(), "symlink_target_out_of_bounds") {
		t.Fatalf("expected symlink_target_out_of_bounds in DecideRecovery, got: %v", recErr)
	}

	// 2. Rollback should fail and not touch outside directory
	rbErr := inst.Rollback("op_symlink_recovery")
	if rbErr == nil || !strings.Contains(rbErr.Error(), "symlink_target_out_of_bounds") {
		t.Fatalf("expected symlink_target_out_of_bounds in Rollback, got: %v", rbErr)
	}

	content, _ := os.ReadFile(outsideSecret)
	if string(content) != "outside_original" {
		t.Fatalf("outside file was modified: %s", string(content))
	}
}
