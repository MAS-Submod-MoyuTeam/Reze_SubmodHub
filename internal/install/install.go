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
	Code string
	Path string
	Err  error
}

func (e *Error) Error() string {
	if e.Path != "" {
		return fmt.Sprintf("%s (%s): %v", e.Code, e.Path, e.Err)
	}
	return fmt.Sprintf("%s: %v", e.Code, e.Err)
}

func (e *Error) Unwrap() error           { return e.Err }
func IsCode(err error, code string) bool { var e *Error; return errors.As(err, &e) && e.Code == code }

type Installer struct {
	root      string
	state     string
	blobs     *BlobStore
	faultHook func(step string) error
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
func (i *Installer) acquireLock() (*InstanceLock, error) {
	return acquireInstanceLock(i.state)
}

func (i *Installer) GetBlobs() *BlobStore {
	return i.blobs
}

func (i *Installer) LoadManifest() (*Manifest, error) {
	manifestPath := filepath.Join(i.state, "manifest.json")
	return LoadManifest(manifestPath)
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
	return filepath.Join(root, filepath.FromSlash(display)), nil
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
		// Roll back on failure if journal was created
		if tx.journal != nil {
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

func (i *Installer) Recover(id string) error {
	j, err := i.LoadJournal(id)
	if err != nil {
		return err
	}
	if j.State == "committed" {
		return nil
	}

	// If there's a TxJournal, rollback via TxJournal
	txPath := filepath.Join(i.state, "journals", id+".json")
	if b, err := os.ReadFile(txPath); err == nil {
		var txJ TxJournal
		if err := json.Unmarshal(b, &txJ); err == nil {
			return i.RollbackJournal(&txJ)
		}
	}

	// Otherwise fallback to legacy rollback
	for path, backup := range j.Backups {
		target, pathErr := safe(i.root, path)
		if pathErr != nil {
			return &Error{Code: "invalid_path", Path: path, Err: pathErr}
		}
		b, readErr := os.ReadFile(backup)
		if readErr != nil {
			return readErr
		}
		if writeErr := os.WriteFile(target, b, 0o644); writeErr != nil {
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
		if tx.journal != nil {
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
	tmp := filepath.Join(i.state, j.Operation.ID+".json.tmp")
	if err = os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, filepath.Join(i.state, j.Operation.ID+".json")); err != nil {
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
