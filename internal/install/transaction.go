package install

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	TxPhasePlanned             = "planned"
	TxPhasePrepared            = "prepared"
	TxPhaseApplying            = "applying"
	TxPhaseCommitting          = "committing"
	TxPhaseCommitted           = "committed"
	TxPhaseRolledBack          = "rolled_back"
	TxPhaseNeedsManualRecovery = "needs_manual_recovery"
)

func IsValidPhaseTransition(from, to string) bool {
	switch from {
	case TxPhasePlanned:
		return to == TxPhasePrepared || to == TxPhaseRolledBack || to == TxPhaseNeedsManualRecovery
	case TxPhasePrepared:
		return to == TxPhaseApplying || to == TxPhaseCommitting || to == TxPhaseRolledBack || to == TxPhaseNeedsManualRecovery
	case TxPhaseApplying:
		return to == TxPhaseApplying || to == TxPhaseCommitting || to == TxPhaseRolledBack || to == TxPhaseNeedsManualRecovery
	case TxPhaseCommitting:
		return to == TxPhaseCommitted || to == TxPhaseRolledBack || to == TxPhaseNeedsManualRecovery
	case TxPhaseNeedsManualRecovery:
		return to == TxPhaseRolledBack || to == TxPhaseNeedsManualRecovery
	case TxPhaseCommitted, TxPhaseRolledBack:
		return false
	default:
		return false
	}
}

type FileBeforeState struct {
	DisplayPath string `json:"display_path"`
	Existed     bool   `json:"existed"`
	Hash        string `json:"hash,omitempty"`
	Mode        uint32 `json:"mode,omitempty"`
}

type FileAfterState struct {
	DisplayPath string `json:"display_path"`
	Exists      bool   `json:"exists"`
	Hash        string `json:"hash,omitempty"`
	Mode        uint32 `json:"mode,omitempty"`
}

type TxJournal struct {
	OperationID          string                     `json:"operation_id"`
	PlanID               string                     `json:"plan_id"`
	Phase                string                     `json:"phase"`
	Kind                 string                     `json:"kind,omitempty"`
	TargetInstallationID string                     `json:"target_installation_id,omitempty"`
	ModID                string                     `json:"mod_id,omitempty"`
	ModTitle             string                     `json:"mod_title,omitempty"`
	VersionID            string                     `json:"version_id,omitempty"`
	Version              string                     `json:"version,omitempty"`
	CurrentStep          int                        `json:"current_step,omitempty"`
	TotalSteps           int                        `json:"total_steps,omitempty"`
	LastPath             string                     `json:"last_path,omitempty"`
	ErrorCode            string                     `json:"error_code,omitempty"`
	ErrorMessage         string                     `json:"error_message,omitempty"`
	ExpectedHash         string                     `json:"expected_hash,omitempty"`
	ActualHash           string                     `json:"actual_hash,omitempty"`
	BeforeFiles          map[string]FileBeforeState `json:"before_files"` // key -> state
	AfterFiles           map[string]FileAfterState  `json:"after_files"`
	OldManifestExisted   bool                       `json:"old_manifest_existed,omitempty"`
	OldManifest          []byte                     `json:"old_manifest,omitempty"`
	ReceiptPath          string                     `json:"receipt_path,omitempty"`
	OldReceiptExisted    bool                       `json:"old_receipt_existed,omitempty"`
	OldReceipt           []byte                     `json:"old_receipt,omitempty"`
	SpriteSetIDs         []string                   `json:"sprite_set_ids,omitempty"`
	SpriteSelectionHash  string                     `json:"sprite_selection_hash,omitempty"`
	SelectedSpriteSetCount int                      `json:"selected_sprite_set_count,omitempty"`
	CreatedAt            time.Time                  `json:"created_at"`
	UpdatedAt            time.Time                  `json:"updated_at"`
}

// HasRecoveryMaterial reports whether the journal contains valid and complete metadata required for rollback.
func (j *TxJournal) HasRecoveryMaterial() bool {
	if j == nil {
		return false
	}
	if j.ErrorCode == "transaction_journal_corrupt" || j.ErrorCode == "transaction_recovery_incomplete" {
		return false
	}
	if j.BeforeFiles == nil {
		return false
	}
	if j.OldManifestExisted && len(j.OldManifest) == 0 {
		return false
	}
	if j.ReceiptPath != "" && j.OldReceiptExisted && len(j.OldReceipt) == 0 {
		return false
	}
	return true
}

