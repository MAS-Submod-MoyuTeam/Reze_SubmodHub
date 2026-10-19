//go:build windows

package winupdate

import (
	"github.com/reze/submodhub/internal/updater"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if mode := os.Getenv("SUBMODHUB_TEST_APP"); mode != "" {
		if mode != "lock" && len(os.Args) != 1 {
			os.Exit(10)
		}
		if mode == "restarted" {
			if os.Getenv(updater.StartupTaskEnv) != "" || os.Getenv(updater.StartupTokenEnv) != "" || os.Getenv(updater.StartupAckEnv) != "" {
				os.Exit(11)
			}
			if err := os.WriteFile(os.Args[0]+".restarted", []byte("old app started"), 0600); err != nil {
				os.Exit(12)
			}
			os.Exit(0)
		}
		if mode == "lock" {
			unlock, err := lockTarget(os.Getenv("SUBMODHUB_TEST_TARGET"))
			if err != nil {
				os.Exit(7)
			}
			unlock()
			os.Exit(0)
		}
		if mode == "wrong-token" {
			_ = os.Setenv(updater.StartupTokenEnv, "another-task-token")
		}
		if mode == "fail-commit" {
			deadline := time.Now().Add(3 * time.Second)
			for {
				state, err := ReadTaskFile(os.Getenv(updater.StartupTaskEnv))
				if err == nil && state.Phase == PhaseLaunched {
					break
				}
				if time.Now().After(deadline) {
					os.Exit(8)
				}
				time.Sleep(10 * time.Millisecond)
			}
			// Windows denies replacing an open file without FILE_SHARE_DELETE.
			f, err := os.Open(os.Getenv(updater.StartupTaskEnv))
			if err != nil {
				os.Exit(8)
			}
			defer f.Close()
		}
		if mode == "confirm" || mode == "wrong-token" || mode == "fail-commit" {
			if err := updater.ConfirmStartup(); err != nil {
				os.Exit(9)
			}
		}
		if mode == "exit" {
			os.Exit(0)
		}
		time.Sleep(10 * time.Second)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestProcessCreationFailureRestartsOldApplication(t *testing.T) {
	t.Setenv("SUBMODHUB_TEST_APP", "restarted")
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	staged := filepath.Join(dir, "invalid.exe")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := CopyFile(self, target); err != nil {
		t.Fatal(err)
	}
	oldSHA, err := updater.CalculateFileSHA256(target)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(staged, []byte("invalid PE executable"), 0755); err != nil {
		t.Fatal(err)
	}
	sha, _ := updater.CalculateFileSHA256(staged)
	task := &UpdateTask{Phase: PhaseInit, TargetExePath: target, NewExePath: staged, ExpectedSHA: sha, TaskFilePath: updater.StableTaskPath(target)}
	if err := ExecuteTransaction(task, nil); err == nil {
		t.Fatal("invalid executable accepted")
	}
	if err := updater.VerifyFileSHA256(target, oldSHA); err != nil {
		t.Fatalf("old executable not restored: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := os.Stat(target + ".restarted"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("restored executable was not restarted")
		}
		time.Sleep(20 * time.Millisecond)
	}
	disk, err := ReadTaskFile(task.TaskFilePath)
	if err != nil || disk.Phase != PhaseRolledBack {
		t.Fatalf("rollback not checkpointed: %+v %v", disk, err)
	}
}

func TestRealAppConfirmation(t *testing.T) {
	for _, mode := range []string{"confirm", "exit", "silent", "wrong-token", "fail-commit"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("SUBMODHUB_TEST_APP", mode)
			dir := t.TempDir()
			target := filepath.Join(dir, "app.exe")
			staged := filepath.Join(dir, "new.exe")
			if err := os.WriteFile(target, []byte("original"), 0755); err != nil {
				t.Fatal(err)
			}
			self, _ := os.Executable()
			if err := CopyFile(self, staged); err != nil {
				t.Fatal(err)
			}
			sha, _ := updater.CalculateFileSHA256(staged)
			task := &UpdateTask{TargetExePath: target, NewExePath: staged, ExpectedSHA: sha, TaskFilePath: updater.StableTaskPath(target), ConfirmTimeoutSeconds: 1}
			err := ExecuteTransaction(task, nil)
			disk, e := ReadTaskFile(task.TaskFilePath)
			if e != nil {
				t.Fatal(e)
			}
			if mode == "silent" {
				running, err := targetRunning(target)
				if err != nil || !running {
					t.Fatalf("running image not found: %v", err)
				}
				if running, err := targetRunning(filepath.Join(dir, "other", "app.exe")); err != nil || running {
					t.Fatalf("same filename incorrectly matched another path: %v", err)
				}
				if err := RecoverTaskFile(task.TaskFilePath); err == nil {
					t.Fatal("recovered over live app")
				}
			}
			if disk.ChildPID > 0 {
				p, _ := os.FindProcess(disk.ChildPID)
				_ = p.Kill()
				_ = WaitForProcessExit(disk.ChildPID, 3*time.Second)
			}
			if mode == "confirm" {
				if err != nil || disk.Phase != PhaseCompleted {
					t.Fatalf("confirmation did not complete: %v %+v", err, disk)
				}
				if _, e := os.Stat(disk.BackupPath); !os.IsNotExist(e) {
					t.Fatalf("backup not cleaned: %v", e)
				}
			} else {
				if err == nil {
					t.Fatal("unconfirmed launch accepted")
				}
				if _, e := os.Stat(disk.BackupPath); e != nil {
					t.Fatalf("backup lost: %v", e)
				}
				if e := RecoverTaskFile(disk.TaskFilePath); e != nil {
					t.Fatal(e)
				}
				data, _ := os.ReadFile(target)
				if string(data) != "original" {
					t.Fatal("original not restored")
				}
			}
		})
	}
}

