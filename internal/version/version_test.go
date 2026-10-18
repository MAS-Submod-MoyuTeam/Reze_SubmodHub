package version

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatalf("resolve repository root: %v", err)
	}
	return root
}

// TestVersionMatchesVersionFile keeps internal/version.Version and the
// repository-root VERSION file from drifting apart.
func TestVersionMatchesVersionFile(t *testing.T) {
	b, err := os.ReadFile(filepath.Join(repoRoot(t), "VERSION"))
	if err != nil {
		t.Fatalf("read VERSION: %v", err)
	}
	declared := strings.TrimSpace(string(b))
	if declared != Version {
		t.Fatalf("internal/version.Version = %q but VERSION declares %q; run `go run ./cmd/version -set %s`", Version, declared, declared)
	}
}

func TestCurrentReportsBuildMetadata(t *testing.T) {
	info := Current()
	if info.Version != Version {
		t.Fatalf("Current().Version = %q, want %q", info.Version, Version)
	}
	if info.GoVersion == "" {
		t.Fatal("Current().GoVersion must not be empty")
	}
	if !strings.Contains(info.Platform, "/") {
		t.Fatalf("Current().Platform = %q, want GOOS/GOARCH", info.Platform)
	}
}

func TestStringIncludesShortCommit(t *testing.T) {
	original := Commit
	t.Cleanup(func() { Commit = original })

	Commit = ""
	if got := Current().String(); got != Version {
		t.Fatalf("String() = %q, want %q", got, Version)
	}

	Commit = "0123456789abcdef"
	if got := Current().String(); got != Version+" (0123456)" {
		t.Fatalf("String() = %q, want version with short commit", got)
	}
}
