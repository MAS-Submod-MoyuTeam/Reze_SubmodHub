package install

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func (i *Installer) PreviewRepair(targetID, operationID string) (*Plan, error) {
	lock, err := i.acquireLock()
	if err != nil {
		return nil, err
	}
	defer lock.Release()
	if err := i.recoverPendingLocked(); err != nil {
		return nil, err
	}
	manifest, err := i.LoadManifest()
	if err != nil {
		return nil, err
	}
	installation := manifest.Installations[targetID]
	if installation == nil {
		for id, inst := range manifest.Installations {
			if inst != nil && ((inst.ModID != "" && inst.ModID == targetID) ||
				(inst.InstallationID != "" && inst.InstallationID == targetID) ||
				(inst.OperationID != "" && inst.OperationID == targetID)) {
				installation = inst
				targetID = id
				break
			}
		}
	}
	if installation == nil {
		// Fallback check receipts (installed-archives.json) under the lock
		for _, recPath := range []string{
			filepath.Join(i.state, "installed-archives.json"),
			filepath.Join(i.root, ".submodhub", "installed-archives.json"),
		} {
			data, err := os.ReadFile(recPath)
			if err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return nil, fmt.Errorf("failed to read installed archives for repair: %w", err)
			}
			var receipts []struct {
				ModID       string `json:"mod_id"`
				OperationID string `json:"operation_id"`
			}
			if err := json.Unmarshal(data, &receipts); err != nil {
				return nil, fmt.Errorf("failed to read installed archives for repair: %w", err)
			}
			for _, rec := range receipts {
				if (rec.ModID != "" && rec.ModID == targetID) || (rec.OperationID != "" && rec.OperationID == targetID) {
					if manifest.Installations[rec.OperationID] != nil {
						installation = manifest.Installations[rec.OperationID]
						targetID = rec.OperationID
						break
					}
					if manifest.Installations[rec.ModID] != nil {
						installation = manifest.Installations[rec.ModID]
						targetID = rec.ModID
						break
					}
					for id, inst := range manifest.Installations {
						if inst != nil && ((rec.ModID != "" && inst.ModID == rec.ModID) || (rec.OperationID != "" && inst.OperationID == rec.OperationID)) {
							installation = inst
							targetID = id
							break
						}
					}
					if installation != nil {
						break
					}
				}
			}
			if installation != nil {
				break
			}
		}
	}
	if installation == nil {
		return nil, &Error{Code: "installation_not_found", Err: fmt.Errorf("managed installation %s not found", targetID)}
	}
	if operationID == "" {
		return nil, &Error{Code: "validation_failed", Err: fmt.Errorf("operation id required")}
	}
	plan := &Plan{PlanID: fmt.Sprintf("plan_repair_%s_%d", operationID, time.Now().UnixNano()), Root: i.root, Generation: manifest.Generation, OperationType: "repair", TargetInstallationID: targetID, OperationID: operationID, ModID: installation.ModID, ModTitle: installation.Title, VersionID: installation.VersionID, Version: installation.Version, NewManifest: manifest.Clone(), Actions: []PlanAction{}, Blockers: []string{}, Risks: []PlanRisk{}, SpriteSetIDs: installation.SpriteSetIDs, SpriteSelectionHash: installation.SpriteSelectionHash, SelectedSpriteSetCount: installation.SelectedSpriteSetCount}
	for _, key := range installation.Paths {
		record := manifest.Files[key]
		if record == nil || record.ActiveLayer() == nil {
			return nil, &Error{Code: "manifest_corrupt", Path: key, Err: fmt.Errorf("managed file has no active layer")}
		}
		var targetLayer *LayerRecord
		for idx := range record.Layers {
			layer := &record.Layers[idx]
			if layer.InstallationID == targetID ||
				(installation.ModID != "" && layer.ModID == installation.ModID) ||
				(installation.OperationID != "" && layer.OperationID == installation.OperationID) {
				targetLayer = layer
				break
			}
		}
		if targetLayer == nil {
			return nil, &Error{Code: "manifest_corrupt", Path: key, Err: fmt.Errorf("managed file has no layer for installation %s", targetID)}
		}
		if err := i.blobs.Verify(targetLayer.Hash); err != nil {
			return nil, err
		}
		path, err := safe(i.root, record.DisplayPath)
		if err != nil {
			return nil, err
		}
		currentHash, err := fileHash(path)
		if err != nil {
			return nil, err
		}

		active := record.ActiveLayer()
		// If the file's active layer belongs to another installation (e.g. shadowed by higher priority
		// or later installation), repairing targetID must NOT overwrite the active layer on disk.
		if active.InstallationID != targetID {
			plan.Summary.MetadataOnly++
			plan.Risks = append(plan.Risks, PlanRisk{
				Type:        "shadowed_layer",
				Path:        record.DisplayPath,
				Description: fmt.Sprintf("File is actively owned by another installation (%s); target installation layer remains preserved in blob store.", active.InstallationID),
			})
			plan.Actions = append(plan.Actions, PlanAction{
				Path:          filepath.ToSlash(record.DisplayPath),
				Key:           key,
				Action:        ActionMetadataOnly,
				CurrentSource: active.InstallationID,
				TargetSource:  active.InstallationID,
				CurrentHash:   currentHash,
				TargetHash:    active.Hash,
				CurrentExists: currentHash != "",
				TargetExists:  true,
				Mode:          active.Mode,
			})
			continue
		}

		action := ActionMetadataOnly
		if currentHash != targetLayer.Hash {
			action = ActionWrite
			plan.Summary.WritesNew++
			plan.Risks = append(plan.Risks, PlanRisk{Type: "external_change", Path: record.DisplayPath, Description: "Explicit repair restores the active managed layer; current bytes are backed up before writing."})
		} else {
			plan.Summary.MetadataOnly++
		}
		plan.Actions = append(plan.Actions, PlanAction{Path: filepath.ToSlash(record.DisplayPath), Key: key, Action: action, CurrentSource: targetLayer.InstallationID, TargetSource: targetLayer.InstallationID, CurrentHash: currentHash, TargetHash: targetLayer.Hash, CurrentExists: currentHash != "", TargetExists: true, Mode: targetLayer.Mode})
	}
	return plan, nil
}
