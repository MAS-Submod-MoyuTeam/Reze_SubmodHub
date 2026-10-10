package install

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

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
	OperationID string                     `json:"operation_id"`
	PlanID      string                     `json:"plan_id"`
	Phase       string                     `json:"phase"`
	BeforeFiles map[string]FileBeforeState `json:"before_files"` // key -> state
	AfterFiles  map[string]FileAfterState  `json:"after_files"`
	OldManifest []byte                     `json:"old_manifest,omitempty"`
	ReceiptPath string                     `json:"receipt_path,omitempty"`
	OldReceipt  []byte                     `json:"old_receipt,omitempty"`
	CreatedAt   time.Time                  `json:"created_at"`
	UpdatedAt   time.Time                  `json:"updated_at"`
}

type InstanceLock struct {
	path string
	file *os.File
}

var (
	processLockMutex sync.Mutex
	activeLocks      = make(map[string]*InstanceLock)
)

func acquireInstanceLock(stateDir string) (*InstanceLock, error) {
	processLockMutex.Lock()
	defer processLockMutex.Unlock()

	cleanDir := filepath.Clean(stateDir)
	if _, exists := activeLocks[cleanDir]; exists {
		return nil, &Error{Code: "instance_busy", Path: stateDir, Err: errors.New("instance locked in current process")}
	}

	if err := os.MkdirAll(cleanDir, 0o755); err != nil {
		return nil, err
	}
	lockFile := filepath.Join(cleanDir, "lock")

	f, err := os.OpenFile(lockFile, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}

	if err := lockOSFile(f); err != nil {
		_ = f.Close()
		if errors.Is(err, errLockBusy) {
			return nil, &Error{Code: "instance_busy", Path: stateDir, Err: errors.New("instance locked by another process")}
		}
		return nil, err
	}

	// Stamp PID in lock file for diagnostic inspection
	_ = f.Truncate(0)
	_, _ = f.Seek(0, 0)
	_, _ = f.WriteString(fmt.Sprintf("%d\n", os.Getpid()))
	_ = f.Sync()

	lock := &InstanceLock{
		path: lockFile,
		file: f,
	}
	activeLocks[cleanDir] = lock
	return lock, nil
}

