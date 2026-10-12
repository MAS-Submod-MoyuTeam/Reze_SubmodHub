package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopServiceInstallsMultiRootSpritepack(t *testing.T) {
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	files := map[string]string{
		"Set A/mod_assets/monika/j/necklace.json":      `{"type":0,"name":"necklace","img_sit":"necklace"}`,
		"Set A/mod_assets/monika/a/acs-necklace-0.png": "necklace image",
		"Set A/gifts/necklace.gift":                    "gift",
		"Set B/mod_assets/monika/j/ribbon.json":        `{"type":0,"name":"ribbon","img_sit":"ribbon"}`,
		"Set B/mod_assets/monika/a/acs-ribbon-0.png":   "ribbon image",
		"Set B/gifts/ribbon.gift":                      "gift",
	}
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	for _, category := range []string{"spritepack", "submod", ""} {
		t.Run(category, func(t *testing.T) {
			root := t.TempDir()
			if err := os.MkdirAll(filepath.Join(root, "game"), 0755); err != nil {
				t.Fatal(err)
			}
			service := NewDesktopService()
			if _, err := service.SetMASRoot(root); err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(archive.Bytes())
			payload, err := json.Marshal(map[string]any{"operation_id": "sprite-install", "archive_base64": base64.StdEncoding.EncodeToString(archive.Bytes()), "expected_sha256": hex.EncodeToString(hash[:]), "mod_id": "sprite-mod", "category": category})
			if err != nil {
				t.Fatal(err)
			}
			var request ArchiveInstallRequest
			if err := json.Unmarshal(payload, &request); err != nil {
				t.Fatal(err)
			}
			result, err := service.ApplyArchive(request)
			if category != "spritepack" {
				if err == nil || !strings.Contains(err.Error(), "ambiguous package roots") {
					t.Fatalf("result=%+v err=%v", result, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if result.State != "committed" || result.Files != len(files) {
				t.Fatalf("result=%+v", result)
			}
			for name, want := range files {
				rel := strings.SplitN(name, "/", 2)[1]
				target := "game/" + rel
				if strings.HasPrefix(rel, "gifts/") {
					target = "characters/" + strings.TrimPrefix(rel, "gifts/")
				}
				got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(target)))
				if err != nil || string(got) != want {
					t.Fatalf("%s: got=%q err=%v", target, got, err)
				}
			}
			receipts, err := service.ListInstalledArchives()
			if err != nil || len(receipts) != 1 || receipts[0].SHA256 != request.ExpectedSHA || receipts[0].SizeBytes != int64(archive.Len()) || receipts[0].Files != len(files) {
				t.Fatalf("receipts=%+v err=%v", receipts, err)
			}
			if _, err := service.Uninstall(request.OperationID, "sprite-uninstall"); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(root, "characters", "necklace.gift")); !os.IsNotExist(err) {
				t.Fatalf("gift remains: %v", err)
			}
		})
	}
}

