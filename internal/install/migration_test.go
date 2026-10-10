package install

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMigrationCompleteChain(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	blobs := filepath.Join(state, "blobs")
	_ = os.MkdirAll(blobs, 0o755)

	filePath := "game/script.rpy"
	diskPath := filepath.Join(root, filepath.FromSlash(filePath))
	_ = os.MkdirAll(filepath.Dir(diskPath), 0o755)

	origContent := "original content"
	modAContent := "mod A content"
	modBContent := "mod B content"

	// Disk currently has mod B
	_ = os.WriteFile(diskPath, []byte(modBContent), 0o644)

	// Create legacy opA: backed up origContent
	backupDirA := filepath.Join(state, "backups", "opA", filepath.Dir(filepath.FromSlash(filePath)))
	_ = os.MkdirAll(backupDirA, 0o755)
	backupFileA := filepath.Join(state, "backups", "opA", filepath.FromSlash(filePath))
	_ = os.WriteFile(backupFileA, []byte(origContent), 0o644)

	jA := Journal{
		Operation: Operation{
			ID: "opA",
			Changes: []Change{
				{Path: filePath},
			},
		},
		Backups: map[string]string{
			filePath: backupFileA,
		},
		State:     "committed",
		UpdatedAt: time.Now().Add(-2 * time.Hour),
	}
	bA, _ := json.Marshal(jA)
	_ = os.WriteFile(filepath.Join(state, "opA.json"), bA, 0o644)

	// Create legacy opB: backed up modAContent
	backupDirB := filepath.Join(state, "backups", "opB", filepath.Dir(filepath.FromSlash(filePath)))
	_ = os.MkdirAll(backupDirB, 0o755)
	backupFileB := filepath.Join(state, "backups", "opB", filepath.FromSlash(filePath))
	_ = os.WriteFile(backupFileB, []byte(modAContent), 0o644)

	jB := Journal{
		Operation: Operation{
			ID: "opB",
			Changes: []Change{
				{Path: filePath},
			},
		},
		Backups: map[string]string{
			filePath: backupFileB,
		},
		State:     "committed",
		UpdatedAt: time.Now().Add(-1 * time.Hour),
	}
	bB, _ := json.Marshal(jB)
	_ = os.WriteFile(filepath.Join(state, "opB.json"), bB, 0o644)

	// Run migration
	m, err := MigrateLegacyState(root, state)
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	if m.SchemaVersion != 2 {
		t.Fatalf("expected schema 2, got %d", m.SchemaVersion)
	}

	rec := m.GetFile(manifestCanonicalKey(filePath))
	if rec == nil {
		t.Fatal("file record missing")
	}
	if !rec.Original.Exists || rec.Original.Hash != hashBytes([]byte(origContent)) {
		t.Fatalf("expected original content hash, got %+v", rec.Original)
	}
	if len(rec.Layers) != 2 {
		t.Fatalf("expected 2 layers, got %d", len(rec.Layers))
	}
	if rec.Layers[0].Hash != hashBytes([]byte(modAContent)) || rec.Layers[1].Hash != hashBytes([]byte(modBContent)) {
		t.Fatalf("unexpected layers: %+v", rec.Layers)
	}

	// Repeat migration -> idempotent
	m2, err := MigrateLegacyState(root, state)
	if err != nil || m2.SchemaVersion != 2 {
		t.Fatalf("repeat migration failed: %v", err)
	}
}

func TestMigrationFailsWhenOriginalBackupMissing(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")

	filePath := "game/script.rpy"
	diskPath := filepath.Join(root, filepath.FromSlash(filePath))
	_ = os.MkdirAll(filepath.Dir(diskPath), 0o755)
	_ = os.WriteFile(diskPath, []byte("mod content"), 0o644)

	// op points to a backup path that does not exist
	j := Journal{
		Operation: Operation{
			ID:      "op_broken",
			Changes: []Change{{Path: filePath}},
		},
		Backups: map[string]string{
			filePath: filepath.Join(state, "backups", "op_broken", "missing.rpy"),
		},
		State:     "committed",
		UpdatedAt: time.Now(),
	}
	_ = os.MkdirAll(state, 0o755)
	b, _ := json.Marshal(j)
	_ = os.WriteFile(filepath.Join(state, "op_broken.json"), b, 0o644)

	_, err := MigrateLegacyState(root, state)
	if err == nil || !IsCode(err, "migration_required") {
		t.Fatalf("expected migration_required error, got %v", err)
	}
}

