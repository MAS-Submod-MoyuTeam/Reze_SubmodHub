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

func (e *Error) Error() string           { return fmt.Sprintf("%s (%s): %v", e.Code, e.Path, e.Err) }
func (e *Error) Unwrap() error           { return e.Err }
func IsCode(err error, code string) bool { var e *Error; return errors.As(err, &e) && e.Code == code }

type Installer struct{ root, state string }

func New(root, state string) *Installer {
	return &Installer{root: filepath.Clean(root), state: filepath.Clean(state)}
}
func hashBytes(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
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
	if rel == "" || filepath.IsAbs(rel) || strings.Contains(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return "", errors.New("unsafe path")
	}
	p := filepath.Join(root, filepath.FromSlash(rel))
	if filepath.Clean(p) != p || !strings.HasPrefix(p, root+string(filepath.Separator)) {
		return "", errors.New("unsafe path")
	}
	return p, nil
}
func (i *Installer) Apply(op Operation) error {
	if op.ID == "" {
		return &Error{Code: "validation_failed", Err: errors.New("operation id required")}
	}
	if err := os.MkdirAll(filepath.Join(i.state, "backups", op.ID), 0o700); err != nil {
		return err
	}
	j := Journal{Operation: op, Backups: map[string]string{}, State: "planned", UpdatedAt: time.Now().UTC()}
	if err := i.writeJournal(j); err != nil {
		return err
	}
	for _, c := range op.Changes {
		p, err := safe(i.root, c.Path)
		if err != nil {
			return &Error{Code: "invalid_path", Path: c.Path, Err: err}
		}
		actual, err := fileHash(p)
		if err != nil {
			return err
		}
		if c.ExpectedSHA256 != "" && actual != c.ExpectedSHA256 {
			return &Error{Code: "external_change", Path: c.Path, Err: fmt.Errorf("expected %s got %s", c.ExpectedSHA256, actual)}
		}
		if actual != "" && !c.Remove {
			backup := filepath.Join(i.state, "backups", op.ID, filepath.FromSlash(c.Path))
			if err := os.MkdirAll(filepath.Dir(backup), 0o700); err != nil {
				return err
			}
			b, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			if err = os.WriteFile(backup, b, 0o600); err != nil {
				return err
			}
			j.Backups[c.Path] = backup
		}
		j.State = "backed_up"
		_ = i.writeJournal(j)
		if c.Remove {
			if c.RestoreBackup {
				if backup, ok := i.previousBackup(op.ID, c.Path); ok {
					b, readErr := os.ReadFile(backup)
					if readErr != nil {
						return readErr
					}
					if err = os.WriteFile(p, b, 0o644); err != nil {
						return err
					}
				} else if err = os.Remove(p); err != nil && !os.IsNotExist(err) {
					return err
				}
			} else if err = os.Remove(p); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}
		if err = os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		tmp := p + ".submodhub.tmp"
		if err = os.WriteFile(tmp, c.Content, 0o600); err != nil {
			return err
		}
		if err = os.Rename(tmp, p); err != nil {
			return err
		}
	}
	j.State = "committed"
	j.UpdatedAt = time.Now().UTC()
	return i.writeJournal(j)
}

func (i *Installer) LoadJournal(id string) (Journal, error) {
	if id == "" || strings.ContainsAny(id, `/\\`) {
		return Journal{}, &Error{Code: "validation_failed", Err: errors.New("invalid operation id")}
	}
	b, err := os.ReadFile(filepath.Join(i.state, id+".json"))
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

// Uninstall removes a committed operation while preserving files that existed
// before it was installed. A separate journal makes the uninstall auditable.
func (i *Installer) Uninstall(id, uninstallID string) error {
	j, err := i.LoadJournal(id)
	if err != nil {
		return err
	}
	if j.State != "committed" {
		return &Error{Code: "invalid_state", Err: fmt.Errorf("operation %s is %s", id, j.State)}
	}
	if uninstallID == "" {
		return &Error{Code: "validation_failed", Err: errors.New("uninstall operation id required")}
	}
	changes := make([]Change, 0, len(j.Operation.Changes))
	for _, c := range j.Operation.Changes {
		p, pathErr := safe(i.root, c.Path)
		if pathErr != nil {
			return &Error{Code: "invalid_path", Path: c.Path, Err: pathErr}
		}
		if _, hashErr := fileHash(p); hashErr != nil {
			return hashErr
		}
		// Uninstall is explicit user intent: remove the current file even if it
		// drifted after installation. The backup remains available for recovery.
		changes = append(changes, Change{Path: c.Path, Remove: true})
	}
	return i.Apply(Operation{ID: uninstallID, Changes: changes})
}
func (i *Installer) previousBackup(currentID, rel string) (string, bool) {
	root := filepath.Join(i.state, "backups")
	var found string
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || strings.Contains(path, string(filepath.Separator)+currentID+string(filepath.Separator)) {
			return nil
		}
		parts := strings.Split(filepath.ToSlash(path), "/")
		want := filepath.ToSlash(filepath.FromSlash(rel))
		if len(parts) >= 2 && strings.HasSuffix(strings.Join(parts[2:], "/"), want) {
			found = path
		}
		return nil
	})
	return found, found != ""
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
	return os.Rename(tmp, filepath.Join(i.state, j.Operation.ID+".json"))
}
