package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/reze/submodhub/internal/install"
	packagezip "github.com/reze/submodhub/internal/package"
)

const (
	MaxScanFiles            = 10000
	MaxScanTotalBytes       = 500 * 1024 * 1024 // 500 MB
	MaxRegistrationsPerItem = 128
)

// SubmodRegistration is a single Submod(...) registration extracted from a script.
type SubmodRegistration struct {
	Name                string                        `json:"name"`
	Author              string                        `json:"author,omitempty"`
	Version             string                        `json:"version,omitempty"`
	Source              string                        `json:"source"`
	Unknown             bool                          `json:"unknown"`
	Dependencies        []packagezip.SubmodDependency `json:"dependencies,omitempty"`
	DependenciesUnknown bool                          `json:"dependencies_unknown,omitempty"`
}

// LocalSubmod represents an unmanaged submod directory or root-scattered group.
type LocalSubmod struct {
	ID            string               `json:"id"`
	Directory     string               `json:"directory"`
	Name          string               `json:"name"`
	Author        string               `json:"author,omitempty"`
	Version       string               `json:"version"`
	Registrations []SubmodRegistration `json:"registrations"`
	Files         []LocalSubmodFile    `json:"files"`
	Warnings      []string             `json:"warnings,omitempty"`
	Incomplete    bool                 `json:"incomplete,omitempty"`
}

type LocalSubmodFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

func canonicalizePathKey(rel string) string {
	clean := filepath.ToSlash(filepath.Clean(rel))
	if runtime.GOOS == "windows" {
		return strings.ToLower(clean)
	}
	return clean
}

