//go:build windows

package winupdate

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/updater"
)

// The published task must point at a helper beside the target: the staging
// directory can be wiped before recovery ever runs.
func TestInstallPublishesDurableUpdater(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	staged := filepath.Join(dir, "new.exe")
	helper := filepath.Join(dir, "staging", "updater.exe")
	for path, data := range map[string]string{target: "original", staged: "new version", helper: "not a PE executable"} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), 0755); err != nil {
			t.Fatal(err)
		}
	}

	err := NewWindowsInstaller(helper).Install(context.Background(), staged, target)
	if err == nil || !strings.Contains(err.Error(), "failed to start updater process") {
		t.Fatalf("install did not reach helper startup: %v", err)
	}

	durable := updater.StableUpdaterPath(target)
	if durable != target+".updater.exe" {
		t.Fatalf("unexpected durable path %q", durable)
	}
	data, readErr := os.ReadFile(durable)
	if readErr != nil {
		t.Fatalf("durable updater missing: %v", readErr)
	}
	if string(data) != "not a PE executable" {
		t.Fatalf("durable updater content = %q", data)
	}
	task, readTaskErr := ReadTaskFile(updater.StableTaskPath(target))
	if readTaskErr != nil {
		t.Fatal(readTaskErr)
	}
	if task.UpdaterExePath != durable {
		t.Fatalf("task records %q, want the durable copy %q", task.UpdaterExePath, durable)
	}
}

// Recovery must leave a checkpoint behind: the missing log is what made an
// interrupted update undiagnosable.
func TestRecoverTaskFileRecordsCheckpoint(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	backup := target + ".old"
	logPath := target + ".updater.log"
	for _, path := range []string{target, backup} {
		if err := os.WriteFile(path, []byte("old"), 0755); err != nil {
			t.Fatal(err)
		}
	}
	task := UpdateTask{
		Phase:         PhaseReplacing,
		TargetExePath: target,
		NewExePath:    target + ".new",
		BackupPath:    backup,
		LogPath:       logPath,
		TaskFilePath:  updater.StableTaskPath(target),
	}
	if err := WriteTaskFile(task.TaskFilePath, task); err != nil {
		t.Fatal(err)
	}
	if err := RecoverTaskFile(task.TaskFilePath); err != nil {
		t.Fatal(err)
	}
	logged, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("recovery wrote no log: %v", err)
	}
	if !strings.Contains(string(logged), "phase="+string(PhaseRolledBack)) {
		t.Fatalf("log does not record the rollback: %q", logged)
	}
}

// A refused recovery is the state that left the update silently wedged: the
// error must reach the log, not only a discarded stderr.
func TestRecoverTaskFileLogsRefusal(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	logPath := target + ".updater.log"
	if err := os.WriteFile(target, []byte("new"), 0755); err != nil {
		t.Fatal(err)
	}
	task := UpdateTask{
		Phase:         PhaseReplaced,
		TargetExePath: target,
		NewExePath:    target + ".new",
		BackupPath:    filepath.Join(dir, "missing.old"),
		LogPath:       logPath,
		TaskFilePath:  updater.StableTaskPath(target),
	}
	if err := WriteTaskFile(task.TaskFilePath, task); err != nil {
		t.Fatal(err)
	}
	if err := RecoverTaskFile(task.TaskFilePath); err == nil {
		t.Fatal("recovery without a backup reported success")
	}
	logged, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("recovery wrote no log: %v", err)
	}
	if !strings.Contains(string(logged), "recovery failed") {
		t.Fatalf("log does not record the refusal: %q", logged)
	}
}
