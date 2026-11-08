package packagezip

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"strings"
	"testing"
)

func TestExternalSpriteArchive(t *testing.T) {
	name := os.Getenv("SUBMODHUB_SPRITE_SAMPLE_ZIP")
	if name == "" {
		t.Skip("set SUBMODHUB_SPRITE_SAMPLE_ZIP to check an external spritepack")
	}
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	report, err := ScanSpriteArchive(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.SpriteSets) == 0 {
		t.Fatal("no sprite sets parsed")
	}
	for _, set := range report.SpriteSets {
		if len(set.Items) == 0 {
			t.Fatalf("set has no JSON items: %+v", set)
		}
	}
	if strings.Contains(name, "和服") {
		if len(report.SpriteSets) != 1 || len(report.SpriteSets[0].Items) != 2 || report.SpriteSets[0].Items[0].PreviewSource == "" || report.SpriteSets[0].Items[1].PreviewSource == "" {
			t.Fatalf("sample preview mapping: %+v", report.SpriteSets)
		}
	}
	ids := make([]string, 0, len(report.SpriteSets))
	for _, set := range report.SpriteSets {
		ids = append(ids, set.ID)
	}
	selected, err := BuildSpriteSelection(bytes.NewReader(b), int64(len(b)), report, ids)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := zip.NewReader(bytes.NewReader(selected), int64(len(selected))); err != nil {
		t.Fatal(err)
	}
	t.Logf("sets=%d items=%d files=%d", len(report.SpriteSets), len(report.Sprites), len(report.Files))
}

