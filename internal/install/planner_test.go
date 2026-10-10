package install

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func shaHex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func TestPlanAllSixUninstallPermutations(t *testing.T) {
	permutations := [][]string{
		{"C", "B", "A"},
		{"B", "C", "A"},
		{"A", "B", "C"},
		{"C", "A", "B"},
		{"A", "C", "B"},
		{"B", "A", "C"},
	}

	for _, perm := range permutations {
		permName := perm[0] + "->" + perm[1] + "->" + perm[2]
		t.Run(permName, func(t *testing.T) {
			root := t.TempDir()
			stateDir := filepath.Join(t.TempDir(), "state")
			blobs := NewBlobStore(filepath.Join(stateDir, "blobs"))
			manifest := NewManifest()

			filePath := "game/script.rpy"
			fullPath := filepath.Join(root, filepath.FromSlash(filePath))
			if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
				t.Fatal(err)
			}
			origContent := "original content"
			origHash := shaHex(origContent)
			if err := os.WriteFile(fullPath, []byte(origContent), 0o644); err != nil {
				t.Fatal(err)
			}
			if _, err := blobs.Put([]byte(origContent)); err != nil {
				t.Fatal(err)
			}

			// Install A, B, C in sequence
			mods := []struct {
				id      string
				content string
			}{
				{"A", "mod A content"},
				{"B", "mod B content"},
				{"C", "mod C content"},
			}

			for _, mod := range mods {
				if _, err := blobs.Put([]byte(mod.content)); err != nil {
					t.Fatal(err)
				}
				plan, err := PlanInstall(manifest, root, blobs, InstallOperation{
					OperationID:    "op_" + mod.id,
					InstallationID: "inst_" + mod.id,
					ModID:          "mod_" + mod.id,
					Title:          "Mod " + mod.id,
					Files: []PlannedFile{
						{Path: filePath, Content: []byte(mod.content)},
					},
				})
				if err != nil {
					t.Fatalf("PlanInstall %s failed: %v", mod.id, err)
				}
				if len(plan.Blockers) > 0 {
					t.Fatalf("unexpected blockers: %+v", plan.Blockers)
				}

				// Apply plan changes manually for test simulation
				for _, act := range plan.Actions {
					if act.Action == ActionWrite {
						if err := os.WriteFile(fullPath, []byte(mod.content), 0o644); err != nil {
							t.Fatal(err)
						}
					}
				}
				// Apply manifest updates
				applyPlanToManifest(manifest, plan)
			}

			// Verify after installs: top layer is C, file on disk has C content
			cur, err := os.ReadFile(fullPath)
			if err != nil || string(cur) != "mod C content" {
				t.Fatalf("expected mod C content, got %q", cur)
			}
			fileRec := manifest.GetFile(manifestCanonicalKey(filePath))
			if fileRec.ActiveLayer().ModID != "mod_C" {
				t.Fatalf("expected active layer mod_C, got %+v", fileRec.ActiveLayer())
			}
			if fileRec.Original.Hash != origHash {
				t.Fatalf("expected original hash %s, got %s", origHash, fileRec.Original.Hash)
			}

			// Now uninstall according to current permutation
			for stepIdx, modToUninstall := range perm {
				targetInstID := "inst_" + modToUninstall
				unplan, err := PlanUninstall(manifest, root, blobs, targetInstID, "unop_"+modToUninstall)
				if err != nil {
					t.Fatalf("[%s step %d] PlanUninstall %s failed: %v", permName, stepIdx, modToUninstall, err)
				}
				if len(unplan.Blockers) > 0 {
					t.Fatalf("[%s step %d] unexpected blockers: %+v", permName, stepIdx, unplan.Blockers)
				}

				// Apply actions to disk
				for _, act := range unplan.Actions {
					switch act.Action {
					case ActionWrite, ActionRestoreOriginal, ActionRestoreLayer:
						blobData, err := blobs.Get(act.TargetHash)
						if err != nil {
							t.Fatalf("failed to get blob %s: %v", act.TargetHash, err)
						}
						if err := os.WriteFile(fullPath, blobData, 0o644); err != nil {
							t.Fatal(err)
						}
					case ActionDelete:
						_ = os.Remove(fullPath)
					case ActionMetadataOnly:
						// No disk change
					}
				}
				applyPlanToManifest(manifest, unplan)
			}

			// After all three uninstalled, disk MUST have original content!
			finalContent, err := os.ReadFile(fullPath)
			if err != nil {
				t.Fatalf("[%s] failed reading final content: %v", permName, err)
			}
			if string(finalContent) != origContent {
				t.Fatalf("[%s] expected original content %q, got %q", permName, origContent, string(finalContent))
			}
		})
	}
}

