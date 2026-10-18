package install

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type PriorityChangeRequest struct {
	OperationID string         `json:"operation_id"`
	Priorities  map[string]int `json:"priorities"`
}

func PlanPriority(m *Manifest, root string, blobs *BlobStore, req PriorityChangeRequest) (*Plan, error) {
	if m == nil || len(m.Installations) == 0 {
		return nil, &Error{Code: "manifest_empty", Err: errors.New("no managed installations found")}
	}
	if len(req.Priorities) == 0 {
		return nil, &Error{Code: "validation_failed", Err: errors.New("empty priorities map")}
	}

	opID := req.OperationID
	if opID == "" {
		opID = fmt.Sprintf("priority_%d", time.Now().UnixNano())
	}
	planID := fmt.Sprintf("plan_priority_%s_%d", opID, time.Now().UnixNano())

	projManifest := m.Clone()
	if projManifest == nil {
		return nil, &Error{Code: "manifest_corrupt", Err: errors.New("cannot clone manifest")}
	}

	effectivePriorities := make(map[string]int)
	for targetID, newP := range req.Priorities {
		var foundInst *InstallationRecord
		for k, inst := range projManifest.Installations {
			if k == targetID || inst.ModID == targetID {
				foundInst = inst
				break
			}
		}
		if foundInst == nil {
			return nil, &Error{Code: "not_found", Err: fmt.Errorf("installation %q not found", targetID)}
		}
		foundInst.Priority = newP
		effectivePriorities[foundInst.InstallationID] = newP
		if foundInst.ModID != "" {
			effectivePriorities[foundInst.ModID] = newP
		}
	}

	plan := &Plan{
		PlanID:        planID,
		Root:          root,
		Generation:    projManifest.Generation,
		OperationType: "priority",
		OperationID:   opID,
		Actions:       make([]PlanAction, 0),
		Blockers:      make([]string, 0),
		Risks:         make([]PlanRisk, 0),
	}

	keys := make([]string, 0, len(projManifest.Files))
	for k := range projManifest.Files {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, key := range keys {
		rec := projManifest.Files[key]
		if rec == nil || len(rec.Layers) == 0 {
			continue
		}

		oldRec := m.Files[key]
		var activeBefore *LayerRecord
		if oldRec != nil {
			activeBefore = oldRec.ActiveLayer()
		}

		for idx := range rec.Layers {
			l := &rec.Layers[idx]
			if p, ok := effectivePriorities[l.InstallationID]; ok {
				l.Priority = p
			} else if p, ok := effectivePriorities[l.ModID]; ok {
				l.Priority = p
			}
		}

		sort.Slice(rec.Layers, func(i, j int) bool {
			return compareLayers(rec.Layers[i], rec.Layers[j])
		})

		activeAfter := rec.ActiveLayer()
		display := rec.DisplayPath
		diskPath := filepath.Join(root, filepath.FromSlash(display))
		diskHash, err := fileHash(diskPath)
		if err != nil && !os.IsNotExist(err) {
			plan.Blockers = append(plan.Blockers, fmt.Sprintf("disk_read_error: %s (%v)", display, err))
			continue
		}
		diskExists := diskHash != ""

		var currentSource, expectedHash string
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

		if activeBefore == nil && activeAfter == nil {
			continue
		}
		if activeBefore != nil && activeAfter != nil && activeBefore.InstallationID == activeAfter.InstallationID {
			continue
		}

		nextSource := activeAfter.ModID
		if nextSource == "" {
			nextSource = activeAfter.InstallationID
		}

		if activeBefore != nil && activeBefore.Hash == activeAfter.Hash {
			plan.Actions = append(plan.Actions, PlanAction{
				Path:          display,
				Key:           key,
				Action:        ActionMetadataOnly,
				CurrentSource: currentSource,
				TargetSource:  nextSource,
				CurrentHash:   diskHash,
				TargetHash:    activeAfter.Hash,
				CurrentExists: diskExists,
				TargetExists:  true,
				Mode:          activeAfter.Mode,
			})
			plan.Summary.MetadataOnly++
		} else {
			if blobs != nil && !blobs.Exists(activeAfter.Hash) {
				plan.Blockers = append(plan.Blockers, fmt.Sprintf("missing_blob: %s (%s)", display, activeAfter.Hash))
			}
			plan.Actions = append(plan.Actions, PlanAction{
				Path:          display,
				Key:           key,
				Action:        ActionRestoreLayer,
				CurrentSource: currentSource,
				TargetSource:  nextSource,
				CurrentHash:   diskHash,
				TargetHash:    activeAfter.Hash,
				CurrentExists: diskExists,
				TargetExists:  true,
				Mode:          activeAfter.Mode,
			})
			plan.Summary.RestoresLayer++
		}
	}

	plan.NewManifest = projManifest
	planCompiledCacheCleanup(plan)
	return plan, nil
}