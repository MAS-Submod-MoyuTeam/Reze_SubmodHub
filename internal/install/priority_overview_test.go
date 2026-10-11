package install

import (
	"bytes"
	"testing"
)

func TestPriorityOverviewPrecedenceAndTies(t *testing.T) {
	m := NewManifest()
	orig := OriginalRecord{Exists: false}

	// 1. Precedence: C(80, 0) > B(50, 2) > A(50, 1)
	layerA := LayerRecord{InstallationID: "inst_a", ModID: "mod_a", Priority: 50, Order: 1, Hash: "hash_a"}
	layerB := LayerRecord{InstallationID: "inst_b", ModID: "mod_b", Priority: 50, Order: 2, Hash: "hash_b"}
	layerC := LayerRecord{InstallationID: "inst_c", ModID: "mod_c", Priority: 80, Order: 0, Hash: "hash_c"}

	if err := m.RecordLayer("game/shared.rpy", "game/shared.rpy", orig, layerA); err != nil {
		t.Fatal(err)
	}
	if err := m.RecordLayer("game/shared.rpy", "game/shared.rpy", orig, layerB); err != nil {
		t.Fatal(err)
	}
	if err := m.RecordLayer("game/shared.rpy", "game/shared.rpy", orig, layerC); err != nil {
		t.Fatal(err)
	}

	rec := m.Files["game/shared.rpy"]
	if rec.ActiveLayer().ModID != "mod_c" {
		t.Fatalf("expected mod_c to win (80 > 50), got %s", rec.ActiveLayer().ModID)
	}

	// Remove C; between B and A, B (Order 2) must win over A (Order 1)
	m.RemoveLayer("game/shared.rpy", "inst_c")
	rec = m.Files["game/shared.rpy"]
	if rec.ActiveLayer().ModID != "mod_b" {
		t.Fatalf("expected mod_b to win on order tie-break (Order 2 > 1), got %s", rec.ActiveLayer().ModID)
	}

	// 2. ModID tie-break when Priority and Order are equal
	m2 := NewManifest()
	layerAlpha := LayerRecord{InstallationID: "inst_1", ModID: "mod_alpha", Priority: 50, Order: 2, Hash: "hash_1"}
	layerBeta := LayerRecord{InstallationID: "inst_2", ModID: "mod_beta", Priority: 50, Order: 2, Hash: "hash_2"}
	if err := m2.RecordLayer("game/tie.rpy", "game/tie.rpy", orig, layerAlpha); err != nil {
		t.Fatal(err)
	}
	if err := m2.RecordLayer("game/tie.rpy", "game/tie.rpy", orig, layerBeta); err != nil {
		t.Fatal(err)
	}
	if m2.Files["game/tie.rpy"].ActiveLayer().ModID != "mod_beta" {
		t.Fatalf("expected mod_beta to win on mod_id tie-break ('mod_beta' > 'mod_alpha'), got %s", m2.Files["game/tie.rpy"].ActiveLayer().ModID)
	}

	// 3. Unicode ModID tie-break
	mUnicode := NewManifest()
	modA := "模组_乙" // '乙' is U+4E59 (0xE4 0xB9 0x99)
	modB := "模组_甲" // '甲' is U+7532 (0xE7 0x94 0xB2), byte comparison: modB > modA
	// Verify Go byte comparison: modB bytes > modA bytes
	if bytes.Compare([]byte(modB), []byte(modA)) <= 0 {
		t.Fatalf("expected %q bytes to be greater than %q", modB, modA)
	}
	layerU1 := LayerRecord{InstallationID: "inst_u1", ModID: modA, Priority: 50, Order: 2, Hash: "hash_u1"}
	layerU2 := LayerRecord{InstallationID: "inst_u2", ModID: modB, Priority: 50, Order: 2, Hash: "hash_u2"}
	if err := mUnicode.RecordLayer("game/unicode.rpy", "game/unicode.rpy", orig, layerU1); err != nil {
		t.Fatal(err)
	}
	if err := mUnicode.RecordLayer("game/unicode.rpy", "game/unicode.rpy", orig, layerU2); err != nil {
		t.Fatal(err)
	}
	if mUnicode.Files["game/unicode.rpy"].ActiveLayer().ModID != modB {
		t.Fatalf("expected %s to win on unicode tie-break, got %s", modB, mUnicode.Files["game/unicode.rpy"].ActiveLayer().ModID)
	}

	// 4. InstallationID tie-break when ModID is also equal
	mInst := NewManifest()
	layerInst1 := LayerRecord{InstallationID: "inst_01", ModID: "same_mod", Priority: 50, Order: 2, Hash: "hash_1"}
	layerInst2 := LayerRecord{InstallationID: "inst_02", ModID: "same_mod", Priority: 50, Order: 2, Hash: "hash_2"}
	if err := mInst.RecordLayer("game/inst.rpy", "game/inst.rpy", orig, layerInst1); err != nil {
		t.Fatal(err)
	}
	if err := mInst.RecordLayer("game/inst.rpy", "game/inst.rpy", orig, layerInst2); err != nil {
		t.Fatal(err)
	}
	if mInst.Files["game/inst.rpy"].ActiveLayer().InstallationID != "inst_02" {
		t.Fatalf("expected inst_02 to win on installation_id tie-break, got %s", mInst.Files["game/inst.rpy"].ActiveLayer().InstallationID)
	}
}

