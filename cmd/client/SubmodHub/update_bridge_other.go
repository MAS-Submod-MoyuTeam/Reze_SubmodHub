//go:build !windows && !android

package main

import (
	"context"
	"fmt"
)

func (d *desktopUpdateBridge) CanInstallDirectly() bool { return false }

func (d *desktopUpdateBridge) Install(context.Context, string, string) error {
	return fmt.Errorf("application updates are unsupported on this platform")
}
