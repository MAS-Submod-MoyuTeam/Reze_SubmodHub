package install

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type InstalledFileEntry struct {
	Path           string `json:"path"`
	CanonicalPath  string `json:"canonical_path"`
	SizeBytes      int64  `json:"size_bytes"`
	SHA256         string `json:"sha256"`
	Active         bool   `json:"active"`
	Drifted        bool   `json:"drifted"`
	Owner          string `json:"owner"`
	VersionID      string `json:"version_id"`
	OperationID    string `json:"operation_id"`
	LayerOrder     int64  `json:"layer_order"`
	OriginalExists bool   `json:"original_exists"`
}

type InstalledFileSummary struct {
	TotalFiles      int   `json:"total_files"`
	ActiveFiles     int   `json:"active_files"`
	DriftedFiles    int   `json:"drifted_files"`
	OverriddenFiles int   `json:"overridden_files"`
	TotalSizeBytes  int64 `json:"total_size_bytes"`
}

type InstalledFileList struct {
	InstallationID string               `json:"installation_id"`
	ModID          string               `json:"mod_id"`
	VersionID      string               `json:"version_id"`
	Version        string               `json:"version"`
	Title          string               `json:"title"`
	Managed        bool                 `json:"managed"`
	InstalledAt    time.Time            `json:"installed_at"`
	Files          []InstalledFileEntry `json:"files"`
	Summary        InstalledFileSummary `json:"summary"`
	NextCursor     string               `json:"next_cursor,omitempty"`
}

func (m *Manifest) ListInstalledFiles(installationID, modID string, masRoot string) (*InstalledFileList, error) {
	return m.ListInstalledFilesPaged(installationID, modID, masRoot, "", 0)
}

