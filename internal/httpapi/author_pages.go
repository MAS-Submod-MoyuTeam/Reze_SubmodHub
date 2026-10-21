package httpapi

import (
	"cmp"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"time"

	packagezip "github.com/reze/submodhub/internal/package"
)

// versionOrder reports whether a must be listed before b: newest first,
// versions without a timestamp last, ID descending as the stable tie-break.
func versionOrder(a, b Version) bool {
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
}

// modCreatedOrder compares mods by strict creation order: newest first, mods
// without a creation timestamp last, ID descending as the stable tie-break.
// The pair (created_at, ID) is unique, so it doubles as the keyset position.
func modCreatedOrder(a, b Mod) int {
	switch {
	case a.CreatedAt == nil && b.CreatedAt == nil:
	case a.CreatedAt == nil:
		return 1
	case b.CreatedAt == nil:
		return -1
	case a.CreatedAt.Before(*b.CreatedAt):
		return 1
	case a.CreatedAt.After(*b.CreatedAt):
		return -1
	}
	return cmp.Compare(b.ID, a.ID)
}

// authorModCursor is the keyset position of the last mod already returned.
// Pages resume strictly after this (created_at, ID) pair, so concurrent inserts
// and deletions cannot shift a later page the way an offset would.
type authorModCursor struct {
	CreatedAt *time.Time
	ID        string
}

type authorModCursorWire struct {
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
}

