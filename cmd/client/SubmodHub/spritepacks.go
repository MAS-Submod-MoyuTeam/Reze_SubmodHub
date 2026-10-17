package main

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Spritepack struct {
	File     string   `json:"file"`
	Name     string   `json:"name"`
	Author   string   `json:"author"`
	Kind     string   `json:"kind"`
	Group    string   `json:"group"`
	GiftName string   `json:"giftname"`
	Complete bool     `json:"complete"`
	Missing  []string `json:"missing"`
	Preview  string   `json:"preview"`
}

type spriteJSON struct {
	Type     int    `json:"type"`
	Name     string `json:"name"`
	Author   string `json:"__author"`
	Image    string `json:"img_sit"`
	GiftName string `json:"giftname"`
	Select   struct {
		DisplayName string `json:"display_name"`
		Group       string `json:"group"`
		Thumb       string `json:"thumb"`
	} `json:"select_info"`
}

var spriteName = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

//go:embed spritepack_whitelist.txt
var masSpriteWhitelistText string

func isMASWhitelisted(root, path string) bool {
	rel, err := filepath.Rel(filepath.Join(root, "game", "mod_assets", "monika"), path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	key := strings.ToLower(filepath.ToSlash(rel))
	for _, line := range strings.Split(masSpriteWhitelistText, "\n") {
		if strings.ToLower(strings.TrimSpace(strings.TrimPrefix(line, "\ufeff"))) == key {
			return true
		}
	}
	return false
}

func (s *DesktopService) spritepack(file string) (Spritepack, error) {
	if file != filepath.Base(file) || !strings.EqualFold(filepath.Ext(file), ".json") {
		return Spritepack{}, errors.New("invalid_spritepack_file")
	}
	data, err := os.ReadFile(filepath.Join(s.root, "game", "mod_assets", "monika", "j", file))
	if err != nil {
		return Spritepack{}, err
	}
	var spec spriteJSON
	if err := json.Unmarshal(data, &spec); err != nil {
		return Spritepack{}, err
	}
	item := Spritepack{File: file, Name: spec.Select.DisplayName, Author: spec.Author, Group: strings.TrimSpace(spec.Select.Group), GiftName: spec.GiftName, Missing: []string{}}
	if item.Name == "" {
		item.Name = spec.Name
	}
	var dir, prefix, thumbPrefix string
	switch spec.Type {
	case 0:
		dir, prefix, thumbPrefix, item.Kind = "a", "acs-", "acs-", "配饰"
	case 1:
		dir, prefix, thumbPrefix, item.Kind = "h", "hair-", "hair-", "发型"
	case 2:
		dir, prefix, thumbPrefix, item.Kind = "c", "", "clothes-", "服装"
	default:
		item.Missing = append(item.Missing, "无效类型")
		return item, nil
	}
	if !spriteName.MatchString(spec.Name) || !spriteName.MatchString(spec.Image) {
		item.Missing = append(item.Missing, "无效名称或图片代码")
		return item, nil
	}
	base := filepath.Join(s.root, "game", "mod_assets")
	assetDir := filepath.Join(base, "monika", dir)
	if spec.Type == 2 {
		assetDir = filepath.Join(assetDir, spec.Image)
	}
	entries, err := os.ReadDir(assetDir)
	found := false
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasPrefix(entry.Name(), prefix+spec.Image) && strings.EqualFold(filepath.Ext(entry.Name()), ".png") {
				found = true
				break
			}
			if spec.Type == 2 && !entry.IsDir() && strings.HasPrefix(entry.Name(), "body-") && strings.EqualFold(filepath.Ext(entry.Name()), ".png") {
				found = true
				break
			}
		}
	}
	if !found {
		item.Missing = append(item.Missing, "精灵图片")
	}
	if spec.Select.Thumb != "" {
		if !spriteName.MatchString(spec.Select.Thumb) {
			item.Missing = append(item.Missing, "无效缩略图代码")
		} else {
			preview, readErr := os.ReadFile(filepath.Join(base, "thumbs", thumbPrefix+spec.Select.Thumb+".png"))
			if readErr != nil {
				item.Missing = append(item.Missing, "缩略图")
			} else if len(preview) <= 2<<20 {
				item.Preview = "data:image/png;base64," + base64.StdEncoding.EncodeToString(preview)
			}
		}
	}
	item.Complete = len(item.Missing) == 0
	return item, nil
}

func (s *DesktopService) ScanInstalledSpritepacks() ([]Spritepack, error) {
	if err := s.checkStorageAccess(); err != nil {
		return nil, err
	}
	if s.root == "" {
		return nil, errors.New("mas_root_not_configured")
	}
	base := filepath.Join(s.root, "game", "mod_assets", "monika", "j")
	entries, err := os.ReadDir(base)
	if os.IsNotExist(err) {
		return []Spritepack{}, nil
	}
	if err != nil {
		return nil, err
	}
	items := make([]Spritepack, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		item, scanErr := s.spritepack(entry.Name())
		if scanErr != nil {
			items = append(items, Spritepack{File: entry.Name(), Name: entry.Name(), Missing: []string{"JSON 无法读取或解析"}})
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *DesktopService) CreateSpriteGift(file string) (string, error) {
	if err := s.checkStorageAccess(); err != nil {
		return "", err
	}
	if s.root == "" {
		return "", errors.New("mas_root_not_configured")
	}
	item, err := s.spritepack(file)
	if err != nil {
		return "", err
	}
	if !item.Complete {
		return "", errors.New("spritepack_incomplete")
	}
	if !spriteName.MatchString(item.GiftName) {
		return "", errors.New("spritepack_has_no_valid_giftname")
	}
	dir := filepath.Join(s.root, "characters")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, item.GiftName+".gift")
	gift, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return "", errors.New("sprite_gift_already_exists")
		}
		return "", err
	}
	if err := gift.Close(); err != nil {
		return "", err
	}
	return fmt.Sprintf("characters/%s.gift", item.GiftName), nil
}

