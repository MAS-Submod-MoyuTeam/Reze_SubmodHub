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

// A Windows-built release (backslash separators plus a bare directory entry)
// must preview and install like any other package.
func TestPreviewArchiveInstallsWindowsBuiltRelease(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range map[string]string{
		`game\Submods\`: "",
		`game\Submods\Log Screen\config.rpy`: `init python:
    pass
`,
	} {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}
	svc := NewDesktopService()
	if _, err := svc.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	preview, err := svc.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_winsep",
		ArchiveBase64: base64.StdEncoding.EncodeToString(data),
		ExpectedSHA:   hex.EncodeToString(hash[:]),
		ModID:         "mod_test",
		VersionID:     "ver_test",
		Version:       "1.0.0",
		Title:         "Windows built",
		Category:      "submod",
	})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if len(preview.Actions) != 1 {
		t.Fatalf("actions = %d, want 1", len(preview.Actions))
	}
	for _, risk := range preview.Risks {
		if risk.Type == "package_unsupported" {
			t.Fatalf("directory entry reported as unsupported: %+v", risk)
		}
	}
	res, err := svc.ExecutePlan(ExecutePlanRequest{PlanID: preview.PlanID, Confirmed: true})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if res.Files != 1 {
		t.Fatalf("files = %d, want 1", res.Files)
	}
	if _, err := os.Stat(filepath.Join(root, "game", "Submods", "Log Screen", "config.rpy")); err != nil {
		t.Fatalf("installed file: %v", err)
	}
}
