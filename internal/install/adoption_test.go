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

// Adoption decides ownership from the artifact's source. A compile cache file
// whose script is being adopted is generated data: recording it would make Ren'Py
// recompile look like content drift the repair flow can never fix. A compiled
// file with no source is the only copy of its script and must stay adoptable.
func TestPlanAdoptionSkipsGeneratedCompiledArtifacts(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, ".submodhub")
	if err := os.MkdirAll(state, 0o755); err != nil {
		t.Fatal(err)
	}
	installer := New(root, state)
	blobs := installer.GetBlobs()

	modDir := filepath.Join(root, "game", "Submods", "GenMod")
	if err := os.MkdirAll(modDir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(modDir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("main.rpy", "init python:\n    Submod(name='Gen', version='1.0')\n")
	write("main.rpyc", "COMPILED-FROM-main.rpy")
	write("module.rpym", "init python:\n    pass\n")
	write("module.rpymc", "COMPILED-FROM-module.rpym")
	write("compiled_only.rpyc", "ONLY COPY")

	plan, err := PlanAdoption(NewManifest(), root, blobs, AdoptOperation{
		OperationID:    "op_adopt_gen",
		InstallationID: "gen_inst",
		ModID:          "gen_mod",
		Version:        "1.0",
		Title:          "Gen",
		Files: []string{
			"game/Submods/GenMod/main.rpy",
			"game/Submods/GenMod/main.rpyc",
			"game/Submods/GenMod/module.rpym",
			"game/Submods/GenMod/module.rpymc",
			"game/Submods/GenMod/compiled_only.rpyc",
		},
	})
	if err != nil {
		t.Fatalf("PlanAdoption failed: %v", err)
	}
	if len(plan.Blockers) > 0 {
		t.Fatalf("unexpected blockers: %+v", plan.Blockers)
	}

	wantDerived := []string{"game/Submods/GenMod/main.rpyc", "game/Submods/GenMod/module.rpymc"}
	if len(plan.DerivedPaths) != len(wantDerived) {
		t.Fatalf("expected derived paths %v, got %v", wantDerived, plan.DerivedPaths)
	}
	for i, want := range wantDerived {
		if plan.DerivedPaths[i] != want {
			t.Fatalf("expected derived paths %v, got %v", wantDerived, plan.DerivedPaths)
		}
	}

	recorded := make(map[string]bool)
	for _, action := range plan.Actions {
		recorded[action.Path] = true
	}
	for _, path := range []string{
		"game/Submods/GenMod/main.rpy",
		"game/Submods/GenMod/module.rpym",
		"game/Submods/GenMod/compiled_only.rpyc",
	} {
		if !recorded[path] {
			t.Fatalf("expected %s to be adopted, got actions %+v", path, plan.Actions)
		}
	}
	for _, path := range wantDerived {
		if recorded[path] {
			t.Fatalf("generated artifact %s must not be recorded, got actions %+v", path, plan.Actions)
		}
	}

	tx, err := installer.NewTransaction(plan)
	if err != nil {
		t.Fatalf("NewTransaction failed: %v", err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatalf("tx.Execute failed: %v", err)
	}
	manifest, err := installer.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range wantDerived {
		_, key, canonErr := CanonicalPath(path, "")
		if canonErr != nil {
			t.Fatal(canonErr)
		}
		if rec := manifest.GetFile(key); rec != nil && len(rec.Layers) > 0 {
			t.Fatalf("generated artifact %s must stay untracked, got %+v", path, rec)
		}
	}
}

// Adoption and the unmanaged scan must decide ownership from the same evidence:
// an existing script makes its sibling artifact regenerable, no matter who — if
// anyone — owns that script. A selection that names only the artifact therefore
// records nothing, and a selection that names only the script records only it.
func TestPlanAdoptionSetsAsideArtifactOfExistingScript(t *testing.T) {
	for _, tc := range []struct {
		name     string
		manifest *Manifest
	}{
		{name: "source unmanaged and not selected", manifest: NewManifest()},
		{name: "source managed by another installation", manifest: func() *Manifest {
			m := NewManifest()
			if err := m.RecordLayer(
				"game/Submods/Shared/main.rpy",
				manifestCanonicalKey("game/Submods/Shared/main.rpy"),
				OriginalRecord{},
				LayerRecord{InstallationID: "inst_owner", ModID: "mod_owner", Hash: "abc", Order: 1},
			); err != nil {
				panic(err)
			}
			return m
		}()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			modDir := filepath.Join(root, "game", "Submods", "Shared")
			if err := os.MkdirAll(modDir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(modDir, "main.rpy"), []byte("init python: pass"), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(modDir, "main.rpyc"), []byte("COMPILED"), 0o644); err != nil {
				t.Fatal(err)
			}

			plan, err := PlanAdoption(tc.manifest, root, NewBlobStore(filepath.Join(root, ".submodhub", "blobs")), AdoptOperation{
				OperationID:    "op_adopt_shared",
				InstallationID: "second_inst",
				ModID:          "second_mod",
				Version:        "1.0",
				Title:          "Second",
				Files:          []string{"game/Submods/Shared/main.rpyc"},
			})
			if err != nil {
				t.Fatalf("PlanAdoption failed: %v", err)
			}
			if len(plan.Actions) != 0 {
				t.Fatalf("an artifact of an existing script must not be adopted, got %+v", plan.Actions)
			}
			if len(plan.DerivedPaths) != 1 || plan.DerivedPaths[0] != "game/Submods/Shared/main.rpyc" {
				t.Fatalf("expected the artifact to be reported as derived, got %+v", plan.DerivedPaths)
			}
			if len(plan.Blockers) == 0 {
				t.Fatalf("a selection with nothing recordable must be blocked, got %+v", plan)
			}
		})
	}
}