func encodeAuthorModCursor(mod Mod) string {
	wire := authorModCursorWire{ID: mod.ID}
	if mod.CreatedAt != nil {
		wire.CreatedAt = mod.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	document, err := json.Marshal(wire)
	if err != nil {
		// Mod only carries strings and one timestamp, so marshalling cannot fail.
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(document)
}

// decodeAuthorModCursor accepts only the canonical encoding produced above, so a
// hand-built or truncated cursor cannot silently change the paging window.
func decodeAuthorModCursor(raw string) (authorModCursor, error) {
	invalid := errors.New("invalid cursor")
	document, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return authorModCursor{}, invalid
	}
	var wire authorModCursorWire
	if err := json.Unmarshal(document, &wire); err != nil || wire.ID == "" {
		return authorModCursor{}, invalid
	}
	cursor := authorModCursor{ID: wire.ID}
	if wire.CreatedAt != "" {
		at, err := time.Parse(time.RFC3339Nano, wire.CreatedAt)
		if err != nil {
			return authorModCursor{}, invalid
		}
		at = at.UTC()
		cursor.CreatedAt = &at
	}
	if encodeAuthorModCursor(Mod{CreatedAt: cursor.CreatedAt, ID: cursor.ID}) != raw {
		return authorModCursor{}, invalid
	}
	return cursor, nil
}

// authorModStats aggregates every version of one mod, so author lookups stay a
// single catalog pass and the client never has to infer mod-wide facts from the
// versions visible on the current page. Published and archived stay separate
// facts: one mod can hold a live version and a retired version at once, and only
// a mod with neither has released anything, which is what allows deleting it as
// a draft.
type authorModStats struct {
	published     bool
	archived      bool
	pendingReview bool
	candidate     *Version
}

func (stats *authorModStats) add(version Version) {
	switch version.State {
	case "published":
		stats.published = true
	case "unpublished":
		stats.archived = true
	case "ready_for_review":
		stats.pendingReview = true
	case "draft", "uploaded", "rejected", "scanning":
		// The uploader reuses the newest still-editable version as the upload
		// target instead of creating a duplicate candidate.
		if candidate := version; stats.candidate == nil || versionOrder(candidate, *stats.candidate) {
			stats.candidate = &candidate
		}
	}
}

// authorModPage lists one cursor window of the caller's own mods with the
// version-derived state the workspace needs. The window is a keyset slice of
// the strict creation order, so repeated paging under concurrent writes neither
// repeats nor skips rows. Author workspace lists never include another user's
// records, including for administrators; administrative review is a separate
// API.
func (s *Store) authorModPage(w http.ResponseWriter, r *http.Request, authorID string) {
	query := r.URL.Query()
	pageSize := 20
	if raw := query.Get("page_size"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, 400, "validation_failed", "page_size must be between 1 and 100")
			return
		}
		pageSize = parsed
	}
	var cursor *authorModCursor
	if raw := query.Get("cursor"); raw != "" {
		decoded, err := decodeAuthorModCursor(raw)
		if err != nil {
			writeError(w, 400, "validation_failed", err.Error())
			return
		}
		cursor = &decoded
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	owned := make([]Mod, 0)
	stats := make(map[string]*authorModStats)
	for _, mod := range s.Catalog.Mods {
		if mod.Author.ID == authorID {
			owned = append(owned, mod)
			stats[mod.ID] = &authorModStats{}
		}
	}
	for _, version := range s.Catalog.Versions {
		if aggregate, ok := stats[version.ModID]; ok {
			aggregate.add(version)
		}
	}
	slices.SortFunc(owned, modCreatedOrder)
	start := 0
	if cursor != nil {
		anchor := Mod{CreatedAt: cursor.CreatedAt, ID: cursor.ID}
		start = sort.Search(len(owned), func(i int) bool { return modCreatedOrder(owned[i], anchor) > 0 })
	}
	// A focused mod snaps the window to the one that contains it, which keeps
	// the create/jump flows working without reintroducing an offset cursor. The
	// focus outranks `cursor`: a caller that sends both gets the focused window,
	// and the response hands back that window's own cursor to continue from.
	if focus := query.Get("focus_mod_id"); focus != "" {
		if position := slices.IndexFunc(owned, func(mod Mod) bool { return mod.ID == focus }); position >= 0 {
			start = position / pageSize * pageSize
		}
	}
	end := min(start+pageSize, len(owned))
	type item struct {
		Mod                Mod    `json:"mod"`
		Published          bool   `json:"is_published"`
		HasPublished       bool   `json:"has_published_version"`
		HasArchived        bool   `json:"has_archived_version"`
		HasPendingReview   bool   `json:"has_pending_review"`
		CandidateVersionID string `json:"candidate_version_id,omitempty"`
	}
	items := make([]item, 0, end-start)
	for _, mod := range owned[start:end] {
		aggregate := stats[mod.ID]
		latestVersion := s.Catalog.Versions[mod.LatestVersionID]
		entry := item{
			Mod:              mod,
			Published:        !mod.Unpublished && latestVersion.ModID == mod.ID && latestVersion.State == "published",
			HasPublished:     aggregate.published,
			HasArchived:      aggregate.archived,
			HasPendingReview: aggregate.pendingReview,
		}
		if aggregate.candidate != nil {
			entry.CandidateVersionID = aggregate.candidate.ID
		}
		items = append(items, entry)
	}
	var windowCursor, nextCursor, prevCursor *string
	if start > 0 {
		// The window cursor reproduces this window: it is the keyset position of
		// the row just before the first one returned.
		cursor := encodeAuthorModCursor(owned[start-1])
		windowCursor = &cursor
		// Every window starts after the first row, so every window but the first
		// has a previous one. When that neighbour is the first window its cursor
		// is the empty string a client already sends to ask for it, and the
		// pointer stays non-nil: a null prev_cursor must only ever mean "this is
		// the first window".
		previous := ""
		if start > pageSize {
			previous = encodeAuthorModCursor(owned[start-pageSize-1])
		}
		prevCursor = &previous
	}
	if end < len(owned) {
		cursor := encodeAuthorModCursor(owned[end-1])
		nextCursor = &cursor
	}
	// Opening the workbench is the author's demand signal. A bounded number of
	// stale GitHub-backed mods in this window are refreshed in the background;
	// the cap keeps one page load from starting every download at once.
	now := time.Now().UTC()
	passiveBudget := maxPassiveRefreshPerPage
	for _, mod := range owned[start:end] {
		if passiveBudget == 0 {
			break
		}
		if !s.passiveSyncDueLocked(mod, now) {
			continue
		}
		passiveBudget--
		s.maybeSyncGitHubModAsync(mod.ID)
	}
	writeJSON(w, 200, map[string]any{
		"items": items, "total": len(owned), "page_size": pageSize, "start": start,
		"cursor": windowCursor, "next_cursor": nextCursor, "prev_cursor": prevCursor,
	})
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
		return versionOrder(s.Catalog.Versions[ids[i]], s.Catalog.Versions[ids[j]])
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
	selected := indices[start:end]
	rows := s.submissionDisplayRows(selected)
	type item struct {
		Submission
		ModTitle       string   `json:"mod_title"`
		AuthorName     string   `json:"author_name"`
		Version        string   `json:"version_str"`
		Category       string   `json:"category"`
		CurrentVersion *Version `json:"current_version,omitempty"`
	}
	items := make([]item, 0, len(selected))
	for _, index := range selected {
		sub := s.Catalog.Submissions[index].SanitizeForClient()
		row := rows[index]
		var current *Version
		// The current version is only exposed for the caller's own mod, so a
		// history row can open the revision form without a second lookup.
		if version, exists := s.Catalog.Versions[sub.VersionID]; exists && row.Mod.Author.ID == authorID {
			clean := resolveVersionDependencies(s.Catalog, version).SanitizeForClient()
			current = &clean
		}
		items = append(items, item{Submission: sub, ModTitle: row.Title, AuthorName: row.Author, Version: row.Version, Category: row.Category, CurrentVersion: current})
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(indices), "page": page, "page_size": query.PageSize})
}
