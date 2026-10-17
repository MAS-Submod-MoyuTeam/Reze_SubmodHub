package maspath

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// AndroidMASRoot is the expected MAS installation root, not an access grant.
const AndroidMASRoot = "/storage/emulated/0/MAS/"

var (
	ErrInvalidAndroidRoot  = errors.New("invalid_mas_root")
	ErrMASGameDirMissing   = errors.New("mas_game_directory_missing")
)

func AndroidGameDirectory() string {
	return strings.TrimRight(AndroidMASRoot, "/") + "/game"
}

// ValidateAndroidMASRoot validates that root strictly matches the fixed Android MAS root path.
// It normalizes forward slashes and trailing slashes.
func ValidateAndroidMASRoot(root string) error {
	trimmed := strings.TrimSpace(root)
	if trimmed == "" {
		return ErrInvalidAndroidRoot
	}
	clean := path.Clean(strings.ReplaceAll(trimmed, "\\", "/"))
	expectedClean := path.Clean(strings.TrimRight(AndroidMASRoot, "/"))
	if clean != expectedClean {
		return ErrInvalidAndroidRoot
	}
	return nil
}

// VerifyAndroidGameDirectory checks that the root contains a valid 'game' directory.
func VerifyAndroidGameDirectory(root string) error {
	if root == "" {
		return ErrInvalidAndroidRoot
	}
	gamePath := filepath.Join(root, "game")
	info, err := os.Stat(gamePath)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrMASGameDirMissing
		}
		return err
	}
	if !info.IsDir() {
		return ErrMASGameDirMissing
	}
	return nil
}
