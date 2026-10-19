//go:build android && !cgo

package main

import "context"

const isAndroidPlatform = true

type androidStorageAccessProvider struct{}

func (a *androidStorageAccessProvider) GetStorageAccess() (AndroidStorageAccessStatus, error) {
	return defaultAndroidStorageStatus(), nil
}

func (a *androidStorageAccessProvider) RequestStorageAccess() (AndroidStorageAccessRequestResult, error) {
	return AndroidStorageAccessRequestResult{
		Opened: false,
		Error:  "cgo_disabled",
	}, nil
}

func newPlatformStorageAccessProvider() StorageAccessProvider {
	return &androidStorageAccessProvider{}
}

func getPlatformInternalConfigDir() (string, error) {
	return "/data/data/com.reze.submodhub/files", nil
}

func getPlatformInternalCacheDir() (string, error) {
	return "/data/data/com.reze.submodhub/cache", nil
}

type androidUpdateBridge struct{}

func (a *androidUpdateBridge) CanInstallDirectly() bool {
	return false
}

func (a *androidUpdateBridge) CanRequestPackageInstalls() (bool, error) {
	return false, nil
}

func (a *androidUpdateBridge) OpenAppUpdateSettings() (bool, error) {
	return false, nil
}

func (a *androidUpdateBridge) InstallDownloadedApk(apkPath string) (bool, error) {
	return false, nil
}

func (a *androidUpdateBridge) GetLastInstallResult() (string, error) {
	return "cgo_disabled", nil
}

func (a *androidUpdateBridge) Install(ctx context.Context, targetFilePath string, currentAppPath string) error {
	return nil
}

func newPlatformUpdateBridge() PlatformUpdateBridge {
	return &androidUpdateBridge{}
}
