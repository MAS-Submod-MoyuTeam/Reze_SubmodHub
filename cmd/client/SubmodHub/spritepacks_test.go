package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSpritepackScanAndGift(t *testing.T) {
	root := t.TempDir()
	game := filepath.Join(root, "game")
	for _, dir := range []string{"mod_assets/monika/j", "mod_assets/monika/c/shirt", "mod_assets/thumbs"} {
		if err := os.MkdirAll(filepath.Join(game, filepath.FromSlash(dir)), 0755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(path, value string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(game, filepath.FromSlash(path)), []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("mod_assets/monika/j/shirt.json", `{"type":2,"name":"shirt","img_sit":"shirt","giftname":"shirtgift","select_info":{"display_name":"Pink Shirt","group":"casual","thumb":"shirt"}}`)
	write("mod_assets/monika/c/shirt/body-def-0.png", "image")
	write("mod_assets/thumbs/clothes-shirt.png", "preview")
	service := &DesktopService{root: root}
	items, err := service.ScanInstalledSpritepacks()
	if err != nil || len(items) != 1 || !items[0].Complete || items[0].Preview == "" || items[0].Group != "casual" {
		t.Fatalf("scan: %+v, %v", items, err)
	}
	if _, err := service.CreateSpriteGift("shirt.json"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "characters", "shirtgift.gift")); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateSpriteGift("shirt.json"); err == nil || !strings.Contains(err.Error(), "sprite_gift_already_exists") {
		t.Fatalf("expected stable existing gift error, got %v", err)
	}
	if _, err := service.CreateSpriteGift("../shirt.json"); err == nil {
		t.Fatal("accepted traversal")
	}
	if err := os.Remove(filepath.Join(game, "mod_assets", "monika", "c", "shirt", "body-def-0.png")); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateSpriteGift("shirt.json"); err == nil {
		t.Fatal("accepted incomplete pack")
	}
}

func TestDeleteSpritepackKeepsSharedAssetsAndBacksUp(t *testing.T) {
	root := t.TempDir()
	game := filepath.Join(root, "game", "mod_assets")
	for _, dir := range []string{"monika/j", "monika/a", "thumbs"} {
		if err := os.MkdirAll(filepath.Join(game, filepath.FromSlash(dir)), 0755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(path, value string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(game, filepath.FromSlash(path)), []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("monika/j/one.json", `{"type":0,"name":"one","img_sit":"shared","select_info":{"thumb":"shared"}}`)
	write("monika/j/two.json", `{"type":0,"name":"two","img_sit":"shared","select_info":{"thumb":"shared"}}`)
	write("monika/a/acs-shared-0.png", "image")
	write("thumbs/acs-shared.png", "preview")
	service := &DesktopService{root: root}
	if _, err := service.DeleteSpritepack("../one.json"); err == nil {
		t.Fatal("accepted traversal")
	}
	result, err := service.DeleteSpritepack("one.json")
	if err != nil || result.Files != 1 {
		t.Fatalf("delete shared: %+v, %v", result, err)
	}
	if _, err := os.Stat(filepath.Join(game, "monika/j/one.json")); !os.IsNotExist(err) {
		t.Fatal("JSON remains")
	}
	if _, err := os.Stat(filepath.Join(game, "monika/a/acs-shared-0.png")); err != nil {
		t.Fatal("shared image removed")
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(result.Backup), "game/mod_assets/monika/j/one.json")); err != nil {
		t.Fatal("backup missing", err)
	}
	result, err = service.DeleteSpritepack("two.json")
	if err != nil || result.Files != 3 {
		t.Fatalf("delete unique: %+v, %v", result, err)
	}
	if _, err := os.Stat(filepath.Join(game, "monika/a/acs-shared-0.png")); !os.IsNotExist(err) {
		t.Fatal("image remains")
	}
	if _, err := os.Stat(filepath.Join(game, "thumbs/acs-shared.png")); !os.IsNotExist(err) {
		t.Fatal("thumb remains")
	}
}

func TestDeleteSpritepackWithUnknownReferencesKeepsAssets(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "game", "mod_assets")
	for _, dir := range []string{"monika/j", "monika/c/shirt", "thumbs"} {
		if err := os.MkdirAll(filepath.Join(base, filepath.FromSlash(dir)), 0755); err != nil {
			t.Fatal(err)
		}
	}
	for name, data := range map[string]string{
		"monika/j/shirt.json":           `{"type":2,"name":"shirt","img_sit":"shirt","select_info":{"thumb":"shirt"}}`,
		"monika/j/broken.json":          `{`,
		"monika/c/shirt/body-def-0.png": "image",
		"thumbs/clothes-shirt.png":      "preview",
	} {
		if err := os.WriteFile(filepath.Join(base, filepath.FromSlash(name)), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	result, err := (&DesktopService{root: root}).DeleteSpritepack("shirt.json")
	if err != nil || result.Files != 1 {
		t.Fatalf("unexpected removal: %+v, %v", result, err)
	}
	if _, err := os.Stat(filepath.Join(base, "monika/c/shirt/body-def-0.png")); err != nil {
		t.Fatal("image removed")
	}
	if _, err := os.Stat(filepath.Join(base, "thumbs/clothes-shirt.png")); err != nil {
		t.Fatal("thumb removed")
	}
}

func TestDeleteSpritepackPreservesMASWhitelistFiles(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "game", "mod_assets", "monika")
	for _, dir := range []string{"j", "c/bath_towel_white"} {
		if err := os.MkdirAll(filepath.Join(base, filepath.FromSlash(dir)), 0755); err != nil {
			t.Fatal(err)
		}
	}
	for name, data := range map[string]string{
		"j/towel.json":                      `{"type":2,"name":"towel","img_sit":"bath_towel_white"}`,
		"c/bath_towel_white/body-def-0.png": "protected",
		"c/bath_towel_white/custom.png":     "unprotected",
	} {
		if err := os.WriteFile(filepath.Join(base, filepath.FromSlash(name)), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	result, err := (&DesktopService{root: root}).DeleteSpritepack("towel.json")
	if err != nil || result.Files != 2 {
		t.Fatalf("unexpected removal: %+v, %v", result, err)
	}
	if _, err := os.Stat(filepath.Join(base, "c/bath_towel_white/body-def-0.png")); err != nil {
		t.Fatal("protected file removed")
	}
	if _, err := os.Stat(filepath.Join(base, "c/bath_towel_white/custom.png")); !os.IsNotExist(err) {
		t.Fatal("custom file remains")
	}
}