func TestDesktopServiceBindsMASRootAndWritesThroughCore(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	status, err := service.SetMASRoot(root)
	if err != nil || !status.Valid || !status.GameExists {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	if state, err := service.ApplyFile(InstallRequest{OperationID: "binding-test", Path: "game/Submods/binding.txt", Content: "binding"}); err != nil || state != "committed" {
		t.Fatalf("state=%s err=%v", state, err)
	}
	got, err := os.ReadFile(filepath.Join(root, "game", "Submods", "binding.txt"))
	if err != nil || string(got) != "binding" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}

func TestDesktopServiceInstallsVerifiedArchive(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	entry, err := writer.Create("game/Submods/WailsFixture/main.rpy")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("# Wails fixture\n"))
	for name, content := range map[string]string{
		"lib/windows-i686/Lib/Cookie.py": "# library\n",
		"characters/HeavenForest.sce":    "scene",
	} {
		entry, err = writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(archive.Bytes())
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	result, err := service.ApplyArchive(ArchiveInstallRequest{OperationID: "archive-test", ArchiveBase64: base64.StdEncoding.EncodeToString(archive.Bytes()), ExpectedSHA: hex.EncodeToString(hash[:])})
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "committed" || result.Files != 3 {
		t.Fatalf("result=%+v", result)
	}
	got, err := os.ReadFile(filepath.Join(root, "game", "Submods", "WailsFixture", "main.rpy"))
	if err != nil || string(got) != "# Wails fixture\n" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	for name, want := range map[string]string{
		"lib/windows-i686/Lib/Cookie.py": "# library\n",
		"characters/HeavenForest.sce":    "scene",
	} {
		got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil || string(got) != want {
			t.Fatalf("%s: got=%q err=%v", name, got, err)
		}
	}
}

func TestInstalledArchiveReceiptSurvivesServiceRestart(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0755); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	entry, err := writer.Create("game/Submods/MAICA_ChatSubmod/main.rpy")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("# MAICA"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	_, err = service.ApplyArchive(ArchiveInstallRequest{OperationID: "install-maica", ArchiveBase64: base64.StdEncoding.EncodeToString(archive.Bytes()), ModID: "mod_maica", VersionID: "ver_1", Version: "1.9.4", Title: "MAICA Blessland"})
	if err != nil {
		t.Fatal(err)
	}
	restarted := NewDesktopService()
	if _, err := restarted.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	receipts, err := restarted.ListInstalledArchives()
	if err != nil || len(receipts) != 1 || receipts[0].ModID != "mod_maica" || receipts[0].Version != "1.9.4" || len(receipts[0].SubmodDirs) != 1 || receipts[0].SubmodDirs[0] != "MAICA_ChatSubmod" {
		t.Fatalf("receipts=%+v err=%v", receipts, err)
	}
	if _, err := restarted.Uninstall("install-maica", "uninstall-maica"); err != nil {
		t.Fatal(err)
	}
	receipts, err = restarted.ListInstalledArchives()
	if err != nil || len(receipts) != 0 {
		t.Fatalf("after uninstall=%+v err=%v", receipts, err)
	}
}

func TestDesktopServiceScansLocalSubmods(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "game", "Submods", "LocalMod")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.rpy"), []byte(`init python:\n    mod = Submod(author="RealAuthor", name="Local Mod", version="2.0")`), 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	result, err := service.ScanLocalSubmods()
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 1 || result[0].Directory != "LocalMod" || result[0].Name != "Local Mod" || result[0].Author != "RealAuthor" || result[0].Version != "2.0" || len(result[0].Files) != 1 || result[0].Files[0].SHA256 == "" {
		t.Fatalf("result=%+v", result)
	}
}

