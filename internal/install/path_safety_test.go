package install

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPathSafety_RejectsAbsoluteAndTraversals(t *testing.T) {
	root := t.TempDir()

	invalids := []string{
		"",
		"/",
		"/etc/passwd",
		"/storage/emulated/0/other",
		"../escape.rpy",
		"game/../../escape.rpy",
		"game/Submods/../../../escape.rpy",
		`\\server\share\file.rpy`,
		`//server/share/file.rpy`,
		"game:stream:$DATA",
	}

	for _, p := range invalids {
		t.Run("invalid_"+p, func(t *testing.T) {
			_, err := SafeJoinAndValidateBounds(root, p)
			if err == nil {
				t.Fatalf("expected path %q to be rejected, but got nil error", p)
			}
		})
	}
}

func TestPathSafety_ValidSubpaths(t *testing.T) {
	root := t.TempDir()
	valids := []string{
		"game/Submods/MyMod/script.rpy",
		"game/mod_assets/image.png",
		"game/Submods/AnotherMod/nested/file.txt",
	}

	for _, p := range valids {
		target, err := SafeJoinAndValidateBounds(root, p)
		if err != nil {
			t.Fatalf("expected path %q to be valid, got err: %v", p, err)
		}
		expected := filepath.Join(root, filepath.FromSlash(p))
		if target != expected {
			t.Fatalf("expected target %q, got %q", expected, target)
		}
	}
}

func TestPathSafety_SymlinkEscapeDetected(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()

	secretFile := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secretFile, []byte("classified"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Create symlink inside root pointing outside
	symlinkPath := filepath.Join(root, "game", "Submods", "escape_link")
	if err := os.MkdirAll(filepath.Dir(symlinkPath), 0o755); err != nil {
		t.Fatal(err)
	}

	err := os.Symlink(outside, symlinkPath)
	if err != nil {
		// On Windows without Developer Mode, creating symlink might fail due to privilege.
		t.Skip("Symlinks not supported in current environment, skipping symlink test:", err)
		return
	}

	// Now try to resolve a file inside that symlinked directory
	_, err = SafeJoinAndValidateBounds(root, "game/Submods/escape_link/secret.txt")
	if err == nil {
		t.Fatal("expected symlink escape to be rejected, got nil")
	}
	if !strings.Contains(err.Error(), "symlink_target_out_of_bounds") {
		t.Fatalf("expected symlink_target_out_of_bounds error, got: %v", err)
	}
}
