package install

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type OriginalRecord struct {
	Exists bool   `json:"exists"`
	Hash   string `json:"hash,omitempty"`
	Mode   uint32 `json:"mode,omitempty"`
}

type LayerRecord struct {
	InstallationID string `json:"installation_id"`
	ModID          string `json:"mod_id,omitempty"`
	VersionID      string `json:"version_id,omitempty"`
	OperationID    string `json:"operation_id,omitempty"`
	Order          int64  `json:"order"`
	Priority       int    `json:"priority"`
	Hash           string `json:"hash"`
	Mode           uint32 `json:"mode,omitempty"`
}

type FileRecord struct {
	DisplayPath string         `json:"display_path"`
	Original    OriginalRecord `json:"original"`
	Layers      []LayerRecord  `json:"layers"`
}

func (f *FileRecord) ActiveLayer() *LayerRecord {
	if f == nil || len(f.Layers) == 0 {
		return nil
	}
	// Layers are sorted by Order ascending; last one is highest order
	return &f.Layers[len(f.Layers)-1]
}

type InstallationRecord struct {
	InstallationID string    `json:"installation_id"`
	ModID          string    `json:"mod_id,omitempty"`
	VersionID      string    `json:"version_id,omitempty"`
	Version        string    `json:"version,omitempty"`
	Title          string    `json:"title,omitempty"`
	OperationID    string    `json:"operation_id"`
	Order          int64     `json:"order"`
	Priority       int       `json:"priority"`
	Paths          []string  `json:"paths"` // canonical keys
	InstalledAt    time.Time `json:"installed_at"`
}

type Manifest struct {
	SchemaVersion int                            `json:"schema_version"`
	Generation    int64                          `json:"generation"`
	NextOrder     int64                          `json:"next_order"`
	Files         map[string]*FileRecord         `json:"files"`
	Installations map[string]*InstallationRecord `json:"installations"`
}

func NewManifest() *Manifest {
	return &Manifest{
		SchemaVersion: 2,
		Generation:    1,
		NextOrder:     1,
		Files:         make(map[string]*FileRecord),
		Installations: make(map[string]*InstallationRecord),
	}
}

// CanonicalPath validates and normalizes a relative file path.
// It returns the clean display path (using /) and a canonical key (lowercased on Windows).
func CanonicalPath(rel string, stateDirRel string) (displayPath, key string, err error) {
	if rel == "" {
		return "", "", &Error{Code: "invalid_path", Path: rel, Err: errors.New("empty path")}
	}
	// Check for Windows Alternate Data Streams (ADS)
	if strings.Contains(rel, ":") {
		return "", "", &Error{Code: "invalid_path", Path: rel, Err: errors.New("alternate data streams or drive letters forbidden")}
	}
	// Check for UNC prefix
	if strings.HasPrefix(rel, `\\`) || strings.HasPrefix(rel, "//") {
		return "", "", &Error{Code: "invalid_path", Path: rel, Err: errors.New("UNC path forbidden")}
	}

	clean := filepath.ToSlash(filepath.Clean(rel))
	if filepath.IsAbs(clean) || strings.HasPrefix(clean, "/") {
		return "", "", &Error{Code: "invalid_path", Path: rel, Err: errors.New("absolute path forbidden")}
	}
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", "", &Error{Code: "invalid_path", Path: rel, Err: errors.New("path traversal outside root forbidden")}
	}

	// Reject paths attempting to write inside the state directory
	if stateDirRel != "" {
		stateClean := filepath.ToSlash(filepath.Clean(stateDirRel))
		comparisonPath := clean
		if runtime.GOOS == "windows" {
			comparisonPath = strings.ToLower(comparisonPath)
			stateClean = strings.ToLower(stateClean)
		}
		if comparisonPath == stateClean || strings.HasPrefix(comparisonPath, stateClean+"/") {
			return "", "", &Error{Code: "invalid_path", Path: rel, Err: errors.New("writing to state directory forbidden")}
		}
	}

	displayPath = clean
	if runtime.GOOS == "windows" {
		key = strings.ToLower(clean)
	} else {
		key = clean
	}
	return displayPath, key, nil
}