type SpritepackDeleteResult struct {
	Files  int    `json:"files"`
	Backup string `json:"backup"`
}

func (s *DesktopService) DeleteSpritepack(file string) (SpritepackDeleteResult, error) {
	if err := s.checkStorageAccess(); err != nil {
		return SpritepackDeleteResult{}, err
	}
	if s.root == "" || !fileExists(filepath.Join(s.root, "game")) {
		return SpritepackDeleteResult{}, errors.New("mas_root_not_configured")
	}
	if file != filepath.Base(file) || !strings.EqualFold(filepath.Ext(file), ".json") {
		return SpritepackDeleteResult{}, errors.New("invalid_spritepack_file")
	}
	game := filepath.Join(s.root, "game")
	jsonDir := filepath.Join(game, "mod_assets", "monika", "j")
	target := filepath.Join(jsonDir, file)
	if isMASWhitelisted(s.root, target) {
		return SpritepackDeleteResult{}, errors.New("spritepack_is_mas_whitelisted")
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return SpritepackDeleteResult{}, err
	}
	paths := []string{target}
	var spec spriteJSON
	if json.Unmarshal(data, &spec) == nil && spriteName.MatchString(spec.Image) {
		entries, readErr := os.ReadDir(jsonDir)
		if readErr != nil {
			return SpritepackDeleteResult{}, readErr
		}
		imageShared, thumbShared, unknownReferences := false, false, false
		for _, entry := range entries {
			if entry.IsDir() || entry.Name() == file || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
				continue
			}
			otherData, readErr := os.ReadFile(filepath.Join(jsonDir, entry.Name()))
			var other spriteJSON
			if readErr != nil || json.Unmarshal(otherData, &other) != nil {
				unknownReferences = true
				continue
			}
			if other.Type == spec.Type && other.Image == spec.Image {
				imageShared = true
			}
			if other.Type == spec.Type && other.Select.Thumb == spec.Select.Thumb {
				thumbShared = true
			}
		}
		base := filepath.Join(game, "mod_assets")
		if !imageShared && !unknownReferences {
			switch spec.Type {
			case 0, 1:
				dir, prefix := "a", "acs-"
				if spec.Type == 1 {
					dir, prefix = "h", "hair-"
				}
				assets, readErr := os.ReadDir(filepath.Join(base, "monika", dir))
				if readErr != nil && !os.IsNotExist(readErr) {
					return SpritepackDeleteResult{}, readErr
				}
				for _, asset := range assets {
					if !asset.IsDir() && strings.HasPrefix(asset.Name(), prefix+spec.Image+"-") && strings.EqualFold(filepath.Ext(asset.Name()), ".png") && !isMASWhitelisted(s.root, filepath.Join(base, "monika", dir, asset.Name())) {
						paths = append(paths, filepath.Join(base, "monika", dir, asset.Name()))
					}
				}
			case 2:
				assetDir := filepath.Join(base, "monika", "c", spec.Image)
				if info, statErr := os.Lstat(assetDir); statErr == nil && info.IsDir() {
					walkErr := filepath.WalkDir(assetDir, func(path string, entry os.DirEntry, err error) error {
						if err != nil {
							return err
						}
						if !entry.IsDir() && !isMASWhitelisted(s.root, path) {
							paths = append(paths, path)
						}
						return nil
					})
					if walkErr != nil {
						return SpritepackDeleteResult{}, walkErr
					}
				} else if statErr != nil && !os.IsNotExist(statErr) {
					return SpritepackDeleteResult{}, statErr
				}
			}
		}
		if spec.Select.Thumb != "" && spriteName.MatchString(spec.Select.Thumb) && !thumbShared && !unknownReferences {
			prefix := []string{"acs-", "hair-", "clothes-"}
			if spec.Type >= 0 && spec.Type < len(prefix) {
				thumb := filepath.Join(base, "thumbs", prefix[spec.Type]+spec.Select.Thumb+".png")
				if _, statErr := os.Lstat(thumb); statErr == nil {
					paths = append(paths, thumb)
				} else if !os.IsNotExist(statErr) {
					return SpritepackDeleteResult{}, statErr
				}
			}
		}
	}
	backup := filepath.Join(".submodhub", "spritepack-backups", fmt.Sprintf("%d", time.Now().UnixNano()))
	backupRoot := filepath.Join(s.root, backup)
	moved := make([]string, 0, len(paths))
	for _, path := range paths {
		rel, relErr := filepath.Rel(s.root, path)
		if relErr != nil {
			return SpritepackDeleteResult{}, relErr
		}
		destination := filepath.Join(backupRoot, rel)
		if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
			rollbackSpritepackFiles(moved, s.root, backupRoot)
			return SpritepackDeleteResult{}, err
		}
		if err := os.Rename(path, destination); err != nil {
			rollbackSpritepackFiles(moved, s.root, backupRoot)
			return SpritepackDeleteResult{}, err
		}
		moved = append(moved, path)
	}
	return SpritepackDeleteResult{Files: len(moved), Backup: filepath.ToSlash(backup)}, nil
}

func rollbackSpritepackFiles(paths []string, root, backupRoot string) {
	for i := len(paths) - 1; i >= 0; i-- {
		rel, err := filepath.Rel(root, paths[i])
		if err == nil {
			_ = os.Rename(filepath.Join(backupRoot, rel), paths[i])
		}
	}
}
