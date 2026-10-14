package install

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRepairRestoresDriftAndRejectsNewDrift(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(map[bool]string{false: "modified", true: "deleted"}[missing], func(t *testing.T) {
			root := t.TempDir()
			installer := New(root, filepath.Join(t.TempDir(), "state"))
			if err := installer.Apply(Operation{ID: "installed", Changes: []Change{{Path: "game/demo.rpy", Content: []byte("managed")}}}); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(root, "game/demo.rpy")
			if missing {
				_ = os.Remove(target)
			} else {
				_ = os.WriteFile(target, []byte("external"), 0644)
			}
			plan, err := installer.PreviewRepair("installed", "repair")
			if err != nil {
				t.Fatal(err)
			}
			if len(plan.Actions) != 1 || plan.OperationType != "repair" {
				t.Fatalf("plan=%+v", plan)
			}
			_ = os.WriteFile(target, []byte("new drift"), 0644)
			transaction, err := installer.NewTransaction(plan)
			if err != nil {
				t.Fatal(err)
			}
			if err = transaction.Execute(); !IsCode(err, "external_change") {
				t.Fatalf("err=%v", err)
			}
			plan, err = installer.PreviewRepair("installed", "repair-fresh")
			if err != nil {
				t.Fatal(err)
			}
			transaction, err = installer.NewTransaction(plan)
			if err != nil {
				t.Fatal(err)
			}
			if err = transaction.Execute(); err != nil {
				t.Fatal(err)
			}
			content, _ := os.ReadFile(target)
			if string(content) != "managed" {
				t.Fatalf("content=%q", content)
			}
			journal, err := installer.GetTxJournal("repair-fresh")
			if err != nil {
				t.Fatal(err)
			}
			backup, err := installer.GetBlobs().Get(journal.BeforeFiles[manifestCanonicalKey("game/demo.rpy")].Hash)
			if err != nil || string(backup) != "new drift" {
				t.Fatalf("backup=%q err=%v", backup, err)
			}
		})
	}
}

func TestRepairMissingMaterialFails(t *testing.T) {
	installer := New(t.TempDir(), filepath.Join(t.TempDir(), "state"))
	if err := installer.Apply(Operation{ID: "installed", Changes: []Change{{Path: "demo.rpy", Content: []byte("managed")}}}); err != nil {
		t.Fatal(err)
	}
	_ = os.Remove(installer.GetBlobs().Path(hashBytes([]byte("managed"))))
	if _, err := installer.PreviewRepair("installed", "repair"); !IsCode(err, "missing_blob") {
		t.Fatalf("err=%v", err)
	}
}

