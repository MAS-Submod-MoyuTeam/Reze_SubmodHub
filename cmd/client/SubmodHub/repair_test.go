package main

import (
	core "github.com/reze/submodhub/internal/install"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopRepairPreviewExecute(t *testing.T) {
	root := t.TempDir()
	_ = os.MkdirAll(filepath.Join(root, "game"), 0755)
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	if err := service.core.Apply(core.Operation{ID: "installed", Changes: []core.Change{{Path: "game/demo.rpy", Content: []byte("managed")}}}); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(root, "game/demo.rpy"), []byte("external"), 0644)
	preview, err := service.PreviewRepair("installed")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Kind != "repair" || !preview.Actions[0].BackupRequired {
		t.Fatalf("preview=%+v", preview)
	}
	if _, err = service.ExecutePlan(ExecutePlanRequest{PlanID: preview.PlanID, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(filepath.Join(root, "game/demo.rpy"))
	if string(content) != "managed" {
		t.Fatalf("content=%q", content)
	}
	if _, err = service.ExecutePlan(ExecutePlanRequest{PlanID: preview.PlanID, Confirmed: true}); err == nil || !strings.Contains(err.Error(), "plan_stale") {
		t.Fatalf("err=%v", err)
	}
	if _, err = service.PreviewRepair("unknown"); !core.IsCode(err, "installation_not_found") {
		t.Fatalf("err=%v", err)
	}

	// Verify plan execution with external_change blocker preserves error code
	service.activePlan = &core.Plan{
		PlanID:   "blocked_plan",
		Root:     root,
		Blockers: []string{"external_change: game/demo.rpy (disk modified)"},
	}
	_, err = service.ExecutePlan(ExecutePlanRequest{PlanID: "blocked_plan", Confirmed: true})
	if err == nil || !core.IsCode(err, "external_change") {
		t.Fatalf("expected external_change, got err=%v", err)
	}
}

func TestDesktopRepairResolvesReceiptFallbackUnderLock(t *testing.T) {
	root := t.TempDir()
	_ = os.MkdirAll(filepath.Join(root, "game"), 0755)
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	// Install with operation ID
	if err := service.core.Apply(core.Operation{ID: "op_original", Changes: []core.Change{{Path: "game/receipt_demo.rpy", Content: []byte("content")}}}); err != nil {
		t.Fatal(err)
	}

	// Write receipt linking mod_id "mod_receipt" to operation_id "op_original"
	receiptFile := filepath.Join(root, ".submodhub", "installed-archives.json")
	receiptData := `[{"mod_id":"mod_receipt","operation_id":"op_original","title":"Receipt Mod","version":"1.0.0"}]`
	if err := os.WriteFile(receiptFile, []byte(receiptData), 0644); err != nil {
		t.Fatal(err)
	}

	// PreviewRepair using mod_id "mod_receipt" which requires receipt resolution under lock
	preview, err := service.PreviewRepair("mod_receipt")
	if err != nil {
		t.Fatalf("PreviewRepair failed: %v", err)
	}
	if preview.TargetID != "op_original" {
		t.Fatalf("expected TargetID op_original, got %s", preview.TargetID)
	}
}


