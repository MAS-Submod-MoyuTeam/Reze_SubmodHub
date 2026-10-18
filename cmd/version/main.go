// Command version is the release-version helper for SubmodHub.
//
// The repository-root VERSION file is the single source of truth. This command
// reads it, verifies that every place embedding the version agrees with it, and
// bumps all of them in one step.
//
// Usage:
//
//	go run ./cmd/version              # print the current version
//	go run ./cmd/version -json        # print build metadata as JSON
//	go run ./cmd/version -check       # fail when VERSION and metadata disagree
//	go run ./cmd/version -set 0.9.1   # bump VERSION and every metadata file
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/reze/submodhub/internal/version"
)

const (
	versionFile      = "VERSION"
	goVersionFile    = "internal/version/version.go"
	wailsConfigFile  = "cmd/client/SubmodHub/build/config.yml"
	windowsInfoFile  = "cmd/client/SubmodHub/build/windows/info.json"
	nsisToolsFile    = "cmd/client/SubmodHub/build/windows/nsis/wails_tools.nsh"
	maxVersionNumber = 99
)

// appleInfoFiles hold the CFBundle versions used by macOS/iOS builds. They are
// maintained here so `-set` keeps every build asset in step with VERSION.
var appleInfoFiles = []string{
	"cmd/client/SubmodHub/build/darwin/Info.plist",
	"cmd/client/SubmodHub/build/darwin/Info.dev.plist",
	"cmd/client/SubmodHub/build/ios/Info.plist",
	"cmd/client/SubmodHub/build/ios/Info.dev.plist",
}

var (
	semverPattern = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$`)

	// Matches `  version: "0.9.0"` under `info:` in the Wails config. The
	// top-level `version: '3'` uses single quotes and is intentionally ignored.
	wailsConfigVersionPattern = regexp.MustCompile(`(?m)^([ \t]+version:[ \t]*)"([^"]*)"`)
	goVersionPattern          = regexp.MustCompile(`(?m)^(var Version = )"([^"]*)"`)
	windowsFileVersionPattern = regexp.MustCompile(`("file_version":[ \t]*)"([^"]*)"`)
	windowsProductPattern     = regexp.MustCompile(`("ProductVersion":[ \t]*)"([^"]*)"`)
	nsisVersionPattern        = regexp.MustCompile(`(?m)^([ \t]*!define INFO_PRODUCTVERSION )"([^"]*)"`)
	plistVersionPattern       = regexp.MustCompile(`(?s)(<key>CFBundle(?:ShortVersionString|Version)</key>\s*<string>)([^<]*)(</string>)`)
)

func main() {
	var (
		asJSON = flag.Bool("json", false, "print build metadata as JSON")
		check  = flag.Bool("check", false, "verify VERSION and every derived file agree")
		set    = flag.String("set", "", "set a new version and update VERSION and derived files")
	)
	flag.Parse()

	root, err := findRepoRoot()
	if err != nil {
		fail(err)
	}

	switch {
	case *set != "":
		if *check {
			fail(errors.New("-set and -check cannot be combined"))
		}
		if err := setVersion(root, *set); err != nil {
			fail(err)
		}
	case *check:
		if err := checkVersion(root); err != nil {
			fail(err)
		}
	case *asJSON:
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(version.Current()); err != nil {
			fail(err)
		}
	case len(flag.Args()) == 0:
		v, err := readVersion(root)
		if err != nil {
			fail(err)
		}
		fmt.Println(v)
	default:
		fail(fmt.Errorf("unexpected argument %q", flag.Arg(0)))
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "version:", err)
	os.Exit(1)
}

// findRepoRoot walks up from the working directory until it finds the project
// root, which is the only directory holding both go.mod and VERSION.
func findRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if isFile(filepath.Join(dir, "go.mod")) && isFile(filepath.Join(dir, versionFile)) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("could not locate the repository root; run this command from inside the repository")
		}
		dir = parent
	}
}

func readVersion(root string) (string, error) {
	b, err := os.ReadFile(filepath.Join(root, versionFile))
	if err != nil {
		return "", fmt.Errorf("read %s: %w", versionFile, err)
	}
	v := strings.TrimSpace(string(b))
	if v == "" {
		return "", fmt.Errorf("%s is empty", versionFile)
	}
	return v, nil
}

func validateVersion(v string) error {
	m := semverPattern.FindStringSubmatch(v)
	if m == nil {
		return fmt.Errorf("%q is not a semantic version (expected MAJOR.MINOR.PATCH)", v)
	}
	for _, part := range m[1:4] {
		n := 0
		for _, r := range part {
			n = n*10 + int(r-'0')
		}
		if n > maxVersionNumber {
			return fmt.Errorf("%q: MAJOR, MINOR and PATCH must each be <= %d so Android versionCode stays unambiguous", v, maxVersionNumber)
		}
	}
	return nil
}

type versionTarget struct {
	path string
	edit func(string) (string, error)
}

