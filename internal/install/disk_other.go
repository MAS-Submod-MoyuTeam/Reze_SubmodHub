//go:build !windows

package install

import (
	"syscall"
)

// GetDiskSpace returns the bytes available to the current user and the total
// capacity of the volume hosting path. If the path cannot be queried, it
// returns an error.
func GetDiskSpace(path string) (available uint64, total uint64, err error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), stat.Blocks * uint64(stat.Bsize), nil
}
