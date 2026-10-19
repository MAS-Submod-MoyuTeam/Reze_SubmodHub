//go:build windows

package main

import (
	"context"
	winupdate "github.com/reze/submodhub/internal/updater/windows"
)

func (d *desktopUpdateBridge) CanInstallDirectly() bool { return true }

func (d *desktopUpdateBridge) Install(ctx context.Context, targetFilePath string, currentAppPath string) error {
	return winupdate.NewWindowsInstaller("").Install(ctx, targetFilePath, currentAppPath)
}
