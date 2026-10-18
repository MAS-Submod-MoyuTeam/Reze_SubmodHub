package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/version"
)

func TestValidateVersion(t *testing.T) {
	for _, v := range []string{"0.9.0", "1.2.3", "0.9.0-beta.1", "1.0.0+build.5"} {
		if err := validateVersion(v); err != nil {
			t.Errorf("validateVersion(%q) = %v, want nil", v, err)
		}
	}
	for _, v := range []string{"", "1.2", "v1.2.3", "1.2.3.4", "1.100.0", "0.-1.0", "abc"} {
		if err := validateVersion(v); err == nil {
			t.Errorf("validateVersion(%q) = nil, want error", v)
		}
	}
}

func TestReplaceValueKeepsSurroundingFormatting(t *testing.T) {
	pattern := regexp.MustCompile(`(?m)^(  version: )"([^"]*)"`)
	edit := replaceValue(pattern, "1.2.3")
	got, err := edit("info:\n  version: \"0.9.0\" # application version\n")
	if err != nil {
		t.Fatal(err)
	}
	want := "info:\n  version: \"1.2.3\" # application version\n"
	if got != want {
		t.Fatalf("edit = %q, want %q", got, want)
	}
}

func TestReplacePlistVersionPreservesDevSuffix(t *testing.T) {
	edit := replacePlistVersion("1.2.3")
	got, err := edit("<key>CFBundleVersion</key>\n<string>0.9.0</string>\n<key>CFBundleShortVersionString</key>\n<string>0.9.0-dev</string>\n")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "<string>1.2.3</string>") || !strings.Contains(got, "<string>1.2.3-dev</string>") {
		t.Fatalf("unexpected plist edit result:\n%s", got)
	}
}

func TestSetVersionUpdatesEveryMetadataFile(t *testing.T) {
	root := t.TempDir()
	writeFile := func(rel, content string) {
		t.Helper()
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	plist := func(cfbundleVersion, shortVersion string) string {
		return "<plist>\n<dict>\n" +
			"<key>CFBundleVersion</key>\n<string>" + cfbundleVersion + "</string>\n" +
			"<key>CFBundleShortVersionString</key>\n<string>" + shortVersion + "</string>\n" +
			"</dict>\n</plist>\n"
	}

	writeFile(versionFile, "0.9.0\n")
	writeFile(goVersionFile, "package version\n\nvar Version = \"0.9.0\"\n")
	writeFile(wailsConfigFile, "version: '3'\ninfo:\n  version: \"0.9.0\" # app version\n")
	writeFile(windowsInfoFile, "{\n\t\"fixed\": {\n\t\t\"file_version\": \"0.9.0\"\n\t},\n\t\"info\": {\n\t\t\"0000\": {\n\t\t\t\"ProductVersion\": \"0.9.0\"\n\t\t}\n\t}\n}\n")
	writeFile(nsisToolsFile, "!define INFO_PRODUCTVERSION \"0.9.0\"\n")
	writeFile(appleInfoFiles[0], plist("0.9.0", "0.9.0"))
	writeFile(appleInfoFiles[1], plist("0.9.0", "0.9.0-dev"))
	writeFile(appleInfoFiles[2], plist("0.9.0", "0.9.0"))
	writeFile(appleInfoFiles[3], plist("0.9.0", "0.9.0-dev"))

	original := version.Version
	t.Cleanup(func() { version.Version = original })

	if err := setVersion(root, "1.2.3"); err != nil {
		t.Fatalf("setVersion: %v", err)
	}
	if got := version.Version; got != "1.2.3" {
		t.Fatalf("in-process version = %q, want 1.2.3", got)
	}
	if err := checkVersion(root); err != nil {
		t.Fatalf("checkVersion after setVersion: %v", err)
	}

	expectations := map[string]string{
		versionFile:     `1.2.3`,
		goVersionFile:   `var Version = "1.2.3"`,
		wailsConfigFile: `version: "1.2.3" # app version`,
		windowsInfoFile: `"ProductVersion": "1.2.3"`,
		nsisToolsFile:   `!define INFO_PRODUCTVERSION "1.2.3"`,
	}
	for rel, needle := range expectations {
		b, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(b), needle) {
			t.Errorf("%s does not contain %q after setVersion:\n%s", rel, needle, b)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(root, windowsInfoFile)); !strings.Contains(string(b), `"file_version": "1.2.3"`) {
		t.Errorf("windows info file_version not updated:\n%s", b)
	}
	if b, _ := os.ReadFile(filepath.Join(root, appleInfoFiles[1])); !strings.Contains(string(b), "<string>1.2.3-dev</string>") {
		t.Errorf("dev plist lost its -dev suffix:\n%s", b)
	}
	if b, _ := os.ReadFile(filepath.Join(root, appleInfoFiles[0])); !strings.Contains(string(b), "<string>1.2.3</string>") {
		t.Errorf("release plist version not updated:\n%s", b)
	}
}
