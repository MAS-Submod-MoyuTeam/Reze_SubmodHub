package install

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mustWriteFixture(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func requireExists(t *testing.T, root, rel string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
		t.Fatalf("%s should exist: %v", rel, err)
	}
}

func requireNotExist(t *testing.T, root, rel string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); !os.IsNotExist(err) {
		t.Fatalf("%s should not exist, stat err=%v", rel, err)
	}
}

func putFixture(t *testing.T, blobs *BlobStore, content string) {
	t.Helper()
	if _, err := blobs.Put([]byte(content)); err != nil {
		t.Fatal(err)
	}
}

func TestUninstallRemovesGeneratedCompiledArtifacts(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))

	err := inst.Apply(Operation{ID: "install_demo", Changes: []Change{
		{Path: "game/Submods/Demo/main.rpy", Content: []byte("init python:\n    pass\n")},
		{Path: "game/Submods/Demo/module.rpym", Content: []byte("init python:\n    pass\n")},
		{Path: "game/python-packages/demo_lib.py", Content: []byte("VALUE = 1\n")},
	}})
	if err != nil {
		t.Fatal(err)
	}

	// Simulate the artifacts Ren'Py / CPython generate after the game starts.
	mustWriteFixture(t, root, "game/Submods/Demo/main.rpyc", "compiled")
	mustWriteFixture(t, root, "game/Submods/Demo/module.rpymc", "compiled")
	mustWriteFixture(t, root, "game/python-packages/demo_lib.pyc", "compiled")
	mustWriteFixture(t, root, "game/python-packages/__pycache__/demo_lib.cpython-311.pyc", "compiled")
	mustWriteFixture(t, root, "game/python-packages/__pycache__/other.cpython-311.pyc", "keep")

	manifest, err := inst.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanUninstall(manifest, root, inst.GetBlobs(), "install_demo", "uninstall_demo")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Blockers) > 0 {
		t.Fatalf("unexpected blockers: %v", plan.Blockers)
	}
	wantCleanup := map[string]bool{
		"game/Submods/Demo/main.rpyc":                               true,
		"game/Submods/Demo/module.rpymc":                            true,
		"game/python-packages/demo_lib.pyc":                         true,
		"game/python-packages/__pycache__/demo_lib.cpython-311.pyc": true,
	}
	if len(plan.CleanupPaths) != len(wantCleanup) {
		t.Fatalf("cleanup paths = %v, want %v", plan.CleanupPaths, wantCleanup)
	}
	for _, rel := range plan.CleanupPaths {
		if !wantCleanup[rel] {
			t.Fatalf("unexpected cleanup path %q", rel)
		}
	}

	if err := inst.Uninstall("install_demo", "uninstall_demo"); err != nil {
		t.Fatal(err)
	}

	requireNotExist(t, root, "game/Submods/Demo/main.rpy")
	requireNotExist(t, root, "game/Submods/Demo/main.rpyc")
	requireNotExist(t, root, "game/Submods/Demo/module.rpym")
	requireNotExist(t, root, "game/Submods/Demo/module.rpymc")
	requireNotExist(t, root, "game/python-packages/demo_lib.py")
	requireNotExist(t, root, "game/python-packages/demo_lib.pyc")
	requireNotExist(t, root, "game/python-packages/__pycache__/demo_lib.cpython-311.pyc")
	requireExists(t, root, "game/python-packages/__pycache__/other.cpython-311.pyc")

	after, err := inst.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	for key := range after.Files {
		if filepath.Ext(key) == ".rpyc" || filepath.Ext(key) == ".rpymc" || filepath.Ext(key) == ".pyc" {
			t.Fatalf("generated artifact %q leaked into the manifest", key)
		}
	}
}

func TestUninstallLowerLayerKeepsCompiledArtifact(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))
	blobs := inst.GetBlobs()
	manifest := NewManifest()

	install := func(manifest *Manifest, opID, instID, modID, content string) *Manifest {
		t.Helper()
		putFixture(t, blobs, content)
		plan, err := PlanInstall(manifest, root, blobs, InstallOperation{
			OperationID:    opID,
			InstallationID: instID,
			ModID:          modID,
			Files:          []PlannedFile{{Path: "game/Submods/Shared/main.rpy", Content: []byte(content)}},
		})
		if err != nil {
			t.Fatal(err)
		}
		tx, err := inst.NewTransaction(plan)
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.Execute(); err != nil {
			t.Fatal(err)
		}
		loaded, err := inst.LoadManifest()
		if err != nil {
			t.Fatal(err)
		}
		return loaded
	}

	m := install(manifest, "op_a", "inst_a", "mod_a", "A")
	m = install(m, "op_b", "inst_b", "mod_b", "B")
	mustWriteFixture(t, root, "game/Submods/Shared/main.rpyc", "compiled from B")

	plan, err := PlanUninstall(m, root, blobs, "inst_a", "op_uninstall_a")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.CleanupPaths) != 0 {
		t.Fatalf("metadata-only uninstall must not clean caches, got %v", plan.CleanupPaths)
	}
	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatal(err)
	}
	requireExists(t, root, "game/Submods/Shared/main.rpyc")
}

