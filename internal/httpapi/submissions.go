package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	packagezip "github.com/reze/submodhub/internal/package"
	"io"
	"net/http"
	"os"
	"slices"
	"sort"
	"strconv"
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

// The reviewed replacement is already published in memory. Preserve old
// submission snapshots before removing obsolete spritepack versions.
func (s *Store) retireSpritepackVersionsLocked(modID, currentID string) []string {
	var spritepack bool
	for _, mod := range s.Catalog.Mods {
		if mod.ID == modID {
			spritepack = mod.Category == "spritepack"
			break
		}
	}
	if !spritepack {
		return nil
	}
	var paths []string
	for id, old := range s.Catalog.Versions {
		if id == currentID || old.ModID != modID || (old.State != "published" && old.State != "unpublished") {
			continue
		}
		for i := range s.Catalog.Submissions {
			sub := &s.Catalog.Submissions[i]
			if sub.VersionID != id || sub.VersionSnapshot != nil {
				continue
			}
			snapshot := old
			snapshot.ArchivePath = ""
			snapshot.PlatformAssets = slices.Clone(old.PlatformAssets)
			for j := range snapshot.PlatformAssets {
				snapshot.PlatformAssets[j].ArchivePath = ""
			}
			sub.VersionSnapshot = &snapshot
			if report, ok := s.Catalog.ScanReports[old.ScanReportID]; ok {
				copy := report
				sub.ScanReportSnapshot = &copy
			}
		}
		paths = append(paths, old.archivePaths()...)
		// A per-platform version owns one report per file; dropping only the
		// summary key would leave the other platforms' reports behind.
		for _, key := range old.scanReportKeys() {
			delete(s.Catalog.ScanReports, key)
		}
		delete(s.Catalog.Versions, id)
	}
	return paths
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
	query, err := parseReviewPage(r, false)
	if err != nil {
		writeError(w, 400, "validation_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.reviewAuditPage(query))
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
	query, err := parseReviewPage(r, true)
	if err != nil {
		writeError(w, 400, "validation_failed", err.Error())
		return
	}
	writeJSON(w, 200, s.reviewSubmissionPage(query))
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
	s.authorSubmissionPage(w, r, session.User.ID)
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
	if len(parts) == 2 && parts[1] == "archive" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method is not supported")
			return
		}
		s.reviewSubmissionArchive(w, r, parts[0])
		return
	}
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
			version, report := sub.reviewVersion(s.Catalog.Versions[sub.VersionID], s.Catalog.ScanReports)
			// `scan_report` stays the version summary a single-archive version has
			// always had; `scan_reports` carries every platform's own report so a
			// reviewer can examine the file list of each build before deciding.
			// `archive_availability` names the builds this page can actually fetch,
			// so the workspace never offers a download that cannot succeed.
			writeJSON(w, http.StatusOK, map[string]any{"submission": sub.SanitizeForClient(), "mod": mod, "version": version.SanitizeForClient(), "scan_report": report, "scan_reports": s.versionScanReports(version), "archive_availability": version.reviewArchiveAvailability()})
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
		// Publishing a per-platform version that cannot serve an advertised
		// platform would put a 404 in the catalog. Submission checks this for the
		// author; the declaration may have widened since then.
		if err := s.requirePublishablePlatformCoverage(v); err != nil {
			writeError(w, 409, "archive_required", err.Error())
			return
		}
		before, _ := json.Marshal(s.Catalog)
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
		oldPaths := s.retireSpritepackVersionsLocked(found.ModID, v.ID)
		if err := s.saveLocked(); err != nil {
			_ = json.Unmarshal(before, &s.Catalog)
			writeError(w, 500, "storage_error", "publication was not saved")
			return
		}
		for _, oldPath := range oldPaths {
			_ = os.Remove(oldPath)
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
	// Same promise as submit: approval must not publish a per-platform version
	// that leaves a declared platform without an archive. Checked before any
	// in-memory mutation so a rejected approval leaves the submission untouched.
	if req.Decision == "approve" {
		if err := s.requirePublishablePlatformCoverage(s.Catalog.Versions[found.VersionID]); err != nil {
			writeError(w, 409, "archive_required", err.Error())
			return
		}
	}
	before, _ := json.Marshal(s.Catalog)
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
	var oldPaths []string
	if req.Decision == "approve" {
		oldPaths = s.retireSpritepackVersionsLocked(found.ModID, v.ID)
	}
	action := "submission_" + req.Decision
	s.Catalog.ReviewAudit = append(s.Catalog.ReviewAudit, ReviewAuditEvent{ID: reviewAuditID(), Timestamp: now, ActorID: session.User.ID, ActorName: session.User.DisplayName, ActorRole: "admin", Action: action, TargetType: "submission", TargetID: found.ID, TargetLabel: found.ID, Reason: found.Reason})
	if err := s.saveLocked(); err != nil {
		_ = json.Unmarshal(before, &s.Catalog)
		writeError(w, 500, "storage_error", "decision was not saved")
		return
	}
	for _, oldPath := range oldPaths {
		_ = os.Remove(oldPath)
	}
	writeJSON(w, 200, *found)
}

// reviewVersion is the version payload a reviewer reads: the live record, or the
// frozen snapshot once a rejection or a deleted record stops the live record from
// describing the reviewed build. The report follows the same choice, so the page
// never shows one build's file list next to another build's metadata.
func (sub Submission) reviewVersion(live Version, reports map[string]packagezip.Report) (Version, *packagezip.Report) {
	var report *packagezip.Report
	if item, ok := reports[live.ScanReportID]; ok {
		report = &item
	}
	if sub.VersionSnapshot == nil {
		return live, report
	}
	if live.ID == "" || sub.State == "rejected" {
		return *sub.VersionSnapshot, sub.ScanReportSnapshot
	}
	return live, report
}

// reviewArchiveAvailability names the builds of a submission this server can
// actually hand over. A deleted version keeps its submission but no bytes, and a
// rejection freezes the reviewed build into a path-less snapshot, so the
// workspace has to know the difference before it offers a download.
type reviewArchiveAvailability struct {
	Shared    bool     `json:"shared"`
	Platforms []string `json:"platforms"`
}

func (v Version) reviewArchiveAvailability() reviewArchiveAvailability {
	availability := reviewArchiveAvailability{Platforms: []string{}}
	if len(v.PlatformAssets) == 0 {
		availability.Shared = storedArchiveExists(v.ArchivePath)
		return availability
	}
	for _, file := range v.platformFiles() {
		if storedArchiveExists(file.ArchivePath) {
			availability.Platforms = append(availability.Platforms, file.Platform)
		}
	}
	return availability
}

// storedArchiveExists is the one test for "these bytes are on this server": a
// recorded path that no longer resolves would otherwise become a download
// control that can only fail.
func storedArchiveExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// reviewSubmissionArchive serves the ZIP behind one submission. The public
// archive endpoint answers for published versions only, so without this route a
// reviewer could read a pending version's file tree and scan report but never the
// package those describe.
//
// Only bytes this server stores are served: that is the artifact the scan report
// describes. Relaying from GitHub here would hand out whatever upstream holds
// now instead of what was inspected.
func (s *Store) reviewSubmissionArchive(w http.ResponseWriter, r *http.Request, submissionID string) {
	s.mu.RLock()
	var sub Submission
	found := false
	for _, candidate := range s.Catalog.Submissions {
		if candidate.ID == submissionID {
			sub, found = candidate, true
			break
		}
	}
	version, _ := sub.reviewVersion(s.Catalog.Versions[sub.VersionID], nil)
	var mod Mod
	for _, item := range s.Catalog.Mods {
		if item.ID == sub.ModID {
			mod = item
			break
		}
	}
	s.mu.RUnlock()
	if !found {
		writeError(w, http.StatusNotFound, "not_found", "submission was not found")
		return
	}
	served, platform := version, ""
	// Same contract as the public archive endpoint: a per-platform version has no
	// default build, while naming a platform for a single-archive version is a
	// no-op. The reviewer's page names the platform whose report it is showing.
	if err := version.platformQueryError(r.URL.Query().Get("platform")); err != nil {
		writePlatformQueryError(w, err)
		return
	}
	if len(version.PlatformAssets) > 0 {
		file, _ := version.platformFileFor(r.URL.Query().Get("platform"))
		platform = file.Platform
		served.ArchivePath, served.SHA256, served.SizeBytes = file.ArchivePath, file.SHA256, file.SizeBytes
	}
	if served.ArchivePath == "" {
		writeError(w, http.StatusNotFound, "archive_not_found", "this submission has no archive stored on this server")
		return
	}
	file, err := os.Open(served.ArchivePath)
	if err != nil {
		writeError(w, http.StatusNotFound, "archive_not_found", "this submission has no archive stored on this server")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeError(w, http.StatusNotFound, "archive_not_found", "this submission has no archive stored on this server")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	// A submission that is not published yet is private: nothing here may be
	// reused from a shared browser cache.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", reviewArchiveName(mod.ID, served.Version, version.ID, platform)))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("X-Archive-SHA256", served.SHA256)
	w.Header().Set("X-Version-ID", version.ID)
	if platform != "" {
		w.Header().Set("X-Archive-Platform", platform)
	}
	_, _ = io.Copy(w, file)
}

// reviewArchiveName names the file a reviewer saves: mod, version and, for a
// per-platform build, the platform whose bytes are inside. Everything outside
// [A-Za-z0-9._-] becomes `_` so the name is safe inside a quoted header value.
func reviewArchiveName(modID, version, versionID, platform string) string {
	parts := []string{modID}
	if version != "" {
		parts = append(parts, version)
	}
	if platform != "" {
		parts = append(parts, platform)
	}
	name := sanitizeArchiveName(strings.Join(parts, "_"))
	if name == "" {
		name = sanitizeArchiveName(versionID)
	}
	if name == "" {
		name = "archive"
	}
	return name + ".zip"
}

func sanitizeArchiveName(name string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			return r
		default:
			return '_'
		}
	}, name)
}
