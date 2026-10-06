//go:build mas_integration

package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestInstallMASUniSyncReleaseToRealMAS(t *testing.T) {
	archivePath := os.Getenv("SUBMODHUB_RELEASE_ZIP")
	if archivePath == "" { t.Fatal("SUBMODHUB_RELEASE_ZIP is required") }
	data, err := os.ReadFile(filepath.Clean(archivePath)); if err != nil { t.Fatal(err) }
	service := NewDesktopService(); root := os.Getenv("SUBMODHUB_MAS_ROOT"); if root == "" { root = `E:\MAS_Cn001280\MAS_CN0012F0` }; if _, err := service.SetMASRoot(root); err != nil { t.Fatal(err) }
	result, err := service.ApplyArchive(ArchiveInstallRequest{OperationID: "release_mas_unisync_1_2_3", ArchiveBase64: base64.StdEncoding.EncodeToString(data)}); if err != nil { t.Fatal(err) }
	if result.State != "committed" || result.Files != 9 { t.Fatalf("result=%+v", result) }
}

func TestUninstallMASUniSyncReleaseFromRealMAS(t *testing.T) {
	if os.Getenv("SUBMODHUB_RUN_UNINSTALL") != "1" { t.Skip("set SUBMODHUB_RUN_UNINSTALL=1 to mutate the real MAS") }
	service := NewDesktopService()
	root := os.Getenv("SUBMODHUB_MAS_ROOT")
	if root == "" { root = `E:\MAS_Cn001280\MAS_CN0012F0` }
	if _, err := service.SetMASRoot(root); err != nil { t.Fatal(err) }
	state, err := service.Uninstall("release_mas_unisync_1_2_3", "uninstall_release_mas_unisync_1_2_3")
	if err != nil { t.Fatal(err) }
	if state != "committed" { t.Fatalf("state=%s", state) }
}
