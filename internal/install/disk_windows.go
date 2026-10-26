//go:build windows

package install

import (
	"syscall"
	"unsafe"
)

var (
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	procGetDiskFreeSpace = kernel32.NewProc("GetDiskFreeSpaceExW")
)

// GetDiskSpace returns the bytes available to the current user and the total
// capacity of the volume hosting path. If the path cannot be queried, it
// returns an error.
func GetDiskSpace(path string) (available uint64, total uint64, err error) {
	ptr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, err
	}
	var freeBytesAvailable uint64
	var totalBytes uint64
	var totalFreeBytes uint64

	r1, _, callErr := procGetDiskFreeSpace.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	if r1 == 0 {
		return 0, 0, callErr
	}
	return freeBytesAvailable, totalBytes, nil
}
