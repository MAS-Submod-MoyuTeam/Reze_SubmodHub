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
	if !found["game/mod_assets/monika/j/coat.json"] || !found["game/mod_assets/monika/j/pin.json"] || !found["characters/coat.gift"] {
		t.Fatalf("missing selected files: %v", found)
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
