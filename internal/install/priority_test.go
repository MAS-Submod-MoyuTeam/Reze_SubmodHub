package install

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPriorityPrecedenceAndTies(t *testing.T) {
	m := NewManifest()

	// Add layers for file1
	orig := OriginalRecord{Exists: false}
	layerA := LayerRecord{InstallationID: "inst_a", ModID: "mod_a", Priority: 10, Order: 1, Hash: "hash_a"}
	layerB := LayerRecord{InstallationID: "inst_b", ModID: "mod_b", Priority: 20, Order: 2, Hash: "hash_b"}

	if err := m.RecordLayer("game/shared.rpy", "game/shared.rpy", orig, layerA); err != nil {
		t.Fatal(err)
	}
	if err := m.RecordLayer("game/shared.rpy", "game/shared.rpy", orig, layerB); err != nil {
		t.Fatal(err)
	}

	rec := m.Files["game/shared.rpy"]
	if rec.ActiveLayer().ModID != "mod_b" {
		t.Fatalf("expected mod_b to win (20 > 10), got %s", rec.ActiveLayer().ModID)
	}

	// Tie-break: equal priority, Order determines winner
	layerA2 := LayerRecord{InstallationID: "inst_a", ModID: "mod_a", Priority: 20, Order: 1, Hash: "hash_a"}
	layerB2 := LayerRecord{InstallationID: "inst_b", ModID: "mod_b", Priority: 20, Order: 2, Hash: "hash_b"}
	rec.Layers = []LayerRecord{layerA2, layerB2}
	if rec.ActiveLayer().ModID != "mod_b" {
		t.Fatalf("expected mod_b to win on order tie-break (Order 2 > 1), got %s", rec.ActiveLayer().ModID)
	}

	// Tie-break: equal priority and equal order, ModID determines winner
	layerC := LayerRecord{InstallationID: "inst_c", ModID: "mod_c", Priority: 20, Order: 2, Hash: "hash_c"}
	rec.Layers = []LayerRecord{layerB2, layerC}
	if rec.ActiveLayer().ModID != "mod_c" {
		t.Fatalf("expected mod_c to win on mod_id tie-break ('mod_c' > 'mod_b'), got %s", rec.ActiveLayer().ModID)
	}
}

