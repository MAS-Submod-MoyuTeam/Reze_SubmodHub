//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/reze/submodhub/internal/updater"
	winupdate "github.com/reze/submodhub/internal/updater/windows"
)

func TestMain(m *testing.M) {
	if os.Getenv("SUBMODHUB_UPDATER_CLI_HELPER") == "1" {
		main()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestRecoveryCLI(t *testing.T) {
	for _, mode := range []string{"no-args", "recover-scan", "recover-target", "explicit-init-task"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "app.exe")
			backup := target + ".old"
			taskPath := updater.StableTaskPath(target)
			if err := os.WriteFile(backup, []byte("original"), 0755); err != nil {
				t.Fatal(err)
			}
			task := winupdate.UpdateTask{Phase: winupdate.PhaseInit, TargetExePath: target, NewExePath: target + ".new", BackupPath: backup}
			if err := winupdate.WriteTaskFile(taskPath, task); err != nil {
				t.Fatal(err)
			}
			var args []string
			switch mode {
			case "recover-scan":
				args = []string{"--recover"}
			case "recover-target":
				args = []string{"--recover", "--target", target}
			case "explicit-init-task":
				args = []string{"--task", taskPath}
			}
			self, _ := os.Executable()
			cmd := exec.Command(self, args...)
			cmd.Env = append(os.Environ(), "SUBMODHUB_UPDATER_CLI_HELPER=1")
			cmd.Dir = dir
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("CLI recovery failed: %v %s", err, out)
			}
			data, err := os.ReadFile(target)
			if err != nil || string(data) != "original" {
				t.Fatalf("entry not recovered: %v %q", err, data)
			}
			saved, err := winupdate.ReadTaskFile(taskPath)
			if err != nil || saved.Phase != winupdate.PhaseRolledBack {
				t.Fatalf("recovery not committed: %v %+v", err, saved)
			}
		})
	}
}
