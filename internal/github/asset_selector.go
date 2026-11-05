package github

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

var ErrNoMatchingAsset = errors.New("no matching zip release asset found and source code fallback is disabled")

// ErrAmbiguousAssets means the release carries more than one ZIP that answers to
// the release tag and no regex was configured to break the tie. Guessing here is
// how one mod's release silently publishes another mod's archive, so the caller
// gets an explicit failure instead.
var ErrAmbiguousAssets = errors.New("several zip release assets match the release tag; configure an asset filename regex")

type SelectedSourceKind string

const (
	SourceKindAsset      SelectedSourceKind = "asset"
	SourceKindSourceCode SelectedSourceKind = "source_code"
)

type SelectedAsset struct {
	Kind        SelectedSourceKind
	AssetID     int64
	AssetName   string
	DownloadURL string
	SizeBytes   int64
}

// SelectReleaseAsset selects a matching .zip asset based on assetRegexStr.
// If multiple assets match a configured regex, they are sorted by name and the
// first is chosen. Without a regex, the asset has to answer to the release tag
// exactly once; several such assets are reported as ErrAmbiguousAssets rather
// than resolved by sort order. If nothing matches and allowSourceCode is true,
// the release zipball_url is chosen.
func SelectReleaseAsset(rel Release, assetRegexStr string, allowSourceCode bool) (*SelectedAsset, error) {
	assetRegexStr = strings.TrimSpace(assetRegexStr)
	var matches []Asset

	if assetRegexStr != "" {
		re, err := regexp.Compile(assetRegexStr)
		if err != nil {
			return nil, fmt.Errorf("compile asset regex failed: %w", err)
		}

		for _, a := range rel.Assets {
			if strings.HasSuffix(strings.ToLower(a.Name), ".zip") && re.MatchString(a.Name) {
				matches = append(matches, a)
			}
		}
	} else {
		// No regex means "this operator has no filename preference", not "skip the
		// release's own files": reading it as the latter is how a repository that
		// ships a real release ZIP still ends up serving its source tree.
		//
		// The release's own ZIP is identified by naming, never by picking whichever
		// archive happens to sort first — a repository that publishes several mods
		// (one release carrying another mod's archive too) would otherwise import
		// the wrong one.
		matches = tagMatchingAssets(rel)
		if len(matches) > 1 {
			names := make([]string, 0, len(matches))
			for _, a := range matches {
				names = append(names, a.Name)
			}
			slices.Sort(names)
			return nil, fmt.Errorf("%w: %s", ErrAmbiguousAssets, strings.Join(names, ", "))
		}
		if len(matches) == 0 {
			// A release with exactly one ZIP has no ambiguity to resolve, even when
			// the filename says nothing about the tag (`AI_submod.zip` on a `2.0.0`
			// release). Several unmatched ZIPs stay unresolved: one repository can
			// publish another mod's archive in the same release, and guessing there
			// imports the wrong mod.
			matches = singleZipAsset(rel)
		}
	}

	if len(matches) > 0 {
		slices.SortFunc(matches, func(a, b Asset) int {
			return strings.Compare(a.Name, b.Name)
		})
		chosen := matches[0]
		return &SelectedAsset{
			Kind:        SourceKindAsset,
			AssetID:     chosen.ID,
			AssetName:   chosen.Name,
			DownloadURL: chosen.BrowserDownloadURL,
			SizeBytes:   chosen.Size,
		}, nil
	}

	if allowSourceCode && strings.TrimSpace(rel.ZipballURL) != "" {
		return &SelectedAsset{
			Kind:        SourceKindSourceCode,
			AssetID:     0,
			AssetName:   rel.TagName + "-source.zip",
			DownloadURL: rel.ZipballURL,
			SizeBytes:   0,
		}, nil
	}

	return nil, ErrNoMatchingAsset
}

// tagMatchingAssets returns the release ZIPs whose filename carries the release
// tag, which is the only signal available when no regex was configured. A tag of
// `v1.2.0` is also looked for as `1.2.0`, because the asset and the tag rarely
// agree on the prefix.
func tagMatchingAssets(rel Release) []Asset {
	tag := strings.TrimSpace(rel.TagName)
	if tag == "" {
		return nil
	}
	wanted := []string{strings.ToLower(tag)}
	if trimmed := strings.ToLower(strings.TrimLeft(tag, "vV")); trimmed != "" && trimmed != wanted[0] {
		wanted = append(wanted, trimmed)
	}
	var out []Asset
	for _, a := range rel.Assets {
		if !strings.HasSuffix(strings.ToLower(a.Name), ".zip") {
			continue
		}
		name := strings.ToLower(a.Name)
		for _, w := range wanted {
			if versionTokenIn(name, w) {
				out = append(out, a)
				break
			}
		}
	}
	return out
}

// singleZipAsset returns the release's only ZIP, if it has exactly one.
func singleZipAsset(rel Release) []Asset {
	var zips []Asset
	for _, a := range rel.Assets {
		if strings.HasSuffix(strings.ToLower(a.Name), ".zip") {
			zips = append(zips, a)
		}
	}
	if len(zips) != 1 {
		return nil
	}
	return zips
}

// versionTokenIn reports whether name carries token as a whole version token, so
// a `1.0.0` tag matches `mod-1.0.0.zip` and `mod-v1.0.0-beta.zip` but not
// `mod-11.0.0.zip` (a longer version number that merely contains the digits) nor
// `mod-1.0.0.1.zip` (a different release).
func versionTokenIn(name, token string) bool {
	for offset := 0; offset < len(name); {
		i := strings.Index(name[offset:], token)
		if i < 0 {
			return false
		}
		start := offset + i
		if versionTokenBoundary(name, start, start+len(token)) {
			return true
		}
		offset = start + 1
	}
	return false
}

func versionTokenBoundary(name string, start, end int) bool {
	if start > 0 {
		prev := name[start-1]
		if prev >= '0' && prev <= '9' {
			return false
		}
		if prev == '.' {
			return false
		}
	}
	if end < len(name) {
		next := name[end]
		if next >= '0' && next <= '9' {
			return false
		}
		// `.zip` closes the name, `.1` continues the version number.
		if next == '.' && end+1 < len(name) && name[end+1] >= '0' && name[end+1] <= '9' {
			return false
		}
	}
	return true
}
