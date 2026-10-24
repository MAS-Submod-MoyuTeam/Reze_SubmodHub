// Package version is the single runtime source for the SubmodHub release
// version.
//
// The repository-root VERSION file is authoritative. This package mirrors it so
// that Go binaries (API server, desktop client, Android native library) can
// report their version without reading files at runtime. Keep both in sync with
//
//	go run ./cmd/version -set X.Y.Z
//
// and verify them with
//
//	go run ./cmd/version -check
package version

import (
	"fmt"
	"runtime"
)

// Version is the SubmodHub release version.
//
// It is a variable so release builds can override it without touching the
// source tree:
//
//	go build -ldflags "-X github.com/reze/submodhub/internal/version.Version=0.9.1"
var Version = "0.9.13"

// RepoOwner and RepoName identify the official repository that publishes
// SubmodHub releases. The API server (app-update delivery) and the desktop
// client (self-update) both read these coordinates here instead of keeping
// private copies.
const (
	RepoOwner = "MAS-Submod-MoyuTeam"
	RepoName  = "Reze_SubmodHub"
)

// Commit and BuildTime are optional build metadata. CI may inject the commit
// SHA and build timestamp through -ldflags -X; they stay empty for local
// builds.
var (
	Commit    = ""
	BuildTime = ""
)

// Info describes a build of SubmodHub. It is the JSON contract used by the
// public version endpoint and by clients that want to show build metadata.
type Info struct {
	Version   string `json:"version"`
	Commit    string `json:"commit,omitempty"`
	BuildTime string `json:"build_time,omitempty"`
	GoVersion string `json:"go_version"`
	Platform  string `json:"platform"`
}

// Current returns the build metadata of the running binary.
func Current() Info {
	return Info{
		Version:   Version,
		Commit:    Commit,
		BuildTime: BuildTime,
		GoVersion: runtime.Version(),
		Platform:  runtime.GOOS + "/" + runtime.GOARCH,
	}
}

// String renders the version, appending the short commit when one is known.
func (i Info) String() string {
	if commit := shortCommit(i.Commit); commit != "" {
		return fmt.Sprintf("%s (%s)", i.Version, commit)
	}
	return i.Version
}

func shortCommit(commit string) string {
	if len(commit) > 7 {
		return commit[:7]
	}
	return commit
}
