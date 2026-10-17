package install

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// SafeJoinAndValidateBounds verifies that relPath is a safe canonical relative path,
// computes its disk path under root, and ensures neither the path nor any symlink resolves outside root.
func SafeJoinAndValidateBounds(root, relPath string) (string, error) {
	if root == "" {
		return "", &Error{Code: "invalid_path", Path: relPath, Err: errors.New("empty root")}
	}
	displayPath, _, err := CanonicalPath(relPath, "")
	if err != nil {
		return "", err
	}

	diskPath := filepath.Join(root, filepath.FromSlash(displayPath))

	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		realRoot = filepath.Clean(root)
	}

	// Check ancestors and current path for symlinks pointing outside root
	curr := diskPath
	for curr != root && curr != realRoot && curr != "." && curr != string(filepath.Separator) {
		if info, statErr := os.Lstat(curr); statErr == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				realTarget, evalErr := filepath.EvalSymlinks(curr)
				if evalErr == nil {
					relToRoot, relErr := filepath.Rel(realRoot, realTarget)
					if relErr != nil || strings.HasPrefix(relToRoot, "..") || filepath.IsAbs(relToRoot) {
						return "", &Error{
							Code: "symlink_target_out_of_bounds",
							Path: displayPath,
							Err:  fmt.Errorf("symlink_target_out_of_bounds: %s points outside root", displayPath),
						}
					}
				}
			}
		}
		parent := filepath.Dir(curr)
		if parent == curr {
			break
		}
		curr = parent
	}

	// If the file itself exists, check full evaluated path
	if realTarget, err := filepath.EvalSymlinks(diskPath); err == nil {
		relToRoot, relErr := filepath.Rel(realRoot, realTarget)
		if relErr != nil || strings.HasPrefix(relToRoot, "..") || filepath.IsAbs(relToRoot) {
			return "", &Error{
				Code: "symlink_target_out_of_bounds",
				Path: displayPath,
				Err:  fmt.Errorf("symlink_target_out_of_bounds: %s points outside root", displayPath),
			}
		}
	}

	return diskPath, nil
}