func TestDesktopServiceOperationsAndRollback(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// 1. Successful install
	req := InstallRequest{
		OperationID: "op_task_1",
		Path:        "game/file1.txt",
		Content:     "content 1",
	}
	_, err := service.ApplyFile(req)
	if err != nil {
		t.Fatal(err)
	}

	ops, err := service.ListOperations()
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 1 {
		t.Fatalf("expected 1 operation, got %d", len(ops))
	}
	if ops[0].OperationID != "op_task_1" || ops[0].State != "committed" {
		t.Fatalf("op 1 state mismatch: %+v", ops[0])
	}

	opDetail, err := service.GetOperation("op_task_1")
	if err != nil {
		t.Fatal(err)
	}
	if opDetail.OperationID != "op_task_1" || opDetail.State != "committed" || opDetail.CanRollback {
		t.Fatalf("opDetail mismatch: %+v", opDetail)
	}

	// 2. Rolling back a committed operation via RollbackOperation must fail
	err = service.RollbackOperation("op_task_1")
	if err == nil {
		t.Fatal("expected rolling back committed op to fail")
	}

	// 3. Inject an uncommitted operation that requires rollback
	service.core.SetCrashWithoutRollback(true)
	service.core.SetFaultHook(func(step string) error {
		if step == "after_prepared" {
			return os.ErrPermission
		}
		return nil
	})

	_, _ = service.ApplyFile(InstallRequest{
		OperationID: "op_task_2",
		Path:        "game/file2.txt",
		Content:     "content 2",
	})

	// Get operation for op_task_2: should be recoverable
	op2, err := service.GetOperation("op_task_2")
	if err != nil {
		t.Fatal(err)
	}
	if op2.State != "recoverable" || !op2.CanRollback {
		t.Fatalf("expected recoverable with CanRollback=true, got %+v", op2)
	}

	// Call RollbackOperation
	service.core.SetFaultHook(nil)
	service.core.SetCrashWithoutRollback(false)
	if err := service.RollbackOperation("op_task_2"); err != nil {
		t.Fatalf("RollbackOperation failed: %v", err)
	}

	op2After, err := service.GetOperation("op_task_2")
	if err != nil {
		t.Fatal(err)
	}
	if op2After.State != "rolled_back" || op2After.CanRollback {
		t.Fatalf("expected rolled_back with CanRollback=false, got %+v", op2After)
	}

	// 4. Test Recover alias on op_task_2: idempotent
	if err := service.Recover("op_task_2"); err != nil {
		t.Fatalf("Recover alias failed on rolled_back: %v", err)
	}

	// 5. Restart service and query operations
	restarted := NewDesktopService()
	if _, err := restarted.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	restartedOps, err := restarted.ListOperations()
	if err != nil {
		t.Fatal(err)
	}
	if len(restartedOps) < 2 {
		t.Fatalf("expected at least 2 operations after restart, got %d", len(restartedOps))
	}
}

func TestDesktopServiceExternalDriftPersistsHashesAndSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}

	initialContent := []byte("original clean content")
	initialHash := sha256.Sum256(initialContent)
	expectedHashHex := hex.EncodeToString(initialHash[:])

	modFile := filepath.Join(root, "game", "drift.rpy")
	if err := os.WriteFile(modFile, initialContent, 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// 1. Start an operation that will leave behind a prepared transaction
	service.core.SetCrashWithoutRollback(true)
	service.core.SetFaultHook(func(step string) error {
		if step == "after_prepared" {
			return errors.New("simulated power cut after prepared")
		}
		return nil
	})

	_, _ = service.ApplyFile(InstallRequest{
		OperationID: "op_drift_1",
		Path:        "game/drift.rpy",
		Content:     "new version of drift.rpy",
	})

	// 2. Introduce external drift on disk while transaction is pending
	driftedContent := []byte("player edited this file directly in notepad")
	driftedHash := sha256.Sum256(driftedContent)
	actualHashHex := hex.EncodeToString(driftedHash[:])
	if err := os.WriteFile(modFile, driftedContent, 0o644); err != nil {
		t.Fatal(err)
	}

	// 3. Attempt rollback: should fail due to external change and transition to needs_manual_recovery
	service.core.SetFaultHook(nil)
	service.core.SetCrashWithoutRollback(false)

	rbErr := service.RollbackOperation("op_drift_1")
	if rbErr == nil || !strings.Contains(rbErr.Error(), "external_change") {
		t.Fatalf("expected external_change error on rollback, got: %v", rbErr)
	}

	// 4. Restart desktop service and reload from disk
	restarted := NewDesktopService()
	if _, err := restarted.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// 5. Query operation details after restart
	detail, err := restarted.GetOperation("op_drift_1")
	if err != nil {
		t.Fatalf("failed to get operation details after restart: %v", err)
	}

	if detail.State != "needs_manual_recovery" {
		t.Fatalf("expected state needs_manual_recovery, got: %s", detail.State)
	}
	if detail.ConflictPath != "game/drift.rpy" {
		t.Fatalf("expected ConflictPath game/drift.rpy, got: %s", detail.ConflictPath)
	}
	if detail.ExpectedHash != expectedHashHex {
		t.Fatalf("expected hash mismatch after restart: got %q, want %q", detail.ExpectedHash, expectedHashHex)
	}
	if detail.ActualHash != actualHashHex {
		t.Fatalf("actual hash mismatch after restart: got %q, want %q", detail.ActualHash, actualHashHex)
	}

	// 6. Check ListOperations as well
	ops, err := restarted.ListOperations()
	if err != nil {
		t.Fatal(err)
	}
	var found *OperationDetail
	for i := range ops {
		if ops[i].OperationID == "op_drift_1" {
			found = &ops[i]
			break
		}
	}
	if found == nil {
		t.Fatal("op_drift_1 not found in ListOperations")
	}
	if found.ExpectedHash != expectedHashHex || found.ActualHash != actualHashHex {
		t.Fatalf("ListOperations hash mismatch: expected=%q actual=%q (want exp=%q act=%q)",
			found.ExpectedHash, found.ActualHash, expectedHashHex, actualHashHex)
	}
}

