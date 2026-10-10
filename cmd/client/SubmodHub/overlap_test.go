package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func safeCleanupDir(t *testing.T, dir string) {
	t.Cleanup(func() {
		for i := 0; i < 25; i++ {
			err := os.RemoveAll(dir)
			if err == nil || os.IsNotExist(err) {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	})
}

func TestDesktopServiceOverlapAndRestoreGameOriginal(t *testing.T) {
	root := t.TempDir()
	safeCleanupDir(t, root)
	origDiskPath := filepath.Join(root, "game", "Submods", "overlap", "main.rpy")
	if err := os.MkdirAll(filepath.Dir(origDiskPath), 0o755); err != nil {
		t.Fatal(err)
	}
	origContent := "# game original content\n"
	if err := os.WriteFile(origDiskPath, []byte(origContent), 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	createArchive := func(content string) string {
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		entry, _ := w.Create("game/Submods/overlap/main.rpy")
		_, _ = entry.Write([]byte(content))
		_ = w.Close()
		return base64.StdEncoding.EncodeToString(buf.Bytes())
	}

	// 1. Install Mod A
	resA, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "install_A",
		ModID:         "mod_A",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "Mod A",
		ArchiveBase64: createArchive("# mod A content\n"),
	})
	if err != nil || resA.State != "committed" {
		t.Fatalf("install A failed: res=%+v err=%v", resA, err)
	}
	gotA, _ := os.ReadFile(origDiskPath)
	if string(gotA) != "# mod A content\n" {
		t.Fatalf("expected mod A content, got %s", gotA)
	}

	// 2. Install Mod B
	resB, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "install_B",
		ModID:         "mod_B",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "Mod B",
		ArchiveBase64: createArchive("# mod B content\n"),
	})
	if err != nil || resB.State != "committed" {
		t.Fatalf("install B failed: res=%+v err=%v", resB, err)
	}
	gotB, _ := os.ReadFile(origDiskPath)
	if string(gotB) != "# mod B content\n" {
		t.Fatalf("expected mod B content, got %s", gotB)
	}

	// 3. Restart service
	restarted := NewDesktopService()
	if _, err := restarted.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// 4. Uninstall A first (A is lower layer; B must be preserved on disk!)
	previewUnA, err := restarted.PreviewUninstall("mod_A")
	if err != nil {
		t.Fatalf("preview uninstall A failed: %v", err)
	}
	if len(previewUnA.Blockers) > 0 {
		t.Fatalf("preview un A had blockers: %+v", previewUnA.Blockers)
	}
	execResA, err := restarted.ExecutePlan(ExecutePlanRequest{
		PlanID:    previewUnA.PlanID,
		Confirmed: true,
	})
	if err != nil || execResA.State != "committed" {
		t.Fatalf("execute un A failed: %+v err=%v", execResA, err)
	}

	// Disk MUST still have Mod B content!
	gotAfterUnA, _ := os.ReadFile(origDiskPath)
	if string(gotAfterUnA) != "# mod B content\n" {
		t.Fatalf("disk lost mod B after uninstalling A! got %s", gotAfterUnA)
	}

	// 5. Uninstall B (Now no mods remain; original game content MUST be restored!)
	previewUnB, err := restarted.PreviewUninstall("mod_B")
	if err != nil {
		t.Fatalf("preview uninstall B failed: %v", err)
	}
	execResB, err := restarted.ExecutePlan(ExecutePlanRequest{
		PlanID:    previewUnB.PlanID,
		Confirmed: true,
	})
	if err != nil || execResB.State != "committed" {
		t.Fatalf("execute un B failed: %+v err=%v", execResB, err)
	}

	// Disk MUST have restored original game content!
	gotFinal, _ := os.ReadFile(origDiskPath)
	if string(gotFinal) != origContent {
		t.Fatalf("original game content not restored! got %q, want %q", string(gotFinal), origContent)
	}
}

func TestDesktopServiceSwitchInstanceRejectsOldPlan(t *testing.T) {
	root1 := t.TempDir()
	root2 := t.TempDir()
	safeCleanupDir(t, root1)
	safeCleanupDir(t, root2)
	_ = os.MkdirAll(filepath.Join(root1, "game"), 0o755)
	_ = os.MkdirAll(filepath.Join(root2, "game"), 0o755)

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root1); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	entry, _ := w.Create("game/Submods/test.rpy")
	_, _ = entry.Write([]byte("test"))
	_ = w.Close()

	planResult, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op1",
		ModID:         "mod_1",
		ArchiveBase64: base64.StdEncoding.EncodeToString(buf.Bytes()),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Switch instance to root2
	if _, err := service.SetMASRoot(root2); err != nil {
		t.Fatal(err)
	}

	// Executing old plan against new instance must be rejected
	_, err = service.ExecutePlan(ExecutePlanRequest{
		PlanID:    planResult.PlanID,
		Confirmed: true,
	})
	if err == nil || !strings.Contains(err.Error(), "plan_stale") {
		t.Fatalf("expected plan_stale error, got %v", err)
	}
}

