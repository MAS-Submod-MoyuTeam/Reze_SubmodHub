package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	packagezip "github.com/reze/submodhub/internal/package"
	"net/http"
	"sort"
	"strings"
	"time"
)

func latestPublishedVersionID(c Catalog, modID string) string {
	ids := make([]string, 0)
	for id, v := range c.Versions {
		if v.ModID == modID && v.State == "published" {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return c.Versions[ids[i]].Version > c.Versions[ids[j]].Version })
	if len(ids) == 0 {
		return ""
	}
	return ids[0]
}

func (s *Store) versionLifecycle(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/versions/"), "/"), "/")
	if len(parts) != 2 || (parts[1] != "unpublish" && parts[1] != "mark-latest") || r.Method != http.MethodPost {
		writeError(w, 404, "not_found", "version lifecycle endpoint was not found")
		return
	}
	session, ok := s.requireSession(w, r)
	if !ok {
		return
	}
	isAdmin := containsRole(s.effectiveRoles(session), "admin")
	if parts[1] == "mark-latest" {
		s.mu.Lock()
		defer s.mu.Unlock()
		v, exists := s.Catalog.Versions[parts[0]]
		if !exists {
			writeError(w, 404, "not_found", "version was not found")
			return
		}
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == v.ModID {
				if s.Catalog.Mods[i].Author.ID != session.User.ID {
					writeError(w, 403, "forbidden", "author permission required")
					return
				}
				if v.State != "published" {
					writeError(w, 409, "invalid_state", "only published versions can be latest")
					return
				}
				s.Catalog.Mods[i].LatestVersionID = v.ID
				if err := s.saveLocked(); err != nil {
					writeError(w, 500, "storage_error", "latest version was not saved")
					return
				}
				writeJSON(w, 200, s.Catalog.Mods[i])
				return
			}
		}
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req) != nil || strings.TrimSpace(req.Reason) == "" {
		writeError(w, 400, "validation_failed", "reason is required")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, exists := s.Catalog.Versions[parts[0]]
	if !exists {
		writeError(w, 404, "not_found", "version was not found")
		return
	}
	owned := false
	for _, m := range s.Catalog.Mods {
		if m.ID == v.ModID && m.Author.ID == session.User.ID {
			owned = true
			break
		}
	}
	if !owned && !isAdmin {
		writeError(w, 403, "forbidden", "administrator or author permission required")
		return
	}
	if v.State != "published" {
		writeError(w, 409, "invalid_state", "only published versions can be unpublished")
		return
	}
	v.State = "unpublished"
	s.Catalog.Versions[v.ID] = v
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == v.ModID {
			s.Catalog.Mods[i].LatestVersionID = latestPublishedVersionID(s.Catalog, v.ModID)
		}
	}
	if err := s.saveLocked(); err != nil {
		writeError(w, 500, "storage_error", "unpublish was not saved")
		return
	}
	writeJSON(w, 200, v)
}

func (s *Store) deprecateVersion(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/versions/"), "/"), "/")
	if len(parts) != 2 || (r.Method != http.MethodPost && r.Method != http.MethodDelete) {
		writeError(w, 404, "not_found", "deprecation endpoint was not found")
		return
	}
	session, ok := s.requireSession(w, r)
	if !ok {
		return
	}
	isAdmin := containsRole(s.effectiveRoles(session), "admin")
	var req struct {
		Reason string `json:"reason"`
	}
	if r.Method == http.MethodPost {
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req) != nil || strings.TrimSpace(req.Reason) == "" {
			writeError(w, 400, "validation_failed", "reason is required")
			return
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, exists := s.Catalog.Versions[parts[0]]
	if !exists {
		writeError(w, 404, "not_found", "version was not found")
		return
	}
	owned := false
	for _, m := range s.Catalog.Mods {
		if m.ID == v.ModID && m.Author.ID == session.User.ID {
			owned = true
			break
		}
	}
	if !owned && !isAdmin {
		writeError(w, 403, "forbidden", "administrator or author permission required")
		return
	}
	v.Deprecated = r.Method == http.MethodPost
	v.DeprecationReason = strings.TrimSpace(req.Reason)
	s.Catalog.Versions[v.ID] = v
	if err := s.saveLocked(); err != nil {
		writeError(w, 500, "storage_error", "deprecation was not saved")
		return
	}
	writeJSON(w, 200, v)
}

func (s *Store) reviewAudit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method is not supported")
		return
	}
	session, ok := s.requireSession(w, r)
	if !ok || !containsRole(s.effectiveRoles(session), "admin") {
		if ok {
			writeError(w, http.StatusForbidden, "forbidden", "administrator role required")
		}
		return
	}
	s.mu.RLock()
	items := append([]ReviewAuditEvent(nil), s.Catalog.ReviewAudit...)
	s.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func reviewAuditID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "audit_unknown"
	}
	return "audit_" + hex.EncodeToString(b[:])
}

func (s *Store) reviewSubmissions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	if session, ok := s.requireSession(w, r); !ok || !containsRole(s.effectiveRoles(session), "admin") {
		if ok {
			writeError(w, 403, "forbidden", "administrator role required")
		}
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := append([]Submission(nil), s.Catalog.Submissions...)
	writeJSON(w, 200, map[string]any{"items": items, "next_cursor": nil})
}

