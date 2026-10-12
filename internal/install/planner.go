package install

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type ActionType string

const (
	ActionWrite           ActionType = "write"
	ActionDelete          ActionType = "delete"
	ActionRestoreOriginal ActionType = "restore_original"
	ActionRestoreLayer    ActionType = "restore_layer"
	ActionMetadataOnly    ActionType = "metadata_only"
)

type PlanAction struct {
	Path          string     `json:"path"`
	Key           string     `json:"key"`
	Action        ActionType `json:"action"`
	CurrentSource string     `json:"current_source"`
	TargetSource  string     `json:"target_source"`
	CurrentHash   string     `json:"current_hash"`
	TargetHash    string     `json:"target_hash"`
	CurrentExists bool       `json:"current_exists"`
	TargetExists  bool       `json:"target_exists"`
	Mode          uint32     `json:"mode,omitempty"`
}

type PlanRisk struct {
	Type        string `json:"type"`
	Path        string `json:"path"`
	Description string `json:"description"`
}

type PlanSummary struct {
	RestoresOriginal int `json:"restores_original"`
	RestoresLayer    int `json:"restores_layer"`
	MetadataOnly     int `json:"metadata_only"`
	DeletesAdded     int `json:"deletes_added"`
	WritesNew        int `json:"writes_new"`
}

type Plan struct {
	PlanID               string       `json:"plan_id"`
	Root                 string       `json:"root"`
	Generation           int64        `json:"generation"`
	OperationType        string       `json:"operation_type"`
	TargetInstallationID string       `json:"target_installation_id"`
	OperationID          string       `json:"operation_id"`
	ModID                string       `json:"mod_id,omitempty"`
	ModTitle             string       `json:"mod_title,omitempty"`
	VersionID            string       `json:"version_id,omitempty"`
	Version              string       `json:"version,omitempty"`
	Actions              []PlanAction `json:"actions"`
	Blockers             []string     `json:"blockers"`
	Risks                []PlanRisk   `json:"risks"`
	Summary              PlanSummary  `json:"summary"`
	NewManifest          *Manifest    `json:"-"`
}

type PlannedFile struct {
	Path        string
	Content     []byte
	ExpectedSHA string
	Mode        uint32
}

type InstallOperation struct {
	OperationID    string
	InstallationID string
	ModID          string
	VersionID      string
	Version        string
	Title          string
	Priority       int
	Files          []PlannedFile
}

func manifestCanonicalKey(rel string) string {
	clean := filepath.ToSlash(filepath.Clean(rel))
	if runtime.GOOS == "windows" {
		return strings.ToLower(clean)
	}
	return clean
}

