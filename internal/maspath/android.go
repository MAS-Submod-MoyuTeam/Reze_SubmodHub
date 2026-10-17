package maspath

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// AndroidMASRoot is the expected MAS installation root, not an access grant.
const AndroidMASRoot = "/storage/emulated/0/MAS/"

var (
	ErrInvalidAndroidRoot = errors.New("invalid_mas_root")
	ErrMASGameDirMissing  = errors.New("mas_game_directory_missing")
)

func AndroidGameDirectory() string {
	return strings.TrimRight(AndroidMASRoot, "/") + "/game"
}

// AndroidInstanceLockPath returns a stable lock file path in the app internal storage
// mapped to the given MAS root. Shared storage (FUSE) does not implement flock (ENOSYS),
// so lock files for MAS instances on Android must reside in internal app storage.
func AndroidInstanceLockPath(internalFilesDir, masRoot string) string {
	base := strings.TrimSpace(internalFilesDir)
	if base == "" {
		base = "/data/data/com.reze.submodhub/files"
	}
	clean := path.Clean(strings.ReplaceAll(strings.TrimSpace(masRoot), "\\", "/"))
	sum := sha256.Sum256([]byte(clean))
	return filepath.Join(base, "locks", "mas_"+hex.EncodeToString(sum[:16])+".lock")
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
