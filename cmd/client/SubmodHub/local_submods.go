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

// LocalSubmodOwner names a managed installation that already owns files inside a
// discovered directory. A directory can hold files outside the ledger, so the
// client must be able to say "this folder belongs to a managed mod" instead of
// presenting the leftovers as an unrelated unmanaged submod.
type LocalSubmodOwner struct {
	InstallationID string `json:"installation_id"`
	ModID          string `json:"mod_id,omitempty"`
	Title          string `json:"title,omitempty"`
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
	ManagedOwners []LocalSubmodOwner   `json:"managed_owners,omitempty"`
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

// compiledArtifactKeys collects the generated compile cache files that managed
// source scripts under game/Submods produce.
//
// Ren'Py writes a sibling .rpyc/.rpymc for every .rpy/.rpym and CPython leaves
// bytecode next to or inside __pycache__ for every module. Those artifacts are
// derived data that the ledger never records, so an exact path match alone would
// resurface the directory of an otherwise fully managed mod as an unmanaged
// detection. Ownership is decided by the source file, not by the folder.
//
// The set is expanded forwards from the ledger's sources instead of backwards
// from each discovered file, so the scan reuses the one naming rule that the
// install-time cache cleanup already owns (install.compiledArtifactCandidates).
//
// managedKeys are canonical ledger keys, which Windows lowercases. install's
// expansion compares __pycache__ entries case-insensitively for that reason, so
// a module's original casing cannot hide its bytecode.
func compiledArtifactKeys(masRoot string, managedKeys map[string]bool) map[string]bool {
	sources := make([]string, 0, len(managedKeys))
	for key := range managedKeys {
		// Only sources inside a submod directory can leave artifacts behind in
		// the tree the walk below visits.
		if submodDirKey(key) == "" {
			continue
		}
		sources = append(sources, key)
	}
	return install.DerivedArtifactKeys(masRoot, sources)
}

// submodDirKey returns the canonical first directory segment under game/Submods
// for a manifest path, or "" when the path is outside that tree or sits directly
// in it. Manifest paths are canonical keys, so the comparison is case-insensitive
// only to survive the mixed casing stored by older ledgers.
func submodDirKey(pathKey string) string {
	parts := strings.Split(filepath.ToSlash(pathKey), "/")
	if len(parts) < 4 {
		return ""
	}
	if !strings.EqualFold(parts[0], "game") || !strings.EqualFold(parts[1], "Submods") {
		return ""
	}
	return canonicalizePathKey(parts[2])
}

// ownersForDir returns the owners of one discovered directory. File layers decide
// it whenever they exist; an installation's recorded path list is only consulted
// for a directory the ledger records no layer for, because a path list can survive
// a reinstall that moved the file to another installation.
func ownersForDir(layers, paths map[string]map[string]LocalSubmodOwner, dirKey string) map[string]LocalSubmodOwner {
	if owners := layers[dirKey]; len(owners) > 0 {
		return owners
	}
	return paths[dirKey]
}

// orderedOwners flattens the per-directory owner set into a stable list.
func orderedOwners(byID map[string]LocalSubmodOwner) []LocalSubmodOwner {
	if len(byID) == 0 {
		return nil
	}
	owners := make([]LocalSubmodOwner, 0, len(byID))
	for _, owner := range byID {
		owners = append(owners, owner)
	}
	sort.Slice(owners, func(i, j int) bool {
		return owners[i].InstallationID < owners[j].InstallationID
	})
	return owners
}

// scanLocalSubmodsCore performs file-level discovery of unmanaged submods in game/Submods.
func scanLocalSubmodsCore(masRoot string, manifest *install.Manifest) ([]LocalSubmod, error) {
	if masRoot == "" {
		return nil, errors.New("mas_root_not_configured")
	}

	// 1. Build set of managed canonical file keys from manifest
	managedKeys := make(map[string]bool)
	// Owner sets per canonical directory segment under game/Submods. Layers and
	// path lists are kept apart because they are not peers; see ownersForDir.
	layerOwnersByDir := make(map[string]map[string]LocalSubmodOwner)
	pathOwnersByDir := make(map[string]map[string]LocalSubmodOwner)
	if manifest != nil {
		// ownerByID resolves an installation id to its display fields. Layers only
		// carry the id and mod id, so the title has to come from the installation
		// record; a layer whose record is gone still names its owner.
		ownerByID := make(map[string]LocalSubmodOwner, len(manifest.Installations))
		for instID, inst := range manifest.Installations {
			if inst == nil {
				continue
			}
			id := inst.InstallationID
			if id == "" {
				id = instID
			}
			owner := LocalSubmodOwner{InstallationID: id, ModID: inst.ModID, Title: inst.Title}
			if _, seen := ownerByID[id]; !seen {
				ownerByID[id] = owner
			}
			// Older ledgers key the record differently from its installation_id.
			if _, seen := ownerByID[instID]; !seen {
				ownerByID[instID] = owner
			}
		}
		addOwner := func(byDir map[string]map[string]LocalSubmodOwner, pathKey, instID, fallbackModID string) {
			dirKey := submodDirKey(pathKey)
			if dirKey == "" || instID == "" {
				return
			}
			owner, known := ownerByID[instID]
			if !known {
				owner = LocalSubmodOwner{InstallationID: instID, ModID: fallbackModID}
			}
			bucket := byDir[dirKey]
			if bucket == nil {
				bucket = make(map[string]LocalSubmodOwner)
				byDir[dirKey] = bucket
			}
			// Two paths can reach the same owner. Keep the write deterministic no
			// matter which order the maps iterate in: a named owner beats an unnamed
			// one, and identical owners are idempotent.
			if existing, seen := bucket[owner.InstallationID]; !seen || (existing.Title == "" && owner.Title != "") {
				bucket[owner.InstallationID] = owner
			}
		}

		for instID, inst := range manifest.Installations {
			if inst == nil {
				continue
			}
			id := inst.InstallationID
			if id == "" {
				id = instID
			}
			for _, p := range inst.Paths {
				managedKeys[canonicalizePathKey(p)] = true
				addOwner(pathOwnersByDir, p, id, "")
			}
		}
		// File layers are the per-file record of who owns a path, so they name the
		// owner even when an installation's recorded paths are missing or pruned.
		for key, record := range manifest.Files {
			managedKeys[canonicalizePathKey(key)] = true
			if record == nil {
				continue
			}
			for _, layer := range record.Layers {
				addOwner(layerOwnersByDir, key, layer.InstallationID, layer.ModID)
			}
		}
	}

	// 2. Expand the managed sources into the compile cache files they produce, so
	// the walk below can ignore generated artifacts of managed scripts. This costs
	// a stat per managed source plus one directory read per Python module; it is
	// paid once per installed-view refresh, not per discovered file.
	artifactKeys := compiledArtifactKeys(masRoot, managedKeys)

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
			if managedKeys[canonKey] || artifactKeys[canonKey] {
				// Excluded: recorded in the ledger, or compiled from a managed source
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
		item.ManagedOwners = orderedOwners(ownersForDir(layerOwnersByDir, pathOwnersByDir, canonicalizePathKey(dirName)))

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
