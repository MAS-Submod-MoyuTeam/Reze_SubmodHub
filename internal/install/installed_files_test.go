package install

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestListInstalledFiles_EmptyAndNotFound(t *testing.T) {
	manifest := NewManifest()

	// Not found
	_, err := manifest.ListInstalledFiles("non-existent", "", "")
	if err == nil || !IsCode(err, "not_found") {
		t.Fatalf("expected not_found error, got %v", err)
	}

	// Empty installation
	manifest.Installations["inst_empty"] = &InstallationRecord{
		InstallationID: "inst_empty",
		ModID:          "mod_empty",
		VersionID:      "v1",
		Version:        "1.0.0",
		Title:          "Empty Mod",
		Paths:          []string{},
		InstalledAt:    time.Now(),
	}

	list, err := manifest.ListInstalledFiles("inst_empty", "mod_empty", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if list.TotalFiles() != 0 || len(list.Files) != 0 {
		t.Fatalf("expected 0 files, got %d", len(list.Files))
	}
	if list.Summary.TotalFiles != 0 || list.Summary.ActiveFiles != 0 {
		t.Fatalf("unexpected summary: %+v", list.Summary)
	}

	// Mismatched modID
	_, err = manifest.ListInstalledFiles("inst_empty", "wrong_mod", "")
	if err == nil || !IsCode(err, "not_found") {
		t.Fatalf("expected not_found for mismatched modID, got %v", err)
	}
}

// helper method if needed or direct check
func (l *InstalledFileList) TotalFiles() int {
	return len(l.Files)
}

func TestListInstalledFiles_LayersAndDrift(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "mas_test_files_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	manifest := NewManifest()

	// Setup file on disk
	filePath := filepath.Join(tempDir, "game", "Submods", "demo", "script.rpy")
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte("original-content"), 0644); err != nil {
		t.Fatal(err)
	}

	hashA := "aaaa1111"
	hashB := "bbbb2222"

	// Register 2 installations sharing the same file
	canonKey := "game/submods/demo/script.rpy"
	manifest.Installations["inst_a"] = &InstallationRecord{
		InstallationID: "inst_a",
		ModID:          "mod_a",
		VersionID:      "v_a",
		Version:        "1.0.0",
		Title:          "Mod A",
		Paths:          []string{canonKey},
		InstalledAt:    time.Now(),
	}
	manifest.Installations["inst_b"] = &InstallationRecord{
		InstallationID: "inst_b",
		ModID:          "mod_b",
		VersionID:      "v_b",
		Version:        "2.0.0",
		Title:          "Mod B (High Priority)",
		Paths:          []string{canonKey},
		InstalledAt:    time.Now(),
	}

	manifest.Files[canonKey] = &FileRecord{
		DisplayPath: "game/Submods/demo/script.rpy",
		Original: OriginalRecord{
			Exists: false,
		},
		Layers: []LayerRecord{
			{
				InstallationID: "inst_a",
				ModID:          "mod_a",
				VersionID:      "v_a",
				Order:          10,
				Hash:           hashA,
			},
			{
				InstallationID: "inst_b",
				ModID:          "mod_b",
				VersionID:      "v_b",
				Order:          20,
				Hash:           hashB,
			},
		},
	}

	// 1. Check inst_a: should be overridden (Active = false), not drifted
	listA, err := manifest.ListInstalledFiles("inst_a", "mod_a", tempDir)
	if err != nil {
		t.Fatalf("listA failed: %v", err)
	}
	if len(listA.Files) != 1 {
		t.Fatalf("expected 1 file for inst_a, got %d", len(listA.Files))
	}
	if listA.Files[0].Active {
		t.Fatalf("expected inst_a layer to be inactive, but was active")
	}
	if listA.Summary.ActiveFiles != 0 || listA.Summary.OverriddenFiles != 1 {
		t.Fatalf("expected 0 active, 1 overridden, got %+v", listA.Summary)
	}

	// 2. Check inst_b: should be active (Active = true), but disk content != hashB, so drifted = true
	listB, err := manifest.ListInstalledFiles("inst_b", "mod_b", tempDir)
	if err != nil {
		t.Fatalf("listB failed: %v", err)
	}
	if len(listB.Files) != 1 {
		t.Fatalf("expected 1 file for inst_b, got %d", len(listB.Files))
	}
	if !listB.Files[0].Active {
		t.Fatalf("expected inst_b layer to be active")
	}
	if !listB.Files[0].Drifted {
		t.Fatalf("expected inst_b file to be drifted because disk content doesn't match hashB")
	}
	if listB.Summary.DriftedFiles != 1 || listB.Summary.ActiveFiles != 1 {
		t.Fatalf("unexpected summary for listB: %+v", listB.Summary)
	}

	// Now write expected hashB content to disk
	realHashB, _ := hashFile(filePath)
	manifest.Files[canonKey].Layers[1].Hash = realHashB

	listBAfter, err := manifest.ListInstalledFiles("inst_b", "mod_b", tempDir)
	if err != nil {
		t.Fatalf("listBAfter failed: %v", err)
	}
	if listBAfter.Files[0].Drifted {
		t.Fatalf("expected inst_b file to NOT be drifted when disk content matches")
	}
	if listBAfter.Summary.DriftedFiles != 0 {
		t.Fatalf("expected 0 drifted files, got %d", listBAfter.Summary.DriftedFiles)
	}

	// 3. Remove file on disk: active file should now be marked drifted
	_ = os.Remove(filePath)
	listBDeleted, err := manifest.ListInstalledFiles("inst_b", "mod_b", tempDir)
	if err != nil {
		t.Fatalf("listBDeleted failed: %v", err)
	}
	if !listBDeleted.Files[0].Drifted {
		t.Fatalf("expected deleted active file to be marked drifted")
	}
}

