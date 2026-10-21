package httpapi

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"
)

type reviewPageQuery struct {
	Page     int
	PageSize int
	State    string
}

func parseReviewPage(r *http.Request, allowState bool) (reviewPageQuery, error) {
	query := reviewPageQuery{Page: 1, PageSize: 20}
	for _, field := range []struct {
		name string
		dest *int
	}{{"page", &query.Page}, {"page_size", &query.PageSize}} {
		if values, exists := r.URL.Query()[field.name]; exists {
			if len(values) != 1 {
				return query, fmt.Errorf("%s must occur once", field.name)
			}
			value, err := strconv.Atoi(values[0])
			if err != nil || value < 1 {
				return query, fmt.Errorf("%s must be a positive integer", field.name)
			}
			*field.dest = value
		}
	}
	if query.PageSize > 100 {
		return query, fmt.Errorf("page_size must be between 1 and 100")
	}
	if allowState {
		query.State = r.URL.Query().Get("state")
		switch query.State {
		case "", "all", "ready_for_review", "approved", "rejected", "published":
		default:
			return query, fmt.Errorf("invalid submission state")
		}
	}
	return query, nil
}

func (query reviewPageQuery) bounds(total int) (page, start, end int) {
	last := max(1, (total+query.PageSize-1)/query.PageSize)
	page = min(query.Page, last)
	start = (page - 1) * query.PageSize
	end = min(start+query.PageSize, total)
	return
}

// List responses carry only the fields needed to browse the queue. Snapshots,
// file trees and archive metadata are loaded through the submission detail API.
type reviewSubmissionItem struct {
	ID         string    `json:"id"`
	ModID      string    `json:"mod_id"`
	VersionID  string    `json:"version_id"`
	AuthorID   string    `json:"author_id"`
	State      string    `json:"state"`
	CreatedAt  time.Time `json:"created_at"`
	ModTitle   string    `json:"mod_title"`
	AuthorName string    `json:"author_name"`
	Version    string    `json:"version_str"`
	Category   string    `json:"category"`
}

func (s *Store) reviewSubmissionPage(query reviewPageQuery) map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	indices := make([]int, 0)
	pending := 0
	for i, sub := range s.Catalog.Submissions {
		if sub.State == "ready_for_review" {
			pending++
		}
		if query.State == "" || query.State == "all" || sub.State == query.State {
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
	// Resolve titles only for the selected page; do not clone full submissions.
	mods := make(map[string]Mod)
	for _, index := range indices[start:end] {
		mods[s.Catalog.Submissions[index].ModID] = Mod{}
	}
	for _, mod := range s.Catalog.Mods {
		if _, wanted := mods[mod.ID]; wanted {
			mods[mod.ID] = mod
		}
	}
	items := make([]reviewSubmissionItem, 0, end-start)
	for _, index := range indices[start:end] {
		sub := s.Catalog.Submissions[index]
		mod := mods[sub.ModID]
		version := s.Catalog.Versions[sub.VersionID].Version
		if sub.VersionSnapshot != nil {
			version = sub.VersionSnapshot.Version
		}
		if version == "" {
			version = sub.VersionID
		}
		title, author, category := mod.Title, mod.Author.DisplayName, mod.Category
		if title == "" {
			title = sub.ModID
		}
		if author == "" {
			author = sub.AuthorID
		}
		if category == "" {
			category = "submod"
		}
		items = append(items, reviewSubmissionItem{ID: sub.ID, ModID: sub.ModID, VersionID: sub.VersionID, AuthorID: sub.AuthorID, State: sub.State, CreatedAt: sub.CreatedAt, ModTitle: title, AuthorName: author, Version: version, Category: category})
	}
	return map[string]any{"items": items, "total": len(indices), "page": page, "page_size": query.PageSize, "pending_count": pending}
}

func (s *Store) reviewAuditPage(query reviewPageQuery) map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	indices := make([]int, len(s.Catalog.ReviewAudit))
	for i := range indices {
		indices[i] = i
	}
	sort.Slice(indices, func(i, j int) bool {
		a, b := s.Catalog.ReviewAudit[indices[i]], s.Catalog.ReviewAudit[indices[j]]
		if a.Timestamp.Equal(b.Timestamp) {
			return a.ID > b.ID
		}
		return a.Timestamp.After(b.Timestamp)
	})
	page, start, end := query.bounds(len(indices))
	items := make([]ReviewAuditEvent, 0, end-start)
	for _, index := range indices[start:end] {
		items = append(items, s.Catalog.ReviewAudit[index])
	}
	return map[string]any{"items": items, "total": len(indices), "page": page, "page_size": query.PageSize}
}
