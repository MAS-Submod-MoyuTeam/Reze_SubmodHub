//go:build !android

package main

import (
	"os"
	"path/filepath"
	"runtime"
)

const (
	isAndroidPlatform = false
	// A desktop build is either a Windows build or a macOS/Linux build; only the
	// former has a per-platform archive of its own.
	isWindowsBuild = runtime.GOOS == "windows"
)

type defaultStorageAccessProvider struct{}

func (d *defaultStorageAccessProvider) GetStorageAccess() (AndroidStorageAccessStatus, error) {
	return AndroidStorageAccessStatus{
		State:    "unsupported",
		Root:     "",
		GamePath: "",
	}, nil
}

func (d *defaultStorageAccessProvider) RequestStorageAccess() (AndroidStorageAccessRequestResult, error) {
	return AndroidStorageAccessRequestResult{
		Opened: false,
		Error:  "unsupported_platform",
	}, nil
}

func newPlatformStorageAccessProvider() StorageAccessProvider {
	return &defaultStorageAccessProvider{}
}

func getPlatformInternalConfigDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "SubmodHub"), nil
}

func getPlatformInternalCacheDir() (string, error) {
	return filepath.Join(os.TempDir(), "submodhub_client_stage"), nil
}

func newPlatformUpdateBridge() PlatformUpdateBridge {
	return &desktopUpdateBridge{}
}