func TestPlanUninstallDeletesWhenOriginallyNotExistent(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	blobs := NewBlobStore(filepath.Join(stateDir, "blobs"))
	manifest := NewManifest()

	filePath := "game/new_script.rpy"
	fullPath := filepath.Join(root, filepath.FromSlash(filePath))

	// Mod A installs new file (did not exist originally)
	contentA := "mod A"
	_, _ = blobs.Put([]byte(contentA))
	planA, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_A",
		InstallationID: "inst_A",
		ModID:          "mod_A",
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentA)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Dir(fullPath), 0o755)
	_ = os.WriteFile(fullPath, []byte(contentA), 0o644)
	applyPlanToManifest(manifest, planA)

	// Mod B overwrites it
	contentB := "mod B"
	_, _ = blobs.Put([]byte(contentB))
	planB, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_B",
		InstallationID: "inst_B",
		ModID:          "mod_B",
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentB)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(fullPath, []byte(contentB), 0o644)
	applyPlanToManifest(manifest, planB)

	// Uninstall B -> should restore A
	unplanB, err := PlanUninstall(manifest, root, blobs, "inst_B", "unop_B")
	if err != nil {
		t.Fatal(err)
	}
	if len(unplanB.Actions) != 1 || unplanB.Actions[0].Action != ActionRestoreLayer {
		t.Fatalf("expected ActionRestoreLayer, got %+v", unplanB.Actions)
	}
	bData, _ := blobs.Get(unplanB.Actions[0].TargetHash)
	_ = os.WriteFile(fullPath, bData, 0o644)
	applyPlanToManifest(manifest, unplanB)

	// Uninstall A -> should delete file!
	unplanA, err := PlanUninstall(manifest, root, blobs, "inst_A", "unop_A")
	if err != nil {
		t.Fatal(err)
	}
	if len(unplanA.Actions) != 1 || unplanA.Actions[0].Action != ActionDelete {
		t.Fatalf("expected ActionDelete, got %+v", unplanA.Actions)
	}
	_ = os.Remove(fullPath)
	applyPlanToManifest(manifest, unplanA)

	if _, err := os.Stat(fullPath); !os.IsNotExist(err) {
		t.Fatalf("expected file to be deleted, err=%v", err)
	}
}

func TestPlanDetectsDriftAndExternalChange(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	blobs := NewBlobStore(filepath.Join(stateDir, "blobs"))
	manifest := NewManifest()

	filePath := "game/drift.rpy"
	fullPath := filepath.Join(root, filepath.FromSlash(filePath))
	_ = os.MkdirAll(filepath.Dir(fullPath), 0o755)
	_ = os.WriteFile(fullPath, []byte("orig"), 0o644)
	_, _ = blobs.Put([]byte("orig"))

	// Mod A installs
	planA, _ := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_A",
		InstallationID: "inst_A",
		Files:          []PlannedFile{{Path: filePath, Content: []byte("content A")}},
	})
	_ = os.WriteFile(fullPath, []byte("content A"), 0o644)
	_, _ = blobs.Put([]byte("content A"))
	applyPlanToManifest(manifest, planA)

	// User modifies file on disk externally!
	_ = os.WriteFile(fullPath, []byte("user modified"), 0o644)

	// Uninstall A -> must be blocked due to drift!
	unplan, err := PlanUninstall(manifest, root, blobs, "inst_A", "unop_A")
	if err != nil {
		t.Fatal(err)
	}
	if len(unplan.Blockers) == 0 {
		t.Fatal("expected external_change blocker, got none")
	}
}


