//go:build !android

package main

import (
	"os"
	"path/filepath"
)

const isAndroidPlatform = false

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
