package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	core "github.com/reze/submodhub/internal/install"
)

func TestLocalSubmodsLedgerExclusionAndScattered(t *testing.T) {
	masRoot := t.TempDir()
	submodsDir := filepath.Join(masRoot, "game", "Submods")
	if err := os.MkdirAll(submodsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// 1. Managed directory "ManagedMod" with 2 files
	managedDir := filepath.Join(submodsDir, "ManagedMod")
	if err := os.MkdirAll(managedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	managedFile1 := filepath.Join(managedDir, "managed.rpy")
	managedFile2 := filepath.Join(managedDir, "managed2.rpy")
	unmanagedInSameDir := filepath.Join(managedDir, "extra_unmanaged.rpy")
	if err := os.WriteFile(managedFile1, []byte("init python:\n    Submod(name='Managed', version='1.0')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(managedFile2, []byte("# managed part 2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(unmanagedInSameDir, []byte("init python:\n    Submod(name='Extra', version='0.1')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 2. Unmanaged directory "UnmanagedMod"
	unmanagedDir := filepath.Join(submodsDir, "UnmanagedMod")
	if err := os.MkdirAll(unmanagedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(unmanagedDir, "main.rpy"), []byte("init python:\n    Submod(author='Auth', name='Unmanaged A', version='1.2.3')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 3. Root scattered .rpy file
	scatteredFile := filepath.Join(submodsDir, "scattered.rpy")
	if err := os.WriteFile(scatteredFile, []byte("init python:\n    Submod(name='Scattered', version='0.9')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Build manifest that manages managedFile1 and managedFile2
	manifest := core.NewManifest()
	manifest.Installations["inst_managed"] = &core.InstallationRecord{
		InstallationID: "inst_managed",
		ModID:          "mod_managed",
		Paths: []string{
			"game/Submods/ManagedMod/managed.rpy",
			"game/Submods/ManagedMod/managed2.rpy",
		},
	}
	manifest.Files["game/submods/managedmod/managed.rpy"] = &core.FileRecord{
		DisplayPath: "game/Submods/ManagedMod/managed.rpy",
	}
	manifest.Files["game/submods/managedmod/managed2.rpy"] = &core.FileRecord{
		DisplayPath: "game/Submods/ManagedMod/managed2.rpy",
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}

	// Expected results:
	// - ManagedMod should only have extra_unmanaged.rpy (file-level exclusion)
	// - UnmanagedMod should have main.rpy
	// - __root_scattered__ should have scattered.rpy
	var foundManaged, foundUnmanaged, foundScattered bool
	for _, item := range results {
		if item.Directory == "ManagedMod" {
			foundManaged = true
			if len(item.Files) != 1 || item.Files[0].Path != "game/Submods/ManagedMod/extra_unmanaged.rpy" {
				t.Errorf("expected only extra_unmanaged.rpy in ManagedMod, got: %+v", item.Files)
			}
			if item.Name != "Extra" {
				t.Errorf("expected name Extra, got %q", item.Name)
			}
		} else if item.Directory == "UnmanagedMod" {
			foundUnmanaged = true
			if len(item.Files) != 1 || item.Files[0].Path != "game/Submods/UnmanagedMod/main.rpy" {
				t.Errorf("expected main.rpy in UnmanagedMod, got: %+v", item.Files)
			}
			if item.Name != "Unmanaged A" || item.Author != "Auth" || item.Version != "1.2.3" {
				t.Errorf("unexpected metadata in UnmanagedMod: %+v", item)
			}
			if len(item.Registrations) != 1 || item.Registrations[0].Source != "game/Submods/UnmanagedMod/main.rpy" {
				t.Errorf("expected registration source to match canonical path game/Submods/UnmanagedMod/main.rpy, got: %+v", item.Registrations)
			}
		} else if item.ID == "__root_scattered__" {
			foundScattered = true
			if len(item.Files) != 1 || item.Files[0].Path != "game/Submods/scattered.rpy" {
				t.Errorf("expected scattered.rpy in root scattered, got: %+v", item.Files)
			}
			if item.Name != "Scattered" {
				t.Errorf("expected scattered name Scattered, got %q", item.Name)
			}
			if len(item.Registrations) != 1 || item.Registrations[0].Source != "game/Submods/scattered.rpy" {
				t.Errorf("expected scattered registration source game/Submods/scattered.rpy, got: %+v", item.Registrations)
			}
		}
	}

	if !foundManaged {
		t.Error("ManagedMod with extra unmanaged file not found")
	}
	if !foundUnmanaged {
		t.Error("UnmanagedMod not found")
	}
	if !foundScattered {
		t.Error("Root scattered file not found")
	}
}

// A directory that already belongs to a managed mod can still hold files the
// ledger does not know. Those files stay discoverable, but the item must say
// which managed installation owns the folder so it is not read as an unrelated
// unmanaged submod.
func TestLocalSubmodsReportsManagedOwnerOfPartiallyManagedDirectory(t *testing.T) {
	masRoot := t.TempDir()
	managedDir := filepath.Join(masRoot, "game", "Submods", "ManagedMod")
	if err := os.MkdirAll(managedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managedDir, "main.rpy"), []byte("init python:\n    Submod(name='Managed', version='1.0')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(managedDir, "user_notes.rpy"), []byte("init python:\n    pass\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := core.NewManifest()
	manifest.Installations["inst_managed"] = &core.InstallationRecord{
		InstallationID: "inst_managed",
		ModID:          "mod_managed",
		Title:          "Managed Title",
		Paths:          []string{"game/Submods/ManagedMod/main.rpy"},
	}
	// The ledger also records the file as a layer of the same installation.
	// Ownership must collapse into one entry instead of listing it twice.
	manifest.Files[canonicalizePathKey("game/Submods/ManagedMod/main.rpy")] = &core.FileRecord{
		DisplayPath: "game/Submods/ManagedMod/main.rpy",
		Layers:      []core.LayerRecord{{InstallationID: "inst_managed", ModID: "mod_managed", Order: 1}},
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected exactly one discovered item, got %+v", results)
	}
	item := results[0]
	if len(item.Files) != 1 || item.Files[0].Path != "game/Submods/ManagedMod/user_notes.rpy" {
		t.Fatalf("expected only the file outside the ledger, got %+v", item.Files)
	}
	if len(item.ManagedOwners) != 1 {
		t.Fatalf("expected the managed owner of the directory, got %+v", item.ManagedOwners)
	}
	owner := item.ManagedOwners[0]
	if owner.InstallationID != "inst_managed" || owner.ModID != "mod_managed" || owner.Title != "Managed Title" {
		t.Fatalf("unexpected owner: %+v", owner)
	}
}

// Ownership must not depend on the installation's recorded path list: file layers
// are the per-file record of who owns a path, so a directory still names its owner
// when only the layers survived (legacy ledgers, journal rebuilds, hand repair).
func TestLocalSubmodsNamesOwnerFromFileLayersAlone(t *testing.T) {
	masRoot := t.TempDir()
	layeredDir := filepath.Join(masRoot, "game", "Submods", "layeredmod")
	if err := os.MkdirAll(layeredDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(layeredDir, "main.rpy"), []byte("init python:\n    Submod(name='Layered', version='1.0')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(layeredDir, "user_notes.rpy"), []byte("init python:\n    pass\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := core.NewManifest()
	manifest.Files[canonicalizePathKey("game/Submods/layeredmod/main.rpy")] = &core.FileRecord{
		DisplayPath: "game/Submods/layeredmod/main.rpy",
		Layers:      []core.LayerRecord{{InstallationID: "inst_layers", ModID: "mod_layers", Order: 1}},
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected exactly one discovered item, got %+v", results)
	}
	item := results[0]
	if len(item.Files) != 1 || item.Files[0].Path != "game/Submods/layeredmod/user_notes.rpy" {
		t.Fatalf("expected only the file outside the ledger, got %+v", item.Files)
	}
	if len(item.ManagedOwners) != 1 {
		t.Fatalf("expected the layer's installation to own the directory, got %+v", item.ManagedOwners)
	}
	if owner := item.ManagedOwners[0]; owner.InstallationID != "inst_layers" || owner.ModID != "mod_layers" {
		t.Fatalf("unexpected owner: %+v", owner)
	}
}

// File layers are the per-file record of ownership, so when a directory has them
// an installation's recorded path list must not add a second, stale owner: only
// layers can say who owns a file after a reinstall moved it.
func TestLocalSubmodsPrefersFileLayersOverInstallationPaths(t *testing.T) {
	masRoot := t.TempDir()
	shared := filepath.Join(masRoot, "game", "Submods", "Shared")
	if err := os.MkdirAll(shared, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"main.rpy", "user_notes.rpy"} {
		if err := os.WriteFile(filepath.Join(shared, name), []byte("init python:\n    pass\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	manifest := core.NewManifest()
	manifest.Files[canonicalizePathKey("game/Submods/Shared/main.rpy")] = &core.FileRecord{
		DisplayPath: "game/Submods/Shared/main.rpy",
		Layers:      []core.LayerRecord{{InstallationID: "inst_current", ModID: "mod_current", Order: 1}},
	}
	manifest.Installations["inst_current"] = &core.InstallationRecord{
		InstallationID: "inst_current", ModID: "mod_current", Title: "Current Title",
		Paths: []string{"game/Submods/Shared/main.rpy"},
	}
	// The stale record still lists the path, but no file layer points at it.
	manifest.Installations["inst_stale"] = &core.InstallationRecord{
		InstallationID: "inst_stale", ModID: "mod_stale", Title: "Stale Title",
		Paths: []string{"game/Submods/Shared/main.rpy"},
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected one discovered item, got %+v", results)
	}
	if len(results[0].ManagedOwners) != 1 {
		t.Fatalf("expected only the layer's owner, got %+v", results[0].ManagedOwners)
	}
	if owner := results[0].ManagedOwners[0]; owner.InstallationID != "inst_current" || owner.Title != "Current Title" {
		t.Fatalf("unexpected owner: %+v", owner)
	}
}

// A ledger from before file layers still names its owner through the recorded
// path list, so that list is the fallback rather than dead data.
func TestLocalSubmodsFallsBackToInstallationPathsWithoutLayers(t *testing.T) {
	masRoot := t.TempDir()
	legacy := filepath.Join(masRoot, "game", "Submods", "Legacy")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "extra.rpy"), []byte("init python:\n    pass\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := core.NewManifest()
	manifest.Installations["inst_legacy"] = &core.InstallationRecord{
		InstallationID: "inst_legacy", ModID: "mod_legacy", Title: "Legacy Title",
		Paths: []string{"game/Submods/Legacy/main.rpy"},
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 1 || len(results[0].ManagedOwners) != 1 {
		t.Fatalf("expected one item naming its owner from paths: %+v", results)
	}
	if owner := results[0].ManagedOwners[0]; owner.InstallationID != "inst_legacy" || owner.Title != "Legacy Title" {
		t.Fatalf("unexpected owner: %+v", owner)
	}
}

// A directory nobody manages must not claim an owner.
func TestLocalSubmodsLeavesUnownedDirectoryWithoutOwners(t *testing.T) {
	masRoot := t.TempDir()
	dir := filepath.Join(masRoot, "game", "Submods", "LooseMod")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.rpy"), []byte("init python:\n    Submod(name='Loose', version='0.1')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := core.NewManifest()
	manifest.Installations["inst_other"] = &core.InstallationRecord{
		InstallationID: "inst_other",
		Paths:          []string{"game/Submods/OtherMod/main.rpy", "game/mod_assets/other.png"},
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected one item, got %+v", results)
	}
	if len(results[0].ManagedOwners) != 0 {
		t.Fatalf("expected no owners for an unmanaged directory, got %+v", results[0].ManagedOwners)
	}
}

// Ren'Py compiles managed .rpy/.rpym/.py sources into sibling artifacts that are
// never recorded in the manifest. Those artifacts belong to a managed file, so a
// fully managed mod directory must not resurface as an unmanaged detection.
func TestLocalSubmodsSkipsCompiledArtifactsOfManagedSources(t *testing.T) {
	masRoot := t.TempDir()
	managedDir := filepath.Join(masRoot, "game", "Submods", "ManagedMod")
	if err := os.MkdirAll(filepath.Join(managedDir, "__pycache__"), 0o755); err != nil {
		t.Fatal(err)
	}

	write := func(rel, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(managedDir, rel), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("main.rpy", "init python:\n    Submod(name='Managed', version='1.0')\n")
	write("module.rpym", "init python:\n    pass\n")
	write("helper.py", "VALUE = 1\n")
	// Generated by Ren'Py / CPython after the managed files were installed.
	write("main.rpyc", "compiled")
	write("module.rpymc", "compiled")
	write(filepath.Join("__pycache__", "helper.cpython-311.pyc"), "compiled")

	manifest := core.NewManifest()
	manifest.Installations["inst_managed"] = &core.InstallationRecord{
		InstallationID: "inst_managed",
		ModID:          "mod_managed",
		Paths: []string{
			"game/Submods/ManagedMod/main.rpy",
			"game/Submods/ManagedMod/module.rpym",
			"game/Submods/ManagedMod/helper.py",
		},
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("expected no unmanaged items for a fully managed directory, got %+v", results)
	}
}

// A module whose name contains a dot still belongs to its source. The owned
// artifact set is expanded forwards from the managed sources, so the scan never
// has to guess which module a __pycache__ entry was compiled from.
func TestLocalSubmodsSkipsCompiledArtifactsOfDottedModule(t *testing.T) {
	masRoot := t.TempDir()
	dottedDir := filepath.Join(masRoot, "game", "Submods", "DottedMod")
	if err := os.MkdirAll(filepath.Join(dottedDir, "__pycache__"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(rel, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dottedDir, rel), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("helper.foo.py", "VALUE = 1\n")
	write(filepath.Join("__pycache__", "helper.foo.cpython-311.pyc"), "compiled")

	manifest := core.NewManifest()
	manifest.Installations["inst_dotted"] = &core.InstallationRecord{
		InstallationID: "inst_dotted",
		Paths:          []string{"game/Submods/DottedMod/helper.foo.py"},
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("expected no unmanaged items for a managed dotted module, got %+v", results)
	}
}

// The scan expands the ledger's canonical keys, which Windows lowercases, while
// CPython keeps the module's casing in __pycache__. Bytecode of a managed
// mixed-case module must not resurface the directory as unmanaged.
func TestLocalSubmodsSkipsCompiledArtifactsOfMixedCaseModule(t *testing.T) {
	masRoot := t.TempDir()
	dir := filepath.Join(masRoot, "game", "Submods", "MixedCase")
	if err := os.MkdirAll(filepath.Join(dir, "__pycache__"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(rel, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("Helper.py", "VALUE = 1\n")
	write(filepath.Join("__pycache__", "Helper.cpython-311.pyc"), "compiled")

	manifest := core.NewManifest()
	manifest.Installations["inst_mixed"] = &core.InstallationRecord{
		InstallationID: "inst_mixed",
		Paths:          []string{"game/Submods/MixedCase/Helper.py"},
	}

	results, err := scanLocalSubmodsCore(masRoot, manifest)
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("expected no unmanaged items for a managed mixed-case module, got %+v", results)
	}
}

// A compiled artifact whose source is not managed is still reported: nothing in
// the ledger proves that another mod owns it.
func TestLocalSubmodsReportsCompiledArtifactsWithoutManagedSource(t *testing.T) {
	masRoot := t.TempDir()
	unmanagedDir := filepath.Join(masRoot, "game", "Submods", "UnmanagedMod")
	if err := os.MkdirAll(unmanagedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(unmanagedDir, "main.rpy"), []byte("init python:\n    Submod(name='Loose', version='0.1')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(unmanagedDir, "main.rpyc"), []byte("compiled"), 0o644); err != nil {
		t.Fatal(err)
	}

	results, err := scanLocalSubmodsCore(masRoot, core.NewManifest())
	if err != nil {
		t.Fatalf("scanLocalSubmodsCore failed: %v", err)
	}
	if len(results) != 1 || len(results[0].Files) != 2 {
		t.Fatalf("expected one item with both files, got %+v", results)
	}
}

func TestLocalSubmodsEmptyResultIsJSONArray(t *testing.T) {
	tests := []struct {
		name  string
		setup func(t *testing.T) (string, *core.Manifest)
	}{
		{
			name: "directory does not exist",
			setup: func(t *testing.T) (string, *core.Manifest) {
				masRoot := t.TempDir()
				return masRoot, core.NewManifest()
			},
		},
		{
			name: "directory exists and is empty",
			setup: func(t *testing.T) (string, *core.Manifest) {
				masRoot := t.TempDir()
				submodsDir := filepath.Join(masRoot, "game", "Submods")
				if err := os.MkdirAll(submodsDir, 0o755); err != nil {
					t.Fatal(err)
				}
				return masRoot, core.NewManifest()
			},
		},
		{
			name: "only managed scripts",
			setup: func(t *testing.T) (string, *core.Manifest) {
				masRoot := t.TempDir()
				submodsDir := filepath.Join(masRoot, "game", "Submods")
				managedDir := filepath.Join(submodsDir, "ManagedMod")
				if err := os.MkdirAll(managedDir, 0o755); err != nil {
					t.Fatal(err)
				}
				managedFile := filepath.Join(managedDir, "managed.rpy")
				if err := os.WriteFile(managedFile, []byte("init python:\n    Submod(name='Managed', version='1.0')\n"), 0o644); err != nil {
					t.Fatal(err)
				}
				manifest := core.NewManifest()
				manifest.Installations["inst_managed"] = &core.InstallationRecord{
					InstallationID: "inst_managed",
					ModID:          "mod_managed",
					Paths:          []string{"game/Submods/ManagedMod/managed.rpy"},
				}
				manifest.Files["game/submods/managedmod/managed.rpy"] = &core.FileRecord{
					DisplayPath: "game/Submods/ManagedMod/managed.rpy",
				}
				return masRoot, manifest
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			masRoot, manifest := tc.setup(t)
			results, err := scanLocalSubmodsCore(masRoot, manifest)
			if err != nil {
				t.Fatalf("expected nil error, got %v", err)
			}
			if results == nil {
				t.Fatalf("expected non-nil results slice, got nil")
			}
			if len(results) != 0 {
				t.Fatalf("expected 0 results, got %d", len(results))
			}
			rawJSON, err := json.Marshal(results)
			if err != nil {
				t.Fatalf("json.Marshal failed: %v", err)
			}
			if string(rawJSON) != "[]" {
				t.Fatalf("expected JSON '[]', got %q", string(rawJSON))
			}
		})
	}
}