func PlanInstall(m *Manifest, root string, blobs *BlobStore, op InstallOperation) (*Plan, error) {
	if op.OperationID == "" {
		return nil, &Error{Code: "validation_failed", Err: fmt.Errorf("operation id required")}
	}
	instID := op.InstallationID
	if instID == "" {
		if op.ModID != "" {
			instID = op.ModID
		} else {
			instID = op.OperationID
		}
	}

	planID := fmt.Sprintf("plan_install_%s_%d", op.OperationID, time.Now().UnixNano())
	projManifest := m.Clone()
	if projManifest == nil {
		projManifest = NewManifest()
	}

	order := projManifest.NextOrder
	priority := op.Priority
	// Check if this installation already existed (e.g. updating same mod)
	existingInst, isUpdate := projManifest.Installations[instID]
	if isUpdate {
		if existingInst.Order > 0 {
			order = existingInst.Order
		}
		if op.Priority == 0 && existingInst.Priority != 0 {
			priority = existingInst.Priority
		}
	} else {
		projManifest.NextOrder++
	}

	opType := "install"
	if isUpdate {
		opType = "update"
	}

	plan := &Plan{
		PlanID:               planID,
		Root:                 root,
		Generation:           projManifest.Generation,
		OperationType:        opType,
		TargetInstallationID: instID,
		OperationID:          op.OperationID,
		ModID:                op.ModID,
		ModTitle:             op.Title,
		VersionID:            op.VersionID,
		Version:              op.Version,
		Actions:              make([]PlanAction, 0, len(op.Files)),
		Blockers:             make([]string, 0),
		Risks:                make([]PlanRisk, 0),
	}

	seenKeys := make(map[string]bool)
	installedPaths := make([]string, 0, len(op.Files))

	for _, file := range op.Files {
		display, key, err := CanonicalPath(file.Path, ".submodhub/state")
		if err != nil {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("invalid_path: %s (%v)", file.Path, err))
			continue
		}
		if seenKeys[key] {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("duplicate_path: %s", display))
			continue
		}
		seenKeys[key] = true
		installedPaths = append(installedPaths, key)

		targetContent := file.Content
		targetHashHex := hashBytes(targetContent)

		diskPath := filepath.Join(root, filepath.FromSlash(display))
		diskHash, err := fileHash(diskPath)
		if err != nil && !os.IsNotExist(err) {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("disk_read_error: %s (%v)", display, err))
			continue
		}
		diskExists := diskHash != ""

		if file.ExpectedSHA != "" && !strings.EqualFold(diskHash, file.ExpectedSHA) {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("external_change: %s (expected %s got %s)", display, file.ExpectedSHA, diskHash))
		}

		rec := projManifest.GetFile(key)
		var orig OriginalRecord
		var currentSource string

		if rec != nil {
			// File is currently managed
			active := rec.ActiveLayer()
			if active != nil {
				currentSource = active.ModID
				if currentSource == "" {
					currentSource = active.InstallationID
				}
				// Drift check
				if diskHash != active.Hash {
					plan.Blockers = append(plan.Blockers, fmt.Sprintf("external_change: %s (disk %s != expected %s)", display, diskHash, active.Hash))
				}
			} else {
				// No active layers, original snapshot is top
				if rec.Original.Exists {
					currentSource = "original"
					if diskHash != rec.Original.Hash {
						plan.Blockers = append(plan.Blockers, fmt.Sprintf("external_change: %s (disk %s != original %s)", display, diskHash, rec.Original.Hash))
					}
				} else {
					currentSource = "none"
					if diskExists {
						plan.Blockers = append(plan.Blockers, fmt.Sprintf("external_change: %s (file unexpectedly exists on disk)", display))
					}
				}
			}
			orig = rec.Original
		} else {
			// Unmanaged file: take disk snapshot as original
			orig = OriginalRecord{
				Exists: diskExists,
				Hash:   diskHash,
				Mode:   0o644,
			}
			if diskExists {
				currentSource = "original"
				plan.Risks = append(plan.Risks, PlanRisk{
					Type:        "overwriting_external_file",
					Path:        display,
					Description: fmt.Sprintf("Overwrites game/external file %s", display),
				})
			} else {
				currentSource = "none"
			}
		}

		layer := LayerRecord{
			InstallationID: instID,
			ModID:          op.ModID,
			VersionID:      op.VersionID,
			OperationID:    op.OperationID,
			Order:          order,
			Priority:       priority,
			Hash:           targetHashHex,
			Mode:           0o644,
		}

		if err := projManifest.RecordLayer(display, key, orig, layer); err != nil {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("record_layer_error: %s (%v)", display, err))
			continue
		}

		// Now determine which layer is active after this update
		updatedRec := projManifest.GetFile(key)
		newActive := updatedRec.ActiveLayer()

		modSource := op.ModID
		if modSource == "" {
			modSource = instID
		}

		if newActive != nil && newActive.InstallationID == instID {
			// This mod is now top layer -> write action
			plan.Actions = append(plan.Actions, PlanAction{
				Path:          display,
				Key:           key,
				Action:        ActionWrite,
				CurrentSource: currentSource,
				TargetSource:  modSource,
				CurrentHash:   diskHash,
				TargetHash:    targetHashHex,
				CurrentExists: diskExists,
				TargetExists:  true,
				Mode:          0o644,
			})
			plan.Summary.WritesNew++
		} else {
			// Another higher-order mod is above this one -> metadata only!
			plan.Actions = append(plan.Actions, PlanAction{
				Path:          display,
				Key:           key,
				Action:        ActionMetadataOnly,
				CurrentSource: currentSource,
				TargetSource:  currentSource,
				CurrentHash:   diskHash,
				TargetHash:    diskHash,
				CurrentExists: diskExists,
				TargetExists:  diskExists,
				Mode:          0o644,
			})
			plan.Summary.MetadataOnly++
		}
	}

	// Invariant: when updating an existing installation, remove layers for paths that are omitted in the new version
	if isUpdate && existingInst != nil {
		for _, oldKey := range existingInst.Paths {
			if seenKeys[oldKey] {
				continue
			}
			rec := projManifest.GetFile(oldKey)
			if rec == nil {
				continue
			}
			display := rec.DisplayPath
			diskPath := filepath.Join(root, filepath.FromSlash(display))
			diskHash, hErr := fileHash(diskPath)
			if hErr != nil && !os.IsNotExist(hErr) {
				plan.Blockers = append(plan.Blockers, fmt.Sprintf("disk_read_error: %s (%v)", display, hErr))
				continue
			}
			diskExists := diskHash != ""

			activeBefore := rec.ActiveLayer()
			var currentSource string
			var expectedHash string
			if activeBefore != nil {
				currentSource = activeBefore.ModID
				if currentSource == "" {
					currentSource = activeBefore.InstallationID
				}
				expectedHash = activeBefore.Hash
			} else if rec.Original.Exists {
				currentSource = "original"
				expectedHash = rec.Original.Hash
			} else {
				currentSource = "none"
			}

			if diskHash != expectedHash {
				plan.Blockers = append(plan.Blockers, fmt.Sprintf("external_change: %s (disk %s != expected %s)", display, diskHash, expectedHash))
			}

			isTargetActive := activeBefore != nil && activeBefore.InstallationID == instID

			projManifest.RemoveLayer(oldKey, instID)

			if !isTargetActive {
				plan.Actions = append(plan.Actions, PlanAction{
					Path:          display,
					Key:           oldKey,
					Action:        ActionMetadataOnly,
					CurrentSource: currentSource,
					TargetSource:  currentSource,
					CurrentHash:   diskHash,
					TargetHash:    diskHash,
					CurrentExists: diskExists,
					TargetExists:  diskExists,
				})
				plan.Summary.MetadataOnly++
				continue
			}

			recAfter := projManifest.GetFile(oldKey)
			if recAfter != nil && recAfter.ActiveLayer() != nil {
				nextLayer := recAfter.ActiveLayer()
				nextSource := nextLayer.ModID
				if nextSource == "" {
					nextSource = nextLayer.InstallationID
				}
				if blobs != nil && !blobs.Exists(nextLayer.Hash) {
					plan.Blockers = append(plan.Blockers, fmt.Sprintf("missing_blob: %s (%s)", display, nextLayer.Hash))
				}
				plan.Actions = append(plan.Actions, PlanAction{
					Path:          display,
					Key:           oldKey,
					Action:        ActionRestoreLayer,
					CurrentSource: currentSource,
					TargetSource:  nextSource,
					CurrentHash:   diskHash,
					TargetHash:    nextLayer.Hash,
					CurrentExists: diskExists,
					TargetExists:  true,
					Mode:          nextLayer.Mode,
				})
				plan.Summary.RestoresLayer++
			} else if rec.Original.Exists {
				if blobs != nil && !blobs.Exists(rec.Original.Hash) {
					plan.Blockers = append(plan.Blockers, fmt.Sprintf("missing_blob: %s (%s)", display, rec.Original.Hash))
				}
				plan.Actions = append(plan.Actions, PlanAction{
					Path:          display,
					Key:           oldKey,
					Action:        ActionRestoreOriginal,
					CurrentSource: currentSource,
					TargetSource:  "original",
					CurrentHash:   diskHash,
					TargetHash:    rec.Original.Hash,
					CurrentExists: diskExists,
					TargetExists:  true,
					Mode:          rec.Original.Mode,
				})
				plan.Summary.RestoresOriginal++
			} else {
				plan.Actions = append(plan.Actions, PlanAction{
					Path:          display,
					Key:           oldKey,
					Action:        ActionDelete,
					CurrentSource: currentSource,
					TargetSource:  "none",
					CurrentHash:   diskHash,
					TargetHash:    "",
					CurrentExists: diskExists,
					TargetExists:  false,
				})
				plan.Summary.DeletesAdded++
			}
		}
	}

	// Update installation entry in projected manifest
	projManifest.Installations[instID] = &InstallationRecord{
		InstallationID: instID,
		ModID:          op.ModID,
		VersionID:      op.VersionID,
		Version:        op.Version,
		Title:          op.Title,
		OperationID:    op.OperationID,
		Order:          order,
		Priority:       priority,
		Paths:          installedPaths,
		InstalledAt:    time.Now().UTC(),
	}

	plan.NewManifest = projManifest
	return plan, nil
}

