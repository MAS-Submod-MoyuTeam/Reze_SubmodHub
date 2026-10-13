package install

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCanonicalPathValidation(t *testing.T) {
	stateDir := ".submodhub/state"

	// Valid paths
	display, key, err := CanonicalPath("game/Submods/demo/main.rpy", stateDir)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if display != "game/Submods/demo/main.rpy" {
		t.Fatalf("unexpected display: %s", display)
	}
	if runtime.GOOS == "windows" {
		if key != "game/submods/demo/main.rpy" {
			t.Fatalf("unexpected windows key: %s", key)
		}
	} else {
		if key != "game/Submods/demo/main.rpy" {
			t.Fatalf("unexpected non-windows key: %s", key)
		}
	}

	// Backslash normalization
	displayBS, keyBS, err := CanonicalPath("game\\Submods\\demo\\main.rpy", stateDir)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if displayBS != "game/Submods/demo/main.rpy" {
		t.Fatalf("unexpected display: %s", displayBS)
	}
	if keyBS != key {
		t.Fatalf("keyBS %s != key %s", keyBS, key)
	}

	// Invalid cases
	invalidPaths := []string{
		"",
		"/game/Submods/test.rpy",
		"\\game\\Submods\\test.rpy",
		"../test.rpy",
		"game/../../test.rpy",
		"C:/game/test.rpy",
		"C:\\game\\test.rpy",
		"\\\\server\\share\\test.rpy",
		"game/test.rpy:stream", // ADS
		".submodhub/state/index.json",
		".submodhub/state/blobs/ab/123",
		".submodhub\\state\\test",
	}

	for _, p := range invalidPaths {
		_, _, err := CanonicalPath(p, stateDir)
		if err == nil {
			t.Fatalf("expected error for path %q, got nil", p)
		}
	}
}

func TestManifestOriginalSnapshotImmutable(t *testing.T) {
	m := NewManifest()

	// Initial record with original file existing
	err := m.RecordLayer("game/script.rpy", "game/script.rpy", OriginalRecord{
		Exists: true,
		Hash:   "orig_hash_111",
		Mode:   0o644,
	}, LayerRecord{
		InstallationID: "inst_A",
		ModID:          "mod_A",
		VersionID:      "v1",
		OperationID:    "op_A",
		Order:          1,
		Hash:           "hash_A",
		Mode:           0o644,
	})
	if err != nil {
		t.Fatalf("record layer A err: %v", err)
	}

	rec := m.GetFile("game/script.rpy")
	if rec == nil || !rec.Original.Exists || rec.Original.Hash != "orig_hash_111" {
		t.Fatalf("invalid original record: %+v", rec)
	}

	// Subsequent record (mod B overwrites) with DIFFERENT original candidate
	// The original record must NOT be overwritten!
	err = m.RecordLayer("game/script.rpy", "game/script.rpy", OriginalRecord{
		Exists: true,
		Hash:   "hash_A", // candidate passed from B's before-state
		Mode:   0o644,
	}, LayerRecord{
		InstallationID: "inst_B",
		ModID:          "mod_B",
		VersionID:      "v2",
		OperationID:    "op_B",
		Order:          2,
		Hash:           "hash_B",
		Mode:           0o644,
	})
	if err != nil {
		t.Fatalf("record layer B err: %v", err)
	}

	rec = m.GetFile("game/script.rpy")
	if rec == nil {
		t.Fatal("file record not found")
	}
	if rec.Original.Hash != "orig_hash_111" {
		t.Fatalf("expected original hash orig_hash_111, got %s (must not be overwritten)", rec.Original.Hash)
	}
	if len(rec.Layers) != 2 {
		t.Fatalf("expected 2 layers, got %d", len(rec.Layers))
	}
	if rec.ActiveLayer().InstallationID != "inst_B" {
		t.Fatalf("expected active layer inst_B, got %+v", rec.ActiveLayer())
	}
}

func TestManifestDistinguishesMissingAndZeroByte(t *testing.T) {
	m := NewManifest()

	// File 1: was originally non-existent
	err := m.RecordLayer("game/new.rpy", "game/new.rpy", OriginalRecord{
		Exists: false,
		Hash:   "",
	}, LayerRecord{
		InstallationID: "inst_1",
		ModID:          "mod_1",
		OperationID:    "op_1",
		Order:          1,
		Hash:           "some_hash",
	})
	if err != nil {
		t.Fatal(err)
	}

	rec1 := m.GetFile("game/new.rpy")
	if rec1.Original.Exists || rec1.Original.Hash != "" {
		t.Fatalf("expected non-existent original, got %+v", rec1.Original)
	}

	// File 2: originally existed as 0-byte file
	emptyHash := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	err = m.RecordLayer("game/empty.rpy", "game/empty.rpy", OriginalRecord{
		Exists: true,
		Hash:   emptyHash,
	}, LayerRecord{
		InstallationID: "inst_2",
		ModID:          "mod_2",
		OperationID:    "op_2",
		Order:          2,
		Hash:           "some_hash",
	})
	if err != nil {
		t.Fatal(err)
	}

	rec2 := m.GetFile("game/empty.rpy")
	if !rec2.Original.Exists || rec2.Original.Hash != emptyHash {
		t.Fatalf("expected exists=true with emptyHash, got %+v", rec2.Original)
	}
}

