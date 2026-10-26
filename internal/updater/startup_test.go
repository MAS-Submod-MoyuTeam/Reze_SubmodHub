package updater

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0755); err != nil {
		t.Fatal(err)
	}
}

// A recorded updater wins while it still exists: it is the helper that the
// transaction was published with.
func TestResolveUpdaterPathPrefersRecorded(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	recorded := filepath.Join(dir, "staging", "updater.exe")
	writeTestFile(t, target, "app")
	writeTestFile(t, recorded, "recorded")
	writeTestFile(t, StableUpdaterPath(target), "durable")
	writeTestFile(t, filepath.Join(dir, "updater.exe"), "adjacent")

	got, err := ResolveUpdaterPath(recorded, target)
	if err != nil {
		t.Fatal(err)
	}
	if got != recorded {
		t.Fatalf("resolved %q, want recorded %q", got, recorded)
	}
}

// Losing the disposable staging directory must not make recovery impossible.
func TestResolveUpdaterPathFallsBackToDurableCopy(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	writeTestFile(t, target, "app")
	durable := StableUpdaterPath(target)
	writeTestFile(t, durable, "durable")

	got, err := ResolveUpdaterPath(filepath.Join(dir, "gone", "updater.exe"), target)
	if err != nil {
		t.Fatal(err)
	}
	if got != durable {
		t.Fatalf("resolved %q, want durable %q", got, durable)
	}
}

func TestResolveUpdaterPathFallsBackToAdjacentUpdater(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	writeTestFile(t, target, "app")
	adjacent := filepath.Join(dir, "updater.exe")
	writeTestFile(t, adjacent, "adjacent")

	got, err := ResolveUpdaterPath("", target)
	if err != nil {
		t.Fatal(err)
	}
	if got != adjacent {
		t.Fatalf("resolved %q, want adjacent %q", got, adjacent)
	}
}

// A directory named like the helper is not a usable updater.
func TestResolveUpdaterPathRejectsDirectory(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	writeTestFile(t, target, "app")
	if err := os.MkdirAll(StableUpdaterPath(target), 0700); err != nil {
		t.Fatal(err)
	}

	if got, err := ResolveUpdaterPath("", target); err == nil {
		t.Fatalf("resolved %q, want an error", got)
	}
}

func TestResolveUpdaterPathReportsActionableGuidance(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	writeTestFile(t, target, "app")

	got, err := ResolveUpdaterPath(filepath.Join(dir, "gone.exe"), target)
	if err == nil {
		t.Fatalf("resolved %q without any updater", got)
	}
	for _, want := range []string{"no independent updater", "gone.exe", StableUpdaterPath(target), "--recover", target} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q does not mention %q", err, want)
		}
	}
}

// Recovery must fail loudly, before spawning anything, when no helper exists.
func TestRecoverTargetStartupWithoutUpdaterReportsGuidance(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	writeTestFile(t, target, "app")
	taskPath := StableTaskPath(target)
	task := map[string]any{
		"schema_version":   1,
		"phase":            "replacing",
		"target_exe_path":  target,
		"new_exe_path":     target + ".new",
		"backup_path":      target + ".old",
		"updater_exe_path": filepath.Join(dir, "gone", "updater.exe"),
	}
	data, err := json.Marshal(task)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, taskPath, string(data))

	err = RecoverTargetStartup(target, "")
	if err == nil {
		t.Fatal("recovery without an updater reported success")
	}
	if !strings.Contains(err.Error(), "no independent updater") {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, statErr := os.Stat(taskPath); statErr != nil {
		t.Fatalf("recovery removed the task it could not handle: %v", statErr)
	}
}
