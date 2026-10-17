package install

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Change struct {
	Path           string `json:"path"`
	Content        []byte `json:"content,omitempty"`
	Remove         bool   `json:"remove,omitempty"`
	RestoreBackup  bool   `json:"restore_backup,omitempty"`
	ExpectedSHA256 string `json:"expected_sha256,omitempty"`
}

type Operation struct {
	ID      string   `json:"id"`
	Changes []Change `json:"changes"`
}

type Journal struct {
	Operation Operation         `json:"operation"`
	Backups   map[string]string `json:"backups"`
	State     string            `json:"state"`
	UpdatedAt time.Time         `json:"updated_at"`
}

type Error struct {
	Code         string
	Path         string
	OperationID  string
	ExpectedHash string
	ActualHash   string
	Err          error
}

func (e *Error) Error() string {
	if e.OperationID != "" || e.ExpectedHash != "" || e.ActualHash != "" {
		var parts []string
		if e.OperationID != "" {
			parts = append(parts, "op="+e.OperationID)
		}
		if e.Path != "" {
			parts = append(parts, "path="+e.Path)
		}
		if e.ExpectedHash != "" || e.ActualHash != "" {
			parts = append(parts, fmt.Sprintf("expected=%s actual=%s", e.ExpectedHash, e.ActualHash))
		}
		return fmt.Sprintf("%s (%s): %v", e.Code, strings.Join(parts, ", "), e.Err)
	}
	if e.Path != "" {
		return fmt.Sprintf("%s (%s): %v", e.Code, e.Path, e.Err)
	}
	return fmt.Sprintf("%s: %v", e.Code, e.Err)
}

func (e *Error) Unwrap() error           { return e.Err }
func IsCode(err error, code string) bool { var e *Error; return errors.As(err, &e) && e.Code == code }

// IsDisplayableRecoveryError returns true if err indicates a transaction state that requires
// manual recovery or inspection, which should not block loading an instance for display/diagnostics.
func IsDisplayableRecoveryError(err error) bool {
	if err == nil {
		return false
	}
	return IsCode(err, "transaction_manual_recovery") ||
		IsCode(err, "transaction_journal_corrupt") ||
		IsCode(err, "external_change") ||
		IsCode(err, "transaction_missing_blob") ||
		IsCode(err, "transaction_rollback_failed") ||
		IsCode(err, "transaction_recovery_incomplete") ||
		IsCode(err, "disk_read_error") ||
		IsCode(err, "invalid_path")
}

type Installer struct {
	root                 string
	state                string
	lockPath             string
	blobs                *BlobStore
	faultHook            func(step string) error
	crashWithoutRollback bool
}

func New(root, state string) *Installer {
	cleanRoot := filepath.Clean(root)
	cleanState := filepath.Clean(state)
	return &Installer{
		root:  cleanRoot,
		state: cleanState,
		blobs: NewBlobStore(filepath.Join(cleanState, "blobs")),
	}
}

func (i *Installer) SetFaultHook(hook func(step string) error) {
	i.faultHook = hook
}

func (i *Installer) SetBlobSyncHook(hook func() error) {
	if i.blobs != nil {
		i.blobs.SetSyncHook(hook)
	}
}

func (i *Installer) SetCrashWithoutRollback(crash bool) {
	i.crashWithoutRollback = crash
}

func (i *Installer) SetLockPath(path string) {
	if path != "" {
		i.lockPath = filepath.Clean(path)
	}
}

func (i *Installer) LockPath() string {
	if i.lockPath != "" {
		return i.lockPath
	}
	return filepath.Join(i.state, "lock")
}

func (i *Installer) acquireLock() (*InstanceLock, error) {
	if i.lockPath != "" {
		return acquireInstanceLockPath(i.lockPath)
	}
	return acquireInstanceLock(i.state)
}

func (i *Installer) GetBlobs() *BlobStore {
	return i.blobs
}

func (i *Installer) LoadManifest() (*Manifest, error) {
	manifestPath := filepath.Join(i.state, "manifest.json")
	return LoadManifest(manifestPath)
}

func (i *Installer) ListInstalledModFiles(installationID, modID string) (*InstalledFileList, error) {
	return i.ListInstalledModFilesPaged(installationID, modID, "", 0)
}

func (i *Installer) ListInstalledModFilesPaged(installationID, modID string, cursor string, limit int) (*InstalledFileList, error) {
	if i == nil || i.root == "" {
		return nil, &Error{Code: "invalid_mas_root", Err: errors.New("mas root is not configured")}
	}
	fi, err := os.Stat(i.root)
	if err != nil || !fi.IsDir() {
		return nil, &Error{Code: "invalid_mas_root", Err: errors.New("mas root is not a directory or inaccessible")}
	}
	manifest, err := i.LoadManifest()
	if err != nil {
		return nil, &Error{Code: "manifest_corrupt", Err: err}
	}
	return manifest.ListInstalledFilesPaged(installationID, modID, i.root, cursor, limit)
}