func TestPlanPriorityLifecycle(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)
	blobs := inst.GetBlobs()

	filePath := "game/Submods/test/shared.rpy"
	fullPath := filepath.Join(root, filepath.FromSlash(filePath))
	_ = os.MkdirAll(filepath.Dir(fullPath), 0o755)

	contentA := "content of mod A"
	contentB := "content of mod B"
	hashA, _ := blobs.Put([]byte(contentA))
	_, _ = blobs.Put([]byte(contentB))

	// 1. Install Mod A (Priority 10)
	manifest := NewManifest()
	planA, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_install_a",
		InstallationID: "inst_a",
		ModID:          "mod_a",
		Title:          "Mod A",
		Priority:       10,
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentA)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	txA, err := inst.NewTransaction(planA)
	if err != nil {
		t.Fatal(err)
	}
	if err := txA.Execute(); err != nil {
		t.Fatal(err)
	}

	// 2. Install Mod B (Priority 20) -> B should be active on disk
	curManifest, err := inst.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	planB, err := PlanInstall(curManifest, root, blobs, InstallOperation{
		OperationID:    "op_install_b",
		InstallationID: "inst_b",
		ModID:          "mod_b",
		Title:          "Mod B",
		Priority:       20,
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentB)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	txB, err := inst.NewTransaction(planB)
	if err != nil {
		t.Fatal(err)
	}
	if err := txB.Execute(); err != nil {
		t.Fatal(err)
	}

	diskData, _ := os.ReadFile(fullPath)
	if string(diskData) != contentB {
		t.Fatalf("expected mod B content on disk, got %s", string(diskData))
	}

	// Verify overview
	overview, err := inst.GetPriorityOverview()
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.Mods) != 2 {
		t.Fatalf("expected 2 mods, got %d", len(overview.Mods))
	}
	if overview.Mods[0].ModID != "mod_b" || overview.Mods[0].Priority != 20 {
		t.Fatalf("expected mod_b with priority 20 at top, got %+v", overview.Mods[0])
	}
	if overview.Mods[1].ModID != "mod_a" || overview.Mods[1].Priority != 10 {
		t.Fatalf("expected mod_a with priority 10 at bottom, got %+v", overview.Mods[1])
	}
	if len(overview.Paths) != 1 {
		t.Fatalf("expected 1 shared path, got %d", len(overview.Paths))
	}
	if overview.Paths[0].ActiveOwner != "mod_b" {
		t.Fatalf("expected active owner mod_b, got %s", overview.Paths[0].ActiveOwner)
	}

	// 3. Preview Priority change: set mod_a to 30 (beats mod_b 20)
	curManifest, _ = inst.LoadManifest()
	planP, err := PlanPriority(curManifest, root, blobs, PriorityChangeRequest{
		OperationID: "op_prio_1",
		Priorities:  map[string]int{"mod_a": 30},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(planP.Blockers) > 0 {
		t.Fatalf("plan unexpectedly blocked: %v", planP.Blockers)
	}
	if len(planP.Actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(planP.Actions))
	}
	if planP.Actions[0].TargetSource != "mod_a" || planP.Actions[0].TargetHash != hashA {
		t.Fatalf("expected target mod_a (%s), got %+v", hashA, planP.Actions[0])
	}

	// Preview must NOT have modified disk!
	diskDataBeforeApply, _ := os.ReadFile(fullPath)
	if string(diskDataBeforeApply) != contentB {
		t.Fatalf("preview modified disk! Expected %s got %s", contentB, string(diskDataBeforeApply))
	}

	// 4. Execute priority change
	txP, err := inst.NewTransaction(planP)
	if err != nil {
		t.Fatal(err)
	}
	if err := txP.Execute(); err != nil {
		t.Fatal(err)
	}

	// Disk must now be Mod A content!
	diskDataAfterApply, _ := os.ReadFile(fullPath)
	if string(diskDataAfterApply) != contentA {
		t.Fatalf("expected mod A content on disk after priority apply, got %s", string(diskDataAfterApply))
	}

	// Manifest must be updated
	afterManifest, _ := inst.LoadManifest()
	if afterManifest.Installations["inst_a"].Priority != 30 {
		t.Fatalf("expected inst_a priority 30, got %d", afterManifest.Installations["inst_a"].Priority)
	}

	// 5. Test no shared paths still persists
	planDisjoint, err := PlanPriority(afterManifest, root, blobs, PriorityChangeRequest{
		OperationID: "op_prio_2",
		Priorities:  map[string]int{"mod_b": 50},
	})
	if err != nil {
		t.Fatal(err)
	}
	txDisjoint, err := inst.NewTransaction(planDisjoint)
	if err != nil {
		t.Fatal(err)
	}
	if err := txDisjoint.Execute(); err != nil {
		t.Fatal(err)
	}

	// Mod B now has 50 (> 30), so disk flipped back to Mod B!
	diskDataAfterB50, _ := os.ReadFile(fullPath)
	if string(diskDataAfterB50) != contentB {
		t.Fatalf("expected mod B content on disk after B set to 50, got %s", string(diskDataAfterB50))
	}

	// 6. Test drift detection blocks priority change
	_ = os.WriteFile(fullPath, []byte("external tampering"), 0o644)
	freshManifest, _ := inst.LoadManifest()
	planDrift, err := PlanPriority(freshManifest, root, blobs, PriorityChangeRequest{
		OperationID: "op_prio_drift",
		Priorities:  map[string]int{"mod_a": 100},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(planDrift.Blockers) == 0 {
		t.Fatal("expected external_change blocker due to drift, but got none")
	}

	// Restore clean content
	_ = os.WriteFile(fullPath, []byte(contentB), 0o644)

	// 7. Test uninstall reveals next priority layer
	cleanManifest, _ := inst.LoadManifest()
	planUninst, err := PlanUninstall(cleanManifest, root, blobs, "inst_b", "op_uninst_b")
	if err != nil {
		t.Fatal(err)
	}
	txUninst, err := inst.NewTransaction(planUninst)
	if err != nil {
		t.Fatal(err)
	}
	if err := txUninst.Execute(); err != nil {
		t.Fatal(err)
	}

	// Disk must now be Mod A
	diskAfterUninstall, _ := os.ReadFile(fullPath)
	if string(diskAfterUninstall) != contentA {
		t.Fatalf("expected mod A content on disk after uninstalling B, got %s", string(diskAfterUninstall))
	}
}

func TestPlanPrioritySameHashOwnerChange(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)
	blobs := inst.GetBlobs()

	filePath := "game/Submods/shared/asset.png"
	fullPath := filepath.Join(root, filepath.FromSlash(filePath))
	_ = os.MkdirAll(filepath.Dir(fullPath), 0o755)

	sameContent := "identical binary bytes"
	_, _ = blobs.Put([]byte(sameContent))

	manifest := NewManifest()
	planA, _ := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_a",
		InstallationID: "inst_a",
		ModID:          "mod_a",
		Priority:       10,
		Files:          []PlannedFile{{Path: filePath, Content: []byte(sameContent)}},
	})
	txA, _ := inst.NewTransaction(planA)
	_ = txA.Execute()

	m2, _ := inst.LoadManifest()
	planB, _ := PlanInstall(m2, root, blobs, InstallOperation{
		OperationID:    "op_b",
		InstallationID: "inst_b",
		ModID:          "mod_b",
		Priority:       20,
		Files:          []PlannedFile{{Path: filePath, Content: []byte(sameContent)}},
	})
	txB, _ := inst.NewTransaction(planB)
	_ = txB.Execute()

	// Mod A set to 30 -> winner flips to mod_a, but hash is identical -> ActionMetadataOnly
	m3, _ := inst.LoadManifest()
	planP, err := PlanPriority(m3, root, blobs, PriorityChangeRequest{
		OperationID: "op_prio_same",
		Priorities:  map[string]int{"mod_a": 30},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(planP.Actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(planP.Actions))
	}
	if planP.Actions[0].Action != ActionMetadataOnly {
		t.Fatalf("expected ActionMetadataOnly for same hash change, got %s", planP.Actions[0].Action)
	}
	if planP.Actions[0].TargetSource != "mod_a" {
		t.Fatalf("expected target mod_a, got %s", planP.Actions[0].TargetSource)
	}
}

