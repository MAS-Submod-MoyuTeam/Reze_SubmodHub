package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// sourceTreeZip is the shape the store served for the log-screen mod: the
// submod lives under a repo-root `mod/` directory, so no entry maps to a MAS
// install path.
func sourceTreeZip(t *testing.T) []byte {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for name, content := range map[string]string{
		"repo-main-bfbe30c/mod/handler.rpy": "init python:\n    pass\n",
		"repo-main-bfbe30c/mod/header.rpy":  "init python:\n    pass\n",
		"repo-main-bfbe30c/README.md":       "# log screen",
	} {
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
	return archive.Bytes()
}

func previewRequestFor(t *testing.T, root string, data []byte) ArchiveInstallRequest {
	t.Helper()
	hash := sha256.Sum256(data)
	return ArchiveInstallRequest{
		OperationID:   "op_unmappable",
		ArchiveBase64: base64.StdEncoding.EncodeToString(data),
		ExpectedSHA:   hex.EncodeToString(hash[:]),
		ModID:         "mod_logscreen",
		VersionID:     "ver_logscreen",
		Version:       "1.0.2",
		Title:         "mas-logscreen",
		Category:      "submod",
	}
}

// A preview with no planned file would produce an empty plan, and an empty plan
// executes "successfully" while writing nothing — the exact symptom this
// regression covers. The only honest answer is to refuse the preview.
func TestPreviewArchiveRefusesArchiveWithoutInstallablePaths(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	_, err := service.PreviewArchive(previewRequestFor(t, root, sourceTreeZip(t)))
	if err == nil {
		t.Fatal("preview of an unmappable archive succeeded and would install zero files")
	}
	if !strings.Contains(err.Error(), "archive_not_installable") {
		t.Fatalf("error = %v, want the archive_not_installable verdict", err)
	}
	// Nothing may be left behind for a later ExecutePlan to pick up.
	if service.activePlan != nil {
		t.Fatal("a refused preview left an active plan behind")
	}
}

// The counterpart: an archive that does map files must stay installable, and any
// entry the scanner dropped has to be visible as a risk rather than silently
// missing from the transfer.
func TestPreviewArchiveSurfacesUnsupportedEntries(t *testing.T) {
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for name, content := range map[string]string{
		"game/Submods/Log Screen/handler.rpy": "init python:\n    pass\n",
		"docs/readme.md":                      "# docs",
	} {
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

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	preview, err := service.PreviewArchive(previewRequestFor(t, root, archive.Bytes()))
	if err != nil {
		t.Fatalf("a package with real files was refused: %v", err)
	}
	if len(preview.Actions) != 1 {
		t.Fatalf("actions = %d, want 1", len(preview.Actions))
	}
	var found bool
	for _, risk := range preview.Risks {
		if risk.Type == "package_unsupported" && strings.Contains(risk.Description, "docs/readme.md") {
			found = true
		}
	}
	if !found {
		t.Fatalf("unsupported entry is not reported in the preview risks: %+v", preview.Risks)
	}
}