func TestUpdateModUpdatesInstalledArchivesReceipt(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// Build v1 archive
	var archiveV1 bytes.Buffer
	w1 := zip.NewWriter(&archiveV1)
	f1, _ := w1.Create("game/Submods/TestMod/test.rpy")
	_, _ = f1.Write([]byte("# v1 submod"))
	_ = w1.Close()

	res1, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "install-v1",
		ArchiveBase64: base64.StdEncoding.EncodeToString(archiveV1.Bytes()),
		ModID:         "my_mod",
		VersionID:     "ver_1",
		Version:       "1.0.0",
		Title:         "My Submod",
	})
	if err != nil {
		t.Fatalf("install v1 failed: %v", err)
	}
	if res1.State != "committed" {
		t.Fatalf("expected state committed, got %s", res1.State)
	}

	// Verify v1 receipt
	receipts, err := service.ListInstalledArchives()
	if err != nil {
		t.Fatalf("ListInstalledArchives failed: %v", err)
	}
	if len(receipts) != 1 {
		t.Fatalf("expected 1 receipt, got %d", len(receipts))
	}
	if receipts[0].Version != "1.0.0" || receipts[0].OperationID != "install-v1" {
		t.Fatalf("unexpected v1 receipt: %+v", receipts[0])
	}

	// Build v2 archive
	var archiveV2 bytes.Buffer
	w2 := zip.NewWriter(&archiveV2)
	f2, _ := w2.Create("game/Submods/TestMod/test.rpy")
	_, _ = f2.Write([]byte("# v2 updated submod"))
	_ = w2.Close()

	// Apply v2 update
	res2, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "update-v2",
		ArchiveBase64: base64.StdEncoding.EncodeToString(archiveV2.Bytes()),
		ModID:         "my_mod",
		VersionID:     "ver_2",
		Version:       "2.0.0",
		Title:         "My Submod",
	})
	if err != nil {
		t.Fatalf("update v2 failed: %v", err)
	}
	if res2.State != "committed" {
		t.Fatalf("expected state committed, got %s", res2.State)
	}

	// Verify v2 receipt has replaced v1
	receiptsV2, err := service.ListInstalledArchives()
	if err != nil {
		t.Fatalf("ListInstalledArchives failed: %v", err)
	}
	if len(receiptsV2) != 1 {
		t.Fatalf("expected 1 receipt after update, got %d", len(receiptsV2))
	}
	if receiptsV2[0].Version != "2.0.0" {
		t.Fatalf("expected updated version 2.0.0, got: %s", receiptsV2[0].Version)
	}
	if receiptsV2[0].OperationID != "update-v2" {
		t.Fatalf("expected updated OperationID update-v2, got: %s", receiptsV2[0].OperationID)
	}
	if receiptsV2[0].VersionID != "ver_2" {
		t.Fatalf("expected updated VersionID ver_2, got: %s", receiptsV2[0].VersionID)
	}

	// Verify file on disk has v2 content
	diskContent, err := os.ReadFile(filepath.Join(root, "game", "Submods", "TestMod", "test.rpy"))
	if err != nil {
		t.Fatal(err)
	}
	if string(diskContent) != "# v2 updated submod" {
		t.Fatalf("disk content was not updated to v2: %q", string(diskContent))
	}
}

