package install

import (
	"os"
	"path/filepath"
	"testing"
)

func TestApplyAndUninstallRestoresExternalFile(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	target := filepath.Join(root, "game", "Submods", "demo.rpy")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("external"), 0o644); err != nil {
		t.Fatal(err)
	}
	i := New(root, state)
	if err := i.Apply(Operation{ID: "op1", Changes: []Change{{Path: "game/Submods/demo.rpy", Content: []byte("managed"), ExpectedSHA256: hashBytes([]byte("external"))}}}); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "managed" {
		t.Fatalf("got %q", got)
	}
	if err := i.Uninstall("op1", "op2"); err != nil {
		t.Fatal(err)
	}
	got, _ = os.ReadFile(target)
	if string(got) != "external" {
		t.Fatalf("restored %q", got)
	}
}

func TestApplyStopsOnExternalChange(t *testing.T) {
	root := t.TempDir()
	i := New(root, filepath.Join(t.TempDir(), "state"))
	path := filepath.Join(root, "game", "x.txt")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte("manual"), 0o644)
	err := i.Apply(Operation{ID: "op", Changes: []Change{{Path: "game/x.txt", Content: []byte("new"), ExpectedSHA256: hashBytes([]byte("wrong"))}}})
	if err == nil || !IsCode(err, "external_change") {
		t.Fatalf("err=%v", err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "manual" {
		t.Fatalf("changed %q", got)
	}
}

func TestJournalKeepsPathsWithoutFilePayload(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	content := make([]byte, 1024*1024)
	for index := range content {
		content[index] = byte(index % 251)
	}
	installer := New(root, state)
	if err := installer.Apply(Operation{ID: "large", Changes: []Change{{Path: "game/Submods/large.bin", Content: content}}}); err != nil {
		t.Fatal(err)
	}
	journal, err := installer.LoadJournal("large")
	if err != nil {
		t.Fatal(err)
	}
	if len(journal.Operation.Changes) != 1 || journal.Operation.Changes[0].Path != "game/Submods/large.bin" || len(journal.Operation.Changes[0].Content) != 0 {
		t.Fatalf("journal retained %d payload bytes", len(journal.Operation.Changes[0].Content))
	}
	info, err := os.Stat(filepath.Join(state, "large.json"))
	if err != nil || info.Size() > 4096 {
		t.Fatalf("journal size=%v err=%v", info, err)
	}
	if err := installer.Uninstall("large", "remove_large"); err != nil {
		t.Fatal(err)
	}
}

func TestLoadJournalAndRecoverRestoresBackup(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	p := filepath.Join(root, "game", "recover.txt")
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	_ = os.WriteFile(p, []byte("before"), 0o644)
	i := New(root, state)
	if err := i.Apply(Operation{ID: "recovery", Changes: []Change{{Path: "game/recover.txt", Content: []byte("after"), ExpectedSHA256: hashBytes([]byte("before"))}}}); err != nil {
		t.Fatal(err)
	}
	j, err := i.LoadJournal("recovery")
	if err != nil {
		t.Fatal(err)
	}
	if j.State != "committed" || len(j.Backups) != 1 {
		t.Fatalf("journal=%+v", j)
	}
	j.State = "writing"
	if err := i.writeJournal(j); err != nil {
		t.Fatal(err)
	}
	if err := i.Recover("recovery"); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != "before" {
		t.Fatalf("recovered %q", got)
	}
	final, _ := i.LoadJournal("recovery")
	if final.State != "rolled_back" {
		t.Fatalf("state=%s", final.State)
	}
}

func TestUninstallCommittedOperation(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	old := filepath.Join(root, "game", "old.txt")
	_ = os.MkdirAll(filepath.Dir(old), 0o755)
	_ = os.WriteFile(old, []byte("before"), 0o644)
	i := New(root, state)
	if err := i.Apply(Operation{ID: "install", Changes: []Change{
		{Path: "game/old.txt", Content: []byte("after"), ExpectedSHA256: hashBytes([]byte("before"))},
		{Path: "game/new.txt", Content: []byte("new")},
	}}); err != nil {
		t.Fatal(err)
	}
	if err := i.Uninstall("install", "install_uninstall"); err != nil {
		t.Fatal(err)
	}
	// Overwritten game original file MUST be restored to "before"
	got, err := os.ReadFile(old)
	if err != nil || string(got) != "before" {
		t.Fatalf("old file was not restored to before: got %q err=%v", got, err)
	}
	// New file (added by mod) must be deleted
	if _, err := os.Stat(filepath.Join(root, "game", "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("new file still exists: %v", err)
	}
}

func TestUninstallRestoresPreviousFileInsteadOfDeleting(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	p := filepath.Join(root, "game", "old.txt")
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	_ = os.WriteFile(p, []byte("before"), 0o644)
	i := New(root, state)
	if err := i.Apply(Operation{ID: "install", Changes: []Change{{Path: "game/old.txt", Content: []byte("after"), ExpectedSHA256: hashBytes([]byte("before"))}}}); err != nil {
		t.Fatal(err)
	}
	if err := i.Uninstall("install", "uninstall"); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(p)
	if err != nil || string(got) != "before" {
		t.Fatalf("file was not restored to before: got %q, err=%v", got, err)
	}
}

func TestUninstallBlocksOnDriftedFile(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	p := filepath.Join(root, "game", "drift.txt")
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	_ = os.WriteFile(p, []byte("before"), 0o644)
	i := New(root, state)
	if err := i.Apply(Operation{ID: "install-drift", Changes: []Change{{Path: "game/drift.txt", Content: []byte("managed"), ExpectedSHA256: hashBytes([]byte("before"))}}}); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(p, []byte("user change"), 0o644)
	err := i.Uninstall("install-drift", "uninstall-drift")
	if err == nil || (!IsCode(err, "external_change") && !IsCode(err, "plan_blocked")) {
		t.Fatalf("expected drift to be blocked, got %v", err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != "user change" {
		t.Fatalf("expected user change preserved, got %q", got)
	}
}
