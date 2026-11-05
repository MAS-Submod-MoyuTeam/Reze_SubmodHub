package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/github"
	packagezip "github.com/reze/submodhub/internal/package"
)

// createSourceTreeZip builds the shape a GitHub release zipball actually has: the
// submod sources live under `mod/`, which is not a path the MAS layout knows, so
// every entry is unmappable.
func createSourceTreeZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range []string{
		"repo-main-abc123/mod/handler.rpy",
		"repo-main-abc123/mod/header.rpy",
		"repo-main-abc123/README.md",
	} {
		entry, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte("init python:\n    pass\n")); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// An archive whose scan maps no MAS path must never become a catalog version:
// publishing it hands every client an install plan with zero writes, which the
// client then reports as a successful install that added no file.
func TestGitHubSyncRejectsArchiveWithoutInstallablePaths(t *testing.T) {
	zipData := createSourceTreeZip(t)
	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/octocat/logscreen/releases":
			fmt.Fprintf(w, `[{"id":501,"tag_name":"v1.0.2","assets":[{"id":502,"name":"mod.zip","browser_download_url":%q}]}]`, ghServer.URL+"/download/mod.zip")
		case "/download/mod.zip":
			_, _ = w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "logscreen", Author: Author{ID: "author"}, Category: "submod",
		SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "logscreen",
		GitHubAssetRegex: `\.zip$`,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	// AutoPublish is the production setting that made this silent: it skips the
	// review gate, so the scanner's verdict is the only thing between an
	// unmappable archive and the public catalog.
	store.AutoPublish = true
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	summary, err := store.SyncMod(context.Background(), "logscreen")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Created != 0 || summary.Failed != 1 {
		t.Fatalf("summary = %+v, want 0 created and 1 failed", summary)
	}
	if len(store.Catalog.Versions) != 0 {
		t.Fatalf("unmappable archive created %d versions", len(store.Catalog.Versions))
	}
	if reason := summary.Items[0].Reason; !strings.Contains(reason, "no installable MAS path") {
		t.Fatalf("failure reason = %q, want the installability verdict", reason)
	}
	// A rejected download must not survive as orphaned bytes.
	entries, readErr := os.ReadDir(filepath.Join(store.DataDir, "archives"))
	if readErr != nil && !os.IsNotExist(readErr) {
		t.Fatal(readErr)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".zip") {
			t.Fatalf("rejected archive left %q on disk", entry.Name())
		}
	}
}

// The gate is about "maps nothing", not about "has unsupported entries": a
// package that installs real files while carrying a stray extra is still a
// package, and rejecting it would break working mods.
func TestUploadAcceptsArchiveWithUnsupportedEntriesButRealFiles(t *testing.T) {
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	entry, err := zw.Create("game/Submods/demo/main.rpy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("init python:\n    pass\n")); err != nil {
		t.Fatal(err)
	}
	// A tree the MAS layout has no place for: it is dropped, not fatal.
	extra, err := zw.Create("docs/readme.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := extra.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "m1", Author: Author{ID: "author"}, Category: "submod",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	report, scanErr := scanArchiveBytes(archive.Bytes(), false)
	if scanErr != nil {
		t.Fatal(scanErr)
	}
	if len(report.Files) == 0 || len(report.Unsupported) == 0 {
		t.Fatalf("fixture must have both mapped and unmapped entries: %+v", report)
	}
	if err := requireInstallableFiles(report); err != nil {
		t.Fatalf("a package with real files was rejected: %v", err)
	}
	if _, _, _, _, err := store.persistArchive("v1", bytes.NewReader(archive.Bytes()), false); err != nil {
		t.Fatalf("upload of a valid package failed: %v", err)
	}
}

// A Windows-built source archive spells the README with the same separator as the
// files it came with, so the "documentation, not content" exemption has to
// compare normalized paths — otherwise every such repo shows a bogus
// unsupported entry on its first import.
func TestAllowSourceRootReadmeNormalizesSeparators(t *testing.T) {
	report := packagezip.Report{
		Files: []packagezip.File{
			{Source: `proj-bfbe30c\game\Submods\A\a.rpy`},
			{Source: `proj-bfbe30c\game\Submods\A\b.rpy`},
		},
		Unsupported: []string{`proj-bfbe30c\README.md`, `proj-bfbe30c\docs\notes.md`},
	}
	allowSourceRootReadme(&report)
	if len(report.Unsupported) != 1 || report.Unsupported[0] != `proj-bfbe30c\docs\notes.md` {
		t.Fatalf("unsupported = %v", report.Unsupported)
	}
	if len(report.Warnings) != 1 || !strings.Contains(report.Warnings[0], "README.md") {
		t.Fatalf("warnings = %v", report.Warnings)
	}
}