func TestDesktopServiceEndToEndAllSixPermutationsWithGameLibCharacters(t *testing.T) {
	permutations := [][]string{
		{"A", "B", "C"},
		{"A", "C", "B"},
		{"B", "A", "C"},
		{"B", "C", "A"},
		{"C", "A", "B"},
		{"C", "B", "A"},
	}

	for _, perm := range permutations {
		permName := strings.Join(perm, "->")
		t.Run("Permutation_"+permName, func(t *testing.T) {
			root := t.TempDir()
			safeCleanupDir(t, root)

			// Original files across game, lib, characters
			targets := map[string]string{
				"game/Submods/multi/script.rpy":  "# original script v0\n",
				"lib/windows-i686/Lib/addon.py":  "# original library v0\n",
				"characters/scene.sce":           "original scene v0",
			}
			originalHashes := make(map[string]string)

			for relPath, content := range targets {
				full := filepath.Join(root, filepath.FromSlash(relPath))
				if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
					t.Fatal(err)
				}
				h := sha256.Sum256([]byte(content))
				originalHashes[relPath] = hex.EncodeToString(h[:])
			}

			service := NewDesktopService()
			if _, err := service.SetMASRoot(root); err != nil {
				t.Fatal(err)
			}

			// Helper to create archive
			makeArchive := func(tag string) string {
				var buf bytes.Buffer
				w := zip.NewWriter(&buf)
				for relPath := range targets {
					entry, _ := w.Create(filepath.ToSlash(relPath))
					_, _ = entry.Write([]byte("content for " + relPath + " by " + tag))
				}
				_ = w.Close()
				return base64.StdEncoding.EncodeToString(buf.Bytes())
			}

			// Install A, B, C in sequence
			for _, modID := range []string{"A", "B", "C"} {
				archB64 := makeArchive(modID)
				res, err := service.ApplyArchive(ArchiveInstallRequest{
					OperationID:   "install_" + modID,
					ModID:         "mod_" + modID,
					VersionID:     "v_" + modID,
					Version:       "1.0." + modID,
					Title:         "Mod " + modID,
					ArchiveBase64: archB64,
				})
				if err != nil || res.State != "committed" {
					t.Fatalf("Install %s failed: res=%+v err=%v", modID, res, err)
				}
			}

			// Verify after installation: disk has C content
			for relPath := range targets {
				full := filepath.Join(root, filepath.FromSlash(relPath))
				data, err := os.ReadFile(full)
				if err != nil || string(data) != "content for "+relPath+" by C" {
					t.Fatalf("file %s did not have C content, got %q", relPath, string(data))
				}
			}

			// Uninstall in permutation order
			for stepIdx, modID := range perm {
				uninstallRes, err := service.Uninstall("install_"+modID, "un_"+modID)
				if err != nil || uninstallRes != "committed" {
					t.Fatalf("[%s step %d] uninstall %s failed: res=%s err=%v", permName, stepIdx, modID, uninstallRes, err)
				}
			}

			// Verify after all uninstalled: all original files match original SHA-256 hash!
			for relPath, wantHash := range originalHashes {
				full := filepath.Join(root, filepath.FromSlash(relPath))
				data, err := os.ReadFile(full)
				if err != nil {
					t.Fatalf("missing original file %s: %v", relPath, err)
				}
				h := sha256.Sum256(data)
				gotHash := hex.EncodeToString(h[:])
				if gotHash != wantHash {
					t.Fatalf("hash mismatch for %s: got %s, want %s", relPath, gotHash, wantHash)
				}
			}
		})
	}
}

