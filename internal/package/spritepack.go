package packagezip

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"

	"github.com/reze/submodhub/internal/maspath"
)

type SpriteSetFile struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type SpriteSetItem struct {
	DisplayName   string `json:"display_name"`
	JSONSource    string `json:"json_source"`
	PreviewSource string `json:"preview_source,omitempty"`
}

type SpriteSet struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Items []SpriteSetItem `json:"items"`
	Files []SpriteSetFile `json:"files"`
}

func spriteSetPrefix(name string) (string, bool) {
	parts := strings.Split(name, "/")
	for i := 0; i+2 < len(parts); i++ {
		if parts[i] == "mod_assets" && parts[i+1] == "monika" && parts[i+2] == "j" && strings.HasSuffix(strings.ToLower(name), ".json") {
			if i > 0 && parts[i-1] == "game" {
				i--
			}
			return strings.Join(parts[:i], "/"), true
		}
	}
	return "", false
}

func spriteTarget(source, prefix string) (string, bool) {
	rel := strings.TrimPrefix(source, prefix)
	rel = strings.TrimPrefix(rel, "/")
	switch {
	case strings.HasPrefix(rel, "game/mod_assets/"):
		return rel, true
	case strings.HasPrefix(rel, "mod_assets/"):
		return "game/" + rel, true
	case strings.HasPrefix(rel, "characters/"):
		return rel, true
	case strings.HasPrefix(rel, "gifts/"):
		return "characters/" + strings.TrimPrefix(rel, "gifts/"), true
	default:
		return "", false
	}
}

func spriteItem(file *zip.File, members []SpriteSetFile) SpriteSetItem {
	item := SpriteSetItem{JSONSource: file.Name, DisplayName: strings.TrimSuffix(path.Base(file.Name), path.Ext(file.Name))}
	r, err := file.Open()
	if err != nil {
		return item
	}
	defer r.Close()
	var data struct {
		Name       string `json:"name"`
		SelectInfo struct {
			DisplayName string `json:"display_name"`
			Thumb       string `json:"thumb"`
		} `json:"select_info"`
	}
	if json.NewDecoder(io.LimitReader(r, 2<<20)).Decode(&data) != nil {
		return item
	}
	if data.Name != "" {
		item.DisplayName = data.Name
	}
	if data.SelectInfo.DisplayName != "" {
		item.DisplayName = data.SelectInfo.DisplayName
	}
	thumb := data.SelectInfo.Thumb
	if thumb == "" || strings.ContainsAny(thumb, "/\\") {
		return item
	}
	for _, member := range members {
		if !strings.Contains(member.Target, "/mod_assets/thumbs/") {
			continue
		}
		base := strings.TrimSuffix(path.Base(member.Target), path.Ext(member.Target))
		if (base == thumb || strings.HasSuffix(base, "-"+thumb)) && strings.EqualFold(path.Ext(member.Target), ".png") {
			item.PreviewSource = member.Source
			break
		}
	}
	return item
}

