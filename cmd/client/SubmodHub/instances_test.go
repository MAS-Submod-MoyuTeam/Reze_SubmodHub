package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMASInstancesPersistAndSwitch(t *testing.T) {
	config := filepath.Join(t.TempDir(), "instances.json")
	first := makeMASFixture(t)
	second := makeMASFixture(t)
	s := &DesktopService{configPath: config}
	if _, err := s.AddMASInstance("First", first); err != nil {
		t.Fatal(err)
	}
	state, err := s.AddMASInstance("Second", second)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Instances) != 2 || state.ActiveID != state.Instances[1].ID {
		t.Fatalf("state=%+v", state)
	}
	if _, err := s.AddMASInstance("Duplicate", first); err == nil {
		t.Fatal("duplicate path accepted")
	}
	if _, err := s.SelectMASInstance(state.Instances[0].ID); err != nil {
		t.Fatal(err)
	}

	restarted := &DesktopService{configPath: config}
	loaded, err := restarted.ListMASInstances()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Instances) != 2 || loaded.ActiveID != state.Instances[0].ID || restarted.root != first {
		t.Fatalf("restored=%+v root=%q", loaded, restarted.root)
	}
	removed, err := restarted.RemoveMASInstance(loaded.ActiveID)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed.Instances) != 1 || removed.ActiveID != "" || restarted.root != "" {
		t.Fatalf("removed=%+v root=%q", removed, restarted.root)
	}
}

func TestMASInstancesRejectInvalidDirectory(t *testing.T) {
	s := &DesktopService{configPath: filepath.Join(t.TempDir(), "instances.json")}
	if _, err := s.AddMASInstance("Invalid", t.TempDir()); err == nil {
		t.Fatal("directory without game accepted")
	}
	if len(s.instances) != 0 {
		t.Fatalf("invalid directory was saved: %+v", s.instances)
	}
}

func makeMASFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}