func TestDesktopServiceRepeatedUninstallCycleUniqueOperationID(t *testing.T) {
	root := t.TempDir()
	safeCleanupDir(t, root)
	_ = os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755)

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	createArchive := func(filePath, content string) string {
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		entry, _ := w.Create(filepath.ToSlash(filePath))
		_, _ = entry.Write([]byte(content))
		_ = w.Close()
		return base64.StdEncoding.EncodeToString(buf.Bytes())
	}

	filePath := "game/Submods/cycle/test.rpy"

	// Cycle 1: Install Mod X then Uninstall Mod X
	arch1 := createArchive(filePath, "version 1")
	_, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "op_install_1",
		ModID:         "mod_x",
		Title:         "Mod X",
		ArchiveBase64: arch1,
	})
	if err != nil {
		t.Fatal(err)
	}

	preview1, err := service.PreviewUninstall("mod_x")
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.ExecutePlan(ExecutePlanRequest{PlanID: preview1.PlanID, Confirmed: true})
	if err != nil {
		t.Fatalf("first uninstall failed: %v", err)
	}

	// Cycle 2: Install Mod X AGAIN then Uninstall Mod X AGAIN
	arch2 := createArchive(filePath, "version 2")
	_, err = service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "op_install_2",
		ModID:         "mod_x",
		Title:         "Mod X",
		ArchiveBase64: arch2,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Second uninstall preview must NOT produce conflicting operation ID!
	preview2, err := service.PreviewUninstall("mod_x")
	if err != nil {
		t.Fatal(err)
	}
	if preview2.PlanID == preview1.PlanID {
		t.Fatalf("preview2 produced identical plan ID: %s", preview2.PlanID)
	}

	// Executing second uninstall must succeed and NOT fail with operation_id_conflict!
	_, err = service.ExecutePlan(ExecutePlanRequest{PlanID: preview2.PlanID, Confirmed: true})
	if err != nil {
		t.Fatalf("second uninstall failed with error: %v", err)
	}
}

func TestDesktopServiceReceiptUpdateInTransactionRollback(t *testing.T) {
	root := t.TempDir()
	safeCleanupDir(t, root)
	_ = os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755)

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	createArchive := func(filePath, content string) string {
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		entry, _ := w.Create(filepath.ToSlash(filePath))
		_, _ = entry.Write([]byte(content))
		_ = w.Close()
		return base64.StdEncoding.EncodeToString(buf.Bytes())
	}

	// 1. Initial valid install of Mod 1
	arch1 := createArchive("game/Submods/m1/main.rpy", "# mod 1\n")
	res1, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "op_m1",
		ModID:         "mod_1",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "Mod 1",
		ArchiveBase64: arch1,
	})
	if err != nil || res1.State != "committed" {
		t.Fatalf("Install Mod 1 failed: %v", err)
	}

	receiptsBefore, err := service.ListInstalledArchives()
	if err != nil || len(receiptsBefore) != 1 || receiptsBefore[0].ModID != "mod_1" {
		t.Fatalf("receiptsBefore unexpected: %+v err=%v", receiptsBefore, err)
	}

	// 2. Try installing Mod 2 with fault injection right before commit
	arch2 := createArchive("game/Submods/m2/main.rpy", "# mod 2\n")
	preview2, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_m2",
		ModID:         "mod_2",
		VersionID:     "v2",
		Version:       "2.0.0",
		Title:         "Mod 2",
		ArchiveBase64: arch2,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Inject fault before committed
	service.core.SetFaultHook(func(step string) error {
		if step == "before_committed" {
			return errors.New("simulated crash before commit")
		}
		return nil
	})

	_, err = service.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview2.PlanID,
		Confirmed: true,
	})
	if err == nil {
		t.Fatal("expected ExecutePlan to fail due to fault injection")
	}

	// Clear hook and recover pending transaction
	service.core.SetFaultHook(nil)
	if err := service.core.RecoverPending(); err != nil {
		t.Fatalf("RecoverPending failed: %v", err)
	}

	// 3. Receipt must remain exactly as before: Mod 1 only, no Mod 2!
	receiptsAfter, err := service.ListInstalledArchives()
	if err != nil || len(receiptsAfter) != 1 || receiptsAfter[0].ModID != "mod_1" {
		t.Fatalf("receiptsAfter was corrupted by failed transaction: %+v", receiptsAfter)
	}

	// Mod 2 file on disk must NOT exist
	m2File := filepath.Join(root, "game", "Submods", "m2", "main.rpy")
	if _, err := os.Stat(m2File); !os.IsNotExist(err) {
		t.Fatalf("mod 2 file still exists on disk: %v", err)
	}
}