type TxDiagnostic struct {
	OperationID  string    `json:"operation_id"`
	ErrorCode    string    `json:"error_code"`
	ErrorMessage string    `json:"error_message"`
	RawPath      string    `json:"raw_path"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (j *TxJournal) TransitionTo(to string) error {
	if !IsValidPhaseTransition(j.Phase, to) {
		return &Error{
			Code:        "transaction_invalid_state",
			OperationID: j.OperationID,
			Err:         fmt.Errorf("illegal phase transition from %q to %q", j.Phase, to),
		}
	}
	j.Phase = to
	j.UpdatedAt = time.Now().UTC()
	return nil
}

type InstanceLock struct {
	key  string
	path string
	file *os.File
}

var (
	processLockMutex sync.Mutex
	activeLocks      = make(map[string]*InstanceLock)
)

func acquireInstanceLock(stateDir string) (*InstanceLock, error) {
	cleanDir := filepath.Clean(stateDir)
	lockFile := filepath.Join(cleanDir, "lock")
	lock, err := acquireInstanceLockPath(lockFile)
	if err != nil {
		if e, ok := err.(*Error); ok && e.Path == lockFile {
			e.Path = stateDir
		}
		return nil, err
	}
	return lock, nil
}

func acquireInstanceLockPath(lockFile string) (*InstanceLock, error) {
	processLockMutex.Lock()
	defer processLockMutex.Unlock()

	cleanPath := filepath.Clean(lockFile)
	if _, exists := activeLocks[cleanPath]; exists {
		return nil, &Error{Code: "instance_busy", Path: cleanPath, Err: errors.New("instance locked in current process")}
	}

	dir := filepath.Dir(cleanPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}

	f, err := os.OpenFile(cleanPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}

	if err := lockOSFile(f); err != nil {
		_ = f.Close()
		if errors.Is(err, errLockBusy) {
			return nil, &Error{Code: "instance_busy", Path: cleanPath, Err: errors.New("instance locked by another process")}
		}
		return nil, err
	}

	// Stamp PID in lock file for diagnostic inspection
	_ = f.Truncate(0)
	_, _ = f.Seek(0, 0)
	_, _ = f.WriteString(fmt.Sprintf("%d\n", os.Getpid()))
	_ = f.Sync()

	lock := &InstanceLock{
		key:  cleanPath,
		path: cleanPath,
		file: f,
	}
	activeLocks[cleanPath] = lock
	return lock, nil
}

func (l *InstanceLock) Release() {
	if l == nil {
		return
	}
	processLockMutex.Lock()
	defer processLockMutex.Unlock()

	if l.key != "" {
		delete(activeLocks, l.key)
	} else if l.path != "" {
		delete(activeLocks, filepath.Clean(l.path))
		delete(activeLocks, filepath.Dir(l.path))
	}

	if l.file != nil {
		_ = unlockOSFile(l.file)
		_ = l.file.Close()
		l.file = nil
	}
}

// TransactionContext coordinates executing a Plan with full ACID guarantees.
type TransactionContext struct {
	installer      *Installer
	plan           *Plan
	lock           *InstanceLock
	journal        *TxJournal
	receiptPath    string
	newReceiptData []byte
}

func (tx *TransactionContext) SetReceiptUpdate(path string, data []byte) {
	tx.receiptPath = path
	tx.newReceiptData = data
}

func (tx *TransactionContext) Close() {
	if tx == nil {
		return
	}
	if tx.lock != nil {
		tx.lock.Release()
		tx.lock = nil
	}
}

func (i *Installer) NewTransaction(plan *Plan) (*TransactionContext, error) {
	if len(plan.Blockers) > 0 {
		return nil, &Error{Code: "plan_blocked", Err: fmt.Errorf("plan has blockers: %s", strings.Join(plan.Blockers, "; "))}
	}

	lock, err := i.acquireLock()
	if err != nil {
		return nil, err
	}

	// Recover any pending uncommitted journals under the lock before proceeding
	if err := i.recoverPendingLocked(); err != nil {
		lock.Release()
		return nil, &Error{Code: "recovery_required", Err: fmt.Errorf("pending transaction recovery failed: %w", err)}
	}

	tx := &TransactionContext{
		installer: i,
		plan:      plan,
		lock:      lock,
	}
	return tx, nil
}

func (tx *TransactionContext) Execute() error {
	defer tx.Close()

	inst := tx.installer
	stateDir := inst.state
	journalsDir := filepath.Join(stateDir, "journals")
	if err := os.MkdirAll(journalsDir, 0o755); err != nil {
		return err
	}

	journalPath := filepath.Join(journalsDir, tx.plan.OperationID+".json")
	if _, err := os.Stat(journalPath); err == nil {
		return &Error{Code: "operation_id_conflict", OperationID: tx.plan.OperationID, Err: fmt.Errorf("operation %s already exists", tx.plan.OperationID)}
	}

	// 1. Re-validate plan under lock: check generation and disk state
	manifestPath := filepath.Join(stateDir, "manifest.json")
	curManifest, err := LoadManifest(manifestPath)
	if err != nil {
		return err
	}
	if curManifest.Generation != tx.plan.Generation {
		return &Error{
			Code:        "plan_stale",
			OperationID: tx.plan.OperationID,
			Err:         fmt.Errorf("manifest generation changed since plan: plan=%d current=%d", tx.plan.Generation, curManifest.Generation),
		}
	}

	for _, act := range tx.plan.Actions {
		diskPath, err := SafeJoinAndValidateBounds(inst.root, act.Path)
		if err != nil {
			return err
		}
		diskHash, hErr := fileHash(diskPath)
		if hErr != nil && !os.IsNotExist(hErr) {
			return &Error{Code: "disk_read_error", OperationID: tx.plan.OperationID, Path: act.Path, Err: hErr}
		}
		diskExists := diskHash != ""
		if diskExists != act.CurrentExists || diskHash != act.CurrentHash {
			return &Error{
				Code:         "external_change",
				OperationID:  tx.plan.OperationID,
				Path:         act.Path,
				ExpectedHash: act.CurrentHash,
				ActualHash:   diskHash,
				Err:          fmt.Errorf("disk modified since plan: was %s (exists=%v), now %s (exists=%v)", act.CurrentHash, act.CurrentExists, diskHash, diskExists),
			}
		}
	}

	// Read old manifest bytes for undo
	oldManifestBytes, mErr := os.ReadFile(manifestPath)
	oldManifestExisted := mErr == nil

	var oldReceiptBytes []byte
	oldReceiptExisted := false
	if tx.receiptPath != "" {
		var rErr error
		oldReceiptBytes, rErr = os.ReadFile(tx.receiptPath)
		oldReceiptExisted = rErr == nil
	}

	journal := &TxJournal{
		OperationID:          tx.plan.OperationID,
		PlanID:               tx.plan.PlanID,
		Phase:                TxPhasePlanned,
		Kind:                 tx.plan.OperationType,
		TargetInstallationID: tx.plan.TargetInstallationID,
		ModID:                tx.plan.ModID,
		ModTitle:             tx.plan.ModTitle,
		VersionID:            tx.plan.VersionID,
		Version:              tx.plan.Version,
		SpriteSetIDs:         tx.plan.SpriteSetIDs,
		SpriteSelectionHash:  tx.plan.SpriteSelectionHash,
		SelectedSpriteSetCount: tx.plan.SelectedSpriteSetCount,
		TotalSteps:           len(tx.plan.Actions),
		BeforeFiles:          make(map[string]FileBeforeState),
		AfterFiles:           make(map[string]FileAfterState),
		OldManifestExisted:   oldManifestExisted,
		OldManifest:          oldManifestBytes,
		ReceiptPath:          tx.receiptPath,
		OldReceiptExisted:    oldReceiptExisted,
		OldReceipt:           oldReceiptBytes,
		CreatedAt:            time.Now().UTC(),
		UpdatedAt:            time.Now().UTC(),
	}
	tx.journal = journal

	blobs := inst.blobs

	// 2. Snapshot all before-images into blob store and record in journal
	for _, act := range tx.plan.Actions {
		diskPath, err := SafeJoinAndValidateBounds(inst.root, act.Path)
		if err != nil {
			return err
		}
		b, err := os.ReadFile(diskPath)
		existed := err == nil
		var beforeHash string
		if existed {
			beforeHash, err = blobs.Put(b)
			if err != nil {
				return err
			}
		}
		journal.BeforeFiles[act.Key] = FileBeforeState{
			DisplayPath: act.Path,
			Existed:     existed,
			Hash:        beforeHash,
			Mode:        act.Mode,
		}

		journal.AfterFiles[act.Key] = FileAfterState{
			DisplayPath: act.Path,
			Exists:      act.TargetExists,
			Hash:        act.TargetHash,
			Mode:        act.Mode,
		}
	}

	journal.Phase = TxPhasePrepared
	journal.UpdatedAt = time.Now().UTC()
	if err := saveJournalFile(journalPath, journal); err != nil {
		return err
	}

	execErr := func() error {
		if inst.faultHook != nil {
			if err := inst.faultHook("after_prepared"); err != nil {
				return err
			}
		}

		// 3. Apply disk changes
		for idx, act := range tx.plan.Actions {
			journal.Phase = TxPhaseApplying
			journal.CurrentStep = idx
			journal.LastPath = act.Path
			journal.UpdatedAt = time.Now().UTC()
			if err := saveJournalFile(journalPath, journal); err != nil {
				return err
			}

			diskPath, err := SafeJoinAndValidateBounds(inst.root, act.Path)
			if err != nil {
				return err
			}
			switch act.Action {
			case ActionWrite, ActionRestoreOriginal, ActionRestoreLayer:
				blobData, err := blobs.Get(act.TargetHash)
				if err != nil {
					return err
				}
				if err := os.MkdirAll(filepath.Dir(diskPath), 0o755); err != nil {
					return err
				}
				mode := os.FileMode(0o644)
				if act.Mode != 0 {
					mode = os.FileMode(act.Mode)
				}
				if err := writeAtomicFile(diskPath, blobData, mode); err != nil {
					return err
				}
			case ActionDelete:
				if err := os.Remove(diskPath); err != nil && !os.IsNotExist(err) {
					return err
				}
				cleanEmptyDirs(filepath.Dir(diskPath), inst.root)
			case ActionMetadataOnly:
				// No disk changes needed
			}

			journal.CurrentStep = idx + 1
			journal.UpdatedAt = time.Now().UTC()
			if err := saveJournalFile(journalPath, journal); err != nil {
				return err
			}

			if inst.faultHook != nil {
				hookName := fmt.Sprintf("after_file_%d", idx+1)
				if err := inst.faultHook(hookName); err != nil {
					return err
				}
			}
		}

		// 3b. Purge generated cache files for scripts written, restored or deleted
		// above. This is part of the transaction's safety contract: committing
		// while an orphan .rpyc remains would let Ren'Py keep loading uninstalled
		// or stale code, and after the manifest update there would be no
		// installation record left to retry from. Any real removal failure rolls
		// the whole operation back so the source files and record stay intact.
		for _, rel := range tx.plan.CleanupPaths {
			cleanupPath, joinErr := SafeJoinAndValidateBounds(inst.root, rel)
			if joinErr != nil {
				return &Error{
					Code:        "cache_cleanup_failed",
					OperationID: tx.plan.OperationID,
					Path:        rel,
					Err:         joinErr,
				}
			}
			if rmErr := removeGeneratedCacheFile(cleanupPath); rmErr != nil {
				return &Error{
					Code:        "cache_cleanup_failed",
					OperationID: tx.plan.OperationID,
					Path:        rel,
					Err:         fmt.Errorf("close the game and clear read-only/permission, then retry: %w", rmErr),
				}
			}
			cleanEmptyDirs(filepath.Dir(cleanupPath), inst.root)
		}

		// 4. Update manifest
		journal.Phase = TxPhaseCommitting
		journal.LastPath = "manifest.json"
		journal.UpdatedAt = time.Now().UTC()
		if err := saveJournalFile(journalPath, journal); err != nil {
			return err
		}

		if tx.plan.NewManifest != nil {
			tx.plan.NewManifest.Generation = curManifest.Generation + 1
			if err := tx.plan.NewManifest.Save(manifestPath); err != nil {
				return err
			}
		}

		if inst.faultHook != nil {
			if err := inst.faultHook("after_manifest"); err != nil {
				return err
			}
		}

		// 5. Update receipt within transaction boundary if configured
		if tx.receiptPath != "" && tx.newReceiptData != nil {
			journal.LastPath = tx.receiptPath
			if err := writeAtomicFile(tx.receiptPath, tx.newReceiptData, 0o600); err != nil {
				return err
			}
		}

		if inst.faultHook != nil {
			if err := inst.faultHook("after_receipt"); err != nil {
				return err
			}
		}

		if inst.faultHook != nil {
			if err := inst.faultHook("before_committed"); err != nil {
				return err
			}
		}

		// 6. Mark journal committed
		journal.Phase = TxPhaseCommitted
		journal.CurrentStep = journal.TotalSteps
		journal.UpdatedAt = time.Now().UTC()
		return saveJournalFile(journalPath, journal)
	}()

	if execErr != nil {
		var appErr *Error
		if errors.As(execErr, &appErr) {
			journal.ErrorCode = appErr.Code
			if appErr.Path != "" {
				journal.LastPath = appErr.Path
			}
			journal.ExpectedHash = appErr.ExpectedHash
			journal.ActualHash = appErr.ActualHash
		} else {
			journal.ErrorCode = "transaction_execution_failed"
		}
		journal.ErrorMessage = execErr.Error()
		journal.UpdatedAt = time.Now().UTC()
		_ = saveJournalFile(journalPath, journal)

		if inst.crashWithoutRollback {
			return execErr
		}

		if rollbackErr := inst.RollbackJournal(journal); rollbackErr != nil {
			return errors.Join(execErr, rollbackErr)
		}
		return execErr
	}
	return nil
}

func writeAtomicFile(destPath string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(destPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	tmpFile, err := os.CreateTemp(dir, ".submodhub.atomic-*")
	if err != nil {
		return err
	}
	tmpName := tmpFile.Name()
	cleanedUp := false
	defer func() {
		if !cleanedUp {
			_ = tmpFile.Close()
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmpFile.Write(data); err != nil {
		return err
	}
	_ = tmpFile.Chmod(perm)
	if err := tmpFile.Sync(); err != nil {
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	if err := safeAtomicRename(tmpName, destPath); err != nil {
		return err
	}
	cleanedUp = true

	// Best-effort directory flush on supported platforms
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}

	return nil
}

func saveJournalFile(path string, j *TxJournal) error {
	b, err := json.MarshalIndent(j, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomicFile(path, b, 0o600)
}

func cleanEmptyDirs(dir, stopAtRoot string) {
	cleanDir := filepath.Clean(dir)
	cleanRoot := filepath.Clean(stopAtRoot)
	for cleanDir != cleanRoot && strings.HasPrefix(cleanDir, cleanRoot+string(filepath.Separator)) {
		entries, err := os.ReadDir(cleanDir)
		if err != nil || len(entries) > 0 {
			break
		}
		if err := os.Remove(cleanDir); err != nil {
			break
		}
		cleanDir = filepath.Dir(cleanDir)
	}
}

type RecoveryAction string

const (
	RecoveryActionNone           RecoveryAction = "none"
	RecoveryActionCommit         RecoveryAction = "commit"
	RecoveryActionRollback       RecoveryAction = "rollback"
	RecoveryActionManualRequired RecoveryAction = "manual_required"
)

// DecideRecovery assesses journal phase and disk state to determine safe recovery action.
func (i *Installer) DecideRecovery(j *TxJournal) (RecoveryAction, error) {
	if j == nil {
		return RecoveryActionNone, nil
	}
	if j.Phase == TxPhaseCommitted || j.Phase == TxPhaseRolledBack {
		return RecoveryActionNone, nil
	}
	if !j.HasRecoveryMaterial() {
		errMsg := j.ErrorMessage
		if errMsg == "" {
			errMsg = "recovery material missing or corrupt"
		}
		return RecoveryActionManualRequired, &Error{
			Code:        "transaction_manual_recovery",
			OperationID: j.OperationID,
			Path:        j.LastPath,
			Err:         errors.New(errMsg),
		}
	}

	// Default recovery strategy is safe rollback for all uncommitted phases (planned, prepared, applying, committing, needs_manual_recovery).
	// Preflight check against BeforeFiles and AfterFiles:
	for key, before := range j.BeforeFiles {
		_, _, err := CanonicalPath(before.DisplayPath, "")
		if err != nil {
			return RecoveryActionManualRequired, &Error{
				Code:        "invalid_path",
				OperationID: j.OperationID,
				Path:        before.DisplayPath,
				Err:         err,
			}
		}
		if before.Existed {
			if vErr := i.blobs.Verify(before.Hash); vErr != nil {
				return RecoveryActionManualRequired, &Error{
					Code:        "transaction_missing_blob",
					OperationID: j.OperationID,
					Path:        before.DisplayPath,
					Err:         fmt.Errorf("missing blob %s: %w", before.Hash, vErr),
				}
			}
		}
		diskPath, err := SafeJoinAndValidateBounds(i.root, before.DisplayPath)
		if err != nil {
			return RecoveryActionManualRequired, &Error{
				Code:        "invalid_path",
				OperationID: j.OperationID,
				Path:        before.DisplayPath,
				Err:         err,
			}
		}
		diskHash, err := fileHash(diskPath)
		if err != nil && !os.IsNotExist(err) {
			return RecoveryActionManualRequired, &Error{
				Code:        "disk_read_error",
				OperationID: j.OperationID,
				Path:        before.DisplayPath,
				Err:         err,
			}
		}
		exists := diskHash != ""
		matchesBefore := exists == before.Existed && (!exists || diskHash == before.Hash)
		after, hasAfter := j.AfterFiles[key]
		matchesAfter := hasAfter && exists == after.Exists && (!exists || diskHash == after.Hash)
		if !matchesBefore && !matchesAfter {
			return RecoveryActionManualRequired, &Error{
				Code:         "external_change",
				OperationID:  j.OperationID,
				Path:         before.DisplayPath,
				ExpectedHash: before.Hash,
				ActualHash:   diskHash,
				Err:          errors.New("rollback blocked: disk matches neither before nor after state"),
			}
		}
	}

	return RecoveryActionRollback, nil
}

// RollbackJournal restores disk, manifest, and receipt to their state before the operation.
func (i *Installer) RollbackJournal(j *TxJournal) error {
	if j == nil {
		return errors.New("nil journal")
	}
	if j.Phase == TxPhaseRolledBack {
		return nil // idempotent
	}
	if j.ErrorCode == "transaction_journal_corrupt" {
		return &Error{
			Code:        "transaction_journal_corrupt",
			OperationID: j.OperationID,
			Err:         errors.New("cannot rollback corrupted journal: recovery material missing"),
		}
	}
	if j.BeforeFiles == nil {
		return &Error{
			Code:        "transaction_recovery_incomplete",
			OperationID: j.OperationID,
			Err:         errors.New("cannot rollback journal: recovery material missing"),
		}
	}

	blobs := i.blobs
	journalPath := filepath.Join(i.state, "journals", j.OperationID+".json")

	recordFailure := func(code, path string, err error) error {
		j.Phase = TxPhaseNeedsManualRecovery
		j.ErrorCode = code
		j.ErrorMessage = err.Error()
		j.LastPath = path
		var appErr *Error
		if errors.As(err, &appErr) {
			if appErr.ExpectedHash != "" {
				j.ExpectedHash = appErr.ExpectedHash
			}
			if appErr.ActualHash != "" {
				j.ActualHash = appErr.ActualHash
			}
		}
		j.UpdatedAt = time.Now().UTC()
		_ = saveJournalFile(journalPath, j)
		return &Error{
			Code:        code,
			OperationID: j.OperationID,
			Path:        path,
			Err:         err,
		}
	}

	// PREFLIGHT: verify all files, hashes, blobs and drift BEFORE touching disk
	for key, before := range j.BeforeFiles {
		diskPath, err := SafeJoinAndValidateBounds(i.root, before.DisplayPath)
		if err != nil {
			return recordFailure("invalid_path", before.DisplayPath, err)
		}

		if before.Existed {
			if vErr := blobs.Verify(before.Hash); vErr != nil {
				return recordFailure("transaction_missing_blob", before.DisplayPath, fmt.Errorf("missing blob %s: %w", before.Hash, vErr))
			}
		}

		diskHash, err := fileHash(diskPath)
		if err != nil && !os.IsNotExist(err) {
			return recordFailure("disk_read_error", before.DisplayPath, err)
		}
		exists := diskHash != ""
		matchesBefore := exists == before.Existed && (!exists || diskHash == before.Hash)
		after, hasAfter := j.AfterFiles[key]
		matchesAfter := hasAfter && exists == after.Exists && (!exists || diskHash == after.Hash)
		if !matchesBefore && !matchesAfter {
			appErr := &Error{
				Code:         "external_change",
				OperationID:  j.OperationID,
				Path:         before.DisplayPath,
				ExpectedHash: before.Hash,
				ActualHash:   diskHash,
				Err:          errors.New("rollback blocked: disk matches neither before nor after state"),
			}
			j.Phase = TxPhaseNeedsManualRecovery
			j.ErrorCode = "external_change"
			j.ErrorMessage = appErr.Error()
			j.LastPath = before.DisplayPath
			j.ExpectedHash = before.Hash
			j.ActualHash = diskHash
			j.UpdatedAt = time.Now().UTC()
			_ = saveJournalFile(journalPath, j)
			return appErr
		}
	}

	// 1. Restore disk files from BeforeFiles
	for _, before := range j.BeforeFiles {
		diskPath, err := SafeJoinAndValidateBounds(i.root, before.DisplayPath)
		if err != nil {
			return recordFailure("invalid_path", before.DisplayPath, err)
		}
		if before.Existed {
			data, err := blobs.Get(before.Hash)
			if err != nil {
				return recordFailure("transaction_missing_blob", before.DisplayPath, err)
			}
			mode := os.FileMode(0o644)
			if before.Mode != 0 {
				mode = os.FileMode(before.Mode)
			}
			if err := writeAtomicFile(diskPath, data, mode); err != nil {
				return recordFailure("transaction_rollback_failed", before.DisplayPath, err)
			}
		} else {
			// Did not exist: remove it
			if err := os.Remove(diskPath); err != nil && !os.IsNotExist(err) {
				return recordFailure("transaction_rollback_failed", before.DisplayPath, err)
			}
			cleanEmptyDirs(filepath.Dir(diskPath), i.root)
		}
	}

	// 2. Restore manifest
	manifestPath := filepath.Join(i.state, "manifest.json")
	manifestExisted := j.OldManifestExisted || len(j.OldManifest) > 0
	if manifestExisted {
		if len(j.OldManifest) == 0 {
			return recordFailure("transaction_recovery_incomplete", "manifest.json", errors.New("missing old manifest recovery data"))
		}
		if err := writeAtomicFile(manifestPath, j.OldManifest, 0o644); err != nil {
			return recordFailure("transaction_rollback_failed", "manifest.json", err)
		}
	} else {
		// Old manifest did not exist originally: clean up newly created manifest
		if err := os.Remove(manifestPath); err != nil && !os.IsNotExist(err) {
			return recordFailure("transaction_rollback_failed", "manifest.json", err)
		}
	}

	// 3. Restore receipt
	if j.ReceiptPath != "" {
		receiptExisted := j.OldReceiptExisted || len(j.OldReceipt) > 0
		if receiptExisted {
			if len(j.OldReceipt) == 0 {
				return recordFailure("transaction_recovery_incomplete", j.ReceiptPath, errors.New("missing old receipt recovery data"))
			}
			if err := writeAtomicFile(j.ReceiptPath, j.OldReceipt, 0o600); err != nil {
				return recordFailure("transaction_rollback_failed", j.ReceiptPath, err)
			}
		} else {
			// Old receipt did not exist originally: clean up newly created receipt
			if err := os.Remove(j.ReceiptPath); err != nil && !os.IsNotExist(err) {
				return recordFailure("transaction_rollback_failed", j.ReceiptPath, err)
			}
		}
	}

	// 4. Update journal state to rolled_back
	j.Phase = TxPhaseRolledBack
	j.ErrorCode = ""
	j.ErrorMessage = ""
	j.ExpectedHash = ""
	j.ActualHash = ""
	j.UpdatedAt = time.Now().UTC()
	return saveJournalFile(journalPath, j)
}

func (i *Installer) recoverPendingLocked() error {
	journalsDir := filepath.Join(i.state, "journals")
	entries, err := os.ReadDir(journalsDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(journalsDir, entry.Name())
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var j TxJournal
		if err := json.Unmarshal(b, &j); err != nil {
			opID := strings.TrimSuffix(entry.Name(), ".json")
			diagDir := filepath.Join(i.state, "diagnostics")
			_ = os.MkdirAll(diagDir, 0o755)
			diag := &TxDiagnostic{
				OperationID:  opID,
				ErrorCode:    "transaction_journal_corrupt",
				ErrorMessage: fmt.Sprintf("corrupt journal JSON: %v", err),
				RawPath:      path,
				CreatedAt:    time.Now().UTC(),
				UpdatedAt:    time.Now().UTC(),
			}
			if diagBytes, mErr := json.MarshalIndent(diag, "", "  "); mErr == nil {
				_ = writeAtomicFile(filepath.Join(diagDir, opID+".json"), diagBytes, 0o600)
			}
			return &Error{
				Code:        "transaction_journal_corrupt",
				OperationID: opID,
				Path:        path,
				Err:         fmt.Errorf("corrupt journal JSON in %s: %w", entry.Name(), err),
			}
		}

		action, dErr := i.DecideRecovery(&j)
		switch action {
		case RecoveryActionNone:
			continue
		case RecoveryActionCommit:
			j.Phase = TxPhaseCommitted
			j.UpdatedAt = time.Now().UTC()
			if sErr := saveJournalFile(path, &j); sErr != nil {
				return sErr
			}
			continue
		case RecoveryActionRollback:
			if rErr := i.RollbackJournal(&j); rErr != nil {
				return rErr
			}
		case RecoveryActionManualRequired:
			j.Phase = TxPhaseNeedsManualRecovery
			if dErr != nil {
				var appErr *Error
				if errors.As(dErr, &appErr) {
					j.ErrorCode = appErr.Code
					j.LastPath = appErr.Path
					j.ExpectedHash = appErr.ExpectedHash
					j.ActualHash = appErr.ActualHash
				} else if j.ErrorCode == "" {
					j.ErrorCode = "transaction_manual_recovery"
				}
				j.ErrorMessage = dErr.Error()
			}
			j.UpdatedAt = time.Now().UTC()
			_ = saveJournalFile(path, &j)
			if dErr != nil {
				return dErr
			}
			return &Error{
				Code:        "transaction_manual_recovery",
				OperationID: j.OperationID,
				Path:        j.LastPath,
				Err:         errors.New(j.ErrorMessage),
			}
		}
	}
	return nil
}

// RecoverPending checks for uncommitted journals and rolls them back safely.
func (i *Installer) RecoverPending() error {
	lock, err := i.acquireLock()
	if err != nil {
		return err
	}
	defer lock.Release()
	return i.recoverPendingLocked()
}

// ListTxJournals returns all transaction journals (and legacy journals mapped to TxJournal) sorted by UpdatedAt desc.
func (i *Installer) ListTxJournals() ([]TxJournal, error) {
	var list []TxJournal
	seenOps := make(map[string]bool)

	journalsDir := filepath.Join(i.state, "journals")
	entries, err := os.ReadDir(journalsDir)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			opID := strings.TrimSuffix(entry.Name(), ".json")
			path := filepath.Join(journalsDir, entry.Name())
			b, rErr := os.ReadFile(path)
			if rErr != nil {
				continue
			}
			var j TxJournal
			if err := json.Unmarshal(b, &j); err != nil {
				diagPath := filepath.Join(i.state, "diagnostics", opID+".json")
				var diag TxDiagnostic
				if diagBytes, dErr := os.ReadFile(diagPath); dErr == nil && json.Unmarshal(diagBytes, &diag) == nil {
					j = TxJournal{
						OperationID:  opID,
						Phase:        TxPhaseNeedsManualRecovery,
						ErrorCode:    diag.ErrorCode,
						ErrorMessage: diag.ErrorMessage,
						CreatedAt:    diag.CreatedAt,
						UpdatedAt:    diag.UpdatedAt,
					}
				} else {
					j = TxJournal{
						OperationID:  opID,
						Phase:        TxPhaseNeedsManualRecovery,
						ErrorCode:    "transaction_journal_corrupt",
						ErrorMessage: fmt.Sprintf("corrupt journal JSON: %v", err),
						CreatedAt:    time.Now().UTC(),
						UpdatedAt:    time.Now().UTC(),
					}
				}
			}
			if j.OperationID == "" {
				j.OperationID = opID
			}
			if j.Phase == "" {
				j.Phase = TxPhasePlanned
			}
			list = append(list, j)
			seenOps[j.OperationID] = true
		}
	}

	// Also inspect legacy journals in i.state/*.json
	stateEntries, sErr := os.ReadDir(i.state)
	if sErr == nil {
		for _, entry := range stateEntries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || entry.Name() == "manifest.json" {
				continue
			}
			opID := strings.TrimSuffix(entry.Name(), ".json")
			if seenOps[opID] {
				continue
			}
			legacyPath := filepath.Join(i.state, entry.Name())
			b, rErr := os.ReadFile(legacyPath)
			if rErr != nil {
				continue
			}
			var legacyJ Journal
			if err := json.Unmarshal(b, &legacyJ); err != nil {
				continue
			}
			phase := legacyJ.State
			if phase == "" {
				phase = TxPhaseCommitted
			}
			j := TxJournal{
				OperationID: legacyJ.Operation.ID,
				PlanID:      legacyJ.Operation.ID,
				Phase:       phase,
				Kind:        "install",
				ModTitle:    legacyJ.Operation.ID,
				TotalSteps:  len(legacyJ.Operation.Changes),
				CreatedAt:   legacyJ.UpdatedAt,
				UpdatedAt:   legacyJ.UpdatedAt,
			}
			list = append(list, j)
			seenOps[opID] = true
		}
	}

	sort.Slice(list, func(a, b int) bool {
		if !list[a].UpdatedAt.Equal(list[b].UpdatedAt) {
			return list[a].UpdatedAt.After(list[b].UpdatedAt)
		}
		return list[a].OperationID < list[b].OperationID
	})

	return list, nil
}

// GetTxJournal retrieves a TxJournal by ID, falling back to legacy journal if needed.
func (i *Installer) GetTxJournal(id string) (*TxJournal, error) {
	if id == "" || strings.ContainsAny(id, `/\\`) {
		return nil, &Error{Code: "validation_failed", Err: errors.New("invalid operation id")}
	}

	path := filepath.Join(i.state, "journals", id+".json")
	if b, err := os.ReadFile(path); err == nil {
		var j TxJournal
		if err := json.Unmarshal(b, &j); err != nil {
			diagPath := filepath.Join(i.state, "diagnostics", id+".json")
			if diagBytes, dErr := os.ReadFile(diagPath); dErr == nil {
				var diag TxDiagnostic
				if json.Unmarshal(diagBytes, &diag) == nil {
					return &TxJournal{
						OperationID:  id,
						Phase:        TxPhaseNeedsManualRecovery,
						ErrorCode:    diag.ErrorCode,
						ErrorMessage: diag.ErrorMessage,
						CreatedAt:    diag.CreatedAt,
						UpdatedAt:    diag.UpdatedAt,
					}, nil
				}
			}
			return &TxJournal{
				OperationID:  id,
				Phase:        TxPhaseNeedsManualRecovery,
				ErrorCode:    "transaction_journal_corrupt",
				ErrorMessage: fmt.Sprintf("corrupt journal JSON: %v", err),
				CreatedAt:    time.Now().UTC(),
				UpdatedAt:    time.Now().UTC(),
			}, nil
		}
		if j.OperationID == "" {
			j.OperationID = id
		}
		return &j, nil
	}

	// Legacy fallback
	legacyJ, err := i.LoadJournal(id)
	if err == nil {
		phase := legacyJ.State
		if phase == "" {
			phase = TxPhaseCommitted
		}
		return &TxJournal{
			OperationID: legacyJ.Operation.ID,
			PlanID:      legacyJ.Operation.ID,
			Phase:       phase,
			Kind:        "install",
			ModTitle:    legacyJ.Operation.ID,
			TotalSteps:  len(legacyJ.Operation.Changes),
			CreatedAt:   legacyJ.UpdatedAt,
			UpdatedAt:   legacyJ.UpdatedAt,
		}, nil
	}

	return nil, &Error{Code: "operation_not_found", OperationID: id, Err: fmt.Errorf("operation %s not found", id)}
}

func safeAtomicRename(src, dest string) error {
	return safeAtomicRenameWith(src, dest, os.Rename)
}

func safeAtomicRenameWith(src, dest string, rename func(string, string) error) error {
	var err error
	for attempt := 0; attempt < 8; attempt++ {
		err = rename(src, dest)
		if err == nil {
			return nil
		}
		if _, sourceErr := os.Lstat(src); sourceErr != nil {
			return errors.Join(err, sourceErr)
		}
		info, targetErr := os.Lstat(dest)
		if targetErr == nil && info.Mode().IsRegular() {
			backupFile, backupErr := os.CreateTemp(filepath.Dir(dest), ".submodhub.old-*")
			if backupErr != nil {
				return errors.Join(err, backupErr)
			}
			backup := backupFile.Name()
			if closeErr := backupFile.Close(); closeErr != nil {
				return closeErr
			}
			if rotateErr := rename(dest, backup); rotateErr == nil {
				if replaceErr := rename(src, dest); replaceErr == nil {
					return os.Remove(backup)
				} else {
					err = replaceErr
				}
				var restoreErr error
				for restoreAttempt := 0; restoreAttempt < 8; restoreAttempt++ {
					restoreErr = rename(backup, dest)
					if restoreErr == nil {
						break
					}
					time.Sleep(10 * time.Millisecond)
				}
				if restoreErr != nil {
					return errors.Join(err, fmt.Errorf("original retained at %s: %w", backup, restoreErr))
				}
			} else {
				_ = os.Remove(backup)
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	return err
}
