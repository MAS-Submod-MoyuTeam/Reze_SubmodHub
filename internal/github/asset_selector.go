package github

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

var ErrNoMatchingAsset = errors.New("no matching zip release asset found and source code fallback is disabled")

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
// If multiple assets match, they are sorted by name and the first is chosen.
// If no asset matches and allowSourceCode is true, the release zipball_url is chosen.
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
