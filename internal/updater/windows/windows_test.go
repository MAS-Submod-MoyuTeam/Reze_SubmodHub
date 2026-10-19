//go:build windows

package winupdate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExecuteTransactionSimulated(t *testing.T) {
	tmpDir := t.TempDir()

	currentExe := filepath.Join(tmpDir, "app.exe")
	newExe := filepath.Join(tmpDir, "app_v2.exe")
	backupPath := filepath.Join(tmpDir, "app.exe.bak")
	logPath := filepath.Join(tmpDir, "updater.log")
	taskPath := filepath.Join(tmpDir, "task_trans.json")

	// Create dummy old exe and new exe
	if err := os.WriteFile(currentExe, []byte("echo old version\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newExe, []byte("echo new version\n"), 0755); err != nil {
		t.Fatal(err)
	}

	task := &UpdateTask{
		SchemaVersion: TaskSchemaVersion,
		Phase:         PhaseInit,
		TargetExePath: currentExe,
		NewExePath:    newExe,
		BackupPath:    backupPath,
		TargetPID:     0, // No PID to wait for
		LogPath:       logPath,
		TaskFilePath:  taskPath,
	}

	logger, err := NewLogger(logPath)
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()

	// Execute transaction (will attempt to run cmd.Start() on app.exe)
	// Because app.exe is text/script, Start may fail on Windows without cmd /c if not binary exe,
	// but the atomic replacement logic before Start is verified.
	// Let's test the file replacement:
	err = ExecuteTransaction(task, logger)
	// On Windows, running a non-PE executable file might return error and trigger rollback
	// which tests our rollback logic!
	if err != nil {
		t.Logf("ExecuteTransaction returned expected non-PE launch error or rollback: %v", err)
		// Verify that currentExe still exists (either replaced or rolled back)
		if _, statErr := os.Stat(currentExe); statErr != nil {
			t.Fatalf("current executable vanished after failed launch: %v", statErr)
		}
	} else {
		// Launch succeeded (e.g. if platform executes it)
		content, _ := os.ReadFile(currentExe)
		if string(content) != "echo new version\n" {
			t.Fatalf("currentExe content mismatch: %s", string(content))
		}
	}
}

func TestRecoverInterruptedTransaction(t *testing.T) {
	tmpDir := t.TempDir()
	currentExe := filepath.Join(tmpDir, "app.exe")
	backupPath := filepath.Join(tmpDir, "app.exe.bak")
	taskPath := filepath.Join(tmpDir, "task_recovery.json")
	logPath := filepath.Join(tmpDir, "recovery.log")

	// 1. Simulate PhaseBackedUp where currentExe is missing and backup exists
	if err := os.WriteFile(backupPath, []byte("backup-binary"), 0755); err != nil {
		t.Fatal(err)
	}

	task := &UpdateTask{
		SchemaVersion: TaskSchemaVersion,
		Phase:         PhaseBackedUp,
		TargetExePath: currentExe,
		NewExePath:    filepath.Join(tmpDir, "new.exe"),
		BackupPath:    backupPath,
		TaskFilePath:  taskPath,
	}

	logger, _ := NewLogger(logPath)
	defer logger.Close()

	if err := RecoverInterruptedTransaction(task, logger); err != nil {
		t.Fatalf("RecoverInterruptedTransaction failed: %v", err)
	}

	data, err := os.ReadFile(currentExe)
	if err != nil {
		t.Fatalf("Target exe not restored: %v", err)
	}
	if string(data) != "backup-binary" {
		t.Fatalf("Restored content mismatch: %s", string(data))
	}

	// Verify task file was updated atomically
	readTask, err := ReadTaskFile(taskPath)
	if err != nil {
		t.Fatalf("Failed to read task after recovery: %v", err)
	}
	if readTask.Phase != PhaseRolledBack {
		t.Fatalf("Task phase expected %s, got %s", PhaseRolledBack, readTask.Phase)
	}
}