func TestSetMASRootAllowsDisplayableRecoveryErrorsAndBlocksWrites(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	modFile := filepath.Join(root, "game", "drift.rpy")
	origContent := "version 1 of drift.rpy"
	if err := os.WriteFile(modFile, []byte(origContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// 1. Simulate an interrupted transaction
	service.core.SetCrashWithoutRollback(true)
	service.core.SetFaultHook(func(step string) error {
		if step == "after_prepared" {
			return errors.New("simulated power cut after prepared")
		}
		return nil
	})

	_, _ = service.ApplyFile(InstallRequest{
		OperationID: "op_drift_initial",
		Path:        "game/drift.rpy",
		Content:     "new version of drift.rpy",
	})

	// 2. Introduce external drift on disk while transaction is pending
	driftedContent := []byte("externally modified content")
	if err := os.WriteFile(modFile, driftedContent, 0o644); err != nil {
		t.Fatal(err)
	}

	// 3. Restart desktop service (simulating fresh start / instance selection)
	// Notice we do NOT call RollbackOperation beforehand! This is the FIRST detection of drift!
	restarted := NewDesktopService()
	status, err := restarted.SetMASRoot(root)
	if err != nil {
		t.Fatalf("expected SetMASRoot to succeed even with external drift, got: %v", err)
	}
	if !status.Valid {
		t.Fatal("expected status to be valid")
	}

	// 4. Verify operation is loaded and available for inspection in Task Center
	detail, err := restarted.GetOperation("op_drift_initial")
	if err != nil {
		t.Fatalf("failed to get operation details: %v", err)
	}
	if detail.State != "needs_manual_recovery" {
		t.Fatalf("expected state needs_manual_recovery, got: %s", detail.State)
	}

	// 5. Verify write operations are BLOCKED while transaction is in manual recovery
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	f, _ := writer.Create("game/Submods/NewMod/file.rpy")
	_, _ = f.Write([]byte("new mod"))
	_ = writer.Close()

	_, previewErr := restarted.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_blocked_write",
		ArchiveBase64: base64.StdEncoding.EncodeToString(archive.Bytes()),
		ModID:         "blocked_mod",
	})
	if previewErr == nil {
		t.Fatal("expected PreviewArchive to be blocked due to pending manual recovery")
	}

	// 6. Restore original file and roll back the interrupted operation
	_ = os.WriteFile(modFile, []byte(origContent), 0o644)
	if err := restarted.RollbackOperation("op_drift_initial"); err != nil {
		t.Fatalf("RollbackOperation failed: %v", err)
	}

	// 7. Verify writes are now allowed after rollback
	previewRes, err := restarted.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_allowed_write",
		ArchiveBase64: base64.StdEncoding.EncodeToString(archive.Bytes()),
		ModID:         "blocked_mod",
	})
	if err != nil {
		t.Fatalf("expected PreviewArchive to succeed after rollback, got: %v", err)
	}
	if len(previewRes.Blockers) > 0 {
		t.Fatalf("unexpected blockers: %v", previewRes.Blockers)
	}
}