func TestManifestDuplicateHashAttribution(t *testing.T) {
	m := NewManifest()

	sameHash := "aabbcc123"
	// Mod A installs file with sameHash
	_ = m.RecordLayer("game/shared.rpy", "game/shared.rpy", OriginalRecord{Exists: false}, LayerRecord{
		InstallationID: "inst_A",
		ModID:          "mod_A",
		Order:          1,
		Hash:           sameHash,
	})

	// Mod B installs file with sameHash
	_ = m.RecordLayer("game/shared.rpy", "game/shared.rpy", OriginalRecord{Exists: false}, LayerRecord{
		InstallationID: "inst_B",
		ModID:          "mod_B",
		Order:          2,
		Hash:           sameHash,
	})

	rec := m.GetFile("game/shared.rpy")
	if len(rec.Layers) != 2 {
		t.Fatalf("expected 2 distinct layer records for same hash, got %d", len(rec.Layers))
	}
	if rec.Layers[0].InstallationID != "inst_A" || rec.Layers[1].InstallationID != "inst_B" {
		t.Fatalf("unexpected layers: %+v", rec.Layers)
	}

	// Remove layer B
	m.RemoveLayer("game/shared.rpy", "inst_B")
	rec = m.GetFile("game/shared.rpy")
	if len(rec.Layers) != 1 || rec.ActiveLayer().InstallationID != "inst_A" {
		t.Fatalf("expected 1 layer inst_A, got %+v", rec)
	}
}

func TestManifestSaveAndLoad(t *testing.T) {
	tmp := t.TempDir()
	p := filepath.Join(tmp, "manifest.json")
	m := NewManifest()
	m.Generation = 42
	m.NextOrder = 5
	_ = m.RecordLayer("game/Submods/a.rpy", "game/submods/a.rpy", OriginalRecord{Exists: true, Hash: "orig_h"}, LayerRecord{
		InstallationID: "inst1",
		Order:          1,
		Hash:           "h1",
	})
	if err := m.Save(p); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	loaded, err := LoadManifest(p)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}
	if loaded.SchemaVersion != 2 || loaded.Generation != 42 || loaded.NextOrder != 5 {
		t.Fatalf("unexpected loaded manifest: %+v", loaded)
	}
	f := loaded.GetFile("game/submods/a.rpy")
	if f == nil || len(f.Layers) != 1 || f.Layers[0].Hash != "h1" || f.Original.Hash != "orig_h" {
		t.Fatalf("unexpected file record: %+v", f)
	}
}

func TestManifestSpritepackPartialSelectionCompatibility(t *testing.T) {
	tmp := t.TempDir()
	p := filepath.Join(tmp, "manifest.json")

	// 1. Save manifest with spritepack partial fields
	m := NewManifest()
	m.Installations["inst_sp"] = &InstallationRecord{
		InstallationID:         "inst_sp",
		ModID:                  "mod_sp",
		VersionID:              "v1",
		Version:                "1.0.0",
		Title:                  "Spritepack Title",
		OperationID:            "op_1",
		Order:                  1,
		Priority:               10,
		Paths:                  []string{"game/mod_assets/monika/j/necklace.json"},
		SpriteSetIDs:           []string{"set_a"},
		SpriteSelectionHash:    "hash_a",
		SelectedSpriteSetCount: 1,
	}
	if err := m.Save(p); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	loaded, err := LoadManifest(p)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}
	inst := loaded.Installations["inst_sp"]
	if inst == nil {
		t.Fatal("expected inst_sp in loaded manifest")
	}
	if len(inst.SpriteSetIDs) != 1 || inst.SpriteSetIDs[0] != "set_a" {
		t.Fatalf("unexpected SpriteSetIDs: %+v", inst.SpriteSetIDs)
	}
	if inst.SpriteSelectionHash != "hash_a" || inst.SelectedSpriteSetCount != 1 {
		t.Fatalf("unexpected sprite hash or count: %+v", inst)
	}

	// 2. Backward compatibility: manifest JSON without sprite fields
	legacyJSON := []byte(`{
		"schema_version": 2,
		"generation": 1,
		"installations": {
			"inst_legacy": {
				"installation_id": "inst_legacy",
				"mod_id": "mod_legacy",
				"operation_id": "op_leg",
				"order": 1,
				"priority": 0,
				"paths": ["game/script.rpy"]
			}
		},
		"files": {}
	}`)
	legacyPath := filepath.Join(tmp, "legacy_manifest.json")
	if err := os.WriteFile(legacyPath, legacyJSON, 0o600); err != nil {
		t.Fatal(err)
	}

	loadedLegacy, err := LoadManifest(legacyPath)
	if err != nil {
		t.Fatalf("load legacy failed: %v", err)
	}
	legInst := loadedLegacy.Installations["inst_legacy"]
	if legInst == nil {
		t.Fatal("expected inst_legacy in loaded manifest")
	}
	// Omitted fields must be empty/nil/0, never auto-inferred as full install
	if len(legInst.SpriteSetIDs) != 0 || legInst.SpriteSelectionHash != "" || legInst.SelectedSpriteSetCount != 0 {
		t.Fatalf("legacy record should have empty sprite fields: %+v", legInst)
	}
}