func TestInstallHighPriorityThenLowPriorityPreservesDisk(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)
	blobs := inst.GetBlobs()

	filePath := "game/Submods/conflict.rpy"
	fullPath := filepath.Join(root, filepath.FromSlash(filePath))
	_ = os.MkdirAll(filepath.Dir(fullPath), 0o755)

	contentHigh := "content of high priority mod A"
	contentLow := "content of low priority mod B"
	_, _ = blobs.Put([]byte(contentHigh))
	_, _ = blobs.Put([]byte(contentLow))

	// 1. Install Mod A first with high priority (100)
	manifest := NewManifest()
	planA, err := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_install_a",
		InstallationID: "inst_a",
		ModID:          "mod_a",
		Title:          "Mod A High",
		Priority:       100,
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentHigh)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	txA, err := inst.NewTransaction(planA)
	if err != nil {
		t.Fatal(err)
	}
	if err := txA.Execute(); err != nil {
		t.Fatal(err)
	}

	diskDataA, _ := os.ReadFile(fullPath)
	if string(diskDataA) != contentHigh {
		t.Fatalf("expected mod A content on disk, got %s", string(diskDataA))
	}

	// 2. Install Mod B second with lower priority (10)
	// Even though Mod B is installed second (Order 2 > Order 1), Mod A's priority 100 > 10 must win!
	curManifest, err := inst.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	planB, err := PlanInstall(curManifest, root, blobs, InstallOperation{
		OperationID:    "op_install_b",
		InstallationID: "inst_b",
		ModID:          "mod_b",
		Title:          "Mod B Low",
		Priority:       10,
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentLow)}},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Verify plan action for B is metadata only, NOT overwriting disk
	if len(planB.Actions) != 1 {
		t.Fatalf("expected 1 action in plan B, got %d", len(planB.Actions))
	}
	if planB.Actions[0].Action != ActionMetadataOnly {
		t.Fatalf("expected ActionMetadataOnly for low priority install, got %s", planB.Actions[0].Action)
	}
	if planB.Actions[0].TargetSource != "mod_a" {
		t.Fatalf("expected active target source to remain mod_a, got %s", planB.Actions[0].TargetSource)
	}

	txB, err := inst.NewTransaction(planB)
	if err != nil {
		t.Fatal(err)
	}
	if err := txB.Execute(); err != nil {
		t.Fatal(err)
	}

	// Verify disk STILL contains Mod A content
	diskDataAfterB, _ := os.ReadFile(fullPath)
	if string(diskDataAfterB) != contentHigh {
		t.Fatalf("expected disk to remain mod A content after low priority mod B installed, got %s", string(diskDataAfterB))
	}

	// Verify manifest records both layers and mod_a is active
	mAfter, err := inst.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	fileRec := mAfter.Files[manifestCanonicalKey(filePath)]
	if fileRec == nil || len(fileRec.Layers) != 2 {
		t.Fatalf("expected 2 layers in manifest, got %+v", fileRec)
	}
	if fileRec.ActiveLayer().ModID != "mod_a" {
		t.Fatalf("expected active layer to be mod_a, got %s", fileRec.ActiveLayer().ModID)
	}

	// 3. Uninstall Mod A -> Mod B must now be restored to disk
	planUninstA, err := PlanUninstall(mAfter, root, blobs, "inst_a", "op_uninst_a")
	if err != nil {
		t.Fatal(err)
	}
	txUninstA, err := inst.NewTransaction(planUninstA)
	if err != nil {
		t.Fatal(err)
	}
	if err := txUninstA.Execute(); err != nil {
		t.Fatal(err)
	}

	diskDataAfterUninstA, _ := os.ReadFile(fullPath)
	if string(diskDataAfterUninstA) != contentLow {
		t.Fatalf("expected disk to be restored to mod B content after mod A uninstalled, got %s", string(diskDataAfterUninstA))
	}
}

