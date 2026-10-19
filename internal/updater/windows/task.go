package winupdate

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// TaskSchemaVersion defines the schema version for forward/backward safety checks.
const TaskSchemaVersion = 1

// TransactionPhase represents the checkpointed state of the update operation.
type TransactionPhase string

const (
	PhaseBackingUp   TransactionPhase = "backing_up"
	PhaseReplacing   TransactionPhase = "replacing"
	PhaseLaunching   TransactionPhase = "launching"
	PhaseRollingBack TransactionPhase = "rolling_back"
	PhaseInit        TransactionPhase = "init"
	PhaseBackedUp    TransactionPhase = "backed_up"
	PhaseReplaced    TransactionPhase = "replaced"
	PhaseLaunched    TransactionPhase = "launched"
	PhaseCompleted   TransactionPhase = "completed"
	PhaseRolledBack  TransactionPhase = "rolled_back"
)

// UpdateTask contains the parameters necessary for the independent updater process.
type UpdateTask struct {
	UpdaterExePath        string           `json:"updater_exe_path,omitempty"`
	Token                 string           `json:"token,omitempty"`
	ChildPID              int              `json:"child_pid,omitempty"`
	BackupSHA             string           `json:"backup_sha256,omitempty"`
	ConfirmTimeoutSeconds int              `json:"confirm_timeout_seconds,omitempty"`
	SchemaVersion         int              `json:"schema_version"`
	Phase                 TransactionPhase `json:"phase"`
	TargetExePath         string           `json:"target_exe_path"`
	NewExePath            string           `json:"new_exe_path"`
	ExpectedSHA           string           `json:"expected_sha256,omitempty"`
	BackupPath            string           `json:"backup_path"`
	TargetPID             int              `json:"target_pid"`
	LogPath               string           `json:"log_path,omitempty"`
	TaskFilePath          string           `json:"task_file_path,omitempty"`
}

// WriteTaskFile serializes and saves an update task to disk atomically.
func WriteTaskFile(taskFilePath string, task UpdateTask) error {
	task.SchemaVersion = TaskSchemaVersion
	task.TaskFilePath = taskFilePath
	if task.Phase == "" {
		task.Phase = PhaseInit
	}
	dir := filepath.Dir(taskFilePath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(task, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode task: %w", err)
	}

	tmpFile := fmt.Sprintf("%s.tmp.%d", taskFilePath, os.Getpid())
	f, err := os.OpenFile(tmpFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		_ = os.Remove(tmpFile)
		return err
	}
	if closeErr != nil {
		_ = os.Remove(tmpFile)
		return closeErr
	}

	if err := os.Rename(tmpFile, taskFilePath); err != nil {
		_ = os.Remove(tmpFile)
		return fmt.Errorf("failed to commit task file atomically: %w", err)
	}
	return nil
}

// ReadTaskFile deserializes and verifies an update task from disk.
func ReadTaskFile(taskFilePath string) (*UpdateTask, error) {
	data, err := os.ReadFile(taskFilePath)
	if err != nil {
		return nil, err
	}
	var task UpdateTask
	if err := json.Unmarshal(data, &task); err != nil {
		return nil, fmt.Errorf("invalid update task format: %w", err)
	}
	if task.SchemaVersion != TaskSchemaVersion {
		return nil, fmt.Errorf("unsupported task schema version %d (supported: %d)", task.SchemaVersion, TaskSchemaVersion)
	}
	if task.TargetExePath == "" || task.NewExePath == "" {
		return nil, fmt.Errorf("malformed task: TargetExePath and NewExePath are required")
	}
	task.TaskFilePath = taskFilePath
	return &task, nil
}
