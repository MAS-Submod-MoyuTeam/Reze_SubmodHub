//go:build windows

package winupdate

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

// targetRunning checks full image paths, rather than trusting a missing/stale
// child PID. An inaccessible matching process is ambiguous and fails closed.
func targetRunning(target string) (bool, error) {
	target, err := filepath.Abs(target)
	if err != nil {
		return false, err
	}
	kernel := syscall.NewLazyDLL("kernel32.dll")
	snapshot, _, callErr := kernel.NewProc("CreateToolhelp32Snapshot").Call(2, 0)
	if snapshot == ^uintptr(0) {
		return false, callErr
	}
	defer syscall.CloseHandle(syscall.Handle(snapshot))
	type processEntry struct {
		Size, Usage, PID             uint32
		Heap                         uintptr
		ModuleID, Threads, ParentPID uint32
		Priority                     int32
		Flags                        uint32
		Exe                          [260]uint16
	}
	var entry processEntry
	entry.Size = uint32(unsafe.Sizeof(entry))
	first := kernel.NewProc("Process32FirstW")
	next := kernel.NewProc("Process32NextW")
	result, _, callErr := first.Call(snapshot, uintptr(unsafe.Pointer(&entry)))
	for result != 0 {
		if strings.EqualFold(syscall.UTF16ToString(entry.Exe[:]), filepath.Base(target)) {
			h, e := syscall.OpenProcess(0x1000, false, entry.PID)
			if e != nil {
				if processAlive(int(entry.PID)) {
					return false, fmt.Errorf("cannot inspect potential target PID %d: %w", entry.PID, e)
				}
			} else {
				buf := make([]uint16, 32768)
				size := uint32(len(buf))
				ok, _, queryErr := kernel.NewProc("QueryFullProcessImageNameW").Call(uintptr(h), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
				syscall.CloseHandle(h)
				if ok == 0 {
					if processAlive(int(entry.PID)) {
						return false, queryErr
					}
				} else if strings.EqualFold(filepath.Clean(syscall.UTF16ToString(buf[:size])), filepath.Clean(target)) {
					return true, nil
				}
			}
		}
		result, _, callErr = next.Call(snapshot, uintptr(unsafe.Pointer(&entry)))
	}
	if !errors.Is(callErr, syscall.Errno(18)) {
		return false, callErr
	}
	return false, nil
}