func TestOperationDetailInstanceIDAndManualRecoveryRollback(t *testing.T) {
	tempDir := t.TempDir()
	root := filepath.Join(tempDir, "mas")
	_ = os.MkdirAll(filepath.Join(root, "game"), 0o755)

	service := NewDesktopService()
	service.activeID = "mas_inst_alpha"
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// 1. Create archive and install it
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	f, _ := writer.Create("game/Submods/TestMod/header.rpy")
	_, _ = f.Write([]byte("version 1"))
	_ = writer.Close()

	preview, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_install_1",
		ArchiveBase64: base64.StdEncoding.EncodeToString(archive.Bytes()),
		ModID:         "mod_awesome",
		Title:         "Awesome Mod",
		Version:       "1.0.0",
	})
	if err != nil {
		t.Fatalf("PreviewArchive failed: %v", err)
	}
	if _, err := service.ExecutePlan(ExecutePlanRequest{PlanID: preview.PlanID, Confirmed: true}); err != nil {
		t.Fatalf("ExecutePlan failed: %v", err)
	}

	// 2. Verify operation record has MAS instance ID as InstallationID, and mod ID as TargetInstallationID
	detail, err := service.GetOperation("op_install_1")
	if err != nil {
		t.Fatalf("GetOperation failed: %v", err)
	}
	if detail.InstallationID != "mas_inst_alpha" {
		t.Fatalf("expected InstallationID to be MAS instance ID 'mas_inst_alpha', got: %q", detail.InstallationID)
	}
	if detail.TargetInstallationID != "mod_awesome" {
		t.Fatalf("expected TargetInstallationID to be mod installation ID 'mod_awesome', got: %q", detail.TargetInstallationID)
	}

	// 3. Inject manual recovery scenario with external drift
	modFilePath := filepath.Join(root, "game", "Submods", "TestMod", "header.rpy")
	service.core.SetCrashWithoutRollback(true)
	service.core.SetFaultHook(func(step string) error {
		if step == "after_prepared" {
			return os.ErrPermission
		}
		return nil
	})

	var updateArchive bytes.Buffer
	uWriter := zip.NewWriter(&updateArchive)
	uf, _ := uWriter.Create("game/Submods/TestMod/header.rpy")
	_, _ = uf.Write([]byte("version 2"))
	_ = uWriter.Close()

	uPreview, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_update_manual",
		ArchiveBase64: base64.StdEncoding.EncodeToString(updateArchive.Bytes()),
		ModID:         "mod_awesome",
		Title:         "Awesome Mod",
		Version:       "2.0.0",
	})
	if err != nil {
		t.Fatalf("update PreviewArchive failed: %v", err)
	}
	_, _ = service.ExecutePlan(ExecutePlanRequest{PlanID: uPreview.PlanID, Confirmed: true})

	service.core.SetFaultHook(nil)
	service.core.SetCrashWithoutRollback(false)

	// Induce external drift on disk
	_ = os.WriteFile(modFilePath, []byte("external tampering"), 0o644)

	// Attempt rollback: should fail preflight and enter needs_manual_recovery
	rbErr := service.RollbackOperation("op_update_manual")
	if rbErr == nil {
		t.Fatal("expected rollback to fail due to external tampering")
	}

	manualDetail, err := service.GetOperation("op_update_manual")
	if err != nil {
		t.Fatalf("GetOperation failed: %v", err)
	}
	if manualDetail.State != "needs_manual_recovery" {
		t.Fatalf("expected state needs_manual_recovery, got: %s", manualDetail.State)
	}
	// Intact recovery materials must allow CanRollback = true
	if !manualDetail.CanRollback {
		t.Fatal("expected CanRollback to be true for needs_manual_recovery with intact recovery material")
	}

	// 4. User manually resolves conflict by restoring original content
	_ = os.WriteFile(modFilePath, []byte("version 1"), 0o644)

	// Now retry rollback via RollbackOperation: should succeed!
	if err := service.RollbackOperation("op_update_manual"); err != nil {
		t.Fatalf("RollbackOperation failed after manual resolution: %v", err)
	}

	afterDetail, err := service.GetOperation("op_update_manual")
	if err != nil {
		t.Fatalf("GetOperation failed: %v", err)
	}
	if afterDetail.State != "rolled_back" {
		t.Fatalf("expected state rolled_back, got: %s", afterDetail.State)
	}
	if afterDetail.CanRollback {
		t.Fatal("expected CanRollback to be false after rolled_back")
	}
}