func (m *Manifest) ListInstalledFilesPaged(installationID, modID string, masRoot string, cursor string, limit int) (*InstalledFileList, error) {
	if m == nil || m.Installations == nil || m.Files == nil {
		return nil, &Error{Code: "manifest_corrupt", Err: errors.New("nil or uninitialized manifest")}
	}

	for id, rec := range m.Installations {
		if rec == nil {
			return nil, &Error{Code: "manifest_corrupt", Err: fmt.Errorf("manifest corrupt: nil installation record %q", id)}
		}
	}

	var inst *InstallationRecord
	if installationID != "" {
		inst = m.Installations[installationID]
	}
	if inst == nil {
		targetMod := modID
		if targetMod == "" {
			targetMod = installationID
		}
		for _, candidate := range m.Installations {
			if candidate == nil {
				return nil, &Error{Code: "manifest_corrupt", Err: errors.New("manifest corrupt: nil installation record")}
			}
			if candidate.ModID != "" && candidate.ModID == targetMod {
				inst = candidate
				break
			}
		}
	}

	if inst == nil {
		return nil, &Error{Code: "not_found", Err: fmt.Errorf("installation %q not found", installationID)}
	}

	if modID != "" && inst.ModID != "" && inst.ModID != modID {
		return nil, &Error{Code: "not_found", Err: fmt.Errorf("installation %q does not match mod %q", installationID, modID)}
	}

	resultModID := inst.ModID
	if resultModID == "" {
		resultModID = modID
	}

	entries := make([]InstalledFileEntry, 0, len(inst.Paths))
	var summary InstalledFileSummary

	for _, cPath := range inst.Paths {
		fileRec, hasRec := m.Files[cPath]
		if !hasRec || fileRec == nil {
			return nil, &Error{
				Code: "manifest_corrupt",
				Path: cPath,
				Err:  fmt.Errorf("manifest corrupt: file record missing for path %q in installation %q", cPath, inst.InstallationID),
			}
		}

		var myLayer *LayerRecord
		for i := range fileRec.Layers {
			if fileRec.Layers[i].InstallationID == inst.InstallationID {
				myLayer = &fileRec.Layers[i]
				break
			}
		}
		if myLayer == nil {
			return nil, &Error{
				Code: "manifest_corrupt",
				Path: cPath,
				Err:  fmt.Errorf("manifest corrupt: layer missing for installation %q in file record %q", inst.InstallationID, cPath),
			}
		}

		activeLayer := fileRec.ActiveLayer()
		isActive := activeLayer != nil && activeLayer.InstallationID == inst.InstallationID

		displayPath := fileRec.DisplayPath
		if displayPath == "" {
			displayPath = cPath
		}

		entry := InstalledFileEntry{
			Path:           displayPath,
			CanonicalPath:  cPath,
			SHA256:         myLayer.Hash,
			Active:         isActive,
			Owner:          myLayer.ModID,
			VersionID:      myLayer.VersionID,
			OperationID:    myLayer.OperationID,
			LayerOrder:     myLayer.Order,
			OriginalExists: fileRec.Original.Exists,
		}
		if entry.Owner == "" {
			entry.Owner = resultModID
		}
		if entry.VersionID == "" {
			entry.VersionID = inst.VersionID
		}

		if masRoot != "" {
			diskFilePath := filepath.Join(masRoot, filepath.FromSlash(displayPath))
			fi, err := os.Stat(diskFilePath)
			if err == nil {
				entry.SizeBytes = fi.Size()
				if isActive {
					actualHash, hashErr := hashFile(diskFilePath)
					if hashErr != nil {
						if isPermissionError(hashErr) {
							return nil, &Error{Code: "permission_lost", Path: displayPath, Err: hashErr}
						}
						return nil, &Error{Code: "disk_read_error", Path: displayPath, Err: hashErr}
					}
					if !strings.EqualFold(actualHash, myLayer.Hash) {
						entry.Drifted = true
					}
				}
			} else if os.IsNotExist(err) {
				if isActive {
					entry.Drifted = true
				}
			} else if isPermissionError(err) {
				return nil, &Error{Code: "permission_lost", Path: displayPath, Err: err}
			} else {
				return nil, &Error{Code: "disk_read_error", Path: displayPath, Err: err}
			}
		}

	entries = append(entries, entry)
	}

	sort.Slice(entries, func(i, j int) bool {
		pi := strings.ToLower(entries[i].Path)
		pj := strings.ToLower(entries[j].Path)
		if pi == pj {
			return entries[i].Path < entries[j].Path
		}
		return pi < pj
	})

	for _, e := range entries {
		summary.TotalFiles++
		summary.TotalSizeBytes += e.SizeBytes
		if e.Active {
			summary.ActiveFiles++
		} else {
			summary.OverriddenFiles++
		}
		if e.Drifted {
			summary.DriftedFiles++
		}
	}

	pagedEntries := entries
	var nextCursor string

	if limit > 0 || cursor != "" {
		if limit <= 0 {
			limit = 100
		}
		if limit > 500 {
			limit = 500
		}

		startIdx := 0
		if cursor != "" {
			cursorLower := strings.ToLower(cursor)
			for idx, e := range entries {
				eLower := strings.ToLower(e.Path)
				if eLower > cursorLower || (eLower == cursorLower && e.Path > cursor) {
					startIdx = idx
					break
				}
				if idx == len(entries)-1 {
					startIdx = len(entries)
				}
			}
		}

		endIdx := startIdx + limit
		if endIdx > len(entries) {
			endIdx = len(entries)
		}

		pagedEntries = entries[startIdx:endIdx]
		if endIdx < len(entries) && len(pagedEntries) > 0 {
			nextCursor = pagedEntries[len(pagedEntries)-1].Path
		}
	}

	list := &InstalledFileList{
		InstallationID: inst.InstallationID,
		ModID:          resultModID,
		VersionID:      inst.VersionID,
		Version:        inst.Version,
		Title:          inst.Title,
		Managed:        true,
		InstalledAt:    inst.InstalledAt,
		Files:          pagedEntries,
		Summary:        summary,
		NextCursor:     nextCursor,
	}

	return list, nil
}

func hashFile(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func isPermissionError(err error) bool {
	if err == nil {
		return false
	}
	if os.IsPermission(err) || errors.Is(err, os.ErrPermission) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "permission denied") || strings.Contains(msg, "access is denied")
}