func TestRecoveryCheckpoints(t *testing.T) {
	for _, phase := range []TransactionPhase{PhaseInit, PhaseBackingUp, PhaseBackedUp, PhaseReplacing, PhaseReplaced, PhaseLaunching, PhaseLaunched, PhaseRollingBack, PhaseRolledBack} {
		t.Run(string(phase), func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "app.exe")
			backup := target + ".bak"
			os.WriteFile(backup, []byte("old"), 0755)
			// Init can be interrupted immediately after creating a complete backup.
			if phase != PhaseInit && phase != PhaseRolledBack {
				os.WriteFile(target, []byte("new"), 0755)
			}
			task := UpdateTask{Phase: phase, TargetExePath: target, NewExePath: target + ".new", BackupPath: backup, TaskFilePath: updater.StableTaskPath(target)}
			if e := WriteTaskFile(task.TaskFilePath, task); e != nil {
				t.Fatal(e)
			}
			if e := RecoverTaskFile(task.TaskFilePath); e != nil {
				t.Fatal(e)
			}
			data, e := os.ReadFile(target)
			if e != nil {
				t.Fatal(e)
			}
			want := "old"
			if phase == PhaseBackingUp {
				want = "new"
			}
			if string(data) != want {
				t.Fatalf("got %q want %q", data, want)
			}
		})
	}
}

func TestTargetLock(t *testing.T) {
	target := filepath.Join(t.TempDir(), "app.exe")
	unlock, e := lockTarget(target)
	if e != nil {
		t.Fatal(e)
	}
	defer unlock()
	self, _ := os.Executable()
	cmd := exec.Command(self)
	cmd.Env = append(os.Environ(), "SUBMODHUB_TEST_APP=lock", "SUBMODHUB_TEST_TARGET="+target)
	if err := cmd.Run(); err == nil {
		t.Fatal("another process acquired target lock")
	}
	if other, e := lockTarget(target); e == nil {
		other()
		t.Fatal("competing updater acquired target")
	}
}
