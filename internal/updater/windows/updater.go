//go:build windows

package winupdate

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/reze/submodhub/internal/updater"
)

// WindowsInstaller implements PlatformInstaller for Windows.
type WindowsInstaller struct {
	updaterExePath string
}

func NewWindowsInstaller(updaterExePath string) *WindowsInstaller {
	return &WindowsInstaller{updaterExePath: updaterExePath}
}

func (w *WindowsInstaller) CanInstallDirectly() bool {
	return true
}

// Install prepares the task and launches the independent updater executable.
func (w *WindowsInstaller) Install(ctx context.Context, targetFilePath string, currentAppPath string) error {
	if currentAppPath == "" {
		var err error
		currentAppPath, err = os.Executable()
		if err != nil {
			return fmt.Errorf("failed to get current executable path: %w", err)
		}
	}
	currentAppPath, err := filepath.Abs(currentAppPath)
	if err != nil {
		return err
	}

	targetFilePath, err = filepath.Abs(targetFilePath)
	if err != nil {
		return err
	}

	unlock, err := lockTarget(currentAppPath)
	if err != nil {
		return err
	}
	defer unlock()
	taskFile := updater.StableTaskPath(currentAppPath)
	if previous, err := ReadTaskFile(taskFile); err == nil {
		if previous.Phase != PhaseCompleted && previous.Phase != PhaseRolledBack {
			recovery, resolveErr := updater.ResolveUpdaterPath(previous.UpdaterExePath, currentAppPath)
			if resolveErr != nil {
				return fmt.Errorf("unfinished update requires recovery: %s (%v)", taskFile, resolveErr)
			}
			return fmt.Errorf("unfinished update requires recovery: %s; exit the app and run %q --recover --target %q", taskFile, recovery, currentAppPath)
		}
		if err := osRemoveIfExists(previous.BackupPath); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	logFile := currentAppPath + ".updater.log"
	backupPath := currentAppPath + ".old"

	expectedSHA, err := updater.CalculateFileSHA256(targetFilePath)
	if err != nil {
		return err
	}

	originalSHA, err := updater.CalculateFileSHA256(currentAppPath)
	if err != nil {
		return err
	}
	task := UpdateTask{
		Token:         rand.Text(),
		BackupSHA:     originalSHA,
		TargetExePath: currentAppPath,
		NewExePath:    targetFilePath,
		ExpectedSHA:   expectedSHA,
		BackupPath:    backupPath,
		TargetPID:     os.Getpid(),
		LogPath:       logFile,
	}

	updaterPath := w.updaterExePath
	if updaterPath == "" {
		// 1. Look for downloaded updater in the same staged directory as targetFilePath
		stagedDir := filepath.Dir(targetFilePath)
		stagedUpdater := filepath.Join(stagedDir, "updater.exe")
		if _, err := os.Stat(stagedUpdater); err == nil {
			updaterPath = stagedUpdater
		}
	}
	if updaterPath == "" {
		// 2. Look for updater.exe in same directory as current app
		dir := filepath.Dir(currentAppPath)
		candidate := filepath.Join(dir, "updater.exe")
		if _, err := os.Stat(candidate); err == nil {
			updaterPath = candidate
		}
	}

	if updaterPath == "" {
		return fmt.Errorf("independent updater executable (updater.exe) not found; cannot proceed with installation")
	}

	if _, err := os.Stat(updaterPath); err != nil {
		return fmt.Errorf("updater executable not found at %s: %w", updaterPath, err)
	}

	updaterPath, err = filepath.Abs(updaterPath)
	if err != nil {
		return err
	}
	// Publish a durable helper beside the target before anything can be wiped
	// from the disposable staging directory. Recovery must never depend on it.
	durableUpdater, err := publishDurableUpdater(updaterPath, updater.StableUpdaterPath(currentAppPath))
	if err != nil {
		return err
	}
	task.UpdaterExePath = durableUpdater
	if err := WriteTaskFile(taskFile, task); err != nil {
		return err
	}
	unlock()
	cmd := exec.Command(durableUpdater, "-task", taskFile)
	cmd.Env = cleanStartupEnvironment()
	if err := cmd.Start(); err != nil {
		startErr := fmt.Errorf("failed to start updater process: %w", err)
		if cleanupErr := retireUnstartedTask(taskFile, task); cleanupErr != nil {
			return errors.Join(startErr, cleanupErr)
		}
		return startErr
	}

	return nil
}

// publishDurableUpdater copies the staged helper beside the target and proves
// the copy matches before the task can reference it.
func publishDurableUpdater(staged, durable string) (string, error) {
	if strings.EqualFold(filepath.Clean(staged), filepath.Clean(durable)) {
		return durable, nil
	}
	sum, err := updater.CalculateFileSHA256(staged)
	if err != nil {
		return "", err
	}
	if err = CopyFile(staged, durable); err != nil {
		return "", fmt.Errorf("failed to publish recovery updater: %w", err)
	}
	if err = updater.VerifyFileSHA256(durable, sum); err != nil {
		return "", fmt.Errorf("published recovery updater does not match its source: %w", err)
	}
	return durable, nil
}

// retireUnstartedTask permits retries only when this exact published task has
// performed no backup or replacement. A competing updater's state is preserved.
func retireUnstartedTask(taskFile string, published UpdateTask) error {
	unlock, err := lockTarget(published.TargetExePath)
	if err != nil {
		return err
	}
	defer unlock()
	disk, err := ReadTaskFile(taskFile)
	if err != nil {
		return err
	}
	if disk.Token != published.Token || disk.TargetExePath != published.TargetExePath || disk.Phase != PhaseInit || disk.ChildPID != 0 {
		return fmt.Errorf("failed-start task changed; recovery state retained")
	}
	if _, err := os.Stat(disk.BackupPath); !os.IsNotExist(err) {
		return fmt.Errorf("failed-start backup exists or cannot be inspected; recovery state retained: %v", err)
	}
	if err := updater.VerifyFileSHA256(disk.TargetExePath, published.BackupSHA); err != nil {
		return fmt.Errorf("failed-start original changed; recovery state retained: %w", err)
	}
	return savePhase(disk, PhaseRolledBack, &Logger{})
}
