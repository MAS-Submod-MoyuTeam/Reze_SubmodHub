package httpapi

import (
	"net/http"
	"sort"

	packagezip "github.com/reze/submodhub/internal/package"
)

// Author workspace lists never include another user's records, including for
// administrators. Administrative review is a separate API.
func (s *Store) authorModPage(w http.ResponseWriter, r *http.Request, authorID string) {
	query, err := parseReviewPage(r, false)
	if err != nil {
		writeError(w, 400, "validation_failed", err.Error())
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	indices := make([]int, 0)
	for i, mod := range s.Catalog.Mods {
		if mod.Author.ID == authorID {
			indices = append(indices, i)
		}
	}
	sort.Slice(indices, func(i, j int) bool { return s.Catalog.Mods[indices[i]].ID > s.Catalog.Mods[indices[j]].ID })
	if focus := r.URL.Query().Get("focus_mod_id"); focus != "" {
		for position, index := range indices {
			if s.Catalog.Mods[index].ID == focus {
				query.Page = position/query.PageSize + 1
				break
			}
		}
	}
	page, start, end := query.bounds(len(indices))
	type item struct {
		Mod       Mod  `json:"mod"`
		Published bool `json:"is_published"`
	}
	items := make([]item, 0, end-start)
	for _, index := range indices[start:end] {
		mod := s.Catalog.Mods[index]
		version := s.Catalog.Versions[mod.LatestVersionID]
		items = append(items, item{Mod: mod, Published: !mod.Unpublished && version.ModID == mod.ID && version.State == "published"})
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(indices), "page": page, "page_size": query.PageSize})
}

func (s *Store) authorVersionPage(w http.ResponseWriter, r *http.Request, authorID, modID string) {
	query, err := parseReviewPage(r, false)
	if err != nil {
		writeError(w, 400, "validation_failed", err.Error())
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	owned := false
	for _, mod := range s.Catalog.Mods {
		if mod.ID == modID && mod.Author.ID == authorID {
			owned = true
			break
		}
	}
	if !owned {
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	ids := make([]string, 0)
	for id, version := range s.Catalog.Versions {
		if version.ModID == modID {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := s.Catalog.Versions[ids[i]], s.Catalog.Versions[ids[j]]
		if a.CreatedAt == nil || b.CreatedAt == nil {
			if a.CreatedAt == b.CreatedAt {
				return a.ID > b.ID
			}
			return a.CreatedAt != nil
		}
		if a.CreatedAt.Equal(*b.CreatedAt) {
			return a.ID > b.ID
		}
		return a.CreatedAt.After(*b.CreatedAt)
	})
	page, start, end := query.bounds(len(ids))
	items := make([]Version, 0, end-start)
	reports := make(map[string]packagezip.Report)
	for _, id := range ids[start:end] {
		version := resolveVersionDependencies(s.Catalog, s.Catalog.Versions[id]).SanitizeForClient()
		items = append(items, version)
		if report, ok := s.Catalog.ScanReports[version.ScanReportID]; ok {
			reports[version.ScanReportID] = report
		}
	}
	writeJSON(w, 200, map[string]any{"items": items, "scan_reports": reports, "total": len(ids), "page": page, "page_size": query.PageSize})
}

func (s *Store) authorSubmissionPage(w http.ResponseWriter, r *http.Request, authorID string) {
	query, err := parseReviewPage(r, true)
	if err != nil {
		writeError(w, 400, "validation_failed", err.Error())
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	indices := make([]int, 0)
	for i, sub := range s.Catalog.Submissions {
		if sub.AuthorID == authorID && (query.State == "" || query.State == "all" || sub.State == query.State) {
			indices = append(indices, i)
		}
	}
	sort.Slice(indices, func(i, j int) bool {
		a, b := s.Catalog.Submissions[indices[i]], s.Catalog.Submissions[indices[j]]
		if a.CreatedAt.Equal(b.CreatedAt) {
			return a.ID > b.ID
		}
		return a.CreatedAt.After(b.CreatedAt)
	})
	page, start, end := query.bounds(len(indices))
	type item struct {
		Submission
		ModTitle       string   `json:"mod_title"`
		AuthorName     string   `json:"author_name"`
		Version        string   `json:"version_str"`
		Category       string   `json:"category"`
		CurrentVersion *Version `json:"current_version,omitempty"`
	}
	mods := make(map[string]Mod)
	for _, index := range indices[start:end] {
		mods[s.Catalog.Submissions[index].ModID] = Mod{}
	}
	for _, mod := range s.Catalog.Mods {
		if _, wanted := mods[mod.ID]; wanted {
			mods[mod.ID] = mod
		}
	}
	items := make([]item, 0, end-start)
	for _, index := range indices[start:end] {
		sub := s.Catalog.Submissions[index].SanitizeForClient()
		mod := mods[sub.ModID]
		version, exists := s.Catalog.Versions[sub.VersionID]
		versionLabel := version.Version
		if sub.VersionSnapshot != nil {
			versionLabel = sub.VersionSnapshot.Version
		}
		if versionLabel == "" {
			versionLabel = sub.VersionID
		}
		var current *Version
		if exists && mod.Author.ID == authorID {
			clean := resolveVersionDependencies(s.Catalog, version).SanitizeForClient()
			current = &clean
		}
		title, category := mod.Title, mod.Category
		if title == "" {
			title = sub.ModID
		}
		if category == "" {
			category = "submod"
		}
		items = append(items, item{Submission: sub, ModTitle: title, AuthorName: mod.Author.DisplayName, Version: versionLabel, Category: category, CurrentVersion: current})
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(indices), "page": page, "page_size": query.PageSize})
}
