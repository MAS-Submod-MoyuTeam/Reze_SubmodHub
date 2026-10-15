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