func TestMigrationFailsOnAmbiguousTimestamps(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")

	sameTime := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	filePath := "game/conflict.rpy"

	j1 := Journal{
		Operation: Operation{ID: "op1", Changes: []Change{{Path: filePath}}},
		State:     "committed",
		UpdatedAt: sameTime,
	}
	j2 := Journal{
		Operation: Operation{ID: "op2", Changes: []Change{{Path: filePath}}},
		State:     "committed",
		UpdatedAt: sameTime,
	}

	_ = os.MkdirAll(state, 0o755)
	b1, _ := json.Marshal(j1)
	b2, _ := json.Marshal(j2)
	_ = os.WriteFile(filepath.Join(state, "op1.json"), b1, 0o644)
	_ = os.WriteFile(filepath.Join(state, "op2.json"), b2, 0o644)

	_, err := MigrateLegacyState(root, state)
	if err == nil || !IsCode(err, "migration_required") {
		t.Fatalf("expected migration_required on ambiguous timestamps, got %v", err)
	}
}

func TestMigrationExcludesUninstalledLegacyInstallations(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	blobs := filepath.Join(state, "blobs")
	_ = os.MkdirAll(blobs, 0o755)

	fileA := "game/fileA.rpy"
	fileB := "game/fileB.rpy"
	diskB := filepath.Join(root, filepath.FromSlash(fileB))
	_ = os.MkdirAll(filepath.Dir(diskB), 0o755)
	_ = os.WriteFile(diskB, []byte("content B"), 0o644)

	// opA installed fileA, then was uninstalled!
	jA := Journal{
		Operation: Operation{ID: "opA", Changes: []Change{{Path: fileA}}},
		State:     "committed",
		UpdatedAt: time.Now().Add(-3 * time.Hour),
	}
	bA, _ := json.Marshal(jA)
	_ = os.WriteFile(filepath.Join(state, "opA.json"), bA, 0o644)

	// uninstall_opA removed fileA
	jUnA := Journal{
		Operation: Operation{ID: "uninstall_opA", Changes: []Change{{Path: fileA, Remove: true}}},
		State:     "committed",
		UpdatedAt: time.Now().Add(-2 * time.Hour),
	}
	bUnA, _ := json.Marshal(jUnA)
	_ = os.WriteFile(filepath.Join(state, "uninstall_opA.json"), bUnA, 0o644)

	// opB installed fileB (remains active)
	jB := Journal{
		Operation: Operation{ID: "opB", Changes: []Change{{Path: fileB}}},
		State:     "committed",
		UpdatedAt: time.Now().Add(-1 * time.Hour),
	}
	bB, _ := json.Marshal(jB)
	_ = os.WriteFile(filepath.Join(state, "opB.json"), bB, 0o644)

	// Receipts: only opB is installed
	type miniReceipt struct {
		ModID       string `json:"mod_id"`
		OperationID string `json:"operation_id"`
	}
	receipts := []miniReceipt{
		{ModID: "mod_B", OperationID: "opB"},
	}
	recBytes, _ := json.Marshal(receipts)
	_ = os.WriteFile(filepath.Join(state, "installed-archives.json"), recBytes, 0o644)

	// Run migration
	m, err := MigrateLegacyState(root, state)
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	// opA MUST NOT be in Installations!
	if _, exists := m.Installations["opA"]; exists {
		t.Fatal("uninstalled opA was unexpectedly included in migrated manifest installations")
	}

	// opB MUST be in Installations!
	if _, exists := m.Installations["opB"]; !exists {
		t.Fatal("active opB was missing from migrated manifest installations")
	}

	// fileA record should have no active layers
	recA := m.GetFile(manifestCanonicalKey(fileA))
	if recA != nil && len(recA.Layers) > 0 {
		t.Fatalf("uninstalled fileA still has layers: %+v", recA.Layers)
	}
}
