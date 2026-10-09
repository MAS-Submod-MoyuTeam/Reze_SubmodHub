package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopServiceBindsMASRootAndWritesThroughCore(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	status, err := service.SetMASRoot(root)
	if err != nil || !status.Valid || !status.GameExists {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	if state, err := service.ApplyFile(InstallRequest{OperationID: "binding-test", Path: "game/Submods/binding.txt", Content: "binding"}); err != nil || state != "committed" {
		t.Fatalf("state=%s err=%v", state, err)
	}
	got, err := os.ReadFile(filepath.Join(root, "game", "Submods", "binding.txt"))
	if err != nil || string(got) != "binding" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}

func TestDesktopServiceInstallsVerifiedArchive(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	entry, err := writer.Create("game/Submods/WailsFixture/main.rpy")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("# Wails fixture\n"))
	for name, content := range map[string]string{
		"lib/windows-i686/Lib/Cookie.py": "# library\n",
		"characters/HeavenForest.sce": "scene",
	} {
		entry, err = writer.Create(name)
		if err != nil { t.Fatal(err) }
		if _, err = entry.Write([]byte(content)); err != nil { t.Fatal(err) }
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(archive.Bytes())
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	result, err := service.ApplyArchive(ArchiveInstallRequest{OperationID: "archive-test", ArchiveBase64: base64.StdEncoding.EncodeToString(archive.Bytes()), ExpectedSHA: hex.EncodeToString(hash[:])})
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "committed" || result.Files != 3 {
		t.Fatalf("result=%+v", result)
	}
	got, err := os.ReadFile(filepath.Join(root, "game", "Submods", "WailsFixture", "main.rpy"))
	if err != nil || string(got) != "# Wails fixture\n" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	for name, want := range map[string]string{
		"lib/windows-i686/Lib/Cookie.py": "# library\n",
		"characters/HeavenForest.sce": "scene",
	} {
		got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil || string(got) != want { t.Fatalf("%s: got=%q err=%v", name, got, err) }
	}
}

func TestInstalledArchiveReceiptSurvivesServiceRestart(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0755); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	entry, err := writer.Create("game/Submods/MAICA_ChatSubmod/main.rpy")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("# MAICA"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	_, err = service.ApplyArchive(ArchiveInstallRequest{OperationID: "install-maica", ArchiveBase64: base64.StdEncoding.EncodeToString(archive.Bytes()), ModID: "mod_maica", VersionID: "ver_1", Version: "1.9.4", Title: "MAICA Blessland"})
	if err != nil {
		t.Fatal(err)
	}
	restarted := NewDesktopService()
	if _, err := restarted.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	receipts, err := restarted.ListInstalledArchives()
	if err != nil || len(receipts) != 1 || receipts[0].ModID != "mod_maica" || receipts[0].Version != "1.9.4" || len(receipts[0].SubmodDirs) != 1 || receipts[0].SubmodDirs[0] != "MAICA_ChatSubmod" {
		t.Fatalf("receipts=%+v err=%v", receipts, err)
	}
	if _, err := restarted.Uninstall("install-maica", "uninstall-maica"); err != nil {
		t.Fatal(err)
	}
	receipts, err = restarted.ListInstalledArchives()
	if err != nil || len(receipts) != 0 {
		t.Fatalf("after uninstall=%+v err=%v", receipts, err)
	}
}

func TestDesktopServiceScansLocalSubmods(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "game", "Submods", "LocalMod")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.rpy"), []byte(`init python:\n    mod = Submod(name="Local Mod", version="2.0")`), 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	result, err := service.ScanLocalSubmods()
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 1 || result[0].Directory != "LocalMod" || result[0].Name != "Local Mod" || result[0].Version != "2.0" || len(result[0].Files) != 1 || result[0].Files[0].SHA256 == "" {
		t.Fatalf("result=%+v", result)
	}
}