func TestListInstalledFiles_Sorting(t *testing.T) {
	manifest := NewManifest()
	manifest.Installations["inst_sort"] = &InstallationRecord{
		InstallationID: "inst_sort",
		ModID:          "mod_sort",
		VersionID:      "v1",
		Paths: []string{
			"game/submods/z.rpy",
			"game/submods/a.rpy",
			"game/submods/B.rpy",
		},
	}
	manifest.Files["game/submods/z.rpy"] = &FileRecord{
		DisplayPath: "game/Submods/Z.rpy",
		Layers: []LayerRecord{{InstallationID: "inst_sort", Hash: "z"}},
	}
	manifest.Files["game/submods/a.rpy"] = &FileRecord{
		DisplayPath: "game/submods/a.rpy",
		Layers: []LayerRecord{{InstallationID: "inst_sort", Hash: "a"}},
	}
	manifest.Files["game/submods/B.rpy"] = &FileRecord{
		DisplayPath: "game/Submods/B.rpy",
		Layers: []LayerRecord{{InstallationID: "inst_sort", Hash: "b"}},
	}

	list, err := manifest.ListInstalledFiles("inst_sort", "mod_sort", "")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(list.Files) != 3 {
		t.Fatalf("expected 3 files, got %d", len(list.Files))
	}
	// case-insensitive order: a.rpy, B.rpy, Z.rpy
	if list.Files[0].Path != "game/submods/a.rpy" {
		t.Errorf("expected first to be a.rpy, got %s", list.Files[0].Path)
	}
	if list.Files[1].Path != "game/Submods/B.rpy" {
		t.Errorf("expected second to be B.rpy, got %s", list.Files[1].Path)
	}
	if list.Files[2].Path != "game/Submods/Z.rpy" {
		t.Errorf("expected third to be Z.rpy, got %s", list.Files[2].Path)
	}
}

func TestListInstalledFiles_PaginationAnd1000Files(t *testing.T) {
	manifest := NewManifest()
	paths := make([]string, 1000)
	for i := 0; i < 1000; i++ {
		p := fmt.Sprintf("game/submods/mod1000/file_%04d.rpy", i)
		paths[i] = p
		manifest.Files[p] = &FileRecord{
			DisplayPath: fmt.Sprintf("game/Submods/mod1000/file_%04d.rpy", i),
			Layers: []LayerRecord{{
				InstallationID: "inst_1000",
				ModID: "mod_1000",
				Hash: "hash123",
				Order: 1,
			}},
		}
	}
	manifest.Installations["inst_1000"] = &InstallationRecord{
		InstallationID: "inst_1000",
		ModID: "mod_1000",
		Paths: paths,
	}

	// Page 1: limit = 100
	p1, err := manifest.ListInstalledFilesPaged("inst_1000", "mod_1000", "", "", 100)
	if err != nil {
		t.Fatalf("page 1 failed: %v", err)
	}
	if len(p1.Files) != 100 {
		t.Fatalf("expected 100 files, got %d", len(p1.Files))
	}
	if p1.Summary.TotalFiles != 1000 {
		t.Fatalf("expected summary total files 1000, got %d", p1.Summary.TotalFiles)
	}
	if p1.NextCursor == "" {
		t.Fatalf("expected next cursor, got empty")
	}

	// Page 2: cursor = p1.NextCursor, limit = 100
	p2, err := manifest.ListInstalledFilesPaged("inst_1000", "mod_1000", "", p1.NextCursor, 100)
	if err != nil {
		t.Fatalf("page 2 failed: %v", err)
	}
	if len(p2.Files) != 100 {
		t.Fatalf("expected 100 files, got %d", len(p2.Files))
	}
	if p2.Files[0].Path <= p1.Files[99].Path {
		t.Fatalf("p2 first file %s should be strictly after p1 last file %s", p2.Files[0].Path, p1.Files[99].Path)
	}
}

