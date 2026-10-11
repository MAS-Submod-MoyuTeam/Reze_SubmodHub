package install

import (
	"errors"
	"path/filepath"
	"sort"
)

type PriorityModInfo struct {
	InstallationID  string `json:"installation_id"`
	ModID           string `json:"mod_id"`
	Title           string `json:"title"`
	Version         string `json:"version"`
	Priority        int    `json:"priority"`
	Order           int64  `json:"order"`
	TotalFiles      int    `json:"total_files"`
	ActiveFiles     int    `json:"active_files"`
	OverriddenFiles int    `json:"overridden_files"`
}

type PriorityLayerInfo struct {
	InstallationID string `json:"installation_id"`
	ModID          string `json:"mod_id"`
	Priority       int    `json:"priority"`
	Order          int64  `json:"order"`
	Hash           string `json:"hash"`
}

type PriorityPathEntry struct {
	Path           string              `json:"path"`
	Key            string              `json:"key"`
	ActiveOwner    string              `json:"active_owner"`
	ActiveHash     string              `json:"active_hash"`
	Drifted        bool                `json:"drifted"`
	OriginalExists bool                `json:"original_exists"`
	OriginalHash   string              `json:"original_hash,omitempty"`
	Layers         []PriorityLayerInfo `json:"layers"`
}

type PriorityOverview struct {
	Generation int64               `json:"generation"`
	Mods       []PriorityModInfo   `json:"mods"`
	Paths      []PriorityPathEntry `json:"paths"`
}

func (m *Manifest) GetPriorityOverview(masRoot string) (*PriorityOverview, error) {
	if m == nil || m.Installations == nil || m.Files == nil {
		return nil, &Error{Code: "manifest_corrupt", Err: errors.New("nil or uninitialized manifest")}
	}

	overview := &PriorityOverview{
		Generation: m.Generation,
		Mods:       make([]PriorityModInfo, 0, len(m.Installations)),
		Paths:      make([]PriorityPathEntry, 0),
	}

	for _, inst := range m.Installations {
		if inst == nil {
			continue
		}
		var total, active, overridden int
		for _, cPath := range inst.Paths {
			fileRec := m.Files[cPath]
			if fileRec == nil {
				continue
			}
			total++
			act := fileRec.ActiveLayer()
			if act != nil && act.InstallationID == inst.InstallationID {
				active++
			} else {
				overridden++
			}
		}
		overview.Mods = append(overview.Mods, PriorityModInfo{
			InstallationID:  inst.InstallationID,
			ModID:           inst.ModID,
			Title:           inst.Title,
			Version:         inst.Version,
			Priority:        inst.Priority,
			Order:           inst.Order,
			TotalFiles:      total,
			ActiveFiles:     active,
			OverriddenFiles: overridden,
		})
	}

	sort.Slice(overview.Mods, func(i, j int) bool {
		if overview.Mods[i].Priority != overview.Mods[j].Priority {
			return overview.Mods[i].Priority > overview.Mods[j].Priority
		}
		if overview.Mods[i].Order != overview.Mods[j].Order {
			return overview.Mods[i].Order > overview.Mods[j].Order
		}
		return overview.Mods[i].ModID < overview.Mods[j].ModID
	})

	pathKeys := make([]string, 0, len(m.Files))
	for k, rec := range m.Files {
		if rec != nil && len(rec.Layers) > 1 {
			pathKeys = append(pathKeys, k)
		}
	}
	sort.Strings(pathKeys)

	for _, key := range pathKeys {
		rec := m.Files[key]
		display := rec.DisplayPath
		if display == "" {
			display = key
		}

		active := rec.ActiveLayer()
		var activeOwner, activeHash string
		if active != nil {
			activeOwner = active.ModID
			if activeOwner == "" {
				activeOwner = active.InstallationID
			}
			activeHash = active.Hash
		} else if rec.Original.Exists {
			activeOwner = "original"
			activeHash = rec.Original.Hash
		}

		drifted := false
		if masRoot != "" && active != nil {
			diskPath := filepath.Join(masRoot, filepath.FromSlash(display))
			diskHash, err := fileHash(diskPath)
			if err != nil || diskHash != active.Hash {
				drifted = true
			}
		}

		layers := make([]PriorityLayerInfo, 0, len(rec.Layers))
		for _, l := range rec.Layers {
			layers = append(layers, PriorityLayerInfo{
				InstallationID: l.InstallationID,
				ModID:          l.ModID,
				Priority:       l.Priority,
				Order:          l.Order,
				Hash:           l.Hash,
			})
		}

		overview.Paths = append(overview.Paths, PriorityPathEntry{
			Path:           display,
			Key:            key,
			ActiveOwner:    activeOwner,
			ActiveHash:     activeHash,
			Drifted:        drifted,
			OriginalExists: rec.Original.Exists,
			OriginalHash:   rec.Original.Hash,
			Layers:         layers,
		})
	}

	return overview, nil
}

func (i *Installer) GetPriorityOverview() (*PriorityOverview, error) {
	if i == nil || i.root == "" {
		return nil, &Error{Code: "invalid_mas_root", Err: errors.New("mas root is not configured")}
	}
	manifest, err := i.LoadManifest()
	if err != nil {
		return nil, &Error{Code: "manifest_corrupt", Err: err}
	}
	return manifest.GetPriorityOverview(i.root)
}
