package github

import (
	"errors"
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
