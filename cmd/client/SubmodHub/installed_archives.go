package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	packagezip "github.com/reze/submodhub/internal/package"
)

type InstalledArchive struct {
	ModID                  string    `json:"mod_id"`
	VersionID              string    `json:"version_id"`
	Version                string    `json:"version"`
	Title                  string    `json:"title"`
	Author                 string    `json:"author,omitempty"`
	Category               string    `json:"category,omitempty"`
	OperationID            string    `json:"operation_id"`
	Priority               int       `json:"priority"`
	Files                  int       `json:"files"`
	SizeBytes              int64     `json:"size_bytes"`
	SHA256                 string    `json:"sha256"`
	InstalledAt            time.Time `json:"installed_at"`
	SubmodDirs             []string  `json:"submod_dirs"`
	SpriteSetIDs           []string  `json:"sprite_set_ids,omitempty"`
	SpriteSelectionHash    string    `json:"sprite_selection_hash,omitempty"`
	SelectedSpriteSetCount int       `json:"selected_sprite_set_count,omitempty"`
}

func (s *DesktopService) installedArchivesPath() string {
	return filepath.Join(s.root, ".submodhub", "installed-archives.json")
}

func (s *DesktopService) ListInstalledArchives() ([]InstalledArchive, error) {
	if err := s.checkStorageAccess(); err != nil {
		return nil, err
	}
	if s.root == "" {
		return nil, errors.New("mas_root_not_configured")
	}
	data, err := os.ReadFile(s.installedArchivesPath())
	if os.IsNotExist(err) {
		return []InstalledArchive{}, nil
	}
	if err != nil {
		return nil, err
	}
	var receipts []InstalledArchive
	if err := json.Unmarshal(data, &receipts); err != nil {
		return nil, err
	}
	if receipts == nil {
		receipts = []InstalledArchive{}
	}
	if s.core != nil {
		if manifest, mErr := s.core.LoadManifest(); mErr == nil && manifest != nil {
			for i := range receipts {
				if inst := manifest.Installations[receipts[i].ModID]; inst != nil {
					receipts[i].Priority = inst.Priority
				} else {
					for _, cand := range manifest.Installations {
						if cand.ModID == receipts[i].ModID {
							receipts[i].Priority = cand.Priority
							break
						}
					}
				}
			}
		}
	}
	return receipts, nil
}

func (s *DesktopService) saveInstalledArchives(receipts []InstalledArchive) error {
	path := s.installedArchivesPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(receipts, "", "  ")
	if err != nil {
		return err
	}
	temp := path + ".tmp"
	if err := os.WriteFile(temp, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(temp, path); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}

func (s *DesktopService) projectedInstalledArchives(request ArchiveInstallRequest, report packagezip.Report, hash string, size int64, spriteSetIDs []string, spriteSelectionHash string, selectedSpriteSetCount int) ([]InstalledArchive, error) {
	receipts, err := s.ListInstalledArchives()
	if err != nil {
		return nil, err
	}
	dirs := map[string]bool{}
	for _, file := range report.Files {
		parts := strings.Split(filepath.ToSlash(file.Target), "/")
		if len(parts) >= 3 && strings.EqualFold(parts[0], "Submods") {
			dirs[parts[1]] = true
		}
	}
	submodDirs := make([]string, 0, len(dirs))
	for dir := range dirs {
		submodDirs = append(submodDirs, dir)
	}
	sort.Strings(submodDirs)
	next := make([]InstalledArchive, 0, len(receipts)+1)
	for _, receipt := range receipts {
		if receipt.ModID != request.ModID {
			next = append(next, receipt)
		}
	}
	prio := request.Priority
	for _, cur := range receipts {
		if cur.ModID == request.ModID && prio == 0 && cur.Priority != 0 {
			prio = cur.Priority
		}
	}
	next = append(next, InstalledArchive{
		Priority:               prio,
		ModID:                  request.ModID,
		VersionID:              request.VersionID,
		Version:                request.Version,
		Title:                  request.Title,
		Author:                 request.Author,
		Category:               request.Category,
		OperationID:            request.OperationID,
		Files:                  len(report.Files),
		SizeBytes:              size,
		SHA256:                 hash,
		InstalledAt:            time.Now().UTC(),
		SubmodDirs:             submodDirs,
		SpriteSetIDs:           spriteSetIDs,
		SpriteSelectionHash:    spriteSelectionHash,
		SelectedSpriteSetCount: selectedSpriteSetCount,
	})
	return next, nil
}

func (s *DesktopService) projectedRemoveInstalledArchive(targetID string) ([]InstalledArchive, error) {
	receipts, err := s.ListInstalledArchives()
	if err != nil {
		return nil, err
	}
	next := make([]InstalledArchive, 0, len(receipts))
	for _, receipt := range receipts {
		if receipt.OperationID != targetID && receipt.ModID != targetID {
			next = append(next, receipt)
		}
	}
	return next, nil
}

func (s *DesktopService) recordInstalledArchive(request ArchiveInstallRequest, report packagezip.Report, hash string, size int64, spriteSetIDs []string, spriteSelectionHash string, selectedSpriteSetCount int) error {
	next, err := s.projectedInstalledArchives(request, report, hash, size, spriteSetIDs, spriteSelectionHash, selectedSpriteSetCount)
	if err != nil {
		return err
	}
	return s.saveInstalledArchives(next)
}

func (s *DesktopService) removeInstalledArchive(targetID string) error {
	next, err := s.projectedRemoveInstalledArchive(targetID)
	if err != nil {
		return err
	}
	if len(next) == 0 {
		receipts, _ := s.ListInstalledArchives()
		if len(receipts) == 0 {
			return nil
		}
	}
	return s.saveInstalledArchives(next)
}