func setVersion(root, next string) error {
	if err := validateVersion(next); err != nil {
		return err
	}
	targets := []versionTarget{
		{versionFile, func(string) (string, error) { return next + "\n", nil }},
		{goVersionFile, replaceValue(goVersionPattern, next)},
		{wailsConfigFile, replaceValue(wailsConfigVersionPattern, next)},
		{windowsInfoFile, replaceValue(windowsFileVersionPattern, next)},
		{windowsInfoFile, replaceValue(windowsProductPattern, next)},
		{nsisToolsFile, replaceValue(nsisVersionPattern, next)},
	}
	for _, path := range appleInfoFiles {
		targets = append(targets, versionTarget{path, replacePlistVersion(next)})
	}

	// Read and transform every target before writing anything so a missing or
	// malformed metadata file cannot leave the repository half-updated. Multiple
	// edits may target the same file, so transformations are chained in order.
	pending := map[string]string{}
	original := map[string]string{}
	var order []string
	for _, target := range targets {
		fullPath := filepath.Join(root, target.path)
		src, ok := pending[fullPath]
		if !ok {
			b, err := os.ReadFile(fullPath)
			if err != nil {
				return fmt.Errorf("read %s: %w", target.path, err)
			}
			src = string(b)
			original[fullPath] = src
			order = append(order, fullPath)
		}
		updated, err := target.edit(src)
		if err != nil {
			return fmt.Errorf("%s: %w", target.path, err)
		}
		pending[fullPath] = updated
	}
	for _, path := range order {
		if pending[path] == original[path] {
			continue
		}
		if err := os.WriteFile(path, []byte(pending[path]), 0o644); err != nil {
			return fmt.Errorf("write %s: %w", path, err)
		}
		fmt.Printf("updated %s\n", filepath.ToSlash(path))
	}

	// Keep the in-process copy consistent for callers that keep running.
	version.Version = next
	fmt.Printf("SubmodHub version is now %s\n", next)
	return nil
}

func checkVersion(root string) error {
	v, err := readVersion(root)
	if err != nil {
		return err
	}
	if err := validateVersion(v); err != nil {
		return err
	}

	var problems []string
	addProblem := func(format string, args ...any) {
		problems = append(problems, fmt.Sprintf(format, args...))
	}

	if version.Version != v {
		addProblem("%s declares %q but internal/version.Version is %q", versionFile, v, version.Version)
	}

	checks := []struct {
		path     string
		patterns []*regexp.Regexp
	}{
		{goVersionFile, []*regexp.Regexp{goVersionPattern}},
		{wailsConfigFile, []*regexp.Regexp{wailsConfigVersionPattern}},
		{windowsInfoFile, []*regexp.Regexp{windowsFileVersionPattern, windowsProductPattern}},
		{nsisToolsFile, []*regexp.Regexp{nsisVersionPattern}},
	}
	for _, check := range checks {
		src, err := os.ReadFile(filepath.Join(root, check.path))
		if err != nil {
			addProblem("read %s: %v", check.path, err)
			continue
		}
		for _, pattern := range check.patterns {
			matches := pattern.FindAllStringSubmatch(string(src), -1)
			if len(matches) == 0 {
				addProblem("%s does not contain a value matching %s", check.path, pattern)
				continue
			}
			for _, match := range matches {
				if match[2] != v {
					addProblem("%s declares %q, want %q", check.path, match[2], v)
				}
			}
		}
	}

	for _, path := range appleInfoFiles {
		src, err := os.ReadFile(filepath.Join(root, path))
		if err != nil {
			addProblem("read %s: %v", path, err)
			continue
		}
		matches := plistVersionPattern.FindAllStringSubmatch(string(src), -1)
		if len(matches) == 0 {
			addProblem("%s does not contain a CFBundle version", path)
			continue
		}
		for _, match := range matches {
			if got := strings.TrimSuffix(match[2], "-dev"); got != v {
				addProblem("%s declares %q, want %q (optionally with a -dev suffix)", path, match[2], v)
			}
		}
	}

	if len(problems) > 0 {
		return fmt.Errorf("version metadata is out of sync (run `go run ./cmd/version -set %s`):\n  - %s", v, strings.Join(problems, "\n  - "))
	}
	fmt.Printf("version metadata is consistent: %s\n", v)
	return nil
}

// replaceValue rewrites the value captured by group 2 of pattern, keeping the
// surrounding text (indentation, key names and JSON/CSS formatting) intact.
func replaceValue(pattern *regexp.Regexp, value string) func(string) (string, error) {
	return func(src string) (string, error) {
		if !pattern.MatchString(src) {
			return "", fmt.Errorf("no value found for %s", pattern)
		}
		return pattern.ReplaceAllStringFunc(src, func(match string) string {
			sub := pattern.FindStringSubmatch(match)
			return sub[1] + `"` + value + `"`
		}), nil
	}
}

// replacePlistVersion rewrites CFBundle version strings in an XML property
// list, preserving the "-dev" suffix used by development builds.
func replacePlistVersion(value string) func(string) (string, error) {
	return func(src string) (string, error) {
		matches := plistVersionPattern.FindAllStringSubmatchIndex(src, -1)
		if len(matches) == 0 {
			return "", errors.New("no CFBundle version value found")
		}
		var b strings.Builder
		last := 0
		for _, match := range matches {
			b.WriteString(src[last:match[4]])
			suffix := ""
			if strings.HasSuffix(src[match[4]:match[5]], "-dev") {
				suffix = "-dev"
			}
			b.WriteString(value + suffix)
			last = match[5]
		}
		b.WriteString(src[last:])
		return b.String(), nil
	}
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