func TestRepairDoesNotOverwriteHigherPriorityLayer(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)

	// 1. Install mod A with priority 10
	manifest, err := installer.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	blobs := installer.GetBlobs()
	_, _ = blobs.Put([]byte("mod a shared content"))
	_, _ = blobs.Put([]byte("mod a exclusive content"))
	_, _ = blobs.Put([]byte("mod b higher priority content"))
	planA, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_mod_a",
		InstallationID: "inst_a",
		ModID:          "mod_a",
		Title:          "Mod A",
		Priority:       10,
		Files: []PlannedFile{
			{Path: "game/shared.rpy", Content: []byte("mod a shared content")},
			{Path: "game/a_only.rpy", Content: []byte("mod a exclusive content")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	txA, err := installer.NewTransaction(planA)
	if err != nil {
		t.Fatal(err)
	}
	if err := txA.Execute(); err != nil {
		t.Fatal(err)
	}

	// 2. Install mod B with priority 20 (higher priority, overrides game/shared.rpy)
	manifest, err = installer.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	planB, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_mod_b",
		InstallationID: "inst_b",
		ModID:          "mod_b",
		Title:          "Mod B",
		Priority:       20,
		Files: []PlannedFile{
			{Path: "game/shared.rpy", Content: []byte("mod b higher priority content")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	txB, err := installer.NewTransaction(planB)
	if err != nil {
		t.Fatal(err)
	}
	if err := txB.Execute(); err != nil {
		t.Fatal(err)
	}

	// Disk must currently have Mod B's content for shared.rpy
	sharedPath := filepath.Join(root, "game/shared.rpy")
	content, _ := os.ReadFile(sharedPath)
	if string(content) != "mod b higher priority content" {
		t.Fatalf("expected mod b content, got %s", string(content))
	}

	// 3. Introduce drift on a_only.rpy (Mod A owns active layer)
	aOnlyPath := filepath.Join(root, "game/a_only.rpy")
	_ = os.WriteFile(aOnlyPath, []byte("external drift on a"), 0644)

	// 4. PreviewRepair for Mod A using mod_id fallback ("mod_a")
	repairPlan, err := installer.PreviewRepair("mod_a", "repair_op")
	if err != nil {
		t.Fatalf("PreviewRepair failed: %v", err)
	}

	// Mod A has 2 paths:
	// - a_only.rpy: active layer is Mod A, drifted -> ActionWrite
	// - shared.rpy: active layer is Mod B (shadowed) -> ActionMetadataOnly (must NOT overwrite disk!)
	var sharedAction, aOnlyAction *PlanAction
	for idx := range repairPlan.Actions {
		if filepath.ToSlash(repairPlan.Actions[idx].Path) == "game/shared.rpy" {
			sharedAction = &repairPlan.Actions[idx]
		}
		if filepath.ToSlash(repairPlan.Actions[idx].Path) == "game/a_only.rpy" {
			aOnlyAction = &repairPlan.Actions[idx]
		}
	}

	if sharedAction == nil || sharedAction.Action != ActionMetadataOnly {
		t.Fatalf("expected sharedAction to be ActionMetadataOnly, got %+v", sharedAction)
	}
	if aOnlyAction == nil || aOnlyAction.Action != ActionWrite {
		t.Fatalf("expected aOnlyAction to be ActionWrite, got %+v", aOnlyAction)
	}

	// 5. Execute repair plan
	txRepair, err := installer.NewTransaction(repairPlan)
	if err != nil {
		t.Fatal(err)
	}
	if err := txRepair.Execute(); err != nil {
		t.Fatalf("repair execute failed: %v", err)
	}

	// Verify disk states:
	// - game/shared.rpy must STILL have Mod B's content!
	contentShared, _ := os.ReadFile(sharedPath)
	if string(contentShared) != "mod b higher priority content" {
		t.Fatalf("repair of Mod A broke higher priority Mod B on shared.rpy! content=%s", string(contentShared))
	}

	// - game/a_only.rpy must be repaired to Mod A's content
	contentA, _ := os.ReadFile(aOnlyPath)
	if string(contentA) != "mod a exclusive content" {
		t.Fatalf("repair failed to restore a_only.rpy! content=%s", string(contentA))
	}
}

func TestPreviewRepairResolvesOperationID(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, ".submodhub")
	installer := New(root, state)
	_ = os.MkdirAll(filepath.Join(root, "game"), 0o755)

	blobs := installer.GetBlobs()

	manifest := NewManifest()
	_, _ = blobs.Put([]byte("hello world"))
	plan, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_unique_123",
		InstallationID: "mod_custom",
		ModID:          "mod_custom",
		Files: []PlannedFile{
			{Path: "game/test.rpy", Content: []byte("hello world")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := installer.NewTransaction(plan)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatal(err)
	}

	// Corrupt file
	_ = os.WriteFile(filepath.Join(root, "game/test.rpy"), []byte("corrupted"), 0644)

	// Call PreviewRepair using operation_id ("op_unique_123")
	repairPlan, err := installer.PreviewRepair("op_unique_123", "repair_op")
	if err != nil {
		t.Fatalf("PreviewRepair with operation_id failed: %v", err)
	}
	if repairPlan.TargetInstallationID != "mod_custom" {
		t.Fatalf("expected TargetInstallationID mod_custom, got %s", repairPlan.TargetInstallationID)
	}
}

