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

func TestInstallerHelperStartFailureCanRetry(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	staged := filepath.Join(dir, "new.exe")
	helper := filepath.Join(dir, "updater.exe")
	for path, data := range map[string]string{target: "original", staged: "new version", helper: "not a PE executable"} {
		if err := os.WriteFile(path, []byte(data), 0755); err != nil {
			t.Fatal(err)
		}
	}
	installer := NewWindowsInstaller(helper)
	var previousToken string
	for attempt := 0; attempt < 2; attempt++ {
		err := installer.Install(context.Background(), staged, target)
		if err == nil || !strings.Contains(err.Error(), "failed to start updater process") {
			t.Fatalf("attempt %d did not reach helper startup: %v", attempt, err)
		}
		task, e := ReadTaskFile(updater.StableTaskPath(target))
		if e != nil {
			t.Fatal(e)
		}
		if task.Phase != PhaseRolledBack {
			t.Fatalf("attempt %d left task unfinished: %s", attempt, task.Phase)
		}
		if task.Token == "" || task.Token == previousToken {
			t.Fatal("retry did not publish distinct task identity")
		}
		previousToken = task.Token
		data, e := os.ReadFile(target)
		if e != nil || string(data) != "original" {
			t.Fatalf("original target changed: %v %q", e, data)
		}
		if _, e := os.Stat(task.BackupPath); !os.IsNotExist(e) {
			t.Fatalf("unstarted helper created backup: %v", e)
		}
	}
}