// ScanSpriteArchive partitions a legacy spritepack ZIP by the directory enclosing
// each mod_assets tree. Multiple JSON files inside that directory form one set.
func ScanSpriteArchive(reader io.ReaderAt, size int64, limits Limits) (Report, error) {
	result := Report{SpriteIndexVersion: 2}
	limits = limits.defaults()
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return result, err
	}
	if len(z.File) > limits.MaxEntries {
		return result, errors.New("ZIP entry limit exceeded")
	}
	seen := map[string]bool{}
	var total uint64
	files := map[string]*zip.File{}
	prefixes := map[string]bool{}
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		_, key, err := maspath.Validate(name)
		if err != nil {
			return result, err
		}
		if seen[key] {
			return result, fmt.Errorf("colliding ZIP entry %q", name)
		}
		seen[key] = true
		if f.Mode()&0o170000 == 0o120000 {
			return result, fmt.Errorf("symlink entry %q", name)
		}
		if f.FileInfo().IsDir() {
			continue
		}
		if f.UncompressedSize64 > limits.MaxUncompressedBytes-total {
			return result, errors.New("ZIP size limit exceeded")
		}
		total += f.UncompressedSize64
		if f.UncompressedSize64 > 0 && float64(f.UncompressedSize64)/float64(max(f.CompressedSize64, 1)) > limits.MaxCompressionRatio {
			return result, errors.New("ZIP compression ratio exceeded")
		}
		files[f.Name] = f
		if prefix, ok := spriteSetPrefix(f.Name); ok {
			prefixes[prefix] = true
		}
	}
	if len(prefixes) == 0 {
		return result, errors.New("spritepack contains no MAS sprite JSON")
	}
	keys := make([]string, 0, len(prefixes))
	for prefix := range prefixes {
		keys = append(keys, prefix)
	}
	sort.Strings(keys)
	for _, prefix := range keys {
		set := SpriteSet{ID: spriteSetID(prefix), Name: prefix}
		if set.Name == "" {
			set.Name = "精灵包"
		}
		for source := range files {
			if prefix != "" && !strings.HasPrefix(source, prefix+"/") {
				continue
			}
			if prefix == "" && len(keys) > 1 {
				continue
			}
			target, ok := spriteTarget(source, prefix)
			if ok {
				set.Files = append(set.Files, SpriteSetFile{Source: source, Target: target})
			}
		}
		sort.Slice(set.Files, func(i, j int) bool { return set.Files[i].Source < set.Files[j].Source })
		var scanBytes bytes.Buffer
		writer := zip.NewWriter(&scanBytes)
		for _, member := range set.Files {
			if !strings.HasPrefix(member.Target, "game/") {
				continue
			}
			out, err := writer.Create(member.Target)
			if err != nil {
				return result, err
			}
			in, err := files[member.Source].Open()
			if err != nil {
				return result, err
			}
			_, err = io.Copy(out, in)
			_ = in.Close()
			if err != nil {
				return result, err
			}
		}
		if err := writer.Close(); err != nil {
			return result, err
		}
		partial, err := Scan(bytes.NewReader(scanBytes.Bytes()), int64(scanBytes.Len()), limits)
		if err != nil {
			return result, err
		}
		for _, file := range partial.Files {
			for _, member := range set.Files {
				if member.Target == "game/"+file.Target {
					file.Source = member.Source
					break
				}
			}
			result.Files = append(result.Files, file)
		}
		result.Sprites = append(result.Sprites, partial.Sprites...)
		result.Conflicts = append(result.Conflicts, partial.Conflicts...)
		result.Warnings = append(result.Warnings, partial.Warnings...)
		result.Derived = append(result.Derived, partial.Derived...)
		for _, member := range set.Files {
			if !strings.HasSuffix(strings.ToLower(member.Target), ".json") || !strings.Contains(member.Target, "/mod_assets/monika/j/") {
				continue
			}
			set.Items = append(set.Items, spriteItem(files[member.Source], set.Files))
		}
		usedPreviews := map[string]bool{}
		missingIndex := -1
		missingCount := 0
		for i, item := range set.Items {
			if item.PreviewSource != "" {
				usedPreviews[item.PreviewSource] = true
			} else {
				missingIndex = i
				missingCount++
			}
		}
		var remaining []string
		for _, member := range set.Files {
			if strings.Contains(member.Target, "/mod_assets/thumbs/") && strings.EqualFold(path.Ext(member.Target), ".png") && !usedPreviews[member.Source] {
				remaining = append(remaining, member.Source)
			}
		}
		if missingCount == 1 && len(remaining) == 1 {
			set.Items[missingIndex].PreviewSource = remaining[0]
		}
		if len(set.Items) == 0 {
			continue
		}
		result.SpriteSets = append(result.SpriteSets, set)
	}
	targetOwners := map[string]struct {
		source string
		crc    uint32
		size   uint64
	}{}
	for _, set := range result.SpriteSets {
		for _, member := range set.Files {
			f := files[member.Source]
			if previous, ok := targetOwners[member.Target]; ok {
				if previous.crc != f.CRC32 || previous.size != f.UncompressedSize64 {
					result.Warnings = append(result.Warnings, fmt.Sprintf("selected sets share a different file %s (%s, %s); first set wins", member.Target, previous.source, member.Source))
				}
				continue
			}
			targetOwners[member.Target] = struct {
				source string
				crc    uint32
				size   uint64
			}{member.Source, f.CRC32, f.UncompressedSize64}
		}
	}
	return result, nil
}

func spriteSetID(prefix string) string {
	hash := sha256.Sum256([]byte(prefix))
	return "set_" + hex.EncodeToString(hash[:6])
}

// BuildSpriteSelection emits one ZIP rooted at MAS, with deterministic
// first-set-wins deduplication for overlapping legacy assets.
func BuildSpriteSelection(reader io.ReaderAt, size int64, report Report, ids []string) ([]byte, error) {
	if len(ids) == 0 {
		return nil, errors.New("select at least one sprite set")
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	for id := range wanted {
		found := false
		for _, set := range report.SpriteSets {
			if set.ID == id {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("unknown sprite set %q", id)
		}
	}
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return nil, err
	}
	entries := map[string]*zip.File{}
	for _, f := range z.File {
		entries[f.Name] = f
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	seen := map[string]bool{}
	for _, set := range report.SpriteSets {
		if !wanted[set.ID] {
			continue
		}
		for _, member := range set.Files {
			if seen[member.Target] {
				continue
			}
			_, key, err := maspath.Validate(member.Target)
			if err != nil {
				return nil, err
			}
			if seen[key] {
				continue
			}
			f := entries[member.Source]
			if f == nil {
				return nil, fmt.Errorf("missing sprite asset %q", member.Source)
			}
			out, err := writer.Create(member.Target)
			if err != nil {
				return nil, err
			}
			in, err := f.Open()
			if err != nil {
				return nil, err
			}
			_, err = io.Copy(out, in)
			_ = in.Close()
			if err != nil {
				return nil, err
			}
			seen[member.Target] = true
			seen[key] = true
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
