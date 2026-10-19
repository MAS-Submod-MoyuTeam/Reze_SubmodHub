package main

import (
	"context"
)

// PlatformUpdateBridge defines the interface for platform-specific update installation operations.
type PlatformUpdateBridge interface {
	CanInstallDirectly() bool
	CanRequestPackageInstalls() (bool, error)
	OpenAppUpdateSettings() (bool, error)
	InstallDownloadedApk(apkPath string) (bool, error)
	GetLastInstallResult() (string, error)
	Install(ctx context.Context, targetFilePath string, currentAppPath string) error
}

type desktopUpdateBridge struct{}

func (d *desktopUpdateBridge) CanRequestPackageInstalls() (bool, error) {
	return true, nil
}

func (d *desktopUpdateBridge) OpenAppUpdateSettings() (bool, error) {
	return false, nil
}

func (d *desktopUpdateBridge) InstallDownloadedApk(apkPath string) (bool, error) {
	return false, nil
}

func (d *desktopUpdateBridge) GetLastInstallResult() (string, error) {
	return "unsupported_on_desktop", nil
}
