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

func TestAndroidInstanceLockPathStability(t *testing.T) {
	internalDir := t.TempDir()

	p1 := AndroidInstanceLockPath(internalDir, "/storage/emulated/0/MAS")
	p2 := AndroidInstanceLockPath(internalDir, "/storage/emulated/0/MAS/")
	p3 := AndroidInstanceLockPath(internalDir, "\\storage\\emulated\\0\\MAS\\")

	if p1 != p2 || p1 != p3 {
		t.Fatalf("expected lock paths to be strictly equal, got: p1=%q, p2=%q, p3=%q", p1, p2, p3)
	}

	expectedPrefix := filepath.Join(internalDir, "locks")
	if !filepath.HasPrefix(p1, expectedPrefix) {
		t.Fatalf("expected path %q to have prefix %q", p1, expectedPrefix)
	}

	pOther := AndroidInstanceLockPath(internalDir, "/storage/emulated/0/MAS_TEST")
	if p1 == pOther {
		t.Fatalf("expected different lock paths for different roots, got same: %q", p1)
	}

	// Test default internalDir fallback
	pDefault := AndroidInstanceLockPath("", "/storage/emulated/0/MAS")
	if !filepath.HasPrefix(pDefault, filepath.Clean("/data/data/com.reze.submodhub/files/locks")) {
		t.Fatalf("expected default internalDir fallback, got: %q", pDefault)
	}
}

