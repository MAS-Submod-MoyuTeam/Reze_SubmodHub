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
	ModID       string    `json:"mod_id"`
	VersionID   string    `json:"version_id"`
	Version     string    `json:"version"`
	Title       string    `json:"title"`
	OperationID string    `json:"operation_id"`
	Files       int       `json:"files"`
	SizeBytes   int64     `json:"size_bytes"`
	SHA256      string    `json:"sha256"`
	InstalledAt time.Time `json:"installed_at"`
	SubmodDirs  []string  `json:"submod_dirs"`
}

func (s *DesktopService) installedArchivesPath() string {
	return filepath.Join(s.root, ".submodhub", "installed-archives.json")
}

func (s *DesktopService) ListInstalledArchives() ([]InstalledArchive, error) {
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
		return []InstalledArchive{}, nil
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

func (s *DesktopService) recordInstalledArchive(request ArchiveInstallRequest, report packagezip.Report, hash string, size int64) error {
	receipts, err := s.ListInstalledArchives()
	if err != nil {
		return err
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
	next = append(next, InstalledArchive{ModID: request.ModID, VersionID: request.VersionID, Version: request.Version, Title: request.Title, OperationID: request.OperationID, Files: len(report.Files), SizeBytes: size, SHA256: hash, InstalledAt: time.Now().UTC(), SubmodDirs: submodDirs})
	return s.saveInstalledArchives(next)
}

func (s *DesktopService) removeInstalledArchive(operationID string) error {
	receipts, err := s.ListInstalledArchives()
	if err != nil {
		return err
	}
	next := make([]InstalledArchive, 0, len(receipts))
	for _, receipt := range receipts {
		if receipt.OperationID != operationID {
			next = append(next, receipt)
		}
	}
	if len(next) == len(receipts) {
		return nil
	}
	return s.saveInstalledArchives(next)
}
