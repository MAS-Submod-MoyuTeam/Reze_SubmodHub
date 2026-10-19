package updater

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

const StartupTaskEnv = "SUBMODHUB_UPDATE_TASK"
const StartupTokenEnv = "SUBMODHUB_UPDATE_TOKEN"
const StartupAckEnv = "SUBMODHUB_UPDATE_ACK"

// StartupConfirmation binds readiness to one transaction and the actual app process.
type StartupConfirmation struct {
	Task  string `json:"task"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
}

// ConfirmStartup must run only after normal initialization and UI readiness.
// It is a no-op for launches which are not part of an update.
func ConfirmStartup() error {
	task, token, ack := os.Getenv(StartupTaskEnv), os.Getenv(StartupTokenEnv), os.Getenv(StartupAckEnv)
	if task == "" && token == "" && ack == "" {
		return nil
	}
	if task == "" || token == "" || ack == "" {
		return fmt.Errorf("incomplete update startup confirmation environment")
	}
	data, err := json.Marshal(StartupConfirmation{task, token, os.Getpid()})
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(ack), ".ack-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, ack)
}

// StableTaskPath is discoverable beside the executable even if it was removed.
func StableTaskPath(target string) string { return target + ".update-task.json" }

// ErrRecoveryStarted requires the caller to exit before normal initialization.
var ErrRecoveryStarted = errors.New("update recovery started; exit to release executable")

// RecoverStartup hands interrupted replacement to the independent updater.
// The caller must exit on ErrRecoveryStarted so Windows releases its image.
// An app awaiting confirmation must never race its own updating process.
func RecoverStartup(updaterPath string) error {
	if os.Getenv(StartupTaskEnv) != "" {
		return nil
	}
	target, err := os.Executable()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(StableTaskPath(target))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var state struct {
		Phase          string `json:"phase"`
		UpdaterExePath string `json:"updater_exe_path"`
		BackupPath     string `json:"backup_path"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	if state.Phase == "rolled_back" {
		return nil
	}
	if state.Phase == "completed" {
		if _, err := os.Stat(state.BackupPath); os.IsNotExist(err) {
			return nil
		}
	}
	if updaterPath == "" {
		updaterPath = state.UpdaterExePath
	}
	if updaterPath == "" {
		updaterPath = filepath.Join(filepath.Dir(target), "updater.exe")
	}
	args := []string{"--recover", "--target", target}
	needsExit := state.Phase != "init" && state.Phase != "backing_up" && state.Phase != "completed"
	if needsExit {
		args = append(args, "--wait-pid", strconv.Itoa(os.Getpid()))
	}
	cmd := exec.Command(updaterPath, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	if err := cmd.Process.Release(); err != nil {
		return err
	}
	if needsExit {
		return ErrRecoveryStarted
	}
	return nil
}
