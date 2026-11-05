package github

import (
	"errors"
	"strings"
	"testing"
)

func TestSelectReleaseAsset(t *testing.T) {
	rel := Release{
		ID:         101,
		TagName:    "v1.2.0",
		Name:       "v1.2.0",
		ZipballURL: "https://example.com/source.zip",
		Assets: []Asset{
			{ID: 1, Name: "MyMod-v1.2.0-windows.exe", BrowserDownloadURL: "https://example.com/mod.exe"},
			{ID: 2, Name: "MyMod-v1.2.0-z-extra.zip", BrowserDownloadURL: "https://example.com/z.zip"},
			{ID: 3, Name: "MyMod-v1.2.0-a-main.zip", BrowserDownloadURL: "https://example.com/a.zip"},
			{ID: 4, Name: "readme.txt", BrowserDownloadURL: "https://example.com/readme.txt"},
		},
	}

	// 1. Matches only .zip files even if regex is broad
	selected, err := SelectReleaseAsset(rel, "^MyMod.*", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selected.Kind != SourceKindAsset {
		t.Fatalf("expected asset kind, got %s", selected.Kind)
	}
	// Stable alphabetical sorting: a-main.zip comes before z-extra.zip
	if selected.AssetName != "MyMod-v1.2.0-a-main.zip" || selected.AssetID != 3 {
		t.Fatalf("expected stable sort first asset MyMod-v1.2.0-a-main.zip, got %s (ID %d)", selected.AssetName, selected.AssetID)
	}

	// 2. Specific regex matching second zip
	selectedZ, err := SelectReleaseAsset(rel, ".*z-extra\\.zip$", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selectedZ.AssetName != "MyMod-v1.2.0-z-extra.zip" || selectedZ.AssetID != 2 {
		t.Fatalf("expected z-extra.zip, got %s", selectedZ.AssetName)
	}

	// 3. Regex does not match any zip asset, but source code fallback enabled
	relNoMatch := Release{
		ID:         102,
		TagName:    "v2.0.0",
		ZipballURL: "https://example.com/v2.0.0.zip",
		Assets: []Asset{
			{ID: 5, Name: "installer.exe", BrowserDownloadURL: "https://example.com/installer.exe"},
		},
	}
	selectedFallback, err := SelectReleaseAsset(relNoMatch, "^Custom.*\\.zip$", true)
	if err != nil {
		t.Fatalf("unexpected error with fallback: %v", err)
	}
	if selectedFallback.Kind != SourceKindSourceCode {
		t.Fatalf("expected source code kind, got %s", selectedFallback.Kind)
	}
	if selectedFallback.DownloadURL != "https://example.com/v2.0.0.zip" {
		t.Fatalf("unexpected fallback url: %s", selectedFallback.DownloadURL)
	}

	// 4. Regex does not match and source code fallback disabled
	_, errNoMatch := SelectReleaseAsset(relNoMatch, "^Custom.*\\.zip$", false)
	if !errors.Is(errNoMatch, ErrNoMatchingAsset) {
		t.Fatalf("expected ErrNoMatchingAsset, got %v", errNoMatch)
	}

	// 5. Invalid regex
	_, errInvalidRegex := SelectReleaseAsset(rel, "[unclosed-regex", false)
	if errInvalidRegex == nil {
		t.Fatal("expected regex compile error, got nil")
	}
}

// An empty regex is "no filename preference", not "ignore the release's files".
// Reading it as the latter is exactly how a repository that ships a real release
// ZIP ended up serving its source tree instead.
func TestSelectReleaseAssetWithoutRegexPrefersTagAsset(t *testing.T) {
	rel := Release{
		ID:         201,
		TagName:    "1.9.3",
		ZipballURL: "https://example.com/source.zip",
		Assets: []Asset{
			{ID: 11, Name: "NeteaseInMas-1.9.3.zip", BrowserDownloadURL: "https://example.com/mod.zip", Size: 29512592},
			{ID: 12, Name: "checksums.txt", BrowserDownloadURL: "https://example.com/c.txt"},
		},
	}
	selected, err := SelectReleaseAsset(rel, "", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selected.Kind != SourceKindAsset || selected.AssetName != "NeteaseInMas-1.9.3.zip" || selected.AssetID != 11 {
		t.Fatalf("expected the release asset, got %+v", selected)
	}
	if selected.SizeBytes != 29512592 {
		t.Fatalf("size = %d", selected.SizeBytes)
	}
}

// A `v`-prefixed tag still matches an unprefixed filename, which is the common
// case for these repositories.
func TestSelectReleaseAssetWithoutRegexMatchesTrimmedTag(t *testing.T) {
	rel := Release{
		TagName:    "v1.0.6.1",
		ZipballURL: "https://example.com/source.zip",
		Assets:     []Asset{{ID: 21, Name: "outfit-selector-1.0.6.1.zip", BrowserDownloadURL: "https://example.com/o.zip"}},
	}
	selected, err := SelectReleaseAsset(rel, "", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selected.AssetName != "outfit-selector-1.0.6.1.zip" {
		t.Fatalf("asset = %q", selected.AssetName)
	}
}

// Two ZIPs that both answer to the tag leave nothing to choose by: sorting by
// name would just pick one at random from the operator's point of view. The
// ambiguity is reported, and it is reported even when the source-code switch is
// on, because falling back there would publish the source tree instead.
func TestSelectReleaseAssetWithoutRegexRefusesAmbiguousTagMatches(t *testing.T) {
	rel := Release{
		TagName:    "2.0.0",
		ZipballURL: "https://example.com/source.zip",
		Assets: []Asset{
			{ID: 31, Name: "b-mod-2.0.0.zip"},
			{ID: 32, Name: "a-mod-2.0.0.zip"},
		},
	}
	for _, allowSource := range []bool{false, true} {
		_, err := SelectReleaseAsset(rel, "", allowSource)
		if !errors.Is(err, ErrAmbiguousAssets) {
			t.Fatalf("allowSourceCode=%v: expected ErrAmbiguousAssets, got %v", allowSource, err)
		}
		if !strings.Contains(err.Error(), "a-mod-2.0.0.zip, b-mod-2.0.0.zip") {
			t.Fatalf("error should name both candidates: %v", err)
		}
	}
}

// A tag is a version token, not a substring: `1.0.0` must not answer to
// `some-mod-11.0.0.zip`, which is a different release's file. The other ZIP in
// these releases keeps the single-ZIP fallback out of the way, so what is being
// tested is the tag match itself.
func TestSelectReleaseAssetWithoutRegexIgnoresLongerVersionNumbers(t *testing.T) {
	for _, asset := range []string{
		"other-mod-11.0.0.zip",
		"other-mod-1.0.01.zip",
		"other-mod-1.0.0.1.zip",
	} {
		rel := Release{
			TagName:    "1.0.0",
			ZipballURL: "https://example.com/source.zip",
			Assets: []Asset{
				{ID: 71, Name: asset},
				{ID: 72, Name: "checksums-archive.zip"},
			},
		}
		if _, err := SelectReleaseAsset(rel, "", false); !errors.Is(err, ErrNoMatchingAsset) {
			t.Fatalf("%s: expected ErrNoMatchingAsset, got %v", asset, err)
		}
	}
}

// With only one ZIP in the release the single-ZIP rule decides, tag or no tag:
// `11.0.0.zip` alone is still the only package there is, and refusing it would
// leave the mod with nothing to publish.
func TestSelectReleaseAssetWithoutRegexAcceptsLoneZipWithDifferentVersionName(t *testing.T) {
	rel := Release{
		TagName: "1.0.0",
		Assets:  []Asset{{ID: 73, Name: "other-mod-11.0.0.zip"}},
	}
	selected, err := SelectReleaseAsset(rel, "", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selected.AssetName != "other-mod-11.0.0.zip" {
		t.Fatalf("asset = %q", selected.AssetName)
	}
}

// The separator between a version token and the rest of a filename is arbitrary:
// `-`, `_`, `v`, and the `.zip` suffix all sit on the boundary and must match.
func TestSelectReleaseAssetWithoutRegexAcceptsSeparatedVersionTokens(t *testing.T) {
	for _, asset := range []string{
		"mod-1.2.0.zip",
		"mod_v1.2.0.zip",
		"mod 1.2.0 (1).zip",
		"mod-1.2.0-beta.zip",
		"mod.1.2.0.zip",
	} {
		rel := Release{
			TagName: "v1.2.0",
			Assets:  []Asset{{ID: 81, Name: asset}},
		}
		selected, err := SelectReleaseAsset(rel, "", false)
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", asset, err)
		}
		if selected.AssetName != asset {
			t.Fatalf("asset = %q", selected.AssetName)
		}
	}
}

// Several ZIPs that none of them mention the tag cannot be resolved: one
// repository can publish another mod's archive in the same release, so guessing
// would import the wrong mod. The caller's source-code switch then decides
// whether the source tree may stand in.
func TestSelectReleaseAssetWithoutRegexRejectsAmbiguousZips(t *testing.T) {
	rel := Release{
		TagName:    "1.0.1",
		ZipballURL: "https://example.com/source.zip",
		Assets: []Asset{
			{ID: 41, Name: "MAICA_ChatSubmod-1.8.21.zip"},
			{ID: 42, Name: "MAICA_Server_Submod-1.9.0.zip"},
		},
	}
	if _, err := SelectReleaseAsset(rel, "", false); !errors.Is(err, ErrNoMatchingAsset) {
		t.Fatalf("expected ErrNoMatchingAsset, got %v", err)
	}
	fallback, err := SelectReleaseAsset(rel, "", true)
	if err != nil || fallback.Kind != SourceKindSourceCode {
		t.Fatalf("fallback = %+v, %v", fallback, err)
	}
}

// A release with exactly one ZIP needs no tag hint: `AI_submod.zip` on a `2.0.0`
// release is the only candidate there is. Several unmatched ZIPs stay
// unresolved, because one repository can publish another mod's archive too.
func TestSelectReleaseAssetWithoutRegexAcceptsSingleZip(t *testing.T) {
	rel := Release{
		TagName:    "2.0.0",
		ZipballURL: "https://example.com/source.zip",
		Assets:     []Asset{{ID: 51, Name: "AI_submod.zip", BrowserDownloadURL: "https://example.com/ai.zip", Size: 59447}},
	}
	selected, err := SelectReleaseAsset(rel, "", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selected.Kind != SourceKindAsset || selected.AssetName != "AI_submod.zip" {
		t.Fatalf("selected = %+v", selected)
	}

	ambiguous := Release{
		TagName:    "2.0.0",
		ZipballURL: "https://example.com/source.zip",
		Assets: []Asset{
			{ID: 52, Name: "AI_submod.zip"},
			{ID: 53, Name: "other-mod.zip"},
		},
	}
	fallback, err := SelectReleaseAsset(ambiguous, "", true)
	if err != nil || fallback.Kind != SourceKindSourceCode {
		t.Fatalf("ambiguous release = %+v, %v", fallback, err)
	}
}

// A tag-matching asset always outranks the single-ZIP rule, so a release that may
// carry several mods still resolves to the file named after its own tag.
func TestSelectReleaseAssetPrefersTagOverSingleZip(t *testing.T) {
	rel := Release{
		TagName: "1.5.1",
		Assets: []Asset{
			{ID: 61, Name: "MAICA_ChatSubmod-1.8.21.zip"},
			{ID: 62, Name: "MAICA_Server_Submod-1.5.1.zip"},
		},
	}
	selected, err := SelectReleaseAsset(rel, "", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selected.AssetID != 62 {
		t.Fatalf("asset = %q", selected.AssetName)
	}
}
