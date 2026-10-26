package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseMASRunVersion(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"mas format with crlf", "Monika After Story|0.12.15\r\n", "0.12.15"},
		{"mas format with lf", "Monika After Story|0.12.15\n", "0.12.15"},
		{"utf8 bom", "\ufeffMonika After Story|0.12.19", "0.12.19"},
		{"version only", "0.12.19", "0.12.19"},
		{"post release suffix", "Monika After Story|0.12.15-2", "0.12.15-2"},
		{"trailing blank line", "Monika After Story|0.13.0\n\n", "0.13.0"},
		{"name only", "Monika After Story|\r\n", ""},
		{"empty file", "", ""},
		{"free text", "not a version\n", ""},
		{"empty version segment", "Monika After Story|", ""},
		{"name without separator", "Monika After Story\r\n", ""},
		{"oversized version", "Monika After Story|0." + "1234567890123456789012345678901234567890", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseMASRunVersion(tc.raw); got != tc.want {
				t.Fatalf("parseMASRunVersion(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestReadMASVersionReportsGameMasrun(t *testing.T) {
	root := makeMASFixture(t)
	game := filepath.Join(root, "game")

	// MAS 还没运行过：没有 masrun，版本未知但不是错误。
	if got := readMASVersion(game); got != "" {
		t.Fatalf("missing masrun = %q, want empty", got)
	}

	if err := os.WriteFile(filepath.Join(game, masRunFile), []byte("Monika After Story|0.12.15\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := readMASVersion(game); got != "0.12.15" {
		t.Fatalf("masrun version = %q, want 0.12.15", got)
	}
}

func TestInspectMASRootReportsMASVersion(t *testing.T) {
	root := makeMASFixture(t)
	if err := os.WriteFile(filepath.Join(root, "game", masRunFile), []byte("Monika After Story|0.12.15\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	status := inspectMASRoot(root)
	if !status.Valid || !status.GameExists {
		t.Fatalf("expected valid game dir, got valid=%v game_exists=%v", status.Valid, status.GameExists)
	}
	if status.Diagnostic != "game_directory_verified" {
		t.Fatalf("diagnostic = %q", status.Diagnostic)
	}
	if status.MASVersion != "0.12.15" {
		t.Fatalf("version = %q, want 0.12.15", status.MASVersion)
	}
}

func TestReadMASVersionIgnoresContentBeyondReadLimit(t *testing.T) {
	root := makeMASFixture(t)
	// 首行超过读取上限：宁可判为无法识别，也不去猜半截版本号。
	line := "Monika After Story|" + strings.Repeat("9", masRunReadLimit)
	if err := os.WriteFile(filepath.Join(root, "game", masRunFile), []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := readMASVersion(filepath.Join(root, "game")); got != "" {
		t.Fatalf("truncated masrun = %q, want empty", got)
	}
}

func TestInspectMASRootLeavesVersionEmptyWhenMasRunUnreadable(t *testing.T) {
	root := makeMASFixture(t)
	// 用同名目录占位：不是普通文件，版本留空，但目录本身仍然有效。
	if err := os.Mkdir(filepath.Join(root, "game", masRunFile), 0o755); err != nil {
		t.Fatal(err)
	}

	status := inspectMASRoot(root)
	if !status.GameExists {
		t.Fatal("game dir should still be valid")
	}
	if status.MASVersion != "" {
		t.Fatalf("version = %q, want empty", status.MASVersion)
	}
}
