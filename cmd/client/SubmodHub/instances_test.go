package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/reze/submodhub/internal/maspath"
)

func TestLaunchMASInstanceRejectsMissingExecutable(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}
	s := &DesktopService{configPath: filepath.Join(t.TempDir(), "instances.json")}
	state, err := s.AddMASInstance("Test", root)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.LaunchMASInstance("unknown"); err == nil || err.Error() != "mas_instance_not_found" {
		t.Fatalf("unknown instance: %v", err)
	}
	if err := s.LaunchMASInstance(state.ActiveID); err == nil || err.Error() != "mas_executable_missing" {
		t.Fatalf("missing executable: %v", err)
	}
	if err := os.Remove(filepath.Join(root, "game")); err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	if err := s.LaunchMASInstance(state.ActiveID); err == nil || err.Error() != "mas_game_directory_missing" {
		t.Fatalf("missing game directory: %v", err)
	}
}

func TestMASInstancesPersistAndSwitch(t *testing.T) {
	config := filepath.Join(t.TempDir(), "instances.json")
	first := makeMASFixture(t)
	second := makeMASFixture(t)
	s := &DesktopService{configPath: config}
	if _, err := s.AddMASInstance("First", first); err != nil {
		t.Fatal(err)
	}
	state, err := s.AddMASInstance("Second", second)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Instances) != 2 || state.ActiveID != state.Instances[1].ID {
		t.Fatalf("state=%+v", state)
	}
	if _, err := s.AddMASInstance("Duplicate", first); err == nil {
		t.Fatal("duplicate path accepted")
	}
	if _, err := s.SelectMASInstance(state.Instances[0].ID); err != nil {
		t.Fatal(err)
	}

	restarted := &DesktopService{configPath: config}
	loaded, err := restarted.ListMASInstances()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Instances) != 2 || loaded.ActiveID != state.Instances[0].ID || restarted.root != first {
		t.Fatalf("restored=%+v root=%q", loaded, restarted.root)
	}
	removed, err := restarted.RemoveMASInstance(loaded.ActiveID)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed.Instances) != 1 || removed.ActiveID != "" || restarted.root != "" {
		t.Fatalf("removed=%+v root=%q", removed, restarted.root)
	}
}

func TestMASInstancesRejectInvalidDirectory(t *testing.T) {
	s := &DesktopService{configPath: filepath.Join(t.TempDir(), "instances.json")}
	if _, err := s.AddMASInstance("Invalid", t.TempDir()); err == nil {
		t.Fatal("directory without game accepted")
	}
	if len(s.instances) != 0 {
		t.Fatalf("invalid directory was saved: %+v", s.instances)
	}
}

func makeMASFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestAndroidMASInstanceDiagnostics(t *testing.T) {
	// 1. Permission is denied: diagnosis is permission-related, and game_directory_missing is NOT falsely claimed
	t.Run("permission_denied_preserves_root_and_reports_denied", func(t *testing.T) {
		service := &DesktopService{
			isAndroidOverride: true,
			storageProvider: &mockStorageAccessProvider{
				status: AndroidStorageAccessStatus{State: "denied"},
			},
			inspectDir: func(root string) MASStatus {
				t.Fatal("inspectDir should NOT be called when storage permission is denied")
				return MASStatus{}
			},
		}

		state, err := service.ListMASInstances()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(state.Instances) != 1 {
			t.Fatalf("expected 1 instance, got %d", len(state.Instances))
		}
		inst := state.Instances[0]
		if inst.Root != maspath.AndroidMASRoot {
			t.Fatalf("expected root %q, got %q", maspath.AndroidMASRoot, inst.Root)
		}
		if inst.Status.Valid {
			t.Fatal("expected Valid to be false")
		}
		if inst.Status.GameExists {
			t.Fatal("expected GameExists to be false")
		}
		if inst.Status.Diagnostic != "storage_access_denied" {
			t.Fatalf("expected diagnostic 'storage_access_denied', got %q", inst.Status.Diagnostic)
		}
	})

	// 2. Permission query fails: diagnosis preserves query failure information
	t.Run("permission_query_failed_preserves_error", func(t *testing.T) {
		service := &DesktopService{
			isAndroidOverride: true,
			storageProvider: &mockStorageAccessProvider{
				statErr: errors.New("jni timeout accessing environment"),
			},
		}

		state, err := service.ListMASInstances()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		inst := state.Instances[0]
		if inst.Status.Diagnostic != "storage_access_query_failed" {
			t.Fatalf("expected diagnostic 'storage_access_query_failed', got %q", inst.Status.Diagnostic)
		}
		if inst.Status.DiagnosticDetail != "jni timeout accessing environment" {
			t.Fatalf("expected detail 'jni timeout accessing environment', got %q", inst.Status.DiagnosticDetail)
		}
		if inst.Status.Valid || inst.Status.GameExists {
			t.Fatal("expected Valid and GameExists to be false")
		}
	})

	// 2b. Storage provider unavailable
	t.Run("storage_provider_unavailable", func(t *testing.T) {
		service := &DesktopService{
			isAndroidOverride: true,
			storageProvider:   nil,
		}

		state, err := service.ListMASInstances()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		inst := state.Instances[0]
		if inst.Status.Diagnostic != "storage_provider_unavailable" {
			t.Fatalf("expected diagnostic 'storage_provider_unavailable', got %q", inst.Status.Diagnostic)
		}
	})

	// 3. MAS root directory missing
	t.Run("mas_root_missing", func(t *testing.T) {
		missingRoot := filepath.Join(t.TempDir(), "nonexistent_mas_dir")
		service := &DesktopService{
			isAndroidOverride:   true,
			androidRootOverride: missingRoot,
			storageProvider: &mockStorageAccessProvider{
				status: AndroidStorageAccessStatus{State: "granted"},
			},
		}

		state, err := service.ListMASInstances()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		inst := state.Instances[0]
		if inst.Status.Valid {
			t.Fatal("expected Valid to be false")
		}
		if inst.Status.GameExists {
			t.Fatal("expected GameExists to be false")
		}
		if inst.Status.Diagnostic != "mas_root_missing" {
			t.Fatalf("expected diagnostic 'mas_root_missing', got %q", inst.Status.Diagnostic)
		}
	})

	// 4. Root path is a file rather than directory
	t.Run("mas_root_not_directory", func(t *testing.T) {
		fileRoot := filepath.Join(t.TempDir(), "mas_file")
		if err := os.WriteFile(fileRoot, []byte("plain text"), 0o644); err != nil {
			t.Fatal(err)
		}
		service := &DesktopService{
			isAndroidOverride:   true,
			androidRootOverride: fileRoot,
			storageProvider: &mockStorageAccessProvider{
				status: AndroidStorageAccessStatus{State: "granted"},
			},
		}

		state, err := service.ListMASInstances()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		inst := state.Instances[0]
		if inst.Status.Valid {
			t.Fatal("expected Valid to be false")
		}
		if inst.Status.GameExists {
			t.Fatal("expected GameExists to be false")
		}
		if inst.Status.Diagnostic != "mas_root_not_directory" {
			t.Fatalf("expected diagnostic 'mas_root_not_directory', got %q", inst.Status.Diagnostic)
		}
	})

	// 5. Root directory exists, but game/ does not exist
	t.Run("game_directory_missing", func(t *testing.T) {
		root := t.TempDir()
		service := &DesktopService{
			isAndroidOverride:   true,
			androidRootOverride: root,
			storageProvider: &mockStorageAccessProvider{
				status: AndroidStorageAccessStatus{State: "granted"},
			},
		}

		state, err := service.ListMASInstances()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		inst := state.Instances[0]
		if !inst.Status.Valid {
			t.Fatal("expected Valid to be true when root exists")
		}
		if inst.Status.GameExists {
			t.Fatal("expected GameExists to be false when game/ is missing")
		}
		if inst.Status.Diagnostic != "game_directory_missing" {
			t.Fatalf("expected diagnostic 'game_directory_missing', got %q", inst.Status.Diagnostic)
		}
	})

	// 6. Root exists, but game path is a file rather than directory
	t.Run("game_path_not_directory", func(t *testing.T) {
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, "game"), []byte("file"), 0o644); err != nil {
			t.Fatal(err)
		}
		service := &DesktopService{
			isAndroidOverride:   true,
			androidRootOverride: root,
			storageProvider: &mockStorageAccessProvider{
				status: AndroidStorageAccessStatus{State: "granted"},
			},
		}

		state, err := service.ListMASInstances()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		inst := state.Instances[0]
		if !inst.Status.Valid {
			t.Fatal("expected Valid to be true")
		}
		if inst.Status.GameExists {
			t.Fatal("expected GameExists to be false")
		}
		if inst.Status.Diagnostic != "game_path_not_directory" {
			t.Fatalf("expected diagnostic 'game_path_not_directory', got %q", inst.Status.Diagnostic)
		}
	})

	// 7. Both root and game/ are valid directories
	t.Run("game_directory_verified", func(t *testing.T) {
		root := makeMASFixture(t)
		service := &DesktopService{
			isAndroidOverride:   true,
			androidRootOverride: root,
			storageProvider: &mockStorageAccessProvider{
				status: AndroidStorageAccessStatus{State: "granted"},
			},
		}

		state, err := service.ListMASInstances()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		inst := state.Instances[0]
		if !inst.Status.Valid {
			t.Fatal("expected Valid to be true")
		}
		if !inst.Status.GameExists {
			t.Fatal("expected GameExists to be true")
		}
		if inst.Status.Diagnostic != "game_directory_verified" {
			t.Fatalf("expected diagnostic 'game_directory_verified', got %q", inst.Status.Diagnostic)
		}
	})

	// 8. Non-Android instance existing state and behavior unchanged
	t.Run("non_android_behavior_preserved", func(t *testing.T) {
		config := filepath.Join(t.TempDir(), "instances.json")
		service := &DesktopService{configPath: config}
		fixture := makeMASFixture(t)

		state, err := service.AddMASInstance("Desktop MAS", fixture)
		if err != nil {
			t.Fatalf("AddMASInstance failed: %v", err)
		}
		if len(state.Instances) != 1 {
			t.Fatalf("expected 1 instance, got %d", len(state.Instances))
		}
		inst := state.Instances[0]
		if !inst.Status.Valid || !inst.Status.GameExists {
			t.Fatalf("expected valid and game_exists, got valid=%v game_exists=%v", inst.Status.Valid, inst.Status.GameExists)
		}
		if inst.Status.Diagnostic != "game_directory_verified" {
			t.Fatalf("expected 'game_directory_verified', got %q", inst.Status.Diagnostic)
		}
	})
}
