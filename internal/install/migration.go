package install

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func MigrateLegacyState(root, stateDir string) (*Manifest, error) {
	manifestPath := filepath.Join(stateDir, "manifest.json")
	if _, err := os.Stat(manifestPath); err == nil {
		return LoadManifest(manifestPath)
	}

	entries, err := os.ReadDir(stateDir)
	if os.IsNotExist(err) {
		return NewManifest(), nil
	}
	if err != nil {
		return nil, err
	}

	// Read all legacy journals
	journals := make([]Journal, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		name := entry.Name()
		if name == "manifest.json" || name == "installed-archives.json" || strings.Contains(name, ".tmp") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(stateDir, name))
		if err != nil {
			continue
		}
		var j Journal
		if err := json.Unmarshal(b, &j); err != nil {
			continue
		}
		if j.State == "committed" {
			journals = append(journals, j)
		}
	}

	if len(journals) == 0 {
		return NewManifest(), nil
	}

		// Load installed receipts if present to ground active installations
	receiptPaths := []string{
		filepath.Join(stateDir, "installed-archives.json"),
		filepath.Join(filepath.Dir(stateDir), "installed-archives.json"),
	}
	type legacyReceipt struct {
		ModID       string `json:"mod_id"`
		OperationID string `json:"operation_id"`
	}
	var validReceiptOps map[string]bool
	for _, rp := range receiptPaths {
		if b, err := os.ReadFile(rp); err == nil {
			var rList []legacyReceipt
			if err := json.Unmarshal(b, &rList); err == nil {
				validReceiptOps = make(map[string]bool)
				for _, r := range rList {
					if r.OperationID != "" {
						validReceiptOps[r.OperationID] = true
					}
					if r.ModID != "" {
						validReceiptOps[r.ModID] = true
					}
				}
				break
			}
		}
	}

	// Filter out uninstall journals and the uninstalled operations they targeted
	uninstalledIDs := make(map[string]bool)
	for _, j := range journals {
		isUninstall := false
		for _, c := range j.Operation.Changes {
			if c.Remove {
				isUninstall = true
				break
			}
		}
		if isUninstall || strings.HasPrefix(j.Operation.ID, "uninstall") || strings.Contains(j.Operation.ID, "_uninstall") {
			uninstalledIDs[j.Operation.ID] = true
			if strings.HasPrefix(j.Operation.ID, "uninstall_") {
				uninstalledIDs[strings.TrimPrefix(j.Operation.ID, "uninstall_")] = true
			}
			if strings.HasSuffix(j.Operation.ID, "_uninstall") {
				uninstalledIDs[strings.TrimSuffix(j.Operation.ID, "_uninstall")] = true
			}
		}
	}

	activeJournals := make([]Journal, 0)
	for _, j := range journals {
		if uninstalledIDs[j.Operation.ID] {
			continue
		}
		if validReceiptOps != nil && !validReceiptOps[j.Operation.ID] {
			continue
		}
		isUninstall := false
		for _, c := range j.Operation.Changes {
			if c.Remove {
				isUninstall = true
				break
			}
		}
		if !isUninstall {
			activeJournals = append(activeJournals, j)
		}
	}
	// Sort active journals by UpdatedAt ascending
	sort.Slice(activeJournals, func(i, j int) bool {
		return activeJournals[i].UpdatedAt.Before(activeJournals[j].UpdatedAt)
	})

	// Check for ambiguous timestamps
	for i := 0; i < len(activeJournals)-1; i++ {
		if activeJournals[i].UpdatedAt.Equal(activeJournals[i+1].UpdatedAt) {
			return nil, &Error{
				Code: "migration_required",
				Err:  fmt.Errorf("ambiguous operation order: %s and %s share identical timestamp", activeJournals[i].Operation.ID, activeJournals[i+1].Operation.ID),
			}
		}
	}

	blobs := NewBlobStore(filepath.Join(stateDir, "blobs"))
	manifest := NewManifest()

	// Track operations touching each path
	type pathTouch struct {
		opIndex int
		opID    string
		backup  string
	}
	touchesByPath := make(map[string][]pathTouch)

	for opIdx, j := range activeJournals {
		for _, c := range j.Operation.Changes {
			_, key, err := CanonicalPath(c.Path, ".submodhub/state")
			if err != nil {
				return nil, &Error{Code: "migration_required", Path: c.Path, Err: err}
			}
			backup := ""
			if j.Backups != nil {
				backup = j.Backups[c.Path]
			}
			touchesByPath[key] = append(touchesByPath[key], pathTouch{
				opIndex: opIdx,
				opID:    j.Operation.ID,
				backup:  backup,
			})
		}
	}

	// Reconstruct original snapshot and each layer
	for key, touches := range touchesByPath {
		display := touches[0].backup
		if display == "" {
			display = key
		}

		firstTouch := touches[0]
		var orig OriginalRecord
		if firstTouch.backup != "" {
			backupData, err := os.ReadFile(firstTouch.backup)
			if err != nil {
				return nil, &Error{Code: "migration_required", Path: key, Err: fmt.Errorf("missing original backup: %v", err)}
			}
			h, err := blobs.Put(backupData)
			if err != nil {
				return nil, &Error{Code: "migration_required", Path: key, Err: err}
			}
			orig = OriginalRecord{
				Exists: true,
				Hash:   h,
				Mode:   0o644,
			}
		} else {
			orig = OriginalRecord{
				Exists: false,
			}
		}

		for i, touch := range touches {
			var layerHash string
			if i < len(touches)-1 {
				// The next touch has a backup of THIS layer's content
				nextTouch := touches[i+1]
				if nextTouch.backup == "" {
					return nil, &Error{Code: "migration_required", Path: key, Err: errors.New("missing intermediate backup")}
				}
				data, err := os.ReadFile(nextTouch.backup)
				if err != nil {
					return nil, &Error{Code: "migration_required", Path: key, Err: err}
				}
				h, err := blobs.Put(data)
				if err != nil {
					return nil, &Error{Code: "migration_required", Path: key, Err: err}
				}
				layerHash = h
			} else {
				// This is the active top layer: read current content from disk
				diskPath := filepath.Join(root, filepath.FromSlash(key))
				data, err := os.ReadFile(diskPath)
				if err != nil {
					return nil, &Error{Code: "migration_required", Path: key, Err: fmt.Errorf("top layer missing from disk: %v", err)}
				}
				h, err := blobs.Put(data)
				if err != nil {
					return nil, &Error{Code: "migration_required", Path: key, Err: err}
				}
				layerHash = h
			}

			layer := LayerRecord{
				InstallationID: touch.opID,
				OperationID:    touch.opID,
				Order:          int64(touch.opIndex + 1),
				Hash:           layerHash,
				Mode:           0o644,
			}
			if err := manifest.RecordLayer(key, key, orig, layer); err != nil {
				return nil, &Error{Code: "migration_required", Path: key, Err: err}
			}
		}
	}

	for _, j := range activeJournals {
		instPaths := make([]string, 0, len(j.Operation.Changes))
		for _, c := range j.Operation.Changes {
			_, key, _ := CanonicalPath(c.Path, ".submodhub/state")
			instPaths = append(instPaths, key)
		}
		manifest.Installations[j.Operation.ID] = &InstallationRecord{
			InstallationID: j.Operation.ID,
			OperationID:    j.Operation.ID,
			Paths:          instPaths,
			InstalledAt:    j.UpdatedAt,
		}
	}

	manifest.NextOrder = int64(len(activeJournals) + 1)
	if err := manifest.Save(manifestPath); err != nil {
		return nil, err
	}

	return manifest, nil
}
