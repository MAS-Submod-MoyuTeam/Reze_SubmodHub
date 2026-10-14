package install

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPlanAdoptionAndTransaction(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, ".submodhub")
	if err := os.MkdirAll(state, 0o755); err != nil {
		t.Fatal(err)
	}

	installer := New(root, state)
	blobs := installer.GetBlobs()

	// Create test file on disk
	modDir := filepath.Join(root, "game", "Submods", "AdoptMe")
	if err := os.MkdirAll(modDir, 0o755); err != nil {
		t.Fatal(err)
	}
	rpyPath := filepath.Join(modDir, "main.rpy")
	content := []byte("init python:\n    Submod(name='AdoptMe', version='1.0')\n")
	if err := os.WriteFile(rpyPath, content, 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := NewManifest()

	// 1. Plan adoption
	plan, err := PlanAdoption(manifest, root, blobs, AdoptOperation{
		OperationID:    "op_adopt_1",
		InstallationID: "adoptme_inst",
		ModID:          "adoptme_mod",
		VersionID:      "",
		Version:        "1.0",
		Title:          "Adopt Me Mod",
		Priority:       0,
		Files:          []string{"game/Submods/AdoptMe/main.rpy"},
	})
	if err != nil {
		t.Fatalf("PlanAdoption failed: %v", err)
	}
	if len(plan.Blockers) > 0 {
		t.Fatalf("unexpected blockers: %+v", plan.Blockers)
	}
	if plan.Summary.MetadataOnly != 1 {
		t.Fatalf("expected 1 MetadataOnly action, got %+v", plan.Summary)
	}

	// 2. Execute adoption via TransactionContext
	tx, err := installer.NewTransaction(plan)
	if err != nil {
		t.Fatalf("NewTransaction failed: %v", err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatalf("tx.Execute failed: %v", err)
	}

	// 3. Verify disk file is unchanged
	dataAfter, err := os.ReadFile(rpyPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(dataAfter) != string(content) {
		t.Fatalf("game file modified during adoption! got %s", string(dataAfter))
	}

	// 4. Verify manifest has installation and file record with original baseline
	loadedManifest, err := installer.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	instRec, exists := loadedManifest.Installations["adoptme_inst"]
	if !exists {
		t.Fatal("installation record not found in manifest")
	}
	if instRec.ModID != "adoptme_mod" || instRec.Version != "1.0" {
		t.Fatalf("unexpected instRec: %+v", instRec)
	}
	canonKey := "game/submods/adoptme/main.rpy"
	fileRec := loadedManifest.GetFile(canonKey)
	if fileRec == nil {
		t.Fatalf("file record %q not found", canonKey)
	}
	if !fileRec.Original.Exists || fileRec.Original.Hash == "" {
		t.Fatalf("original baseline not recorded: %+v", fileRec.Original)
	}

	// 5. Verify uninstallation of adopted mod restores original baseline and does NOT delete the manual file
	uninstPlan, err := PlanUninstall(loadedManifest, root, blobs, "adoptme_inst", "op_uninst_1")
	if err != nil {
		t.Fatalf("PlanUninstall failed: %v", err)
	}
	if len(uninstPlan.Blockers) > 0 {
		t.Fatalf("uninstall plan blockers: %+v", uninstPlan.Blockers)
	}
	if uninstPlan.Summary.RestoresOriginal != 1 {
		t.Fatalf("expected 1 RestoresOriginal, got %+v", uninstPlan.Summary)
	}

	txUninst, err := installer.NewTransaction(uninstPlan)
	if err != nil {
		t.Fatalf("NewTransaction for uninstall failed: %v", err)
	}
	if err := txUninst.Execute(); err != nil {
		t.Fatalf("txUninst.Execute failed: %v", err)
	}

	dataAfterUninst, err := os.ReadFile(rpyPath)
	if err != nil {
		t.Fatalf("manual file was removed during uninstall of adopted mod! err: %v", err)
	}
	if string(dataAfterUninst) != string(content) {
		t.Fatalf("manual file content corrupted after uninstall! got %s", string(dataAfterUninst))
	}
}

func TestPlanAdoptionSymlinkOutOfBounds(t *testing.T) {
	root := t.TempDir()
	outsideDir := t.TempDir()
	outsideSecret := filepath.Join(outsideDir, "secret.txt")
	if err := os.WriteFile(outsideSecret, []byte("secret content"), 0o644); err != nil {
		t.Fatal(err)
	}

	submodsDir := filepath.Join(root, "game", "Submods", "SymlinkAttack")
	if err := os.MkdirAll(submodsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	symlinkPath := filepath.Join(submodsDir, "leak.rpy")
	if err := os.Symlink(outsideSecret, symlinkPath); err != nil {
		// If OS does not permit symlinks without elevation, skip
		t.Skip("skipping symlink test due to os lack of symlink permissions:", err)
	}

	manifest := NewManifest()
	blobs := NewBlobStore(filepath.Join(root, ".submodhub", "blobs"))

	plan, err := PlanAdoption(manifest, root, blobs, AdoptOperation{
		OperationID:    "op_symlink_test",
		InstallationID: "attack_inst",
		ModID:          "attack_mod",
		Version:        "1.0",
		Title:          "Attack Mod",
		Files:          []string{"game/Submods/SymlinkAttack/leak.rpy"},
	})
	if err != nil {
		t.Fatalf("PlanAdoption failed unexpectedly: %v", err)
	}
	// Plan must be blocked because the symlink points outside root
	foundBlocker := false
	for _, b := range plan.Blockers {
		if b == "symlink_target_out_of_bounds: game/Submods/SymlinkAttack/leak.rpy points outside root" {
			foundBlocker = true
			break
		}
	}
	if !foundBlocker {
		t.Fatalf("expected symlink_target_out_of_bounds blocker, got blockers: %+v", plan.Blockers)
	}
}
