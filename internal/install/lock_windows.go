//go:build windows

package install

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

var (
	modkernel32      = syscall.NewLazyDLL("kernel32.dll")
	procLockFileEx   = modkernel32.NewProc("LockFileEx")
	procUnlockFileEx = modkernel32.NewProc("UnlockFileEx")
)

const (
	lockfileExclusiveLock   = 0x00000002
	lockfileFailImmediately = 0x00000001
	errorLockViolation      = 33
	lockOffset              = 0x7FFFFFFE
)

var errLockBusy = errors.New("lock busy")

func lockOSFile(f *os.File) error {
	var ov syscall.Overlapped
	ov.Offset = lockOffset
	r1, _, err := procLockFileEx.Call(
		f.Fd(),
		uintptr(lockfileExclusiveLock|lockfileFailImmediately),
		0,
		1, 0,
		uintptr(unsafe.Pointer(&ov)),
	)
	if r1 == 0 {
		if errno, ok := err.(syscall.Errno); ok && errno == errorLockViolation {
			return errLockBusy
		}
		return err
	}
	return nil
}

func unlockOSFile(f *os.File) error {
	var ov syscall.Overlapped
	ov.Offset = lockOffset
	r1, _, err := procUnlockFileEx.Call(
		f.Fd(),
		0,
		1, 0,
		uintptr(unsafe.Pointer(&ov)),
	)
	if r1 == 0 {
		return err
	}
	return nil
}