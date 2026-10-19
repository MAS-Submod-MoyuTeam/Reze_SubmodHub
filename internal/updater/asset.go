package updater

import (
	"fmt"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/reze/submodhub/internal/github"
)

// SelectAsset matches an asset in release corresponding to the target OS and arch.
//
// Expected naming patterns:
// Windows: submodhub-windows-amd64[-<version>].exe, submodhub-windows-arm64[-<version>].exe
// Android: submodhub-android-arm64[-<version>].apk, submodhub-android[-<version>].apk
func SelectAsset(assets []github.Asset, targetOS, targetArch string) (*github.Asset, error) {
	if len(assets) == 0 {
		return nil, fmt.Errorf("release contains no assets")
	}

	targetOS = strings.ToLower(targetOS)
	targetArch = strings.ToLower(targetArch)

	var candidates []github.Asset

	for _, a := range assets {
		name := strings.ToLower(a.Name)
		switch targetOS {
		case "windows":
			if strings.HasSuffix(name, ".exe") && strings.Contains(name, "windows") {
				if targetArch == "amd64" && (strings.Contains(name, "amd64") || strings.Contains(name, "x86_64")) {
					candidates = append(candidates, a)
				} else if targetArch == "arm64" && strings.Contains(name, "arm64") {
					candidates = append(candidates, a)
				}
			}
		case "android":
			if strings.HasSuffix(name, ".apk") && strings.Contains(name, "android") {
				// Prefer matching arch if present, or general android apk
				if targetArch == "arm64" && strings.Contains(name, "arm64") {
					return &a, nil
				}
				candidates = append(candidates, a)
			}
		case "darwin":
			if (strings.HasSuffix(name, ".dmg") || strings.HasSuffix(name, ".zip")) && strings.Contains(name, "darwin") {
				candidates = append(candidates, a)
			}
		case "linux":
			if (strings.HasSuffix(name, ".appimage") || strings.HasSuffix(name, ".tar.gz")) && strings.Contains(name, "linux") {
				candidates = append(candidates, a)
			}
		}
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no matching asset found for OS %s and Arch %s", targetOS, targetArch)
	}

	// Prefer the first matching candidate
	return &candidates[0], nil
}

// FindUpdaterAsset finds the updater.exe asset in release assets if present.
func FindUpdaterAsset(assets []github.Asset) *github.Asset {
	for _, a := range assets {
		lower := strings.ToLower(a.Name)
		if lower == "updater.exe" || lower == "submodhub-updater.exe" {
			return &a
		}
	}
	return nil
}

// FindChecksumAsset finds the SHA256SUMS.txt or similar asset.
func FindChecksumAsset(assets []github.Asset) *github.Asset {
	for _, a := range assets {
		lower := strings.ToLower(a.Name)
		if lower == "sha256sums.txt" || lower == "checksums.txt" || strings.HasSuffix(lower, "sha256sums.txt") {
			return &a
		}
	}
	return nil
}

// FindSignatureAsset finds the .sig / .minisig signature asset corresponding to target asset name.
func FindSignatureAsset(assets []github.Asset, assetName string) *github.Asset {
	expectedSig1 := assetName + ".sig"
	expectedSig2 := assetName + ".minisig"
	for _, a := range assets {
		if strings.EqualFold(a.Name, expectedSig1) || strings.EqualFold(a.Name, expectedSig2) {
			return &a
		}
	}
	return nil
}

// ParseSemVer extracts major, minor, patch and optional prerelease from version string like "v1.2.3" or "1.2.3-beta.1".
var semverRegex = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?`)

type SemVer struct {
	Major      int
	Minor      int
	Patch      int
	Prerelease string
}

func ParseSemVer(v string) (SemVer, bool) {
	v = strings.TrimSpace(v)
	matches := semverRegex.FindStringSubmatch(v)
	if len(matches) < 4 {
		return SemVer{}, false
	}
	major, _ := strconv.Atoi(matches[1])
	minor, _ := strconv.Atoi(matches[2])
	patch, _ := strconv.Atoi(matches[3])
	var prerelease string
	if len(matches) >= 5 {
		prerelease = matches[4]
	}
	return SemVer{
		Major:      major,
		Minor:      minor,
		Patch:      patch,
		Prerelease: prerelease,
	}, true
}

// CompareSemVer compares v1 and v2.
// Returns 1 if v1 > v2, -1 if v1 < v2, 0 if v1 == v2.
// If both have prereleases or one does, standard semver rules apply (no prerelease > has prerelease).
func CompareSemVer(v1, v2 string) int {
	sv1, ok1 := ParseSemVer(v1)
	sv2, ok2 := ParseSemVer(v2)
	if !ok1 || !ok2 {
		// Fallback to simple string comparison if invalid semver
		if v1 > v2 {
			return 1
		} else if v1 < v2 {
			return -1
		}
		return 0
	}

	if sv1.Major != sv2.Major {
		if sv1.Major > sv2.Major {
			return 1
		}
		return -1
	}
	if sv1.Minor != sv2.Minor {
		if sv1.Minor > sv2.Minor {
			return 1
		}
		return -1
	}
	if sv1.Patch != sv2.Patch {
		if sv1.Patch > sv2.Patch {
			return 1
		}
		return -1
	}

	// Compare prerelease
	if sv1.Prerelease == "" && sv2.Prerelease != "" {
		return 1 // release > prerelease
	}
	if sv1.Prerelease != "" && sv2.Prerelease == "" {
		return -1 // prerelease < release
	}
	if sv1.Prerelease != sv2.Prerelease {
		if sv1.Prerelease > sv2.Prerelease {
			return 1
		}
		return -1
	}

	return 0
}

// CurrentPlatform returns the runtime GOOS and GOARCH
func CurrentPlatform() (string, string) {
	return runtime.GOOS, runtime.GOARCH
}

// SanitizeFilename ensures no path traversal or special chars
func SanitizeFilename(name string) string {
	base := filepath.Base(name)
	return strings.ReplaceAll(base, "..", "")
}