func TestUpdateCleansCompiledArtifactsForChangedAndOmittedScripts(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))
	blobs := inst.GetBlobs()

	putFixture(t, blobs, "A1")
	putFixture(t, blobs, "B1")
	planV1, err := PlanInstall(NewManifest(), root, blobs, InstallOperation{
		OperationID:    "op_v1",
		InstallationID: "inst_x",
		ModID:          "mod_x",
		Files: []PlannedFile{
			{Path: "game/Submods/X/a.rpy", Content: []byte("A1")},
			{Path: "game/Submods/X/b.rpy", Content: []byte("B1")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := inst.NewTransaction(planV1)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatal(err)
	}

	m, err := inst.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFixture(t, root, "game/Submods/X/a.rpyc", "compiled A1")
	mustWriteFixture(t, root, "game/Submods/X/b.rpyc", "compiled B1")

	putFixture(t, blobs, "B2")
	planV2, err := PlanInstall(m, root, blobs, InstallOperation{
		OperationID:    "op_v2",
		InstallationID: "inst_x",
		ModID:          "mod_x",
		Files: []PlannedFile{
			{Path: "game/Submods/X/b.rpy", Content: []byte("B2")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	cleanup := make(map[string]bool)
	for _, rel := range planV2.CleanupPaths {
		cleanup[rel] = true
	}
	if !cleanup["game/Submods/X/a.rpyc"] || !cleanup["game/Submods/X/b.rpyc"] {
		t.Fatalf("expected both cache files in cleanup, got %v", planV2.CleanupPaths)
	}

	tx, err = inst.NewTransaction(planV2)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatal(err)
	}
	requireNotExist(t, root, "game/Submods/X/a.rpy")
	requireNotExist(t, root, "game/Submods/X/a.rpyc")
	requireExists(t, root, "game/Submods/X/b.rpy")
	requireNotExist(t, root, "game/Submods/X/b.rpyc")
}

func TestShippedCompiledArtifactIsManagedNotCleanup(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))
	blobs := inst.GetBlobs()

	putFixture(t, blobs, "SOURCE")
	putFixture(t, blobs, "PRECOMPILED")
	plan, err := PlanInstall(NewManifest(), root, blobs, InstallOperation{
		OperationID:    "op_ship",
		InstallationID: "inst_ship",
		ModID:          "mod_ship",
		Files: []PlannedFile{
			{Path: "game/Submods/Ship/main.rpy", Content: []byte("SOURCE")},
			{Path: "game/Submods/Ship/main.rpyc", Content: []byte("PRECOMPILED")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.CleanupPaths) != 0 {
		t.Fatalf("shipped .rpyc must stay managed, got cleanup %v", plan.CleanupPaths)
	}
	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatal(err)
	}

	m, err := inst.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	uninstallPlan, err := PlanUninstall(m, root, blobs, "inst_ship", "op_uninstall_ship")
	if err != nil {
		t.Fatal(err)
	}
	if len(uninstallPlan.CleanupPaths) != 0 {
		t.Fatalf("action-managed .rpyc must not be duplicated in cleanup, got %v", uninstallPlan.CleanupPaths)
	}
	if err := inst.Uninstall("inst_ship", "op_uninstall_ship"); err != nil {
		t.Fatal(err)
	}
	requireNotExist(t, root, "game/Submods/Ship/main.rpy")
	requireNotExist(t, root, "game/Submods/Ship/main.rpyc")
}

func TestInstallKeepsPreExistingCompiledOnlyScript(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))
	blobs := inst.GetBlobs()

	// A compiled-only script (no .rpy) is not regenerable cargo, so installing a
	// source file at the same path must not silently delete it during cleanup.
	mustWriteFixture(t, root, "game/Submods/CompiledOnly/main.rpyc", "COMPILED ONLY")
	putFixture(t, blobs, "SOURCE")

	plan, err := PlanInstall(NewManifest(), root, blobs, InstallOperation{
		OperationID:    "op_compiled_only",
		InstallationID: "inst_compiled_only",
		ModID:          "mod_compiled_only",
		Files:          []PlannedFile{{Path: "game/Submods/CompiledOnly/main.rpy", Content: []byte("SOURCE")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.CleanupPaths) != 0 {
		t.Fatalf("compiled-only script must not be scheduled for cleanup, got %v", plan.CleanupPaths)
	}
	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatal(err)
	}
	requireExists(t, root, "game/Submods/CompiledOnly/main.rpy")
	requireExists(t, root, "game/Submods/CompiledOnly/main.rpyc")
}

func TestCacheCleanupFailureRollsBackUninstallAndCanRetry(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))

	if err := inst.Apply(Operation{ID: "install_cleanup_fail", Changes: []Change{
		{Path: "game/Submods/Safe/main.rpy", Content: []byte("SOURCE")},
	}}); err != nil {
		t.Fatal(err)
	}

	// A non-empty directory at the cache path cannot be removed; this simulates
	// an undeletable cache without depending on platform-specific file locks.
	mustWriteFixture(t, root, "game/Submods/Safe/main.rpyc/blocker", "x")

	err := inst.Uninstall("install_cleanup_fail", "uninstall_cleanup_fail")
	if !IsCode(err, "cache_cleanup_failed") {
		t.Fatalf("expected cache_cleanup_failed, got %v", err)
	}
	if !strings.Contains(err.Error(), "close the game") {
		t.Fatalf("error should explain recovery, got %v", err)
	}

	// The operation must be fully rolled back: source and installation record stay.
	requireExists(t, root, "game/Submods/Safe/main.rpy")
	requireExists(t, root, "game/Submods/Safe/main.rpyc/blocker")
	manifest, loadErr := inst.LoadManifest()
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if manifest.Installations["install_cleanup_fail"] == nil {
		t.Fatal("installation record was removed despite rollback")
	}

	// Clear the obstruction and retry with a fresh operation id.
	if err := os.RemoveAll(filepath.Join(root, "game", "Submods", "Safe", "main.rpyc")); err != nil {
		t.Fatal(err)
	}
	if err := inst.Uninstall("install_cleanup_fail", "uninstall_cleanup_retry"); err != nil {
		t.Fatalf("retry after clearing obstruction failed: %v", err)
	}
	requireNotExist(t, root, "game/Submods/Safe/main.rpy")
	requireNotExist(t, root, "game/Submods/Safe/main.rpyc")
}

func TestUninstallToleratesCacheRemovedAfterPreview(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))

	if err := inst.Apply(Operation{ID: "install_cache_gone", Changes: []Change{
		{Path: "game/Submods/Gone/main.rpy", Content: []byte("SOURCE")},
	}}); err != nil {
		t.Fatal(err)
	}
	mustWriteFixture(t, root, "game/Submods/Gone/main.rpyc", "stale")

	manifest, err := inst.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanUninstall(manifest, root, inst.GetBlobs(), "install_cache_gone", "uninstall_cache_gone")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.CleanupPaths) != 1 {
		t.Fatalf("expected cache cleanup plan, got %v", plan.CleanupPaths)
	}

	// Another process cleans the cache between preview and execution.
	if err := os.Remove(filepath.Join(root, "game", "Submods", "Gone", "main.rpyc")); err != nil {
		t.Fatal(err)
	}
	tx, err := inst.NewTransaction(plan)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatalf("missing cache file must be treated as success: %v", err)
	}
	requireNotExist(t, root, "game/Submods/Gone/main.rpy")
}

func TestUninstallClearsReadOnlyCache(t *testing.T) {
	root := t.TempDir()
	inst := New(root, filepath.Join(t.TempDir(), "state"))

	if err := inst.Apply(Operation{ID: "install_readonly_cache", Changes: []Change{
		{Path: "game/Submods/ReadOnly/main.rpy", Content: []byte("SOURCE")},
	}}); err != nil {
		t.Fatal(err)
	}
	mustWriteFixture(t, root, "game/Submods/ReadOnly/main.rpyc", "stale")
	cachePath := filepath.Join(root, "game", "Submods", "ReadOnly", "main.rpyc")
	if err := os.Chmod(cachePath, 0o444); err != nil {
		t.Fatal(err)
	}

	if err := inst.Uninstall("install_readonly_cache", "uninstall_readonly_cache"); err != nil {
		t.Fatalf("read-only cache should be cleared and removed: %v", err)
	}
	requireNotExist(t, root, "game/Submods/ReadOnly/main.rpy")
	requireNotExist(t, root, "game/Submods/ReadOnly/main.rpyc")
}
