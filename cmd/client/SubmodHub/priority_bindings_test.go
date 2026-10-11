package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func createPriorityTestZip(path, content string) string {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	entry, _ := w.Create(path)
	_, _ = entry.Write([]byte(content))
	_ = w.Close()
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestDesktopServicePriorityEndToEnd(t *testing.T) {
	root := t.TempDir()
	safeCleanupDir(t, root)
	_ = os.MkdirAll(filepath.Join(root, "game"), 0755)

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	sharedFile := "game/Submods/conflict/data.rpy"
	diskPath := filepath.Join(root, filepath.FromSlash(sharedFile))

	// 1. Install Mod A (prio 10)
	resA, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "op_inst_a",
		ModID:         "mod_a",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "Mod A",
		Priority:      10,
		ArchiveBase64: createPriorityTestZip(sharedFile, "# Content from Mod A\n"),
	})
	if err != nil || resA.State != "committed" {
		t.Fatalf("install A failed: %+v %v", resA, err)
	}

	// 2. Install Mod B (prio 20)
	resB, err := service.ApplyArchive(ArchiveInstallRequest{
		OperationID:   "op_inst_b",
		ModID:         "mod_b",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "Mod B",
		Priority:      20,
		ArchiveBase64: createPriorityTestZip(sharedFile, "# Content from Mod B\n"),
	})
	if err != nil || resB.State != "committed" {
		t.Fatalf("install B failed: %+v %v", resB, err)
	}

	// Verify disk has Mod B
	got, _ := os.ReadFile(diskPath)
	if string(got) != "# Content from Mod B\n" {
		t.Fatalf("expected mod B content, got %s", got)
	}

	// 3. GetPriorityOverview
	overview, err := service.GetPriorityOverview()
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.Mods) != 2 {
		t.Fatalf("expected 2 mods, got %d", len(overview.Mods))
	}
	if overview.Mods[0].ModID != "mod_b" || overview.Mods[0].Priority != 20 {
		t.Fatalf("expected mod_b priority 20 at top, got %+v", overview.Mods[0])
	}
	if len(overview.Paths) != 1 || overview.Paths[0].ActiveOwner != "mod_b" {
		t.Fatalf("expected 1 shared path owned by mod_b, got %+v", overview.Paths)
	}

	// 4. Preview Priority: elevate mod_a to 30
	preview, err := service.PreviewPriority(map[string]int{"mod_a": 30})
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Blockers) > 0 {
		t.Fatalf("unexpected blockers: %v", preview.Blockers)
	}
	if len(preview.Actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(preview.Actions))
	}
	if preview.Actions[0].TargetSource != "Mod A" {
		t.Fatalf("expected target source Mod A, got %s", preview.Actions[0].TargetSource)
	}
	if preview.Actions[0].CurrentSource != "Mod B" {
		t.Fatalf("expected current source Mod B, got %s", preview.Actions[0].CurrentSource)
	}

	// Disk must still be Mod B before execute
	gotBefore, _ := os.ReadFile(diskPath)
	if string(gotBefore) != "# Content from Mod B\n" {
		t.Fatalf("preview modified disk before execute: %s", gotBefore)
	}

	// 5. Execute Plan
	execRes, err := service.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview.PlanID,
		Confirmed: true,
	})
	if err != nil || execRes.State != "committed" {
		t.Fatalf("execute priority plan failed: %+v %v", execRes, err)
	}

	// Disk must now be Mod A
	gotAfter, _ := os.ReadFile(diskPath)
	if string(gotAfter) != "# Content from Mod A\n" {
		t.Fatalf("expected mod A content after apply, got %s", gotAfter)
	}

	// 6. Restart DesktopService: verify persistence across restart
	restarted := NewDesktopService()
	if _, err := restarted.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	receipts, err := restarted.ListInstalledArchives()
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range receipts {
		if r.ModID == "mod_a" && r.Priority != 30 {
			t.Fatalf("expected mod_a priority 30 after restart, got %d", r.Priority)
		}
	}
	gotRestart, _ := os.ReadFile(diskPath)
	if string(gotRestart) != "# Content from Mod A\n" {
		t.Fatalf("expected mod A content after restart, got %s", gotRestart)
	}
}

func TestPreviewArchiveRecommendedPriorityPropagation(t *testing.T) {
	root := t.TempDir()
	safeCleanupDir(t, root)
	_ = os.MkdirAll(filepath.Join(root, "game"), 0755)

	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	zipData := createPriorityTestZip("game/Submods/my_mod/test.rpy", "# Submod test\n")

	// 1. PreviewArchive with recommended priority 55
	preview, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_install_prio",
		ModID:         "mod_custom",
		VersionID:     "v1",
		Version:       "1.0.0",
		Title:         "Custom Mod",
		Priority:      55,
		ArchiveBase64: zipData,
	})
	if err != nil {
		t.Fatalf("PreviewArchive failed: %v", err)
	}
	if preview.Priority != 55 {
		t.Fatalf("expected PlanResult.Priority 55, got %d", preview.Priority)
	}

	// 2. ExecutePlan
	res, err := service.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview.PlanID,
		Confirmed: true,
	})
	if err != nil || res.State != "committed" {
		t.Fatalf("ExecutePlan failed: %+v %v", res, err)
	}

	// 3. Overview should reflect 55
	overview, err := service.GetPriorityOverview()
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.Mods) != 1 || overview.Mods[0].Priority != 55 {
		t.Fatalf("expected overview priority 55, got %+v", overview.Mods)
	}

	// 4. Installed receipts should reflect 55
	receipts, err := service.ListInstalledArchives()
	if err != nil {
		t.Fatal(err)
	}
	if len(receipts) != 1 || receipts[0].Priority != 55 {
		t.Fatalf("expected receipt priority 55, got %+v", receipts)
	}

	// 5. Preview update with Priority: 0 should retain existing priority 55
	updatePreview, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_update_prio",
		ModID:         "mod_custom",
		VersionID:     "v2",
		Version:       "2.0.0",
		Title:         "Custom Mod",
		Priority:      0,
		ArchiveBase64: zipData,
	})
	if err != nil {
		t.Fatalf("update PreviewArchive failed: %v", err)
	}
	if updatePreview.Priority != 55 {
		t.Fatalf("expected update PlanResult.Priority to retain 55, got %d", updatePreview.Priority)
	}
}

