package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	core "github.com/reze/submodhub/internal/install"
	"github.com/reze/submodhub/internal/maspath"
)

func TestAndroidPlatform_FixedMASInstance(t *testing.T) {
	service := &DesktopService{
		configPath: filepath.Join(t.TempDir(), "instances.json"),
		storageProvider: &mockStorageAccessProvider{
			status: AndroidStorageAccessStatus{State: "denied"},
		},
	}
	service.storageGuard = NewStorageAccessGuard(service.storageProvider)

	// Test with android mode enabled
	service.isAndroidOverride = true

	state, err := service.ListMASInstances()
	if err != nil {
		t.Fatalf("unexpected error listing instances: %v", err)
	}

	if len(state.Instances) != 1 {
		t.Fatalf("expected 1 fixed instance, got %d", len(state.Instances))
	}

	inst := state.Instances[0]
	if inst.ID != "android-mas" {
		t.Fatalf("expected ID 'android-mas', got %q", inst.ID)
	}
	if inst.Root != maspath.AndroidMASRoot {
		t.Fatalf("expected root %q, got %q", maspath.AndroidMASRoot, inst.Root)
	}
	if inst.Status.Valid {
		t.Fatal("expected status.Valid to be false when storage permission denied")
	}

	// Desktop-specific actions must be rejected
	if _, err := service.AddMASInstance("custom", "/custom"); err == nil {
		t.Fatal("expected AddMASInstance to fail on Android")
	}
	if _, err := service.RemoveMASInstance("android-mas"); err == nil {
		t.Fatal("expected RemoveMASInstance to fail on Android")
	}
	if err := service.LaunchMASInstance("android-mas"); err == nil {
		t.Fatal("expected LaunchMASInstance to fail on Android")
	}
	if _, err := service.BrowseMASDirectory(); err == nil {
		t.Fatal("expected BrowseMASDirectory to fail on Android")
	}
}

func TestAndroidPlatform_GuardsLocalOperationsWhenDenied(t *testing.T) {
	temp := t.TempDir()
	gameDir := filepath.Join(temp, "game")
	_ = os.MkdirAll(gameDir, 0o755)

	provider := &mockStorageAccessProvider{
		status: AndroidStorageAccessStatus{State: "denied"},
	}

	service := &DesktopService{
		configPath:      filepath.Join(temp, "instances.json"),
		storageProvider: provider,
		storageGuard:    NewStorageAccessGuard(provider),
		isAndroidOverride: true,
	}

	// Invalid root rejected
	_, err := service.SetMASRoot("/storage/emulated/0/other")
	if err == nil || !errors.Is(err, ErrInvalidMASRoot) {
		t.Fatalf("expected ErrInvalidMASRoot for wrong root, got: %v", err)
	}

	// Correct root but permission denied -> permission_lost
	_, err = service.SetMASRoot(maspath.AndroidMASRoot)
	if err == nil || !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("expected ErrPermissionLost, got: %v", err)
	}

	// All local operations must return permission_lost
	if _, err := service.ScanLocalSubmods(); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("ScanLocalSubmods: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.ListInstalledArchives(); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("ListInstalledArchives: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.ListInstalledModFiles("inst-1", "mod-1"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("ListInstalledModFiles: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.ScanInstalledSpritepacks(); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("ScanInstalledSpritepacks: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.CreateSpriteGift("test.gift"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("CreateSpriteGift: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.DeleteSpritepack("test.gift"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("DeleteSpritepack: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.PreviewArchive(ArchiveInstallRequest{}); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("PreviewArchive: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.PreviewAdopt(AdoptRequest{}); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("PreviewAdopt: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.PreviewUninstall("inst-1"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("PreviewUninstall: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.PreviewRepair("inst-1"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("PreviewRepair: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.GetPriorityOverview(); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("GetPriorityOverview: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.ExecutePlan(ExecutePlanRequest{PlanID: "plan-1"}); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("ExecutePlan: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.ApplyArchive(ArchiveInstallRequest{}); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("ApplyArchive: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.Uninstall("op-1", "inst-1"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("Uninstall: expected ErrPermissionLost, got: %v", err)
	}
	if err := service.Recover("op-1"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("Recover: expected ErrPermissionLost, got: %v", err)
	}
	if err := service.RollbackOperation("op-1"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("RollbackOperation: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.GetMASStatus(); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("GetMASStatus: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.ListOperations(); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("ListOperations: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.GetOperation("op-1"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("GetOperation: expected ErrPermissionLost, got: %v", err)
	}
}

func TestStorageAccess_InitializedThenRevokedGuards(t *testing.T) {
	temp := t.TempDir()
	gameDir := filepath.Join(temp, "game")
	_ = os.MkdirAll(filepath.Join(gameDir, "Submods"), 0o755)

	provider := &mockStorageAccessProvider{
		status: AndroidStorageAccessStatus{State: "granted"},
	}

	service := NewDesktopService()
	service.isAndroidOverride = true
	service.SetStorageAccessProvider(provider)

	// Initialize root and core
	service.root = temp
	service.state = filepath.Join(temp, ".submodhub", "state")
	service.core = core.New(temp, service.state)

	if service.core == nil {
		t.Fatal("expected service.core to be non-nil")
	}

	// 1. While permission is granted, read entries succeed
	status, err := service.GetMASStatus()
	if err != nil {
		t.Fatalf("expected GetMASStatus to succeed when granted, got: %v", err)
	}
	if !status.Valid {
		t.Fatal("expected status.Valid to be true")
	}

	ops, err := service.ListOperations()
	if err != nil {
		t.Fatalf("expected ListOperations to succeed when granted, got: %v", err)
	}
	if len(ops) != 0 {
		t.Fatalf("expected 0 ops, got %d", len(ops))
	}

	// 2. Now simulate revocation (provider status becomes "denied")
	provider.status = AndroidStorageAccessStatus{State: "denied"}

	// Even though service.core is already initialized, read entries MUST return ErrPermissionLost
	if _, err := service.GetMASStatus(); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("GetMASStatus after revocation: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.ListOperations(); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("ListOperations after revocation: expected ErrPermissionLost, got: %v", err)
	}
	if _, err := service.GetOperation("op-1"); !errors.Is(err, ErrPermissionLost) {
		t.Fatalf("GetOperation after revocation: expected ErrPermissionLost, got: %v", err)
	}
}
