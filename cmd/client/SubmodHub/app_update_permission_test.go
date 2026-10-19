package main

import (
	"fmt"
	"testing"
)

type permissionUpdateBridge struct {
	mockUpdateBridge
	allowed       bool
	permissionErr error
}

func (b *permissionUpdateBridge) CanInstallDirectly() bool { return false }
func (b *permissionUpdateBridge) CanRequestPackageInstalls() (bool, error) {
	return b.allowed, b.permissionErr
}

func TestAppUpdatePermissionReflectsCurrentPlatformGrant(t *testing.T) {
	bridge := &permissionUpdateBridge{}
	bindings, err := newAppUpdateBindings(bridge, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	svc := &DesktopService{appUpdater: bindings}
	if !svc.GetAppUpdateStatus().RequiresInstallPermission {
		t.Fatal("missing install grant did not request permission")
	}
	bridge.allowed = true
	if svc.GetAppUpdateStatus().RequiresInstallPermission {
		t.Fatal("authorized installer still prompts for permission")
	}
	bridge.allowed = false
	if !svc.GetAppUpdateStatus().RequiresInstallPermission {
		t.Fatal("revoked grant was not refreshed")
	}
	bridge.permissionErr = fmt.Errorf("unavailable")
	if svc.GetAppUpdateStatus().RequiresInstallPermission {
		t.Fatal("failed permission query was presented as a known missing grant")
	}
}
