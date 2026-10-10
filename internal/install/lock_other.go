//go:build !windows

package install

import (
	"errors"
	"os"
	"syscall"
)

var errLockBusy = errors.New("lock busy")

func lockOSFile(f *os.File) error {
	err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err != nil {
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return errLockBusy
		}
		return err
	}
	return nil
}

func unlockOSFile(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}