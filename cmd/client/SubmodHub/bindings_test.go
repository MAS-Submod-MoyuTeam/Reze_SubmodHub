package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopServiceInstallsMultiRootSpritepack(t *testing.T) {
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	files := map[string]string{
		"Set A/mod_assets/monika/j/necklace.json":      `{"type":0,"name":"necklace","img_sit":"necklace"}`,
		"Set A/mod_assets/monika/a/acs-necklace-0.png": "necklace image",
		"Set A/gifts/necklace.gift":                    "gift",
		"Set B/mod_assets/monika/j/ribbon.json":        `{"type":0,"name":"ribbon","img_sit":"ribbon"}`,
		"Set B/mod_assets/monika/a/acs-ribbon-0.png":   "ribbon image",
		"Set B/gifts/ribbon.gift":                      "gift",
	}
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	for _, category := range []string{"spritepack", "submod", ""} {
		t.Run(category, func(t *testing.T) {
			root := t.TempDir()
			if err := os.MkdirAll(filepath.Join(root, "game"), 0755); err != nil {
				t.Fatal(err)
			}
			service := NewDesktopService()
			if _, err := service.SetMASRoot(root); err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(archive.Bytes())
			payload, err := json.Marshal(map[string]any{"operation_id": "sprite-install", "archive_base64": base64.StdEncoding.EncodeToString(archive.Bytes()), "expected_sha256": hex.EncodeToString(hash[:]), "mod_id": "sprite-mod", "category": category})
			if err != nil {
				t.Fatal(err)
			}
			var request ArchiveInstallRequest
			if err := json.Unmarshal(payload, &request); err != nil {
				t.Fatal(err)
			}
			result, err := service.ApplyArchive(request)
			if category != "spritepack" {
				if err == nil || !strings.Contains(err.Error(), "ambiguous package roots") {
					t.Fatalf("result=%+v err=%v", result, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if result.State != "committed" || result.Files != len(files) {
				t.Fatalf("result=%+v", result)
			}
			for name, want := range files {
				rel := strings.SplitN(name, "/", 2)[1]
				target := "game/" + rel
				if strings.HasPrefix(rel, "gifts/") {
					target = "characters/" + strings.TrimPrefix(rel, "gifts/")
				}
				got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(target)))
				if err != nil || string(got) != want {
					t.Fatalf("%s: got=%q err=%v", target, got, err)
				}
			}
			receipts, err := service.ListInstalledArchives()
			if err != nil || len(receipts) != 1 || receipts[0].SHA256 != request.ExpectedSHA || receipts[0].SizeBytes != int64(archive.Len()) || receipts[0].Files != len(files) {
				t.Fatalf("receipts=%+v err=%v", receipts, err)
			}
			if _, err := service.Uninstall(request.OperationID, "sprite-uninstall"); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(root, "characters", "necklace.gift")); !os.IsNotExist(err) {
				t.Fatalf("gift remains: %v", err)
			}
		})
	}
}

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
		"characters/HeavenForest.sce":    "scene",
	} {
		entry, err = writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
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
		"characters/HeavenForest.sce":    "scene",
	} {
		got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil || string(got) != want {
			t.Fatalf("%s: got=%q err=%v", name, got, err)
		}
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