func TestScanSpriteArchiveGroupsJSONByContainingSet(t *testing.T) {
	b := archive(t, map[string]string{
		"game/mod_assets/monika/j/coat.json":           `{"name":"coat","select_info":{"display_name":"和服","thumb":"coat","group":"clothes"}}`,
		"game/mod_assets/monika/j/pin.json":            `{"name":"pin","select_info":{"display_name":"发簪","group":"hairpiece_acs"}}`,
		"game/mod_assets/thumbs/clothes-coat.png":      "image",
		"game/mod_assets/monika/c/coat/body-def-0.png": "body",
		"characters/coat.gift":                         "",
	})
	report, err := ScanSpriteArchive(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.SpriteSets) != 1 || len(report.SpriteSets[0].Items) != 2 {
		t.Fatalf("sets: %+v", report.SpriteSets)
	}
	if report.SpriteSets[0].Items[0].DisplayName != "和服" || report.SpriteSets[0].Items[0].PreviewSource != "game/mod_assets/thumbs/clothes-coat.png" {
		t.Fatalf("item metadata: %+v", report.SpriteSets[0].Items[0])
	}
	if report.SpriteSets[0].Items[1].DisplayName != "发簪" {
		t.Fatalf("item name: %+v", report.SpriteSets[0].Items[1])
	}
	selected, err := BuildSpriteSelection(bytes.NewReader(b), int64(len(b)), report, []string{report.SpriteSets[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(selected), int64(len(selected)))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, f := range z.File {
		found[f.Name] = true
	}
	if !found["game/mod_assets/monika/j/coat.json"] || !found["game/mod_assets/monika/j/pin.json"] {
		t.Fatalf("missing selected files: %v", found)
	}
	// The gift token is deliberately dropped: installing it would unlock the item
	// for every player.
	if found["characters/coat.gift"] {
		t.Fatalf("gift token leaked into the selection: %v", found)
	}
	if len(report.SkippedGifts) != 1 || report.SkippedGifts[0] != "characters/coat.gift" {
		t.Fatalf("skipped gifts: %+v", report.SkippedGifts)
	}
}

func TestScanSpriteArchiveSkipsCharactersGifts(t *testing.T) {
	b := archive(t, map[string]string{
		"game/mod_assets/monika/j/coat.json": `{"name":"coat","select_info":{"display_name":"和服"}}`,
		"characters/coat.gift":               "",
		"gifts/other.gift":                   "",
		"characters/notes.txt":               "kept",
		"game/mod_assets/monika/j/pin.json":  `{"name":"pin","select_info":{"display_name":"发簪"}}`,
	})
	report, err := ScanSpriteArchive(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	// Both source layouts that land in `characters/` are skipped; the neighbouring
	// non-gift file is kept so the rule stays scoped to gift tokens.
	want := "characters/coat.gift,gifts/other.gift"
	if strings.Join(report.SkippedGifts, ",") != want {
		t.Fatalf("skipped gifts = %v, want %s", report.SkippedGifts, want)
	}
	for _, set := range report.SpriteSets {
		for _, member := range set.Files {
			if strings.HasSuffix(member.Target, ".gift") {
				t.Fatalf("gift token joined a set: %+v", member)
			}
		}
	}
	ids := make([]string, 0, len(report.SpriteSets))
	for _, set := range report.SpriteSets {
		ids = append(ids, set.ID)
	}
	selected, err := BuildSpriteSelection(bytes.NewReader(b), int64(len(b)), report, ids)
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(selected), int64(len(selected)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range z.File {
		if strings.HasSuffix(f.Name, ".gift") {
			t.Fatalf("gift token leaked into the selection: %s", f.Name)
		}
	}
}

// The gift skip changed what a scan answers for the same archive, so the index
// carries a version: servers cache reports, and an older cache entry must be
// recognised as stale rather than served with tokens inside.
func TestScanSpriteArchiveStampsCurrentIndexVersion(t *testing.T) {
	b := archive(t, map[string]string{
		"game/mod_assets/monika/j/coat.json": `{"name":"coat","select_info":{"display_name":"和服"}}`,
	})
	report, err := ScanSpriteArchive(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if report.SpriteIndexVersion != SpriteIndexVersion {
		t.Fatalf("sprite index version = %d, want %d", report.SpriteIndexVersion, SpriteIndexVersion)
	}
	if SpriteIndexVersion < 3 {
		t.Fatalf("SpriteIndexVersion must stay >= 3 or cached reports with gift tokens are served again")
	}
}

// A report cached before the gift skip still lists the token in its sets, and
// nothing re-derives membership from the archive downstream. The selection has
// to drop it on its own.
func TestBuildSpriteSelectionDropsGiftTokensFromStaleReport(t *testing.T) {
	b := archive(t, map[string]string{
		"Set A/mod_assets/monika/j/coat.json": `{"name":"coat","select_info":{"display_name":"和服"}}`,
		"Set A/gifts/coat.gift":               "unlock",
	})
	var legacy Report
	legacy.SpriteIndexVersion = 2
	legacy.SpriteSets = []SpriteSet{{
		ID:   "stale",
		Name: "Set A",
		Files: []SpriteSetFile{
			{Source: "Set A/mod_assets/monika/j/coat.json", Target: "game/mod_assets/monika/j/coat.json"},
			{Source: "Set A/gifts/coat.gift", Target: "characters/coat.gift"},
		},
	}}

	selected, err := BuildSpriteSelection(bytes.NewReader(b), int64(len(b)), legacy, []string{"stale"})
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(selected), int64(len(selected)))
	if err != nil {
		t.Fatal(err)
	}
	var kept []string
	for _, f := range z.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".gift") {
			t.Fatalf("gift token from a stale report leaked into the selection: %s", f.Name)
		}
		kept = append(kept, f.Name)
	}
	if len(kept) == 0 {
		t.Fatal("selection dropped every member; the sprite JSON should survive")
	}
}

// A `.gift` outside `characters/` is not a sprite unlock marker, so it keeps
// whatever mapping it would otherwise get.
func TestScanSpriteArchiveKeepsGiftsOutsideCharacters(t *testing.T) {	for _, target := range []string{"gift", "characters", "characters2/x.gift", "game/characters/x.gift", "mod_assets/x.gift", "gifts/x.gift"} {
		if spritepackSkipsGift(target) {
			t.Fatalf("%q should not be skipped", target)
		}
	}
	for _, target := range []string{"characters/x.gift", "characters/x.GIFT"} {
		if !spritepackSkipsGift(target) {
			t.Fatalf("%q should be skipped", target)
		}
	}
}

func TestScanSpriteArchiveSeparatesDirectoriesAndRejectsInvalidSelections(t *testing.T) {
	b := archive(t, map[string]string{
		"Alpha/mod_assets/monika/j/a.json": `{"name":"a","select_info":{"display_name":"A"}}`,
		"Alpha/mod_assets/thumbs/a.png":    "a",
		"Beta/mod_assets/monika/j/b.json":  `{"name":"b"}`,
		"Beta/gifts/b.gift":                "",
	})
	report, err := ScanSpriteArchive(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.SpriteSets) != 2 || report.SpriteSets[0].Name != "Alpha" || report.SpriteSets[1].Name != "Beta" {
		t.Fatalf("sets: %+v", report.SpriteSets)
	}
	if report.SpriteSets[1].Items[0].DisplayName != "b" {
		t.Fatalf("fallback name: %+v", report.SpriteSets[1].Items[0])
	}
	if _, err := BuildSpriteSelection(bytes.NewReader(b), int64(len(b)), report, []string{"unknown"}); err == nil {
		t.Fatal("accepted unknown set")
	}
	selected, err := BuildSpriteSelection(bytes.NewReader(b), int64(len(b)), report, []string{report.SpriteSets[1].ID})
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(selected), int64(len(selected)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range z.File {
		if strings.Contains(f.Name, "Alpha") || strings.Contains(f.Name, "a.json") {
			t.Fatalf("leaked other set: %s", f.Name)
		}
		if f.Name == "characters/b.gift" {
			r, _ := f.Open()
			_, _ = io.ReadAll(r)
			_ = r.Close()
		}
	}
}