func (l *InstanceLock) Release() {
	if l == nil {
		return
	}
	processLockMutex.Lock()
	defer processLockMutex.Unlock()

	dir := filepath.Dir(l.path)
	delete(activeLocks, dir)

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
		return &Error{Code: "operation_id_conflict", Err: fmt.Errorf("operation %s already exists", tx.plan.OperationID)}
	}

	// 1. Re-validate plan under lock: check generation and disk state
	manifestPath := filepath.Join(stateDir, "manifest.json")
	curManifest, err := LoadManifest(manifestPath)
	if err != nil {
		return err
	}
	if curManifest.Generation != tx.plan.Generation {
		return &Error{
			Code: "plan_stale",
			Err:  fmt.Errorf("manifest generation changed since plan: plan=%d current=%d", tx.plan.Generation, curManifest.Generation),
		}
	}

	for _, act := range tx.plan.Actions {
		diskPath := filepath.Join(inst.root, filepath.FromSlash(act.Path))
		diskHash, hErr := fileHash(diskPath)
		if hErr != nil && !os.IsNotExist(hErr) {
			return &Error{Code: "disk_read_error", Path: act.Path, Err: hErr}
		}
		diskExists := diskHash != ""
		if diskExists != act.CurrentExists || diskHash != act.CurrentHash {
			return &Error{
				Code: "external_change",
				Path: act.Path,
				Err:  fmt.Errorf("disk modified since plan: was %s (exists=%v), now %s (exists=%v)", act.CurrentHash, act.CurrentExists, diskHash, diskExists),
			}
		}
	}

	// Read old manifest bytes for undo
	oldManifestBytes, _ := os.ReadFile(manifestPath)

	var oldReceiptBytes []byte
	if tx.receiptPath != "" {
		oldReceiptBytes, _ = os.ReadFile(tx.receiptPath)
	}

	journal := &TxJournal{
		OperationID: tx.plan.OperationID,
		PlanID:      tx.plan.PlanID,
		Phase:       "planned",
		BeforeFiles: make(map[string]FileBeforeState),
		AfterFiles:  make(map[string]FileAfterState),
		OldManifest: oldManifestBytes,
		ReceiptPath: tx.receiptPath,
		OldReceipt:  oldReceiptBytes,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	tx.journal = journal

	blobs := inst.blobs

	// 2. Snapshot all before-images into blob store and record in journal
	for _, act := range tx.plan.Actions {
		diskPath := filepath.Join(inst.root, filepath.FromSlash(act.Path))
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

	journal.Phase = "prepared"
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
			diskPath := filepath.Join(inst.root, filepath.FromSlash(act.Path))
			switch act.Action {
			case ActionWrite, ActionRestoreOriginal, ActionRestoreLayer:
				blobData, err := blobs.Get(act.TargetHash)
				if err != nil {
					return err
				}
				if err := os.MkdirAll(filepath.Dir(diskPath), 0o755); err != nil {
					return err
				}
				tmp := diskPath + fmt.Sprintf(".submodhub.tmp.%d", time.Now().UnixNano())
				mode := os.FileMode(0o644)
				if act.Mode != 0 {
					mode = os.FileMode(act.Mode)
				}
				if err := os.WriteFile(tmp, blobData, mode); err != nil {
					return err
				}
				if err := safeAtomicRename(tmp, diskPath); err != nil {
					_ = os.Remove(tmp)
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

			if inst.faultHook != nil {
				hookName := fmt.Sprintf("after_file_%d", idx+1)
				if err := inst.faultHook(hookName); err != nil {
					return err
				}
			}
		}

		// 4. Save new manifest with incremented generation
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
			receiptTmp := tx.receiptPath + fmt.Sprintf(".tmp.%d", time.Now().UnixNano())
			if err := os.MkdirAll(filepath.Dir(tx.receiptPath), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(receiptTmp, tx.newReceiptData, 0o600); err != nil {
				return err
			}
			if err := safeAtomicRename(receiptTmp, tx.receiptPath); err != nil {
				_ = os.Remove(receiptTmp)
				return err
			}
		}

		if inst.faultHook != nil {
			if err := inst.faultHook("before_committed"); err != nil {
				return err
			}
		}

		// 6. Mark journal committed
		journal.Phase = "committed"
		journal.UpdatedAt = time.Now().UTC()
		return saveJournalFile(journalPath, journal)
	}()

	if execErr != nil {
		if rollbackErr := inst.RollbackJournal(journal); rollbackErr != nil {
			return errors.Join(execErr, rollbackErr)
		}
		return execErr
	}
	return nil
}

func saveJournalFile(path string, j *TxJournal) error {
	b, err := json.MarshalIndent(j, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + fmt.Sprintf(".tmp.%d", time.Now().UnixNano())
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := safeAtomicRename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
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

// RollbackJournal restores disk, manifest, and receipt to their state before the operation.
func (i *Installer) RollbackJournal(j *TxJournal) error {
	blobs := i.blobs
	for key, before := range j.BeforeFiles {
		_, _, err := CanonicalPath(before.DisplayPath, "")
		if err != nil {
			return err
		}
		diskHash, err := fileHash(filepath.Join(i.root, filepath.FromSlash(before.DisplayPath)))
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		exists := diskHash != ""
		matchesBefore := exists == before.Existed && (!exists || diskHash == before.Hash)
		after, hasAfter := j.AfterFiles[key]
		matchesAfter := hasAfter && exists == after.Exists && (!exists || diskHash == after.Hash)
		if !matchesBefore && !matchesAfter {
			return &Error{Code: "external_change", Path: before.DisplayPath, Err: errors.New("rollback blocked: disk matches neither before nor after state")}
		}
	}

	// 1. Restore disk files from BeforeFiles
	for _, before := range j.BeforeFiles {
		diskPath := filepath.Join(i.root, filepath.FromSlash(before.DisplayPath))
		if before.Existed {
			data, err := blobs.Get(before.Hash)
			if err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(diskPath), 0o755); err != nil {
				return err
			}
			tmp := diskPath + fmt.Sprintf(".rollback.tmp.%d", time.Now().UnixNano())
			mode := os.FileMode(0o644)
			if before.Mode != 0 {
				mode = os.FileMode(before.Mode)
			}
			if err := os.WriteFile(tmp, data, mode); err != nil {
				return err
			}
			if err := safeAtomicRename(tmp, diskPath); err != nil {
				_ = os.Remove(tmp)
				return err
			}
		} else {
			// Did not exist: remove it
			if err := os.Remove(diskPath); err != nil && !os.IsNotExist(err) {
				return err
			}
			cleanEmptyDirs(filepath.Dir(diskPath), i.root)
		}
	}

	// 2. Restore manifest
	manifestPath := filepath.Join(i.state, "manifest.json")
	if len(j.OldManifest) > 0 {
		if err := os.WriteFile(manifestPath, j.OldManifest, 0o644); err != nil {
			return err
		}
	} else {
		if err := os.Remove(manifestPath); err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	// 3. Restore receipt
	if j.ReceiptPath != "" {
		if len(j.OldReceipt) > 0 {
			if err := os.WriteFile(j.ReceiptPath, j.OldReceipt, 0o644); err != nil {
				return err
			}
		} else {
			if err := os.Remove(j.ReceiptPath); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}

	// 4. Update journal state to rolled_back
	j.Phase = "rolled_back"
	j.UpdatedAt = time.Now().UTC()
	journalPath := filepath.Join(i.state, "journals", j.OperationID+".json")
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
			continue
		}
		var j TxJournal
		if err := json.Unmarshal(b, &j); err != nil {
			continue
		}

		if j.Phase != "committed" && j.Phase != "rolled_back" {
			// Needs rollback!
			if err := i.RollbackJournal(&j); err != nil {
				return err
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