func TestDesktopServiceReceiptFailureDoesNotLeakLock(t *testing.T) {
	root := t.TempDir()
	safeCleanupDir(t, root)
	_ = os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755)

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	createArchive := func(filePath, content string) string {
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		entry, _ := w.Create(filepath.ToSlash(filePath))
		_, _ = entry.Write([]byte(content))
		_ = w.Close()
		return base64.StdEncoding.EncodeToString(buf.Bytes())
	}

	arch := createArchive("game/Submods/m1/main.rpy", "# mod 1\n")
	preview, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_m1",
		ModID:         "mod_1",
		Title:         "Mod 1",
		ArchiveBase64: arch,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Corrupt installed-archives.json
	receiptPath := service.installedArchivesPath()
	_ = os.MkdirAll(filepath.Dir(receiptPath), 0o755)
	_ = os.WriteFile(receiptPath, []byte("invalid json content"), 0o644)

	// ExecutePlan will fail in projectedInstalledArchives
	_, err = service.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview.PlanID,
		Confirmed: true,
	})
	if err == nil {
		t.Fatal("expected ExecutePlan to fail due to corrupt receipts")
	}

	// Lock MUST be released! Fixing receipt file allows next operation without instance_busy
	_ = os.WriteFile(receiptPath, []byte("[]"), 0o644)

	// Preview and execute again: must NOT fail with instance_busy!
	preview2, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_m1_retry",
		ModID:         "mod_1",
		Title:         "Mod 1",
		ArchiveBase64: arch,
	})
	if err != nil {
		t.Fatalf("expected preview2 to succeed without instance_busy, got: %v", err)
	}

	res, err := service.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview2.PlanID,
		Confirmed: true,
	})
	if err != nil || res.State != "committed" {
		t.Fatalf("expected execute to succeed after fixing receipt, got res=%+v err=%v", res, err)
	}
}

func TestDesktopServiceNoSubsequentTransactionOverDirtyState(t *testing.T) {
	root := t.TempDir()
	safeCleanupDir(t, root)
	_ = os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755)

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	createArchive := func(filePath, content string) string {
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		entry, _ := w.Create(filepath.ToSlash(filePath))
		_, _ = entry.Write([]byte(content))
		_ = w.Close()
		return base64.StdEncoding.EncodeToString(buf.Bytes())
	}

	// 1. Valid install of Mod 1
	arch1 := createArchive("game/Submods/m1/main.rpy", "# mod 1\n")
	res1, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "op_m1",
		ModID:         "mod_1",
		Title:         "Mod 1",
		ArchiveBase64: arch1,
	})
	if err != nil || res1.State != "committed" {
		t.Fatalf("install Mod 1 failed: %v", err)
	}

	// 2. Mod 2 fails during execution after manifest save
	arch2 := createArchive("game/Submods/m2/main.rpy", "# mod 2\n")
	service.core.SetFaultHook(func(step string) error {
		if step == "after_manifest" {
			return errors.New("crash after manifest")
		}
		return nil
	})

	preview2, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_m2",
		ModID:         "mod_2",
		Title:         "Mod 2",
		ArchiveBase64: arch2,
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = service.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview2.PlanID,
		Confirmed: true,
	})
	if err == nil {
		t.Fatal("expected ExecutePlan to fail")
	}

	// Clear fault hook
	service.core.SetFaultHook(nil)

	// Manifest must NOT contain mod_2, and mod_2 files must NOT exist on disk!
	m, err := service.core.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := m.Installations["mod_2"]; exists {
		t.Fatal("manifest was not rolled back inside lock, mod_2 remains in manifest")
	}
	if _, err := os.Stat(filepath.Join(root, "game", "Submods", "m2", "main.rpy")); !os.IsNotExist(err) {
		t.Fatal("mod_2 file was not rolled back inside lock")
	}

	// 3. Immediately install Mod 3 without restarting: must succeed cleanly!
	arch3 := createArchive("game/Submods/m3/main.rpy", "# mod 3\n")
	res3, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "op_m3",
		ModID:         "mod_3",
		Title:         "Mod 3",
		ArchiveBase64: arch3,
	})
	if err != nil || res3.State != "committed" {
		t.Fatalf("install Mod 3 failed after aborted Mod 2: %v", err)
	}
}