func TestPlanUpdateLowerLayerDoesNotOverwriteHigher(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	blobs := NewBlobStore(filepath.Join(stateDir, "blobs"))
	manifest := NewManifest()

	filePath := "game/shared.rpy"
	fullPath := filepath.Join(root, filepath.FromSlash(filePath))
	_ = os.MkdirAll(filepath.Dir(fullPath), 0o755)

	// Install A (order 1)
	planA, _ := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_A1",
		InstallationID: "inst_A",
		ModID:          "mod_A",
		Files:          []PlannedFile{{Path: filePath, Content: []byte("A_v1")}},
	})
	_ = os.WriteFile(fullPath, []byte("A_v1"), 0o644)
	_, _ = blobs.Put([]byte("A_v1"))
	applyPlanToManifest(manifest, planA)

	// Install B (order 2)
	planB, _ := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_B1",
		InstallationID: "inst_B",
		ModID:          "mod_B",
		Files:          []PlannedFile{{Path: filePath, Content: []byte("B_v1")}},
	})
	_ = os.WriteFile(fullPath, []byte("B_v1"), 0o644)
	_, _ = blobs.Put([]byte("B_v1"))
	applyPlanToManifest(manifest, planB)

	// Now update A (inst_A order is still 1, but B is order 2)
	planA2, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_A2",
		InstallationID: "inst_A",
		ModID:          "mod_A",
		Files:          []PlannedFile{{Path: filePath, Content: []byte("A_v2")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(planA2.Actions) != 1 || planA2.Actions[0].Action != ActionMetadataOnly {
		t.Fatalf("expected ActionMetadataOnly for updating lower layer, got %+v", planA2.Actions)
	}
	if planA2.Summary.MetadataOnly != 1 || planA2.Summary.WritesNew != 0 {
		t.Fatalf("unexpected summary: %+v", planA2.Summary)
	}
}

func TestPlanUpdateRemovesOmittedPaths(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	blobs := NewBlobStore(filepath.Join(stateDir, "blobs"))
	manifest := NewManifest()

	file1 := "game/kept.rpy"
	file2 := "game/omitted.rpy"
	full1 := filepath.Join(root, filepath.FromSlash(file1))
	full2 := filepath.Join(root, filepath.FromSlash(file2))
	_ = os.MkdirAll(filepath.Dir(full1), 0o755)

	// Original state: file2 existed originally as game file
	origContent2 := "original game file2"
	_ = os.WriteFile(full2, []byte(origContent2), 0o644)
	_, _ = blobs.Put([]byte(origContent2))

	// Mod A v1 installs both file1 and file2 (overwriting file2)
	content1v1 := "mod A v1 file1"
	content2v1 := "mod A v1 file2"
	_, _ = blobs.Put([]byte(content1v1))
	_, _ = blobs.Put([]byte(content2v1))

	planV1, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_v1",
		InstallationID: "mod_A",
		ModID:          "mod_A",
		VersionID:      "v1",
		Files: []PlannedFile{
			{Path: file1, Content: []byte(content1v1)},
			{Path: file2, Content: []byte(content2v1)},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(full1, []byte(content1v1), 0o644)
	_ = os.WriteFile(full2, []byte(content2v1), 0o644)
	applyPlanToManifest(manifest, planV1)

	// Now Mod A v2 updates: only has file1, omitted file2!
	content1v2 := "mod A v2 file1"
	_, _ = blobs.Put([]byte(content1v2))

	planV2, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_v2",
		InstallationID: "mod_A",
		ModID:          "mod_A",
		VersionID:      "v2",
		Files: []PlannedFile{
			{Path: file1, Content: []byte(content1v2)},
		},
	})
	if err != nil {
		t.Fatalf("PlanInstall v2 failed: %v", err)
	}

	// Verify planV2 contains an action to restore original file2!
	var foundOmittedAction bool
	for _, act := range planV2.Actions {
		if act.Path == file2 {
			foundOmittedAction = true
			if act.Action != ActionRestoreOriginal {
				t.Fatalf("expected ActionRestoreOriginal for omitted file2, got %s", act.Action)
			}
			if act.TargetHash != hashBytes([]byte(origContent2)) {
				t.Fatalf("expected target hash of original content, got %s", act.TargetHash)
			}
		}
	}
	if !foundOmittedAction {
		t.Fatalf("planV2 did not contain an action for omitted path %s", file2)
	}

	// Apply planV2
	for _, act := range planV2.Actions {
		switch act.Action {
		case ActionWrite:
			_ = os.WriteFile(filepath.Join(root, filepath.FromSlash(act.Path)), []byte(content1v2), 0o644)
		case ActionRestoreOriginal:
			_ = os.WriteFile(filepath.Join(root, filepath.FromSlash(act.Path)), []byte(origContent2), 0o644)
		}
	}
	applyPlanToManifest(manifest, planV2)

	// Check disk: file2 must be restored to origContent2!
	got2, _ := os.ReadFile(full2)
	if string(got2) != origContent2 {
		t.Fatalf("file2 on disk not restored to original: %q", got2)
	}

	// In manifest: mod_A installation Paths must ONLY have file1!
	instRec := manifest.Installations["mod_A"]
	if len(instRec.Paths) != 1 || instRec.Paths[0] != manifestCanonicalKey(file1) {
		t.Fatalf("instRec.Paths unexpected: %+v", instRec.Paths)
	}

	// File2 record in manifest must no longer have mod_A layer!
	rec2 := manifest.GetFile(manifestCanonicalKey(file2))
	if rec2 != nil && len(rec2.Layers) > 0 {
		t.Fatalf("file2 still has layers in manifest: %+v", rec2.Layers)
	}
}
