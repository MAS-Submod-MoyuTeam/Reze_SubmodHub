//go:build !windows

package install

import (
	"syscall"
)

// GetAvailableDiskSpace returns the free bytes available on the volume hosting path.
// If the path cannot be queried, it returns an error.
func GetAvailableDiskSpace(path string) (uint64, error) {
	var stat syscall.Statfs_t
	err := syscall.Statfs(path, &stat)
	if err != nil {
		return 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), nil
}