func TestPreviewTitleResolutionAndDiskAvailable(t *testing.T) {
	root := t.TempDir()
	safeCleanupDir(t, root)
	origDiskPath := filepath.Join(root, "game", "Submods", "overlap", "main.rpy")
	if err := os.MkdirAll(filepath.Dir(origDiskPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(origDiskPath, []byte("# original\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	status, err := service.SetMASRoot(root)
	if err != nil {
		t.Fatal(err)
	}

	// 1. Check AvailableBytes
	if status.AvailableBytes <= 0 {
		t.Fatalf("expected positive available bytes, got %d", status.AvailableBytes)
	}

	createArchive := func(content string) string {
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		entry, _ := w.Create("game/Submods/overlap/main.rpy")
		_, _ = entry.Write([]byte(content))
		_ = w.Close()
		return base64.StdEncoding.EncodeToString(buf.Bytes())
	}

	// 2. Install Mod MAICA Blessland
	resMAICA, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "op_maica",
		ModID:         "maica_blessland",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "MAICA Blessland",
		ArchiveBase64: createArchive("# maica content\n"),
	})
	if err != nil || resMAICA.State != "committed" {
		t.Fatalf("install MAICA failed: %+v err: %v", resMAICA, err)
	}

	// 3. Preview Install of Mod 2 (MAS Ignore TL Conflicts Submod) that overwrites main.rpy
	preview2, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_ignore_tl",
		ModID:         "mas_ignore_tl_conflicts",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "MAS Ignore TL Conflicts Submod",
		ArchiveBase64: createArchive("# ignore tl content\n"),
	})
	if err != nil {
		t.Fatalf("preview mod 2 failed: %v", err)
	}

	if len(preview2.Actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(preview2.Actions))
	}
	act := preview2.Actions[0]
	if act.CurrentSource != "MAICA Blessland" {
		t.Fatalf("expected CurrentSource 'MAICA Blessland', got '%s'", act.CurrentSource)
	}
	if act.TargetSource != "MAS Ignore TL Conflicts Submod" {
		t.Fatalf("expected TargetSource 'MAS Ignore TL Conflicts Submod', got '%s'", act.TargetSource)
	}

	// 4. Apply Mod 2
	resMod2, err := service.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview2.PlanID,
		Confirmed: true,
	})
	if err != nil || resMod2.State != "committed" {
		t.Fatalf("execute plan mod 2 failed: %+v err: %v", resMod2, err)
	}

	// Disk must have Mod 2 content
	got2, _ := os.ReadFile(origDiskPath)
	if string(got2) != "# ignore tl content\n" {
		t.Fatalf("expected mod 2 content, got %s", got2)
	}

	// 5. Preview Uninstall Mod 2 -> must restore MAICA Blessland
	unPreview, err := service.PreviewUninstall("mas_ignore_tl_conflicts")
	if err != nil {
		t.Fatalf("preview uninstall mod 2 failed: %v", err)
	}
	if len(unPreview.Actions) != 1 {
		t.Fatalf("expected 1 action in uninstall preview, got %d", len(unPreview.Actions))
	}
	unAct := unPreview.Actions[0]
	if unAct.CurrentSource != "MAS Ignore TL Conflicts Submod" {
		t.Fatalf("expected CurrentSource 'MAS Ignore TL Conflicts Submod', got '%s'", unAct.CurrentSource)
	}
	if unAct.TargetSource != "MAICA Blessland" {
		t.Fatalf("expected TargetSource 'MAICA Blessland', got '%s'", unAct.TargetSource)
	}

	// 6. Execute Uninstall of Mod 2
	unRes, err := service.ExecutePlan(ExecutePlanRequest{
		PlanID:    unPreview.PlanID,
		Confirmed: true,
	})
	if err != nil || unRes.State != "committed" {
		t.Fatalf("uninstall mod 2 failed: %+v err: %v", unRes, err)
	}

	// Disk must now be restored to MAICA Blessland content
	gotRestored, _ := os.ReadFile(origDiskPath)
	if string(gotRestored) != "# maica content\n" {
		t.Fatalf("expected restored maica content, got %s", gotRestored)
	}

	// 7. Verify external change detection blocks modification if drifted
	if err := os.WriteFile(origDiskPath, []byte("# external user edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	driftPreview, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_drift_test",
		ModID:         "third_mod",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "Third Mod",
		ArchiveBase64: createArchive("# third mod content\n"),
	})
	if err != nil {
		t.Fatalf("preview on drift failed: %v", err)
	}
	if len(driftPreview.Blockers) == 0 {
		t.Fatalf("expected external_change blocker, got none")
	}
	foundExternalChange := false
	for _, b := range driftPreview.Blockers {
		if strings.Contains(b, "external_change") {
			foundExternalChange = true
			break
		}
	}
	if !foundExternalChange {
		t.Fatalf("expected external_change blocker, got: %v", driftPreview.Blockers)
	}
}