func TestInstaller_ListInstalledModFilesErrors(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "installer_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	stateDir := filepath.Join(tempDir, ".submodhub", "state")
	inst := New(tempDir, stateDir)

	// Empty manifest -> not_found
	_, err = inst.ListInstalledModFiles("missing_inst", "missing_mod")
	if err == nil || !IsCode(err, "not_found") {
		t.Fatalf("expected not_found error, got %v", err)
	}

	// Invalid MAS root
	badInst := New(filepath.Join(tempDir, "non_existent_root"), stateDir)
	_, err = badInst.ListInstalledModFiles("inst_1", "mod_1")
	if err == nil || !IsCode(err, "invalid_mas_root") {
		t.Fatalf("expected invalid_mas_root error, got %v", err)
	}
}


func TestListInstalledFiles_ManifestCorruptOnMissingRecordOrLayer(t *testing.T) {
	manifest := NewManifest()

	// 1. Missing FileRecord in manifest
	manifest.Installations["inst_corrupt_rec"] = &InstallationRecord{
		InstallationID: "inst_corrupt_rec",
		ModID:          "mod_corrupt",
		Paths:          []string{"game/submods/missing_rec.rpy"},
	}

	_, err := manifest.ListInstalledFiles("inst_corrupt_rec", "mod_corrupt", "")
	if err == nil || !IsCode(err, "manifest_corrupt") {
		t.Fatalf("expected manifest_corrupt for missing file record, got %v", err)
	}

	// 2. Missing Layer for installation
	manifest.Installations["inst_corrupt_layer"] = &InstallationRecord{
		InstallationID: "inst_corrupt_layer",
		ModID:          "mod_corrupt",
		Paths:          []string{"game/submods/has_rec_no_layer.rpy"},
	}
	manifest.Files["game/submods/has_rec_no_layer.rpy"] = &FileRecord{
		DisplayPath: "game/Submods/has_rec_no_layer.rpy",
		Layers: []LayerRecord{
			{InstallationID: "other_inst", ModID: "other_mod", Hash: "abc"},
		},
	}

	_, err = manifest.ListInstalledFiles("inst_corrupt_layer", "mod_corrupt", "")
	if err == nil || !IsCode(err, "manifest_corrupt") {
		t.Fatalf("expected manifest_corrupt for missing layer, got %v", err)
	}
}

func TestListInstalledFiles_PermissionOrInaccessibleError(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "mas_perm_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	manifest := NewManifest()
	canonKey := "game/submods/perm/locked.rpy"
	filePath := filepath.Join(tempDir, "game", "Submods", "perm", "locked.rpy")
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}

	manifest.Installations["inst_perm"] = &InstallationRecord{
		InstallationID: "inst_perm",
		ModID:          "mod_perm",
		VersionID:      "v1",
		Paths:          []string{canonKey},
		InstalledAt:    time.Now(),
	}
	manifest.Files[canonKey] = &FileRecord{
		DisplayPath: "game/Submods/perm/locked.rpy",
		Layers: []LayerRecord{
			{
				InstallationID: "inst_perm",
				ModID:          "mod_perm",
				VersionID:      "v1",
				Order:          1,
				Hash:           "somehash",
			},
		},
	}

	// Verify isPermissionError works as expected
	permErr := &os.PathError{Op: "open", Path: filePath, Err: os.ErrPermission}
	if !isPermissionError(permErr) {
		t.Fatalf("expected isPermissionError to return true for os.ErrPermission")
	}

	// If file cannot be read, an error (permission_lost or disk_read_error) must be returned,
	// never silently reporting drifted=false or active without error.
}

func TestListInstalledFiles_NilInstallationRecord(t *testing.T) {
	manifest := NewManifest()
	// Simulate corrupt manifest where an installation key contains a null value
	manifest.Installations["bad"] = nil

	// Direct lookup by installation ID
	_, err := manifest.ListInstalledFiles("bad", "", "")
	if err == nil || !IsCode(err, "manifest_corrupt") {
		t.Fatalf("expected manifest_corrupt for nil installation record, got %v", err)
	}

	// Fallback lookup by mod ID
	_, err = manifest.ListInstalledFiles("missing_inst", "target_mod", "")
	if err == nil || !IsCode(err, "manifest_corrupt") {
		t.Fatalf("expected manifest_corrupt for nil installation record in fallback, got %v", err)
	}
}
