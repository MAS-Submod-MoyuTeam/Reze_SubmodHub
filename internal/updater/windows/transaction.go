//go:build windows

package winupdate

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/reze/submodhub/internal/updater"
)

var ErrProcessWaitTimeout = errors.New("timeout waiting for target process to exit")
var ErrRollbackFailed = errors.New("failed to restore original binary after failed update")

func cleanStartupEnvironment() []string {
	var env []string
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		if strings.EqualFold(key, updater.StartupTaskEnv) || strings.EqualFold(key, updater.StartupTokenEnv) || strings.EqualFold(key, updater.StartupAckEnv) {
			continue
		}
		env = append(env, value)
	}
	return env
}

type Logger struct{ file *os.File }

func NewLogger(path string) (*Logger, error) {
	if path == "" {
		return &Logger{}, nil
	}
	f, e := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	return &Logger{f}, e
}
func (l *Logger) Logf(format string, args ...any) {
	if l != nil && l.file != nil {
		_, _ = fmt.Fprintf(l.file, "[%s] %s\n", time.Now().Format(time.RFC3339), fmt.Sprintf(format, args...))
		_ = l.file.Sync()
	}
}
func (l *Logger) Close() {
	if l != nil && l.file != nil {
		_ = l.file.Close()
	}
}
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, e := syscall.OpenProcess(0x1000, false, uint32(pid))
	if e != nil {
		return !errors.Is(e, syscall.Errno(87))
	}
	defer syscall.CloseHandle(h)
	var code uint32
	e = syscall.GetExitCodeProcess(h, &code)
	return e != nil || code == 259
}
func WaitForProcessExit(pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for processAlive(pid) {
		if time.Now().After(deadline) {
			return ErrProcessWaitTimeout
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil
}
func CopyFile(src, dst string) error {
	in, e := os.Open(src)
	if e != nil {
		return e
	}
	defer in.Close()
	out, e := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0755)
	if e != nil {
		return e
	}
	_, e = io.Copy(out, in)
	if e == nil {
		e = out.Sync()
	}
	ce := out.Close()
	if e != nil {
		return e
	}
	return ce
}
func savePhase(t *UpdateTask, p TransactionPhase, l *Logger) error {
	old := t.Phase
	t.Phase = p
	if e := WriteTaskFile(t.TaskFilePath, *t); e != nil {
		t.Phase = old
		return e
	}
	l.Logf("phase=%s", p)
	return nil
}

// lockTarget uses a kernel byte-range lock; OS releases it after updater crashes.
func lockTarget(target string) (func(), error) {
	f, e := os.OpenFile(target+".update-lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	var ov syscall.Overlapped
	r, _, callErr := syscall.NewLazyDLL("kernel32.dll").NewProc("LockFileEx").Call(f.Fd(), 3, 0, 1, 0, uintptr(unsafe.Pointer(&ov)))
	if r == 0 {
		f.Close()
		return nil, fmt.Errorf("another updater owns target: %w", callErr)
	}
	return func() { f.Close() }, nil
}

func RollbackToBackup(t *UpdateTask, l *Logger) error {
	if running, err := targetRunning(t.TargetExePath); err != nil {
		return err
	} else if running {
		return fmt.Errorf("target image still running; backup retained")
	}
	if t.ChildPID > 0 && processAlive(t.ChildPID) {
		return fmt.Errorf("refusing rollback while child %d is alive", t.ChildPID)
	}
	if e := savePhase(t, PhaseRollingBack, l); e != nil {
		return e
	}
	if t.BackupSHA != "" {
		if e := updater.VerifyFileSHA256(t.BackupPath, t.BackupSHA); e != nil {
			return e
		}
	}
	// Keep the verified backup until restoration itself is durably checkpointed.
	if e := CopyFile(t.BackupPath, t.TargetExePath); e != nil {
		return fmt.Errorf("%w: %v", ErrRollbackFailed, e)
	}
	if t.BackupSHA != "" {
		if e := updater.VerifyFileSHA256(t.TargetExePath, t.BackupSHA); e != nil {
			return e
		}
	}
	return savePhase(t, PhaseRolledBack, l)
}

func RecoverInterruptedTransaction(t *UpdateTask, l *Logger) error {
	if t.BackupPath == "" {
		t.BackupPath = t.TargetExePath + ".bak"
	}
	switch t.Phase {
	case PhaseCompleted:
		return osRemoveIfExists(t.BackupPath)
	case PhaseInit, PhaseBackingUp:
		// Before replacing intent the original entry was never modified, including
		// a crash after backup copy but before its completion checkpoint.
		if _, e := os.Stat(t.TargetExePath); e == nil {
			return savePhase(t, PhaseRolledBack, l)
		}
		if _, e := os.Stat(t.BackupPath); e != nil {
			return e
		}
		return RollbackToBackup(t, l)
	case PhaseBackedUp, PhaseReplacing, PhaseReplaced, PhaseLaunching, PhaseLaunched, PhaseRollingBack:
		// RollbackToBackup checks full target image paths even when launch
		// completed before its child PID could be checkpointed.
		if processAlive(t.ChildPID) {
			return fmt.Errorf("child still running; backup retained")
		}
		return RollbackToBackup(t, l)
	case PhaseRolledBack:
		if _, err := os.Stat(t.TargetExePath); os.IsNotExist(err) {
			return RollbackToBackup(t, l)
		} else {
			return err
		}
	default:
		return fmt.Errorf("unknown transaction phase %q", t.Phase)
	}
}
func osRemoveIfExists(path string) error {
	e := os.Remove(path)
	if os.IsNotExist(e) {
		return nil
	}
	return e
}

func launchRestoredApp(t *UpdateTask, l *Logger) {
	old := exec.Command(t.TargetExePath)
	old.Env = cleanStartupEnvironment()
	if err := old.Start(); err == nil {
		_ = old.Process.Release()
	} else {
		l.Logf("Restored old app but relaunch failed: %v", err)
	}
}

func ExecuteTransaction(t *UpdateTask, l *Logger) error {
	if l == nil {
		l = &Logger{}
	}
	unlock, e := lockTarget(t.TargetExePath)
	if e != nil {
		return e
	}
	defer unlock()
	if t.TaskFilePath == "" {
		t.TaskFilePath = updater.StableTaskPath(t.TargetExePath)
	}
	// Re-read under lock: a second updater must never execute a stale task.
	if disk, e := ReadTaskFile(t.TaskFilePath); e == nil {
		t = disk
	} else if !os.IsNotExist(e) {
		return e
	}
	if t.BackupPath == "" {
		t.BackupPath = t.TargetExePath + ".bak"
	}
	if t.Phase == PhaseInit {
		if _, err := os.Stat(t.BackupPath); err == nil {
			return RecoverInterruptedTransaction(t, l)
		}
		if _, err := os.Stat(t.TargetExePath); os.IsNotExist(err) {
			return RecoverInterruptedTransaction(t, l)
		}
	}
	if t.Phase != "" && t.Phase != PhaseInit {
		return RecoverInterruptedTransaction(t, l)
	}
	if e := WaitForProcessExit(t.TargetPID, 30*time.Second); e != nil {
		return e
	}
	if t.ExpectedSHA == "" {
		return fmt.Errorf("expected staged SHA256 is required")
	}
	if e := updater.VerifyFileSHA256(t.NewExePath, t.ExpectedSHA); e != nil {
		return e
	}
	if t.BackupPath == "" {
		t.BackupPath = t.TargetExePath + ".bak"
	}
	// Never overwrite evidence of a previous unfinished update.
	if _, e := os.Stat(t.BackupPath); e == nil {
		return fmt.Errorf("existing backup requires recovery")
	} else if !os.IsNotExist(e) {
		return e
	}
	t.BackupSHA, e = updater.CalculateFileSHA256(t.TargetExePath)
	if e != nil {
		return e
	}
	b := make([]byte, 32)
	if _, e = rand.Read(b); e != nil {
		return e
	}
	t.Token = hex.EncodeToString(b)
	if e = savePhase(t, PhaseBackingUp, l); e != nil {
		return e
	}
	if e = CopyFile(t.TargetExePath, t.BackupPath); e != nil {
		return e
	}
	if e = updater.VerifyFileSHA256(t.BackupPath, t.BackupSHA); e != nil {
		return e
	}
	if e = savePhase(t, PhaseBackedUp, l); e != nil {
		return e
	}
	if e = savePhase(t, PhaseReplacing, l); e != nil {
		return e
	}
	if e = CopyFile(t.NewExePath, t.TargetExePath); e != nil {
		_ = RollbackToBackup(t, l)
		return e
	}
	if e = updater.VerifyFileSHA256(t.TargetExePath, t.ExpectedSHA); e != nil {
		_ = RollbackToBackup(t, l)
		return e
	}
	if e = savePhase(t, PhaseReplaced, l); e != nil {
		return e
	}
	ack := t.TaskFilePath + ".ack"
	if e = osRemoveIfExists(ack); e != nil {
		return e
	}
	if e = savePhase(t, PhaseLaunching, l); e != nil {
		return e
	}
	cmd := exec.Command(t.TargetExePath)
	cmd.Env = append(cleanStartupEnvironment(), updater.StartupTaskEnv+"="+t.TaskFilePath, updater.StartupTokenEnv+"="+t.Token, updater.StartupAckEnv+"="+ack)
	if e = cmd.Start(); e != nil {
		if rollbackErr := RollbackToBackup(t, l); rollbackErr != nil {
			return fmt.Errorf("new app launch failed (%v); rollback failed: %w", e, rollbackErr)
		}
		launchRestoredApp(t, l)
		return fmt.Errorf("new app launch failed; previous version restored: %w", e)
	}
	t.ChildPID = cmd.Process.Pid
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	if e = savePhase(t, PhaseLaunched, l); e != nil {
		return e
	} // retain backup and running child
	timeout := time.Duration(t.ConfirmTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			if err := RollbackToBackup(t, l); err != nil {
				return fmt.Errorf("new app exited before readiness; rollback failed: %w", err)
			}
			launchRestoredApp(t, l)
			return fmt.Errorf("new app exited before readiness; previous version restored")
		case <-timer.C:
			return fmt.Errorf("new app readiness timed out; backup retained")
		case <-ticker.C:
			data, err := os.ReadFile(ack)
			if err != nil {
				continue
			}
			var c updater.StartupConfirmation
			if json.Unmarshal(data, &c) != nil || c.Task != t.TaskFilePath || c.Token != t.Token || c.PID != t.ChildPID {
				continue
			}
			if !processAlive(t.ChildPID) {
				return fmt.Errorf("confirmed child exited; backup retained")
			}
			if e = savePhase(t, PhaseCompleted, l); e != nil {
				return e
			}
			if e = osRemoveIfExists(t.BackupPath); e != nil {
				return e
			}
			_ = os.Remove(ack)
			return nil
		}
	}
}

// RecoverTaskFile serializes recovery against installers and other updaters.
func RecoverTaskFile(path string) error {
	t, e := ReadTaskFile(path)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	logger := &Logger{}
	if t.LogPath != "" {
		if opened, logErr := NewLogger(t.LogPath); logErr == nil {
			logger = opened
			defer opened.Close()
		}
	}
	unlock, e := lockTarget(t.TargetExePath)
	if e != nil {
		return e
	}
	defer unlock()
	t, e = ReadTaskFile(path)
	if e != nil {
		return e
	}
	e = RecoverInterruptedTransaction(t, logger)
	if e != nil {
		logger.Logf("recovery failed: %v", e)
	}
	return e
}

// RecoverDirectory scans fixed task paths in an actual application directory.
func RecoverDirectory(dir string) error {
	paths, e := filepath.Glob(filepath.Join(dir, "*.update-task.json"))
	if e != nil {
		return e
	}
	var result error
	for _, p := range paths {
		result = errors.Join(result, RecoverTaskFile(p))
	}
	return result
}