func TestUpdateAfterPriorityAdjustmentPreservesPrecedence(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(t.TempDir(), "state")
	inst := New(root, stateDir)
	blobs := inst.GetBlobs()

	filePath := "game/Submods/override.rpy"
	fullPath := filepath.Join(root, filepath.FromSlash(filePath))
	_ = os.MkdirAll(filepath.Dir(fullPath), 0o755)

	contentA1 := "content A version 1"
	contentA2 := "content A version 2"
	contentB1 := "content B version 1"
	contentB2 := "content B version 2"
	_, _ = blobs.Put([]byte(contentA1))
	_, _ = blobs.Put([]byte(contentA2))
	_, _ = blobs.Put([]byte(contentB1))
	_, _ = blobs.Put([]byte(contentB2))

	// 1. Install Mod A (Prio 10)
	manifest := NewManifest()
	planA, _ := PlanInstall(manifest, root, blobs, InstallOperation{
		OperationID:    "op_a1",
		InstallationID: "inst_a",
		ModID:          "mod_a",
		Priority:       10,
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentA1)}},
	})
	txA, _ := inst.NewTransaction(planA)
	_ = txA.Execute()

	// 2. Install Mod B (Prio 20) -> B wins initially
	m1, _ := inst.LoadManifest()
	planB, _ := PlanInstall(m1, root, blobs, InstallOperation{
		OperationID:    "op_b1",
		InstallationID: "inst_b",
		ModID:          "mod_b",
		Priority:       20,
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentB1)}},
	})
	txB, _ := inst.NewTransaction(planB)
	_ = txB.Execute()

	disk1, _ := os.ReadFile(fullPath)
	if string(disk1) != contentB1 {
		t.Fatalf("expected B1 on disk initially, got %s", string(disk1))
	}

	// 3. User adjusts Priority: set Mod A to 30 (30 > 20)
	m2, _ := inst.LoadManifest()
	planPrio, err := PlanPriority(m2, root, blobs, PriorityChangeRequest{
		OperationID: "op_prio_adjust",
		Priorities:  map[string]int{"mod_a": 30},
	})
	if err != nil {
		t.Fatal(err)
	}
	txPrio, _ := inst.NewTransaction(planPrio)
	if err := txPrio.Execute(); err != nil {
		t.Fatal(err)
	}

	// Disk must now be A1
	disk2, _ := os.ReadFile(fullPath)
	if string(disk2) != contentA1 {
		t.Fatalf("expected A1 on disk after priority adjustment, got %s", string(disk2))
	}

	// 4. Update Mod B to version 2 (without passing explicit Priority, so it retains its adjusted/existing priority 20)
	m3, _ := inst.LoadManifest()
	planBUpdate, err := PlanInstall(m3, root, blobs, InstallOperation{
		OperationID:    "op_b2",
		InstallationID: "inst_b",
		ModID:          "mod_b",
		Version:        "2.0.0",
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentB2)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Action for B2 must be ActionMetadataOnly because Mod A has Priority 30 > Mod B Priority 20
	if len(planBUpdate.Actions) != 1 || planBUpdate.Actions[0].Action != ActionMetadataOnly {
		t.Fatalf("expected ActionMetadataOnly on B update, got %+v", planBUpdate.Actions)
	}
	txBUpdate, _ := inst.NewTransaction(planBUpdate)
	if err := txBUpdate.Execute(); err != nil {
		t.Fatal(err)
	}

	// Disk MUST still be A1! Not overwritten by B2!
	disk3, _ := os.ReadFile(fullPath)
	if string(disk3) != contentA1 {
		t.Fatalf("expected disk to remain A1 after B updated, got %s", string(disk3))
	}

	// 5. Update Mod A to version 2 (retaining Priority 30)
	m4, _ := inst.LoadManifest()
	planAUpdate, err := PlanInstall(m4, root, blobs, InstallOperation{
		OperationID:    "op_a2",
		InstallationID: "inst_a",
		ModID:          "mod_a",
		Version:        "2.0.0",
		Files:          []PlannedFile{{Path: filePath, Content: []byte(contentA2)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Mod A has Priority 30 > 20, so Mod A update writes to disk
	if len(planAUpdate.Actions) != 1 || (planAUpdate.Actions[0].Action != ActionRestoreLayer && planAUpdate.Actions[0].Action != ActionWrite) {
		t.Fatalf("expected write action on A update, got %+v", planAUpdate.Actions)
	}
	txAUpdate, _ := inst.NewTransaction(planAUpdate)
	if err := txAUpdate.Execute(); err != nil {
		t.Fatal(err)
	}

	// Disk is now A2
	disk4, _ := os.ReadFile(fullPath)
	if string(disk4) != contentA2 {
		t.Fatalf("expected disk to be A2 after A updated, got %s", string(disk4))
	}

	// 6. Now adjust Mod B priority to 40 (40 > 30) -> disk flips to B2!
	m5, _ := inst.LoadManifest()
	planPrio2, err := PlanPriority(m5, root, blobs, PriorityChangeRequest{
		OperationID: "op_prio_adjust_2",
		Priorities:  map[string]int{"mod_b": 40},
	})
	if err != nil {
		t.Fatal(err)
	}
	txPrio2, _ := inst.NewTransaction(planPrio2)
	if err := txPrio2.Execute(); err != nil {
		t.Fatal(err)
	}

	disk5, _ := os.ReadFile(fullPath)
	if string(disk5) != contentB2 {
		t.Fatalf("expected disk to be B2 after B priority increased to 40, got %s", string(disk5))
	}
}
