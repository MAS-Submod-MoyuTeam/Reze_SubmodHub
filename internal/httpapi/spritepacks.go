package httpapi

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	packagezip "github.com/reze/submodhub/internal/package"
)

type publicSpriteItem struct {
	DisplayName string `json:"display_name"`
	PreviewURL  string `json:"preview_url,omitempty"`
}

type publicSpriteSet struct {
	ID    string             `json:"id"`
	Name  string             `json:"name"`
	Items []publicSpriteItem `json:"items"`
}

func (s *Store) spritepackResource(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method is not supported")
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/spritepacks/"), "/"), "/")
	if len(parts) < 1 || len(parts) > 2 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "not_found", "spritepack was not found")
		return
	}
	modID := parts[0]
	s.mu.RLock()
	var mod Mod
	for _, candidate := range s.Catalog.Mods {
		if candidate.ID == modID {
			mod = candidate
			break
		}
	}
	v, ok := s.Catalog.Versions[mod.LatestVersionID]
	report := s.Catalog.ScanReports[v.ScanReportID]
	s.mu.RUnlock()
	if mod.ID == "" || mod.Category != "spritepack" || !ok || v.ModID != modID || v.State != "published" {
		writeError(w, http.StatusNotFound, "not_found", "published spritepack was not found")
		return
	}
	if report.SpriteIndexVersion < 2 {
		file, err := os.Open(v.ArchivePath)
		if err != nil {
			writeError(w, 404, "not_found", "archive was not found")
			return
		}
		info, statErr := file.Stat()
		if statErr != nil {
			_ = file.Close()
			writeError(w, 404, "not_found", "archive was not found")
			return
		}
		report, err = packagezip.ScanSpriteArchive(file, info.Size(), packagezip.Limits{})
		_ = file.Close()
		if err != nil {
			writeError(w, 422, "invalid_spritepack", err.Error())
			return
		}
		s.mu.Lock()
		if current := s.Catalog.Versions[mod.LatestVersionID]; current.ID == v.ID {
			if s.Catalog.ScanReports == nil {
				s.Catalog.ScanReports = map[string]packagezip.Report{}
			}
			s.Catalog.ScanReports[v.ScanReportID] = report
			if err := s.saveLocked(); err != nil {
				s.mu.Unlock()
				writeError(w, 500, "storage_error", "sprite index was not saved")
				return
			}
		}
		s.mu.Unlock()
	}
	if len(parts) == 1 {
		sets := make([]publicSpriteSet, 0, len(report.SpriteSets))
		for _, set := range report.SpriteSets {
			entry := publicSpriteSet{ID: set.ID, Name: set.Name, Items: []publicSpriteItem{}}
			for i, item := range set.Items {
				public := publicSpriteItem{DisplayName: item.DisplayName}
				if item.PreviewSource != "" {
					public.PreviewURL = fmt.Sprintf("/api/v1/spritepacks/%s/preview?set=%s&item=%d", modID, set.ID, i)
				}
				entry.Items = append(entry.Items, public)
			}
			sets = append(sets, entry)
		}
		writeJSON(w, http.StatusOK, map[string]any{"sets": sets})
		return
	}
	switch parts[1] {
	case "preview":
		setID := r.URL.Query().Get("set")
		index, err := strconv.Atoi(r.URL.Query().Get("item"))
		if err != nil || index < 0 {
			writeError(w, 400, "invalid_selection", "invalid sprite item")
			return
		}
		var source string
		for _, set := range report.SpriteSets {
			if set.ID == setID && index < len(set.Items) {
				source = set.Items[index].PreviewSource
				break
			}
		}
		if source == "" {
			writeError(w, 404, "not_found", "preview was not found")
			return
		}
		file, err := os.Open(v.ArchivePath)
		if err != nil {
			writeError(w, 404, "not_found", "archive was not found")
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			writeError(w, 404, "not_found", "archive was not found")
			return
		}
		archive, err := zip.NewReader(file, info.Size())
		if err != nil {
			writeError(w, 500, "storage_error", "archive is invalid")
			return
		}
		for _, member := range archive.File {
			if member.Name != source {
				continue
			}
			if member.UncompressedSize64 > 5<<20 {
				writeError(w, 413, "preview_too_large", "preview is too large")
				return
			}
			stream, err := member.Open()
			if err != nil {
				writeError(w, 500, "storage_error", "preview is unreadable")
				return
			}
			defer stream.Close()
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Cache-Control", "public, max-age=3600")
			_, _ = io.Copy(w, io.LimitReader(stream, 5<<20))
			return
		}
		writeError(w, 404, "not_found", "preview was not found")
	case "download":
		ids := strings.Split(r.URL.Query().Get("sets"), ",")
		if len(ids) == 0 || len(ids) > len(report.SpriteSets) {
			writeError(w, 400, "invalid_selection", "select one or more sprite sets")
			return
		}
		file, err := os.Open(v.ArchivePath)
		if err != nil {
			writeError(w, 404, "not_found", "archive was not found")
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			writeError(w, 404, "not_found", "archive was not found")
			return
		}
		b, err := packagezip.BuildSpriteSelection(file, info.Size(), report, ids)
		if err != nil {
			writeError(w, 400, "invalid_selection", err.Error())
			return
		}
		if len(b) > 64<<20 {
			writeError(w, 413, "download_too_large", "selected ZIP exceeds 64 MiB")
			return
		}
		hash := sha256.Sum256(b)
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"spritepack_%s.zip\"", modID))
		w.Header().Set("Content-Length", strconv.Itoa(len(b)))
		w.Header().Set("X-Archive-SHA256", hex.EncodeToString(hash[:]))
		_, _ = io.Copy(w, bytes.NewReader(b))
	default:
		writeError(w, http.StatusNotFound, "not_found", "spritepack endpoint was not found")
	}
}
