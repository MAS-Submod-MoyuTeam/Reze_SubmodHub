package maspath

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAndroidMASRootIsFixedGameRoot(t *testing.T) {
	if AndroidMASRoot != "/storage/emulated/0/MAS/" {
		t.Fatalf("root = %q", AndroidMASRoot)
	}
	if AndroidGameDirectory() != "/storage/emulated/0/MAS/game" {
		t.Fatalf("game = %q", AndroidGameDirectory())
	}
}

func TestValidateAndroidMASRoot(t *testing.T) {
	validRoots := []string{
		"/storage/emulated/0/MAS",
		"/storage/emulated/0/MAS/",
		"/storage/emulated/0/MAS///",
	}
	for _, root := range validRoots {
		if err := ValidateAndroidMASRoot(root); err != nil {
			t.Errorf("expected valid root for %q, got err: %v", root, err)
		}
	}

	invalidRoots := []string{
		"",
		"MAS",
		"../MAS",
		"/sdcard/MAS",
		"/storage/emulated/0",
		"/storage/emulated/0/Download",
		"/storage/emulated/0/MAS/other",
		"/data/data/com.reze.submodhub",
		"/etc/passwd",
	}
	for _, root := range invalidRoots {
		if err := ValidateAndroidMASRoot(root); err == nil {
			t.Errorf("expected invalid root for %q, but got nil", root)
		}
	}
}

func TestVerifyAndroidMASInstallation(t *testing.T) {
	temp := t.TempDir()
	// Test game missing
	if err := VerifyAndroidGameDirectory(temp); err == nil {
		t.Fatal("expected error when game directory missing, got nil")
	}

	// Create game directory
	gameDir := filepath.Join(temp, "game")
	if err := os.Mkdir(gameDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := VerifyAndroidGameDirectory(temp); err != nil {
		t.Fatalf("expected valid when game directory exists, got: %v", err)
	}
}