// scanLocalSubmodsCore performs file-level discovery of unmanaged submods in game/Submods.
func scanLocalSubmodsCore(masRoot string, manifest *install.Manifest) ([]LocalSubmod, error) {
	if masRoot == "" {
		return nil, errors.New("mas_root_not_configured")
	}

	// 1. Build set of managed canonical file keys from manifest
	managedKeys := make(map[string]bool)
	if manifest != nil {
		for _, inst := range manifest.Installations {
			if inst == nil {
				continue
			}
			for _, p := range inst.Paths {
				managedKeys[canonicalizePathKey(p)] = true
			}
		}
		for key := range manifest.Files {
			managedKeys[canonicalizePathKey(key)] = true
		}
	}

	base := filepath.Join(masRoot, "game", "Submods")
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return []LocalSubmod{}, nil
		}
		return nil, err
	}

	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		realBase = base
	}

	totalFilesScanned := 0
	var totalBytesScanned int64 = 0

	result := make([]LocalSubmod, 0)
	var rootScatteredFiles []LocalSubmodFile
	var rootScatteredRegs []SubmodRegistration
	var rootScatteredWarnings []string
	rootScatteredIncomplete := false

	// Helper to process a single file
	processFile := func(fullPath string, relToGame string) (*LocalSubmodFile, []SubmodRegistration, []string, error) {
		info, statErr := os.Lstat(fullPath)
		if statErr != nil {
			return nil, nil, []string{"cannot stat " + relToGame + ": " + statErr.Error()}, nil
		}
		// Protect against symlinks pointing outside game/Submods
		if info.Mode()&os.ModeSymlink != 0 {
			target, evalErr := filepath.EvalSymlinks(fullPath)
			if evalErr != nil {
				return nil, nil, []string{"broken symlink: " + relToGame}, nil
			}
			relToSubmods, errRel := filepath.Rel(realBase, target)
			if errRel != nil || strings.HasPrefix(relToSubmods, "..") || filepath.IsAbs(relToSubmods) {
				return nil, nil, []string{"symlink points outside game/Submods: " + relToGame}, nil
			}
			// Stat target
			targetInfo, errTarget := os.Stat(target)
			if errTarget != nil {
				return nil, nil, []string{"broken symlink target: " + relToGame}, nil
			}
			if targetInfo.IsDir() {
				return nil, nil, nil, nil
			}
			info = targetInfo
		}

		f, openErr := os.Open(fullPath)
		if openErr != nil {
			return nil, nil, []string{"cannot read " + relToGame + ": " + openErr.Error()}, nil
		}
		defer f.Close()

		hasher := sha256.New()
		var buf [32 * 1024]byte
		var fileBytes int64
		// We read up to 2MB for script parsing if it's a script
		isScript := strings.HasSuffix(strings.ToLower(fullPath), ".rpy") ||
			strings.HasSuffix(strings.ToLower(fullPath), ".rpym") ||
			strings.HasSuffix(strings.ToLower(fullPath), ".py")

		var scriptBuf []byte

		for {
			n, rErr := f.Read(buf[:])
			if n > 0 {
				hasher.Write(buf[:n])
				fileBytes += int64(n)
				if isScript && len(scriptBuf) <= 2<<20 {
					toAppend := n
					if len(scriptBuf)+toAppend > 2<<20+1 {
						toAppend = (2<<20 + 1) - len(scriptBuf)
					}
					scriptBuf = append(scriptBuf, buf[:toAppend]...)
				}
			}
			if rErr == io.EOF {
				break
			}
			if rErr != nil {
				return nil, nil, []string{"read error " + relToGame + ": " + rErr.Error()}, nil
			}
		}

		canonicalPath := filepath.ToSlash(filepath.Join("game", relToGame))
		fileObj := &LocalSubmodFile{
			Path:   canonicalPath,
			SHA256: hex.EncodeToString(hasher.Sum(nil)),
			Size:   fileBytes,
		}

		var regs []SubmodRegistration
		if isScript {
			parsed := packagezip.ParseSubmods(canonicalPath, scriptBuf)
			for _, r := range parsed {
				regs = append(regs, SubmodRegistration{
					Name:                r.Name,
					Author:              r.Author,
					Version:             r.Version,
					Source:              r.Source,
					Unknown:             r.Unknown,
					Dependencies:        r.Dependencies,
					DependenciesUnknown: r.DependenciesUnknown,
				})
			}
		}

		return fileObj, regs, nil, nil
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			// Scattered file in game/Submods root
			name := entry.Name()
			lower := strings.ToLower(name)
			// Check if .rpy/.rpym/.py
			if !strings.HasSuffix(lower, ".rpy") && !strings.HasSuffix(lower, ".rpym") && !strings.HasSuffix(lower, ".py") {
				continue
			}
			relToGame := filepath.Join("Submods", name)
			canonKey := canonicalizePathKey(filepath.Join("game", relToGame))
			if managedKeys[canonKey] {
				continue
			}

			if totalFilesScanned >= MaxScanFiles || totalBytesScanned >= MaxScanTotalBytes {
				rootScatteredIncomplete = true
				rootScatteredWarnings = append(rootScatteredWarnings, "scan limits exceeded")
				continue
			}

			fullPath := filepath.Join(base, name)
			fileObj, regs, warns, _ := processFile(fullPath, relToGame)
			if warns != nil {
				rootScatteredWarnings = append(rootScatteredWarnings, warns...)
			}
			if fileObj != nil {
				totalFilesScanned++
				totalBytesScanned += fileObj.Size
				rootScatteredFiles = append(rootScatteredFiles, *fileObj)
				rootScatteredRegs = append(rootScatteredRegs, regs...)
			}
			continue
		}

		// Directory entry
		dirName := entry.Name()
		dirRoot := filepath.Join(base, dirName)
		item := LocalSubmod{
			ID:            dirName,
			Directory:     dirName,
			Files:         make([]LocalSubmodFile, 0),
			Registrations: make([]SubmodRegistration, 0),
		}

		dirIncomplete := false
		var dirWarnings []string

		walkErr := filepath.Walk(dirRoot, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				dirWarnings = append(dirWarnings, "walk error at "+path+": "+err.Error())
				return nil
			}
			if info.IsDir() {
				return nil
			}

			relToGame, relErr := filepath.Rel(filepath.Join(masRoot, "game"), path)
			if relErr != nil {
				return nil
			}
			canonKey := canonicalizePathKey(filepath.Join("game", relToGame))
			if managedKeys[canonKey] {
				// Excluded because it's actively managed by manifest
				return nil
			}

			if totalFilesScanned >= MaxScanFiles || totalBytesScanned >= MaxScanTotalBytes {
				dirIncomplete = true
				dirWarnings = append(dirWarnings, "scan limits exceeded")
				return filepath.SkipDir
			}

			fileObj, regs, warns, _ := processFile(path, relToGame)
			if warns != nil {
				dirWarnings = append(dirWarnings, warns...)
			}
			if fileObj != nil {
				totalFilesScanned++
				totalBytesScanned += fileObj.Size
				item.Files = append(item.Files, *fileObj)
				if len(item.Registrations)+len(regs) > MaxRegistrationsPerItem {
					dirIncomplete = true
					dirWarnings = append(dirWarnings, "maximum registrations limit exceeded")
				} else {
					item.Registrations = append(item.Registrations, regs...)
				}
			}
			return nil
		})

		if walkErr != nil {
			dirWarnings = append(dirWarnings, "directory walk failed: "+walkErr.Error())
		}

		// If no unmanaged files in this directory, skip it
		if len(item.Files) == 0 {
			continue
		}

		item.Warnings = dirWarnings
		item.Incomplete = dirIncomplete

		// Summarize primary name/author/version for backward compatibility
		for _, reg := range item.Registrations {
			if !reg.Unknown && reg.Name != "" {
				if item.Name == "" {
					item.Name = reg.Name
					item.Author = reg.Author
					item.Version = reg.Version
				}
			}
		}

		result = append(result, item)
	}

	// Add root scattered files if any
	if len(rootScatteredFiles) > 0 {
		scatteredItem := LocalSubmod{
			ID:            "__root_scattered__",
			Directory:     "",
			Files:         rootScatteredFiles,
			Registrations: rootScatteredRegs,
			Warnings:      rootScatteredWarnings,
			Incomplete:    rootScatteredIncomplete,
		}
		for _, reg := range rootScatteredRegs {
			if !reg.Unknown && reg.Name != "" {
				if scatteredItem.Name == "" {
					scatteredItem.Name = reg.Name
					scatteredItem.Author = reg.Author
					scatteredItem.Version = reg.Version
				}
			}
		}
		result = append(result, scatteredItem)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Directory < result[j].Directory
	})

	return result, nil
}