func (s *Store) authorSubmissions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method is not supported")
		return
	}
	session, ok := s.requireSession(w, r)
	if !ok {
		return
	}
	s.mu.RLock()
	items := make([]Submission, 0)
	for _, item := range s.Catalog.Submissions {
		if item.AuthorID == session.User.ID {
			items = append(items, item)
		}
	}
	s.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (s *Store) reviewSubmissionResource(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireSession(w, r)
	if !ok {
		return
	}
	if !containsRole(s.effectiveRoles(session), "admin") {
		writeError(w, 403, "forbidden", "administrator role required")
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/review/submissions/"), "/"), "/")
	if len(parts) == 1 && r.Method == http.MethodGet {
		s.mu.RLock()
		defer s.mu.RUnlock()
		for _, sub := range s.Catalog.Submissions {
			if sub.ID != parts[0] {
				continue
			}
			var mod Mod
			for _, item := range s.Catalog.Mods {
				if item.ID == sub.ModID {
					mod = item
					break
				}
			}
			version := s.Catalog.Versions[sub.VersionID]
			var report *packagezip.Report
			if s.Catalog.ScanReports != nil {
				if item, ok := s.Catalog.ScanReports[version.ScanReportID]; ok {
					report = &item
				}
			}
			if sub.State == "rejected" && sub.VersionSnapshot != nil {
				version = *sub.VersionSnapshot
				report = sub.ScanReportSnapshot
			}
			writeJSON(w, http.StatusOK, map[string]any{"submission": sub, "mod": mod, "version": version, "scan_report": report})
			return
		}
		writeError(w, 404, "not_found", "submission was not found")
		return
	}
	if len(parts) != 2 || r.Method != http.MethodPost || (parts[1] != "decision" && parts[1] != "publish") {
		writeError(w, 404, "not_found", "review action was not found")
		return
	}
	if parts[1] == "publish" {
		s.mu.Lock()
		defer s.mu.Unlock()
		var found *Submission
		for i := range s.Catalog.Submissions {
			if s.Catalog.Submissions[i].ID == parts[0] {
				found = &s.Catalog.Submissions[i]
				break
			}
		}
		if found == nil {
			writeError(w, 404, "not_found", "submission was not found")
			return
		}
		if found.State != "approved" {
			writeError(w, 409, "invalid_state", "submission is not approved")
			return
		}
		v := s.Catalog.Versions[found.VersionID]
		v.State = "published"
		s.Catalog.Versions[v.ID] = v
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == found.ModID && (found.MarkLatest == nil || *found.MarkLatest || s.Catalog.Mods[i].LatestVersionID == "") {
				s.Catalog.Mods[i].LatestVersionID = v.ID
			}
		}
		now := time.Now().UTC()
		found.State = "published"
		found.PublishedAt = &now
		s.Catalog.ReviewAudit = append(s.Catalog.ReviewAudit, ReviewAuditEvent{ID: reviewAuditID(), Timestamp: now, ActorID: session.User.ID, ActorName: session.User.DisplayName, ActorRole: "admin", Action: "version_publish", TargetType: "version", TargetID: found.VersionID, TargetLabel: found.ID, Reason: "published"})
		if err := s.saveLocked(); err != nil {
			writeError(w, 500, "storage_error", "publication was not saved")
			return
		}
		writeJSON(w, 200, *found)
		return
	}
	var req struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if dec.Decode(&req) != nil || (req.Decision != "approve" && req.Decision != "reject") || strings.TrimSpace(req.Reason) == "" {
		writeError(w, 400, "validation_failed", "decision and reason are required")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var found *Submission
	for i := range s.Catalog.Submissions {
		if s.Catalog.Submissions[i].ID == parts[0] {
			found = &s.Catalog.Submissions[i]
			break
		}
	}
	if found == nil {
		writeError(w, 404, "not_found", "submission was not found")
		return
	}
	if found.State != "ready_for_review" {
		writeError(w, 409, "invalid_state", "submission is not awaiting review")
		return
	}
	now := time.Now().UTC()
	found.ReviewerID = session.User.ID
	found.Reason = strings.TrimSpace(req.Reason)
	found.DecidedAt = &now
	if req.Decision == "approve" {
		found.State = "published"
		found.PublishedAt = &now
	} else {
		found.State = "rejected"
	}
	v := s.Catalog.Versions[found.VersionID]
	if req.Decision == "approve" {
		v.State = "published"
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == found.ModID && (found.MarkLatest == nil || *found.MarkLatest || s.Catalog.Mods[i].LatestVersionID == "") {
				s.Catalog.Mods[i].LatestVersionID = v.ID
			}
		}
	} else {
		v.State = "rejected"
		original := v
		original.ArchivePath = ""
		found.VersionSnapshot = &original
		if report, ok := s.Catalog.ScanReports[v.ScanReportID]; ok {
			originalReport := report
			found.ScanReportSnapshot = &originalReport
		}
	}
	s.Catalog.Versions[v.ID] = v
	action := "submission_" + req.Decision
	s.Catalog.ReviewAudit = append(s.Catalog.ReviewAudit, ReviewAuditEvent{ID: reviewAuditID(), Timestamp: now, ActorID: session.User.ID, ActorName: session.User.DisplayName, ActorRole: "admin", Action: action, TargetType: "submission", TargetID: found.ID, TargetLabel: found.ID, Reason: found.Reason})
	if err := s.saveLocked(); err != nil {
		writeError(w, 500, "storage_error", "decision was not saved")
		return
	}
	writeJSON(w, 200, *found)
}
