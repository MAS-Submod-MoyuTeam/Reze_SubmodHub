package winupdate

import (
	"path/filepath"
	"testing"
)

func TestUpdateTaskSerialization(t *testing.T) {
	tmpDir := t.TempDir()
	taskPath := filepath.Join(tmpDir, "task.json")

	task := UpdateTask{
		TargetExePath: "C:\\Program Files\\SubmodHub\\submodhub.exe",
		NewExePath:    "C:\\Temp\\submodhub_new.exe",
		ExpectedSHA:   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		BackupPath:    "C:\\Program Files\\SubmodHub\\submodhub.exe.bak",
		TargetPID:     1234,
	}

	if err := WriteTaskFile(taskPath, task); err != nil {
		t.Fatalf("WriteTaskFile failed: %v", err)
	}

	readTask, err := ReadTaskFile(taskPath)
	if err != nil {
		t.Fatalf("ReadTaskFile failed: %v", err)
	}

	if readTask.TargetExePath != task.TargetExePath || readTask.TargetPID != 1234 || readTask.SchemaVersion != TaskSchemaVersion || readTask.Phase != PhaseInit {
		t.Errorf("read task mismatch: %+v", readTask)
	}
}