func PlanUninstall(m *Manifest, root string, blobs *BlobStore, targetID, uninstallOpID string) (*Plan, error) {
	if targetID == "" {
		return nil, &Error{Code: "validation_failed", Err: fmt.Errorf("target id required")}
	}
	planID := fmt.Sprintf("plan_uninstall_%s_%d", targetID, time.Now().UnixNano())

	projManifest := m.Clone()
	if projManifest == nil {
		return nil, &Error{Code: "not_found", Err: fmt.Errorf("manifest is empty")}
	}

	// Find installation record by InstallationID, ModID, or OperationID
	var inst *InstallationRecord
	var instKey string
	for k, v := range projManifest.Installations {
		if k == targetID || v.ModID == targetID || v.OperationID == targetID {
			inst = v
			instKey = k
			break
		}
	}
	if inst == nil {
		return nil, &Error{Code: "not_found", Err: fmt.Errorf("installation %s not found", targetID)}
	}

	plan := &Plan{
		PlanID:               planID,
		Root:                 root,
		Generation:           projManifest.Generation,
		OperationType:        "uninstall",
		TargetInstallationID: inst.InstallationID,
		OperationID:          uninstallOpID,
		ModID:                inst.ModID,
		ModTitle:             inst.Title,
		VersionID:            inst.VersionID,
		Version:              inst.Version,
		Actions:              make([]PlanAction, 0, len(inst.Paths)),
		Blockers:             make([]string, 0),
		Risks:                make([]PlanRisk, 0),
	}

	for _, key := range inst.Paths {
		rec := projManifest.GetFile(key)
		if rec == nil {
			continue
		}
		display := rec.DisplayPath
		diskPath := filepath.Join(root, filepath.FromSlash(display))
		diskHash, err := fileHash(diskPath)
		if err != nil && !os.IsNotExist(err) {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("disk_read_error: %s (%v)", display, err))
			continue
		}
		diskExists := diskHash != ""


		activeBefore := rec.ActiveLayer()
		var currentSource string
		var expectedHash string
		if activeBefore != nil {
			currentSource = activeBefore.ModID
			if currentSource == "" {
				currentSource = activeBefore.InstallationID
			}
			expectedHash = activeBefore.Hash
		} else if rec.Original.Exists {
			currentSource = "original"
			expectedHash = rec.Original.Hash
		} else {
			currentSource = "none"
		}

		// Drift detection: verify disk matches expected active layer
		if diskHash != expectedHash {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("external_change: %s (disk %s != expected %s)", display, diskHash, expectedHash))
		}

		isTargetActive := activeBefore != nil && activeBefore.InstallationID == inst.InstallationID

		// Remove the target layer in projected manifest
		projManifest.RemoveLayer(key, inst.InstallationID)

		if !isTargetActive {
			// The uninstalled mod was NOT the top layer; disk stays as-is
			plan.Actions = append(plan.Actions, PlanAction{
				Path:          display,
				Key:           key,
				Action:        ActionMetadataOnly,
				CurrentSource: currentSource,
				TargetSource:  currentSource,
				CurrentHash:   diskHash,
				TargetHash:    diskHash,
				CurrentExists: diskExists,
				TargetExists:  diskExists,
			})
			plan.Summary.MetadataOnly++
			continue
		}

		// Target WAS the top layer; determine what becomes active now
		recAfter := projManifest.GetFile(key)
		if recAfter != nil && recAfter.ActiveLayer() != nil {
			nextLayer := recAfter.ActiveLayer()
			nextSource := nextLayer.ModID
			if nextSource == "" {
				nextSource = nextLayer.InstallationID
			}

			// Verify required blob exists in BlobStore
			if blobs != nil && !blobs.Exists(nextLayer.Hash) {
				plan.Blockers = append(plan.Blockers, fmt.Sprintf("missing_blob: %s (%s)", display, nextLayer.Hash))
			}

			plan.Actions = append(plan.Actions, PlanAction{
				Path:          display,
				Key:           key,
				Action:        ActionRestoreLayer,
				CurrentSource: currentSource,
				TargetSource:  nextSource,
				CurrentHash:   diskHash,
				TargetHash:    nextLayer.Hash,
				CurrentExists: diskExists,
				TargetExists:  true,
				Mode:          nextLayer.Mode,
			})
			plan.Summary.RestoresLayer++
		} else {
			// No layers remaining: restore original
			if rec.Original.Exists {
				if blobs != nil && !blobs.Exists(rec.Original.Hash) {
					plan.Blockers = append(plan.Blockers, fmt.Sprintf("missing_blob: %s (%s)", display, rec.Original.Hash))
				}
				plan.Actions = append(plan.Actions, PlanAction{
					Path:          display,
					Key:           key,
					Action:        ActionRestoreOriginal,
					CurrentSource: currentSource,
					TargetSource:  "original",
					CurrentHash:   diskHash,
					TargetHash:    rec.Original.Hash,
					CurrentExists: diskExists,
					TargetExists:  true,
					Mode:          rec.Original.Mode,
				})
				plan.Summary.RestoresOriginal++
			} else {
				plan.Actions = append(plan.Actions, PlanAction{
					Path:          display,
					Key:           key,
					Action:        ActionDelete,
					CurrentSource: currentSource,
					TargetSource:  "none",
					CurrentHash:   diskHash,
					TargetHash:    "",
					CurrentExists: diskExists,
					TargetExists:  false,
				})
				plan.Summary.DeletesAdded++
			}
		}
	}

	delete(projManifest.Installations, instKey)
	plan.NewManifest = projManifest
	return plan, nil
}

func applyPlanToManifest(m *Manifest, p *Plan) {
	if p.NewManifest != nil {
		m.SchemaVersion = p.NewManifest.SchemaVersion
		m.Generation = p.NewManifest.Generation + 1
		m.NextOrder = p.NewManifest.NextOrder
		m.Files = p.NewManifest.Files
		m.Installations = p.NewManifest.Installations
	}
}
