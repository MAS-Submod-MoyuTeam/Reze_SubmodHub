package install

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type AdoptOperation struct {
	OperationID    string
	InstallationID string
	ModID          string
	VersionID      string
	Version        string
	Title          string
	Priority       int
	Files          []string // Display relative paths to adopt
}

type AdoptPreviewFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	Status string `json:"status"` // "matched" | "untracked" | "conflict"
}

type AdoptPreview struct {
	PlanID               string             `json:"plan_id"`
	OperationID          string             `json:"operation_id"`
	TargetInstallationID string             `json:"target_installation_id"`
	ModID                string             `json:"mod_id"`
	VersionID            string             `json:"version_id"`
	Version              string             `json:"version"`
	Title                string             `json:"title"`
	Priority             int                `json:"priority"`
	Files                []AdoptPreviewFile `json:"files"`
	Blockers             []string           `json:"blockers"`
	Plan                 *Plan              `json:"-"`
}

// PlanAdoption creates an adoption plan.
// It verifies that each file to be adopted exists on disk and is NOT already managed by another installation.
// Every adopted file is recorded as an OriginalRecord (baseline) so that if uninstalled, the original file is preserved/restored.
// All file contents are snapshotted into blob storage so they can be restored or verified.
func PlanAdoption(m *Manifest, root string, blobs *BlobStore, op AdoptOperation) (*Plan, error) {
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

	planID := fmt.Sprintf("plan_adopt_%s_%d", op.OperationID, time.Now().UnixNano())
	projManifest := m.Clone()
	if projManifest == nil {
		projManifest = NewManifest()
	}

	// Check if this installation ID already exists
	if _, exists := projManifest.Installations[instID]; exists {
		return nil, &Error{Code: "conflict", Err: fmt.Errorf("installation %s already exists", instID)}
	}

	order := projManifest.NextOrder
	projManifest.NextOrder++

	plan := &Plan{
		PlanID:               planID,
		Root:                 root,
		Generation:           projManifest.Generation,
		OperationType:        "adopt",
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

	instRec := &InstallationRecord{
		InstallationID: instID,
		ModID:          op.ModID,
		VersionID:      op.VersionID,
		Version:        op.Version,
		Title:          op.Title,
		OperationID:    op.OperationID,
		Order:          order,
		Priority:       op.Priority,
		Paths:          make([]string, 0, len(op.Files)),
		InstalledAt:    time.Now().UTC(),
	}

	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		realRoot = filepath.Clean(root)
	}

	for _, relPath := range op.Files {
		displayPath, canonKey, err := CanonicalPath(relPath, "")
		if err != nil {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("invalid_path: %s (%v)", relPath, err))
			continue
		}

		diskPath := filepath.Join(root, filepath.FromSlash(displayPath))

		// Prevent symlink traversal out of root
		realTarget, evalErr := filepath.EvalSymlinks(diskPath)
		if evalErr != nil {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("file_missing_or_unreadable: %s (%v)", displayPath, evalErr))
			continue
		}
		relToRealRoot, relErr := filepath.Rel(realRoot, realTarget)
		if relErr != nil || strings.HasPrefix(relToRealRoot, "..") || filepath.IsAbs(relToRealRoot) {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("symlink_target_out_of_bounds: %s points outside root", displayPath))
			continue
		}

		data, readErr := os.ReadFile(realTarget)
		if readErr != nil {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("file_missing_or_unreadable: %s (%v)", displayPath, readErr))
			continue
		}

		h := sha256.Sum256(data)
		fileHashStr := hex.EncodeToString(h[:])

		// Ensure blob exists in blob store
		if blobs != nil {
			if _, err := blobs.Put(data); err != nil {
				plan.Blockers = append(plan.Blockers, fmt.Sprintf("blob_store_error: %s (%v)", displayPath, err))
				continue
			}
		}

		stat, _ := os.Stat(diskPath)
		var mode uint32 = 0o644
		if stat != nil {
			mode = uint32(stat.Mode().Perm())
		}

		// Check if file is already managed by another active installation in the manifest
		existingRec := projManifest.GetFile(canonKey)
		if existingRec != nil && len(existingRec.Layers) > 0 {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("conflict_already_managed: %s is managed by installation %s", displayPath, existingRec.ActiveLayer().InstallationID))
			continue
		}

		// When adopting, the existing file on disk is the original baseline:
		// OriginalRecord has Exists: true, Hash: fileHashStr, Mode: mode.
		orig := OriginalRecord{
			Exists: true,
			Hash:   fileHashStr,
			Mode:   mode,
		}

		layer := LayerRecord{
			InstallationID: instID,
			ModID:          op.ModID,
			VersionID:      op.VersionID,
			OperationID:    op.OperationID,
			Order:          order,
			Priority:       op.Priority,
			Hash:           fileHashStr,
			Mode:           mode,
		}

		if err := projManifest.RecordLayer(displayPath, canonKey, orig, layer); err != nil {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("record_layer_error: %s (%v)", displayPath, err))
			continue
		}

		instRec.Paths = append(instRec.Paths, canonKey)

		// Disk file is already in place with fileHashStr.
		// Action is ActionMetadataOnly because no bytes need to be rewritten during adoption.
		plan.Actions = append(plan.Actions, PlanAction{
			Path:          displayPath,
			Key:           canonKey,
			Action:        ActionMetadataOnly,
			CurrentSource: "unmanaged",
			TargetSource:  op.ModID,
			CurrentHash:   fileHashStr,
			TargetHash:    fileHashStr,
			CurrentExists: true,
			TargetExists:  true,
			Mode:          mode,
		})
		plan.Summary.MetadataOnly++
	}

	projManifest.Installations[instID] = instRec
	plan.NewManifest = projManifest

	return plan, nil
}