func (m *Manifest) GetFile(key string) *FileRecord {
	if m == nil || m.Files == nil {
		return nil
	}
	return m.Files[key]
}

// RecordLayer adds or updates a layer for the specified file.
// If the file was not managed or all layers were uninstalled, orig is recorded as the original snapshot.
// If the file is already managed with active layers, orig is ignored to protect the true original snapshot.
func (m *Manifest) RecordLayer(displayPath, key string, orig OriginalRecord, layer LayerRecord) error {
	if m.Files == nil {
		m.Files = make(map[string]*FileRecord)
	}
	rec, exists := m.Files[key]
	if !exists {
		rec = &FileRecord{
			DisplayPath: displayPath,
			Original:    orig,
			Layers:      []LayerRecord{layer},
		}
		m.Files[key] = rec
		return nil
	}

	// If rec already exists, ensure display path is preserved or updated
	if rec.DisplayPath == "" {
		rec.DisplayPath = displayPath
	}

	// Invariant: If all layers were uninstalled, this file was unmanaged.
	// When re-managed, take fresh snapshot from disk.
	if len(rec.Layers) == 0 {
		rec.Original = orig
	}

	// Check if this installation already has a layer
	replaced := false
	for i, l := range rec.Layers {
		if l.InstallationID == layer.InstallationID {
			rec.Layers[i] = layer
			replaced = true
			break
		}
	}
	if !replaced {
		rec.Layers = append(rec.Layers, layer)
	}

	// Sort layers by priority and order ascending
	sort.Slice(rec.Layers, func(i, j int) bool {
		return compareLayers(rec.Layers[i], rec.Layers[j])
	})
	return nil
}

func compareLayers(a, b LayerRecord) bool {
	if a.Priority != b.Priority {
		return a.Priority < b.Priority
	}
	if a.Order != b.Order {
		return a.Order < b.Order
	}
	if a.ModID != b.ModID {
		return a.ModID < b.ModID
	}
	return a.InstallationID < b.InstallationID
}

// RemoveLayer removes the layer for installationID from key.
// Returns whether a layer was removed and the count of remaining layers.
func (m *Manifest) RemoveLayer(key, installationID string) (bool, int) {
	if m == nil || m.Files == nil {
		return false, 0
	}
	rec, exists := m.Files[key]
	if !exists {
		return false, 0
	}
	newLayers := make([]LayerRecord, 0, len(rec.Layers))
	removed := false
	for _, l := range rec.Layers {
		if l.InstallationID == installationID {
			removed = true
		} else {
			newLayers = append(newLayers, l)
		}
	}
	rec.Layers = newLayers
	if len(newLayers) == 0 {
		// Invariant: When all layers are uninstalled, the file becomes unmanaged.
		// Delete the file entry so next installation takes a fresh disk snapshot!
		delete(m.Files, key)
		return removed, 0
	}
	return removed, len(newLayers)
}

// Clone creates a deep copy of Manifest for isolation during transaction planning.
func (m *Manifest) Clone() *Manifest {
	b, _ := json.Marshal(m)
	var clone Manifest
	_ = json.Unmarshal(b, &clone)
	return &clone
}

func (m *Manifest) Save(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + fmt.Sprintf(".tmp.%d", time.Now().UnixNano())
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return safeAtomicRename(tmp, path)
}

func LoadManifest(path string) (*Manifest, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return NewManifest(), nil
	}
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	if m.Files == nil {
		m.Files = make(map[string]*FileRecord)
	}
	if m.Installations == nil {
		m.Installations = make(map[string]*InstallationRecord)
	}
	return &m, nil
}