func TestPriorityOverviewLayersOrderAndActiveOwner(t *testing.T) {
	m := NewManifest()
	m.Generation = 42

	// Register installations
	m.Installations["inst_a"] = &InstallationRecord{
		InstallationID: "inst_a",
		ModID:          "mod_a",
		Title:          "Mod A",
		Priority:       50,
		Order:          1,
		Paths:          []string{"game/shared.rpy", "game/conflict.rpy"},
	}
	m.Installations["inst_b"] = &InstallationRecord{
		InstallationID: "inst_b",
		ModID:          "mod_b",
		Title:          "Mod B",
		Priority:       50,
		Order:          2,
		Paths:          []string{"game/shared.rpy", "game/conflict.rpy"},
	}
	m.Installations["inst_c"] = &InstallationRecord{
		InstallationID: "inst_c",
		ModID:          "mod_c",
		Title:          "Mod C",
		Priority:       80,
		Order:          0,
		Paths:          []string{"game/shared.rpy", "game/conflict.rpy"},
	}

	orig := OriginalRecord{Exists: false}

	// Shared path: identical hash across layers
	sameHash := "sha256_identical"
	if err := m.RecordLayer("game/shared.rpy", "game/shared.rpy", orig, LayerRecord{
		InstallationID: "inst_a", ModID: "mod_a", Priority: 50, Order: 1, Hash: sameHash,
	}); err != nil {
		t.Fatal(err)
	}
	if err := m.RecordLayer("game/shared.rpy", "game/shared.rpy", orig, LayerRecord{
		InstallationID: "inst_b", ModID: "mod_b", Priority: 50, Order: 2, Hash: sameHash,
	}); err != nil {
		t.Fatal(err)
	}
	if err := m.RecordLayer("game/shared.rpy", "game/shared.rpy", orig, LayerRecord{
		InstallationID: "inst_c", ModID: "mod_c", Priority: 80, Order: 0, Hash: sameHash,
	}); err != nil {
		t.Fatal(err)
	}

	// Conflict path: different hashes across layers
	if err := m.RecordLayer("game/conflict.rpy", "game/conflict.rpy", orig, LayerRecord{
		InstallationID: "inst_a", ModID: "mod_a", Priority: 50, Order: 1, Hash: "hash_a",
	}); err != nil {
		t.Fatal(err)
	}
	if err := m.RecordLayer("game/conflict.rpy", "game/conflict.rpy", orig, LayerRecord{
		InstallationID: "inst_b", ModID: "mod_b", Priority: 50, Order: 2, Hash: "hash_b",
	}); err != nil {
		t.Fatal(err)
	}
	if err := m.RecordLayer("game/conflict.rpy", "game/conflict.rpy", orig, LayerRecord{
		InstallationID: "inst_c", ModID: "mod_c", Priority: 80, Order: 0, Hash: "hash_c",
	}); err != nil {
		t.Fatal(err)
	}

	overview, err := m.GetPriorityOverview("")
	if err != nil {
		t.Fatalf("unexpected error getting priority overview: %v", err)
	}

	// Verify overview.Mods is sorted descending: C (80), B (50, order 2), A (50, order 1)
	if len(overview.Mods) != 3 {
		t.Fatalf("expected 3 mods, got %d", len(overview.Mods))
	}
	if overview.Mods[0].ModID != "mod_c" || overview.Mods[0].Priority != 80 {
		t.Fatalf("expected mod_c first, got %+v", overview.Mods[0])
	}
	if overview.Mods[1].ModID != "mod_b" || overview.Mods[1].Order != 2 {
		t.Fatalf("expected mod_b second, got %+v", overview.Mods[1])
	}
	if overview.Mods[2].ModID != "mod_a" || overview.Mods[2].Order != 1 {
		t.Fatalf("expected mod_a third, got %+v", overview.Mods[2])
	}

	// Verify overview.Paths retains original ascending layer order (lowest to highest)
	// and ActiveOwner matches the winning layer (the last item in raw layers)
	for _, pe := range overview.Paths {
		if len(pe.Layers) != 3 {
			t.Fatalf("path %s expected 3 layers, got %d", pe.Path, len(pe.Layers))
		}
		// In raw manifest and overview, layers are sorted ascending:
		// index 0: A (prio 50, order 1)
		// index 1: B (prio 50, order 2)
		// index 2: C (prio 80, order 0)
		if pe.Layers[0].ModID != "mod_a" || pe.Layers[1].ModID != "mod_b" || pe.Layers[2].ModID != "mod_c" {
			t.Fatalf("path %s raw layers should remain low-to-high ascending (A, B, C), got: %+v", pe.Path, pe.Layers)
		}
		// ActiveOwner must match the last layer (C)
		lastLayer := pe.Layers[len(pe.Layers)-1]
		if pe.ActiveOwner != lastLayer.ModID {
			t.Fatalf("path %s ActiveOwner (%s) does not match winning layer (%s)", pe.Path, pe.ActiveOwner, lastLayer.ModID)
		}
		if pe.ActiveOwner != "mod_c" {
			t.Fatalf("path %s expected ActiveOwner mod_c, got %s", pe.Path, pe.ActiveOwner)
		}
	}
}