func hashBytes(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func fileHash(path string) (string, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return hashBytes(b), nil
}

func safe(root, rel string) (string, error) {
	display, _, err := CanonicalPath(rel, ".submodhub/state")
	if err != nil {
		return "", err
	}
	return SafeJoinAndValidateBounds(root, display)
}

func (i *Installer) Apply(op Operation) error {
	if op.ID == "" {
		return &Error{Code: "validation_failed", Err: errors.New("operation id required")}
	}

	// 1. Recover any interrupted pending operations
	if err := i.RecoverPending(); err != nil {
		return err
	}

	// Check if this operation already exists as committed journal
	legacyPath := filepath.Join(i.state, op.ID+".json")
	txJournalPath := filepath.Join(i.state, "journals", op.ID+".json")
	if _, err := os.Stat(legacyPath); err == nil {
		return &Error{Code: "operation_id_conflict", Err: fmt.Errorf("operation %s already exists", op.ID)}
	}
	if _, err := os.Stat(txJournalPath); err == nil {
		return &Error{Code: "operation_id_conflict", Err: fmt.Errorf("operation %s already exists", op.ID)}
	}

	// 2. Prepare blobs and planned files
	plannedFiles := make([]PlannedFile, 0, len(op.Changes))
	for _, c := range op.Changes {
		if c.Remove {
			continue
		}
		// Put content into blob store ahead of time
		_, err := i.blobs.Put(c.Content)
		if err != nil {
			return err
		}
		plannedFiles = append(plannedFiles, PlannedFile{
			Path:        c.Path,
			Content:     c.Content,
			ExpectedSHA: c.ExpectedSHA256,
		})
	}

	manifest, err := i.LoadManifest()
	if err != nil {
		return err
	}

	plan, err := PlanInstall(manifest, i.root, i.blobs, InstallOperation{
		OperationID:    op.ID,
		InstallationID: op.ID,
		Files:          plannedFiles,
	})
	if err != nil {
		return err
	}

	if len(plan.Blockers) > 0 {
		first := plan.Blockers[0]
		if strings.HasPrefix(first, "external_change") {
			return &Error{Code: "external_change", Err: errors.New(first)}
		}
		return &Error{Code: "plan_blocked", Err: fmt.Errorf("blockers: %s", strings.Join(plan.Blockers, "; "))}
	}

	// 3. Execute plan within transaction
	tx, err := i.NewTransaction(plan)
	if err != nil {
		return err
	}
	defer tx.Close()
	if err := tx.Execute(); err != nil {
		if !i.crashWithoutRollback && tx.journal != nil {
			_ = i.RollbackJournal(tx.journal)
		}
		return err
	}

	// 4. Write legacy journal for backwards compatibility
	journalChanges := make([]Change, len(op.Changes))
	for index, change := range op.Changes {
		change.Content = nil
		journalChanges[index] = change
	}
	backups := make(map[string]string)
	if tx.journal != nil {
		for _, b := range tx.journal.BeforeFiles {
			if b.Existed {
				backups[b.DisplayPath] = i.blobs.Path(b.Hash)
			}
		}
	}
	legacyJ := Journal{
		Operation: Operation{ID: op.ID, Changes: journalChanges},
		Backups:   backups,
		State:     "committed",
		UpdatedAt: time.Now().UTC(),
	}
	return i.writeJournal(legacyJ)
}

func (i *Installer) LoadJournal(id string) (Journal, error) {
	if id == "" || strings.ContainsAny(id, `/\\`) {
		return Journal{}, &Error{Code: "validation_failed", Err: errors.New("invalid operation id")}
	}

	// Check tx journals
	txPath := filepath.Join(i.state, "journals", id+".json")
	if b, err := os.ReadFile(txPath); err == nil {
		var txJ TxJournal
		if err := json.Unmarshal(b, &txJ); err == nil {
			state := txJ.Phase
			backups := make(map[string]string)
			for _, bf := range txJ.BeforeFiles {
				if bf.Existed {
					backups[bf.DisplayPath] = i.blobs.Path(bf.Hash)
				}
			}
			var changes []Change
			for _, af := range txJ.AfterFiles {
				changes = append(changes, Change{
					Path: af.DisplayPath,
				})
			}
			return Journal{
				Operation: Operation{ID: id, Changes: changes},
				Backups:   backups,
				State:     state,
				UpdatedAt: txJ.UpdatedAt,
			}, nil
		}
	}

	// Check legacy journal
	legacyPath := filepath.Join(i.state, id+".json")
	b, err := os.ReadFile(legacyPath)
	if err != nil {
		return Journal{}, err
	}
	var j Journal
	if err = json.Unmarshal(b, &j); err != nil {
		return Journal{}, err
	}
	return j, nil
}

// Rollback rolls back the specified operation by ID.
// If the operation was already committed, it cannot be rolled back with this method (use Uninstall instead).
// If the operation is already rolled back, it returns nil (idempotent).
func (i *Installer) Rollback(id string) error {
	lock, err := i.acquireLock()
	if err != nil {
		return err
	}
	defer lock.Release()

	return i.rollbackLocked(id)
}

// Recover is a backward-compatible alias for Rollback.
// Note: Recovery performs a safe rollback of an interrupted or uncommitted transaction to its initial state.
func (i *Installer) Recover(id string) error {
	return i.Rollback(id)
}

func (i *Installer) rollbackLocked(id string) error {
	if id == "" {
		return &Error{Code: "validation_failed", Err: errors.New("operation id required")}
	}

	// 1. If there's a TxJournal, rollback via TxJournal
	txPath := filepath.Join(i.state, "journals", id+".json")
	if b, err := os.ReadFile(txPath); err == nil {
		var txJ TxJournal
		if err := json.Unmarshal(b, &txJ); err != nil {
			return &Error{Code: "transaction_journal_corrupt", OperationID: id, Path: txPath, Err: err}
		}
		if txJ.Phase == TxPhaseCommitted {
			return &Error{Code: "transaction_invalid_state", OperationID: id, Err: fmt.Errorf("operation %s is already committed; use Uninstall to remove", id)}
		}
		if txJ.Phase == TxPhaseRolledBack {
			return nil
		}
		return i.RollbackJournal(&txJ)
	}

	// 2. Otherwise fallback to legacy journal
	j, err := i.LoadJournal(id)
	if err != nil {
		return err
	}
	if j.State == "committed" {
		return &Error{Code: "transaction_invalid_state", OperationID: id, Err: fmt.Errorf("operation %s is already committed; use Uninstall to remove", id)}
	}
	if j.State == "rolled_back" {
		return nil
	}

	for path, backup := range j.Backups {
		target, pathErr := safe(i.root, path)
		if pathErr != nil {
			return &Error{Code: "invalid_path", Path: path, Err: pathErr}
		}
		b, readErr := os.ReadFile(backup)
		if readErr != nil {
			return readErr
		}
		if writeErr := writeAtomicFile(target, b, 0o644); writeErr != nil {
			return writeErr
		}
	}
	j.State = "rolled_back"
	j.UpdatedAt = time.Now().UTC()
	return i.writeJournal(j)
}

func (i *Installer) Uninstall(id, uninstallID string) error {
	if id == "" || uninstallID == "" {
		return &Error{Code: "validation_failed", Err: errors.New("operation ids required")}
	}

	if err := i.RecoverPending(); err != nil {
		return err
	}

	manifest, err := i.LoadManifest()
	if err != nil {
		return err
	}

	plan, err := PlanUninstall(manifest, i.root, i.blobs, id, uninstallID)
	if err != nil {
		// Fallback to legacy journal if not found in manifest
		legacyJ, lErr := i.LoadJournal(id)
		if lErr != nil {
			return err
		}
		if legacyJ.State != "committed" {
			return &Error{Code: "invalid_state", Err: fmt.Errorf("operation %s is %s", id, legacyJ.State)}
		}
		// For legacy journal, construct plan with paths
		var paths []string
		for _, c := range legacyJ.Operation.Changes {
			paths = append(paths, c.Path)
		}
		// Synthesize installation
		manifest.Installations[id] = &InstallationRecord{
			InstallationID: id,
			OperationID:    id,
			Paths:          paths,
		}
		plan, err = PlanUninstall(manifest, i.root, i.blobs, id, uninstallID)
		if err != nil {
			return err
		}
	}

	if len(plan.Blockers) > 0 {
		first := plan.Blockers[0]
		if strings.HasPrefix(first, "external_change") {
			return &Error{Code: "external_change", Err: errors.New(first)}
		}
		return &Error{Code: "plan_blocked", Err: fmt.Errorf("blockers: %s", strings.Join(plan.Blockers, "; "))}
	}

	tx, err := i.NewTransaction(plan)
	if err != nil {
		return err
	}
	defer tx.Close()
	if err := tx.Execute(); err != nil {
		if !i.crashWithoutRollback && tx.journal != nil {
			_ = i.RollbackJournal(tx.journal)
		}
		return err
	}

	legacyJ := Journal{
		Operation: Operation{ID: uninstallID},
		State:     "committed",
		UpdatedAt: time.Now().UTC(),
	}
	return i.writeJournal(legacyJ)
}

func (i *Installer) writeJournal(j Journal) error {
	if err := os.MkdirAll(i.state, 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(j, "", "  ")
	if err != nil {
		return err
	}
	if err := writeAtomicFile(filepath.Join(i.state, j.Operation.ID+".json"), b, 0o600); err != nil {
		return err
	}
	txPath := filepath.Join(i.state, "journals", j.Operation.ID+".json")
	if txBytes, err := os.ReadFile(txPath); err == nil {
		var txJ TxJournal
		if err := json.Unmarshal(txBytes, &txJ); err == nil {
			txJ.Phase = j.State
			txJ.UpdatedAt = j.UpdatedAt
			_ = saveJournalFile(txPath, &txJ)
		}
	}
	return nil
}
