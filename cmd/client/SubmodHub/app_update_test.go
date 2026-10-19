package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/reze/submodhub/internal/updater"
)

type mockUpdateBridge struct {
	installedTarget string
	openedSettings  bool
}

func (m *mockUpdateBridge) CanInstallDirectly() bool {
	return true
}

func (m *mockUpdateBridge) CanRequestPackageInstalls() (bool, error) {
	return true, nil
}

func (m *mockUpdateBridge) OpenAppUpdateSettings() (bool, error) {
	m.openedSettings = true
	return true, nil
}

func (m *mockUpdateBridge) InstallDownloadedApk(apkPath string) (bool, error) {
	m.installedTarget = apkPath
	return true, nil
}

func (m *mockUpdateBridge) GetLastInstallResult() (string, error) {
	return "launched", nil
}

func (m *mockUpdateBridge) Install(ctx context.Context, targetFilePath string, currentAppPath string) error {
	m.installedTarget = targetFilePath
	return nil
}

func TestStartupConfirmationRequiresValidConfiguration(t *testing.T) {
	dir := t.TempDir()
	ack := filepath.Join(dir, "startup.ack")
	task := filepath.Join(dir, "app.update-task.json")
	t.Setenv(updater.StartupTaskEnv, task)
	t.Setenv(updater.StartupTokenEnv, "transaction-token")
	t.Setenv(updater.StartupAckEnv, ack)
	config := filepath.Join(dir, "instances.json")
	if err := os.WriteFile(config, []byte("invalid configuration"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := (&DesktopService{}).ConfirmAppUpdateStartup(); err == nil {
		t.Fatal("uninitialized services acknowledged startup")
	}
	svc := NewDesktopService()
	svc.configPath = config
	if err := svc.ConfirmAppUpdateStartup(); err == nil {
		t.Fatal("invalid configuration acknowledged startup")
	}
	if _, err := os.Stat(ack); !os.IsNotExist(err) {
		t.Fatalf("confirmation created despite initialization failure: %v", err)
	}
	if err := os.WriteFile(config, []byte(`{"instances":[],"active_id":""}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := svc.ConfirmAppUpdateStartup(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(ack)
	if err != nil {
		t.Fatal(err)
	}
	var confirmation updater.StartupConfirmation
	if err := json.Unmarshal(data, &confirmation); err != nil {
		t.Fatal(err)
	}
	if confirmation.Task != task || confirmation.Token != "transaction-token" || confirmation.PID != os.Getpid() {
		t.Fatalf("confirmation does not identify this update and process: %+v", confirmation)
	}
}

func TestAppUpdateBindings(t *testing.T) {
	svc := NewDesktopService()
	bridge := &mockUpdateBridge{}
	bindings, err := newAppUpdateBindings(bridge, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	svc.appUpdater = bindings

	state := svc.GetAppUpdateStatus()
	if state.Status != updater.StatusIdle {
		t.Errorf("expected initial status idle, got: %s", state.Status)
	}

	// Test settings invocation
	opened, err := svc.OpenAppUpdateSettings()
	if err != nil || !opened || !bridge.openedSettings {
		t.Fatalf("OpenAppUpdateSettings failed: %v", err)
	}

	// Test Cancel
	cancelState := svc.CancelAppUpdate()
	if cancelState.Status != updater.StatusIdle {
		t.Errorf("expected idle cancellation to be a no-op, got: %s", cancelState.Status)
	}
}
