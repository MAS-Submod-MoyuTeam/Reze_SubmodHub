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
	if result.State != "committed" || result.Files != 1 {
		t.Fatalf("result=%+v", result)
	}
	got, err := os.ReadFile(filepath.Join(root, "game", "Submods", "WailsFixture", "main.rpy"))
	if err != nil || string(got) != "# Wails fixture\n" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}

func TestDesktopServiceScansLocalSubmods(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "game", "Submods", "LocalMod")
	if err := os.MkdirAll(dir, 0o755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(dir, "main.rpy"), []byte(`init python:\n    mod = Submod(name="Local Mod", version="2.0")`), 0o644); err != nil { t.Fatal(err) }
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil { t.Fatal(err) }
	result, err := service.ScanLocalSubmods()
	if err != nil { t.Fatal(err) }
	if len(result) != 1 || result[0].Directory != "LocalMod" || result[0].Name != "Local Mod" || result[0].Version != "2.0" || len(result[0].Files) != 1 || result[0].Files[0].SHA256 == "" { t.Fatalf("result=%+v", result) }
}
