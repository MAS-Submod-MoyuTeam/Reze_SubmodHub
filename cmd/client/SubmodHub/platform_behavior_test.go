package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
	service.core = service.newCore(temp, service.state)

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

func TestAndroidMASLockMappedToInternalStorage(t *testing.T) {
	tempRoot := t.TempDir()
	gameDir := filepath.Join(tempRoot, "game")
	_ = os.MkdirAll(filepath.Join(gameDir, "Submods"), 0o755)

	configDir := t.TempDir()
	configPath := filepath.Join(configDir, "instances.json")

	provider := &mockStorageAccessProvider{
		status: AndroidStorageAccessStatus{State: "granted"},
	}

	service1 := NewDesktopService()
	service1.configPath = configPath
	service1.isAndroidOverride = true
	service1.androidRootOverride = tempRoot
	service1.SetStorageAccessProvider(provider)

	// SetMASRoot with android override
	_, err := service1.SetMASRoot(maspath.AndroidMASRoot)
	if err != nil {
		t.Fatalf("SetMASRoot failed: %v", err)
	}

	// The lock path must be located in configDir/locks and NOT inside root/.submodhub/state
	lockPath1 := service1.core.LockPath()
	expectedPrefix := filepath.Join(configDir, "locks")
	if !strings.HasPrefix(lockPath1, expectedPrefix) {
		t.Fatalf("expected lock path to be in internal storage %q, got %q", expectedPrefix, lockPath1)
	}
	stateLock := filepath.Join(service1.state, "lock")
	if lockPath1 == stateLock {
		t.Fatalf("lock path must not be inside shared storage state dir: %q", stateLock)
	}

	// A second service instance targeting the same MAS root must map to the exact same lock path
	service2 := NewDesktopService()
	service2.configPath = configPath
	service2.isAndroidOverride = true
	service2.androidRootOverride = tempRoot
	service2.SetStorageAccessProvider(provider)

	lockPath2 := service2.newCore(service1.root, service1.state).LockPath()
	if lockPath1 != lockPath2 {
		t.Fatalf("expected stable lock path mapping: %q != %q", lockPath1, lockPath2)
	}
}
