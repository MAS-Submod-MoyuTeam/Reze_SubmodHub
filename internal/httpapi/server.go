package httpapi

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/reze/submodhub/internal/auth"
	packagezip "github.com/reze/submodhub/internal/package"
)

type Author struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
}
type Dependency struct {
	ModID        string `json:"mod_id"`
	ModTitle     string `json:"mod_title,omitempty"`
	LinkedModID  string `json:"linked_mod_id,omitempty"`
	VersionRange string `json:"version_range"`
	Required     bool   `json:"required"`
}
type Version struct {
	ID                string       `json:"id"`
	ModID             string       `json:"mod_id"`
	Version           string       `json:"version"`
	CreatedAt         *time.Time   `json:"created_at,omitempty"`
	State             string       `json:"state"`
	SizeBytes         int64        `json:"size_bytes"`
	SHA256            string       `json:"sha256"`
	ReleaseNotes      string       `json:"release_notes"`
	Dependencies      []Dependency `json:"dependencies"`
	ScanReportID      string       `json:"scan_report_id,omitempty"`
	ArchivePath       string       `json:"archive_path,omitempty"`
	Deprecated        bool         `json:"deprecated,omitempty"`
	DeprecationReason string       `json:"deprecation_reason,omitempty"`
}
type Mod struct {
	ID                  string   `json:"id"`
	Title               string   `json:"title"`
	Summary             string   `json:"summary"`
	Description         string   `json:"description,omitempty"`
	Author              Author   `json:"author"`
	Category            string   `json:"category"`
	Tags                []string `json:"tags"`
	SupportedPlatforms  []string `json:"supported_platforms"`
	MASVersionRange     string   `json:"mas_version_range"`
	RecommendedPriority int      `json:"recommended_priority"`
	LatestVersionID     string   `json:"latest_version_id"`
	LatestVersion       string   `json:"latest_version"`
	SizeBytes           int64    `json:"size_bytes"`
	SHA256              string   `json:"sha256"`
	ImagePaths          []string   `json:"image_paths,omitempty"`
	Unpublished         bool       `json:"unpublished,omitempty"`
	SourceType          string     `json:"source_type,omitempty"`
	GitHubOwner         string     `json:"github_owner,omitempty"`
	GitHubRepo          string     `json:"github_repo,omitempty"`
	GitHubAssetRegex    string     `json:"github_asset_regex,omitempty"`
	GitHubSourceCode    bool       `json:"github_source_code,omitempty"`
	GitHubLastSyncAt    *time.Time `json:"github_last_sync_at,omitempty"`
	GitHubLastSyncError string     `json:"github_last_sync_error,omitempty"`
	GitHubLastReleaseID int64      `json:"github_last_release_id,omitempty"`
}

func (m Mod) GetSourceType() string {
	if m.SourceType == "" {
		return "local"
	}
	return m.SourceType
}

var githubOwnerRegex = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$`)
var githubRepoRegex = regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)

func validateSourceConfig(sourceType, owner, repo, assetRegex string, sourceCode bool) error {
	switch sourceType {
	case "", "local":
		return nil
	case "github_releases":
		owner = strings.TrimSpace(owner)
		repo = strings.TrimSpace(repo)
		if owner == "" || repo == "" {
			return errors.New("github_owner and github_repo are required for github_releases source")
		}
		if !githubOwnerRegex.MatchString(owner) {
			return errors.New("invalid github_owner format")
		}
		if !githubRepoRegex.MatchString(repo) {
			return errors.New("invalid github_repo format")
		}
		assetRegex = strings.TrimSpace(assetRegex)
		if assetRegex == "" && !sourceCode {
			return errors.New("github_releases source requires either github_asset_regex or github_source_code to be enabled")
		}
		if assetRegex != "" {
			if _, err := regexp.Compile(assetRegex); err != nil {
				return fmt.Errorf("invalid github_asset_regex: %w", err)
			}
		}
		return nil
	default:
		return fmt.Errorf("unsupported source_type: %s", sourceType)
	}
}

func cleanPublicMod(m Mod) Mod {
	cp := m
	cp.GitHubLastSyncAt = nil
	cp.GitHubLastSyncError = ""
	cp.GitHubLastReleaseID = 0
	return cp
}
type Catalog struct {
	Mods        []Mod                        `json:"mods"`
	Versions    map[string]Version           `json:"versions"`
	Submissions []Submission                 `json:"submissions,omitempty"`
	ReviewAudit []ReviewAuditEvent           `json:"review_audit,omitempty"`
	ScanReports map[string]packagezip.Report `json:"scan_reports,omitempty"`
	RoleGrants  map[string][]string          `json:"role_grants,omitempty"`
	RoleAudit   []RoleAuditEvent             `json:"role_audit,omitempty"`
}

const maxModImageSize = 10 << 20
const maxArchiveSize = 128 << 20

type ReviewAuditEvent struct {
	ID          string         `json:"id"`
	Timestamp   time.Time      `json:"timestamp"`
	ActorID     string         `json:"actor_id"`
	ActorName   string         `json:"actor_name"`
	ActorRole   string         `json:"actor_role"`
	Action      string         `json:"action"`
	TargetType  string         `json:"target_type"`
	TargetID    string         `json:"target_id"`
	TargetLabel string         `json:"target_label"`
	Reason      string         `json:"reason"`
	Details     map[string]any `json:"details,omitempty"`
}
type Submission struct {
	ID                 string             `json:"id"`
	ModID              string             `json:"mod_id"`
	VersionID          string             `json:"version_id"`
	AuthorID           string             `json:"author_id"`
	State              string             `json:"state"`
	MarkLatest         *bool              `json:"mark_latest,omitempty"`
	ReviewerID         string             `json:"reviewer_id,omitempty"`
	Reason             string             `json:"reason,omitempty"`
	CreatedAt          time.Time          `json:"created_at"`
	DecidedAt          *time.Time         `json:"decided_at,omitempty"`
	PublishedAt        *time.Time         `json:"published_at,omitempty"`
	VersionSnapshot    *Version           `json:"version_snapshot,omitempty"`
	ScanReportSnapshot *packagezip.Report `json:"scan_report_snapshot,omitempty"`
}
type RoleAuditEvent struct {
	ActorID  string    `json:"actor_id"`
	TargetID string    `json:"target_id"`
	Roles    []string  `json:"roles"`
	At       time.Time `json:"at"`
}
type Store struct {
	mu            sync.RWMutex
	Catalog       Catalog
	DataDir       string
	UploadToken   string
	AutoPublish   bool
	TestMode      bool
	TestUsername  string
	TestPassword  string
	DB            *sql.DB
	Flarum        *auth.FlarumClient
	AdminGroupIDs map[string]bool
	sessions      map[string]authSession
}

func NewStore(dataDir string, initial Catalog) (*Store, error) {
	return newStore(dataDir, initial, true)
}

func newArchiveStore(dataDir string, initial Catalog) (*Store, error) {
	return newStore(dataDir, initial, false)
}

func newStore(dataDir string, initial Catalog, loadLocalCatalog bool) (*Store, error) {
	if dataDir == "" {
		dataDir = "./data"
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "archives"), 0o750); err != nil {
		return nil, err
	}
	s := &Store{Catalog: initial, DataDir: dataDir, sessions: map[string]authSession{}}
	if loadLocalCatalog {
		if b, err := os.ReadFile(filepath.Join(dataDir, "catalog.json")); err == nil {
			if json.Unmarshal(b, &s.Catalog) != nil {
				return nil, errors.New("invalid catalog.json")
			}
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}
	if s.Catalog.Versions == nil {
		s.Catalog.Versions = map[string]Version{}
	}
	for id, v := range s.Catalog.Versions {
		if v.ArchivePath != "" {
			v.ArchivePath = filepath.Join(dataDir, "archives", filepath.Base(v.ArchivePath))
			s.Catalog.Versions[id] = v
		}
	}
	return s, nil
}
func (s *Store) saveLocked() error {
	b, err := json.MarshalIndent(s.Catalog, "", "  ")
	if err != nil {
		return err
	}
	if s.DB != nil {
		_, err = s.DB.Exec("INSERT INTO catalog_snapshot (id, document) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document", b)
		return err
	}
	tmp := filepath.Join(s.DataDir, "catalog.json.tmp")
	if err = os.WriteFile(tmp, b, 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(s.DataDir, "catalog.json"))
}
func New(c Catalog) http.Handler {
	s, err := NewStore("./data", c)
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writeError(w, 500, "storage_error", err.Error()) })
	}
	return NewStoreHandler(s)
}
func NewStoreHandler(s *Store) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("/api/v1/mods", s.listMods)
	mux.HandleFunc("/api/v1/session", s.session)
	mux.HandleFunc("/api/v1/auth/flarum/login", s.loginFlarum)
	mux.HandleFunc("/api/v1/auth/logout", s.logout)
	mux.HandleFunc("/api/v1/admin/users/", s.updateUserRoles)
	mux.HandleFunc("/api/v1/author/mods", s.authorMods)
	mux.HandleFunc("/api/v1/author/mods/", s.authorModResource)
	mux.HandleFunc("/api/v1/author/versions/", s.authorVersionResource)
	mux.HandleFunc("/api/v1/author/submissions", s.authorSubmissions)
	mux.HandleFunc("/api/v1/review/submissions", s.reviewSubmissions)
	mux.HandleFunc("/api/v1/review/audit", s.reviewAudit)
	mux.HandleFunc("/api/v1/review/submissions/", s.reviewSubmissionResource)
	mux.HandleFunc("/api/v1/mods/", s.modResource)
	mux.HandleFunc("/api/v1/spritepacks/", s.spritepackResource)
	mux.HandleFunc("/api/v1/versions/", s.downloadDescriptor)
	mux.HandleFunc("/api/v1/archives/", s.downloadArchive)
	mux.HandleFunc("/api/v1/images/", s.downloadImage)
	return withCORS(mux)
}

func (s *Store) requireRole(w http.ResponseWriter, r *http.Request, role string) (authSession, bool) {
	session, ok := s.readSession(r)
	if !ok {
		writeError(w, 401, "unauthenticated", "login required")
		return authSession{}, false
	}
	roles := s.effectiveRoles(session)
	if !containsRole(roles, role) && !containsRole(roles, "admin") {
		writeError(w, 403, "forbidden", role+" role required")
		return authSession{}, false
	}
	return session, true
}

func (s *Store) requireSession(w http.ResponseWriter, r *http.Request) (authSession, bool) {
	session, ok := s.readSession(r)
	if !ok {
		writeError(w, 401, "unauthenticated", "login required")
	}
	return session, ok
}

func (s *Store) authorMods(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireSession(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		s.mu.RLock()
		items := make([]struct {
			Mod         Mod                          `json:"mod"`
			Versions    []Version                    `json:"versions"`
			ScanReports map[string]packagezip.Report `json:"scan_reports"`
		}, 0)
		for _, mod := range s.Catalog.Mods {
			if mod.Author.ID != session.User.ID {
				continue
			}
			item := struct {
				Mod         Mod                          `json:"mod"`
				Versions    []Version                    `json:"versions"`
				ScanReports map[string]packagezip.Report `json:"scan_reports"`
			}{Mod: mod, Versions: []Version{}, ScanReports: map[string]packagezip.Report{}}
			for _, version := range s.Catalog.Versions {
				if version.ModID == mod.ID {
					version.ArchivePath = ""
					item.Versions = append(item.Versions, resolveVersionDependencies(s.Catalog, version))
					if report, ok := s.Catalog.ScanReports[version.ScanReportID]; ok {
						item.ScanReports[version.ScanReportID] = report
					}
				}
			}
			items = append(items, item)
		}
		s.mu.RUnlock()
		writeJSON(w, 200, map[string]any{"items": items})
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	var req struct {
		Title               string   `json:"title"`
		Summary             string   `json:"summary"`
		Description         string   `json:"description"`
		AuthorDisplayName   string   `json:"author_display_name"`
		Category            string   `json:"category"`
		Tags                []string `json:"tags"`
		SupportedPlatforms  []string `json:"supported_platforms"`
		MASVersionRange     string   `json:"mas_version_range"`
		RecommendedPriority int      `json:"recommended_priority"`
		SourceType          string   `json:"source_type"`
		GitHubOwner         string   `json:"github_owner"`
		GitHubRepo          string   `json:"github_repo"`
		GitHubAssetRegex    string   `json:"github_asset_regex"`
		GitHubSourceCode    bool     `json:"github_source_code"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&req) != nil || strings.TrimSpace(req.Title) == "" || (req.Category != "submod" && req.Category != "spritepack") {
		writeError(w, 400, "validation_failed", "title and category are required")
		return
	}
	if err := validateSourceConfig(req.SourceType, req.GitHubOwner, req.GitHubRepo, req.GitHubAssetRegex, req.GitHubSourceCode); err != nil {
		writeError(w, 400, "validation_failed", err.Error())
		return
	}
	id, err := randomToken()
	if err != nil {
		writeError(w, 500, "storage_error", "could not create draft")
		return
	}
	id = "mod_" + id[:12]
	authorDisplayName := strings.TrimSpace(req.AuthorDisplayName)
	if authorDisplayName == "" {
		authorDisplayName = session.User.DisplayName
	}
	srcType := req.SourceType
	if srcType == "" {
		srcType = "local"
	}
	mod := Mod{
		ID:                  id,
		Title:               strings.TrimSpace(req.Title),
		Summary:             req.Summary,
		Description:         req.Description,
		Author:              Author{ID: session.User.ID, DisplayName: authorDisplayName},
		Category:            req.Category,
		Tags:                req.Tags,
		SupportedPlatforms:  req.SupportedPlatforms,
		MASVersionRange:     req.MASVersionRange,
		RecommendedPriority: req.RecommendedPriority,
		SourceType:          srcType,
		GitHubOwner:         strings.TrimSpace(req.GitHubOwner),
		GitHubRepo:          strings.TrimSpace(req.GitHubRepo),
		GitHubAssetRegex:    strings.TrimSpace(req.GitHubAssetRegex),
		GitHubSourceCode:    req.GitHubSourceCode,
	}
	s.mu.Lock()
	s.Catalog.Mods = append(s.Catalog.Mods, mod)
	if err := s.saveLocked(); err != nil {
		s.mu.Unlock()
		writeError(w, 500, "storage_error", "draft was not saved")
		return
	}
	s.mu.Unlock()
	writeJSON(w, 201, mod)
}

func (s *Store) authorVersionResource(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/archive") || strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/images") {
		s.uploadArchive(w, r)
		return
	}
	session, ok := s.requireSession(w, r)
	if !ok {
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/author/versions/"), "/"), "/")
	if len(parts) == 1 && r.Method == http.MethodDelete {
		versionID := parts[0]
		isAdmin := containsRole(s.effectiveRoles(session), "admin")
		s.mu.Lock()
		v, exists := s.Catalog.Versions[versionID]
		owned := false
		for _, m := range s.Catalog.Mods {
			if m.ID == v.ModID && m.Author.ID == session.User.ID {
				owned = true
				break
			}
		}
		if !owned && !isAdmin {
			s.mu.Unlock()
			writeError(w, 403, "forbidden", "administrator or author permission required")
			return
		}
		if !exists {
			s.mu.Unlock()
			writeError(w, 404, "not_found", "version was not found")
			return
		}
		for _, m := range s.Catalog.Mods {
			if m.LatestVersionID == versionID {
				s.mu.Unlock()
				writeError(w, 409, "current_version", "current catalog version cannot be deleted")
				return
			}
		}
		delete(s.Catalog.Versions, versionID)
		for i := range s.Catalog.Submissions {
			if s.Catalog.Submissions[i].VersionID == versionID {
				s.Catalog.Submissions[i].State = "deleted"
			}
		}
		if v.ArchivePath != "" {
			_ = os.Remove(v.ArchivePath)
		}
		if err := s.saveLocked(); err != nil {
			s.mu.Unlock()
			writeError(w, 500, "storage_error", "version deletion was not saved")
			return
		}
		s.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(parts) == 1 && r.Method == http.MethodPost && parts[0] == "" {
		writeError(w, 404, "not_found", "version endpoint was not found")
		return
	}
	if len(parts) == 1 && r.Method == http.MethodPost {
		modID := parts[0]
		_ = modID
		writeError(w, 404, "not_found", "version endpoint was not found")
		return
	}
	if len(parts) != 2 {
		writeError(w, 404, "not_found", "version endpoint was not found")
		return
	}
	versionID, action := parts[0], parts[1]
	s.mu.RLock()
	version, exists := s.Catalog.Versions[versionID]
	var mod *Mod
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == version.ModID {
			mod = &s.Catalog.Mods[i]
			break
		}
	}
	s.mu.RUnlock()
	if !exists || mod == nil || mod.Author.ID != session.User.ID {
		writeError(w, 404, "not_found", "version was not found")
		return
	}
	if action == "edit" && r.Method == http.MethodPatch {
		if version.State != "draft" && version.State != "uploaded" && version.State != "rejected" {
			writeError(w, 409, "immutable_version", "only draft, uploaded, or rejected versions can be edited")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16384)
		var req struct {
			Version      string        `json:"version"`
			ReleaseNotes string        `json:"release_notes"`
			Dependencies *[]Dependency `json:"dependencies"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if dec.Decode(&req) != nil || (version.State != "draft" && strings.TrimSpace(req.Version) == "") {
			writeError(w, 400, "validation_failed", "uploaded or rejected version requires a version identifier")
			return
		}
		if req.Dependencies != nil {
			for _, dependency := range *req.Dependencies {
				if dependency.LinkedModID == "" {
					continue
				}
				valid := false
				for _, candidate := range s.Catalog.Mods {
					if candidate.ID == dependency.LinkedModID && candidate.ID != version.ModID {
						valid = true
						break
					}
				}
				if !valid {
					writeError(w, 400, "validation_failed", "linked dependency must be another catalog mod")
					return
				}
			}
		}
		s.mu.Lock()
		if version.State == "rejected" {
			for i := range s.Catalog.Submissions {
				if s.Catalog.Submissions[i].VersionID == versionID && s.Catalog.Submissions[i].State == "rejected" && s.Catalog.Submissions[i].VersionSnapshot == nil {
					original := version
					original.ArchivePath = ""
					s.Catalog.Submissions[i].VersionSnapshot = &original
					if report, ok := s.Catalog.ScanReports[version.ScanReportID]; ok {
						originalReport := report
						s.Catalog.Submissions[i].ScanReportSnapshot = &originalReport
					}
				}
			}
		}
		version.Version = strings.TrimSpace(req.Version)
		if version.State == "draft" || version.State == "rejected" {
			version.ReleaseNotes = req.ReleaseNotes
		}
		if req.Dependencies != nil {
			version.Dependencies = *req.Dependencies
		}
		s.Catalog.Versions[version.ID] = version
		err := s.saveLocked()
		s.mu.Unlock()
		if err != nil {
			writeError(w, 500, "storage_error", "version edit was not saved")
			return
		}
		writeJSON(w, 200, version)
		return
	}
	if action == "submit" && r.Method == http.MethodPost {
		if strings.TrimSpace(version.Version) == "" {
			writeError(w, 400, "version_required", "enter a version identifier before submitting")
			return
		}
		if version.State != "uploaded" && version.State != "ready_for_review" {
			writeError(w, 409, "invalid_state", "version is not ready for review")
			return
		}
		archiveInfo, archiveErr := os.Stat(version.ArchivePath)
		if version.ArchivePath == "" || archiveErr != nil || !archiveInfo.Mode().IsRegular() {
			writeError(w, 409, "archive_required", "upload a ZIP archive before submitting for review")
			return
		}
		if version.ScanReportID == "" {
			writeError(w, 409, "scan_required", "scan the ZIP archive before submitting for review")
			return
		}
		s.mu.RLock()
		_, hasReport := s.Catalog.ScanReports[version.ScanReportID]
		s.mu.RUnlock()
		if !hasReport {
			writeError(w, 409, "scan_required", "scan the ZIP archive before submitting for review")
			return
		}
		var req struct {
			MarkLatest *bool `json:"mark_latest"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, 400, "validation_failed", "invalid submission options")
			return
		}
		now := time.Now().UTC()
		subID, _ := randomToken()
		state := "ready_for_review"
		if s.AutoPublish {
			state = "published"
		}
		sub := Submission{ID: "sub_" + subID[:12], ModID: version.ModID, VersionID: version.ID, AuthorID: session.User.ID, State: state, MarkLatest: req.MarkLatest, CreatedAt: now}
		s.mu.Lock()
		version.State = state
		s.Catalog.Versions[versionID] = version
		if s.AutoPublish {
			for i := range s.Catalog.Mods {
				if s.Catalog.Mods[i].ID == version.ModID {
					if req.MarkLatest == nil || *req.MarkLatest || s.Catalog.Mods[i].LatestVersionID == "" {
						s.Catalog.Mods[i].LatestVersionID = version.ID
					}
				}
			}
			sub.PublishedAt = &now
		}
		s.Catalog.Submissions = append(s.Catalog.Submissions, sub)
		err := s.saveLocked()
		s.mu.Unlock()
		if err != nil {
			writeError(w, 500, "storage_error", "submission was not saved")
			return
		}
		writeJSON(w, 201, sub)
		return
	}
	writeError(w, 404, "not_found", "version action was not found")
}

func (s *Store) authorModResource(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireSession(w, r)
	if !ok {
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/author/mods/"), "/"), "/")
	if len(parts) == 2 && parts[1] == "images" {
		switch r.Method {
		case http.MethodDelete:
			s.clearModImages(w, r)
		case http.MethodPatch:
			s.reorderModImages(w, r)
		case http.MethodPost:
			s.uploadModImages(w, r)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method is not supported")
		}
		return
	}
	if len(parts) == 2 && parts[1] == "unpublish" && r.Method == http.MethodPost {
		modID := parts[0]
		isAdmin := containsRole(s.effectiveRoles(session), "admin")
		s.mu.Lock()
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID && (s.Catalog.Mods[i].Author.ID == session.User.ID || isAdmin) {
				s.Catalog.Mods[i].Unpublished = true
				err := s.saveLocked()
				s.mu.Unlock()
				if err != nil {
					writeError(w, 500, "storage_error", "mod was not saved")
					return
				}
				writeJSON(w, 200, s.Catalog.Mods[i])
				return
			}
		}
		s.mu.Unlock()
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodDelete {
		modID := parts[0]
		isAdmin := containsRole(s.effectiveRoles(session), "admin")
		s.mu.Lock()
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID && (s.Catalog.Mods[i].Author.ID == session.User.ID || isAdmin) {
				published := false
				for _, candidate := range s.Catalog.Versions {
					if candidate.ModID == modID && (candidate.State == "published" || candidate.State == "unpublished") {
						published = true
						break
					}
				}
				if published {
					s.mu.Unlock()
					writeError(w, 409, "mod_not_deletable", "published mod cannot be deleted")
					return
				}
				for _, v := range s.Catalog.Versions {
					if v.ModID == modID {
						if v.ArchivePath != "" {
							_ = os.Remove(v.ArchivePath)
						}
						delete(s.Catalog.Versions, v.ID)
					}
				}
				if s.Catalog.Mods[i].ImagePaths != nil {
					for _, p := range s.Catalog.Mods[i].ImagePaths {
						_ = os.Remove(p)
					}
				}
				s.Catalog.Mods = append(s.Catalog.Mods[:i], s.Catalog.Mods[i+1:]...)
				if err := s.saveLocked(); err != nil {
					s.mu.Unlock()
					writeError(w, 500, "storage_error", "mod was not deleted")
					return
				}
				s.mu.Unlock()
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		s.mu.Unlock()
		writeError(w, 409, "mod_not_deletable", "published mod cannot be deleted")
		return
	}
	if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodPatch {
		modID := parts[0]
		r.Body = http.MaxBytesReader(w, r.Body, 16384)
		var req struct {
			Title               string   `json:"title"`
			Summary             string   `json:"summary"`
			Description         string   `json:"description"`
			AuthorDisplayName   string   `json:"author_display_name"`
			Category            string   `json:"category"`
			Tags                []string `json:"tags"`
			SupportedPlatforms  []string `json:"supported_platforms"`
			MASVersionRange     string   `json:"mas_version_range"`
			RecommendedPriority int      `json:"recommended_priority"`
			SourceType          *string  `json:"source_type"`
			GitHubOwner         *string  `json:"github_owner"`
			GitHubRepo          *string  `json:"github_repo"`
			GitHubAssetRegex    *string  `json:"github_asset_regex"`
			GitHubSourceCode    *bool    `json:"github_source_code"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if dec.Decode(&req) != nil || strings.TrimSpace(req.Title) == "" || (req.Category != "submod" && req.Category != "spritepack") {
			writeError(w, 400, "validation_failed", "title and category are required")
			return
		}
		isAdmin := containsRole(s.effectiveRoles(session), "admin")
		s.mu.Lock()
		index := -1
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID {
				index = i
				break
			}
		}
		if index < 0 {
			s.mu.Unlock()
			writeError(w, 404, "not_found", "mod was not found")
			return
		}
		if s.Catalog.Mods[index].Author.ID != session.User.ID && !isAdmin {
			s.mu.Unlock()
			writeError(w, 403, "forbidden", "administrator or author permission required")
			return
		}
		mod := &s.Catalog.Mods[index]
		mod.Title = strings.TrimSpace(req.Title)
		mod.Summary = req.Summary
		mod.Description = req.Description
		if strings.TrimSpace(req.AuthorDisplayName) != "" {
			mod.Author.DisplayName = strings.TrimSpace(req.AuthorDisplayName)
		}
		mod.Category = req.Category
		mod.Tags = req.Tags
		mod.SupportedPlatforms = req.SupportedPlatforms
		mod.MASVersionRange = req.MASVersionRange
		mod.RecommendedPriority = req.RecommendedPriority
		if req.SourceType != nil || req.GitHubOwner != nil || req.GitHubRepo != nil || req.GitHubAssetRegex != nil || req.GitHubSourceCode != nil {
			newSourceType := mod.GetSourceType()
			if req.SourceType != nil {
				newSourceType = *req.SourceType
			}
			newOwner := mod.GitHubOwner
			if req.GitHubOwner != nil {
				newOwner = *req.GitHubOwner
			}
			newRepo := mod.GitHubRepo
			if req.GitHubRepo != nil {
				newRepo = *req.GitHubRepo
			}
			newRegex := mod.GitHubAssetRegex
			if req.GitHubAssetRegex != nil {
				newRegex = *req.GitHubAssetRegex
			}
			newSourceCode := mod.GitHubSourceCode
			if req.GitHubSourceCode != nil {
				newSourceCode = *req.GitHubSourceCode
			}
			if err := validateSourceConfig(newSourceType, newOwner, newRepo, newRegex, newSourceCode); err != nil {
				s.mu.Unlock()
				writeError(w, 400, "validation_failed", err.Error())
				return
			}
			mod.SourceType = newSourceType
			mod.GitHubOwner = strings.TrimSpace(newOwner)
			mod.GitHubRepo = strings.TrimSpace(newRepo)
			mod.GitHubAssetRegex = strings.TrimSpace(newRegex)
			mod.GitHubSourceCode = newSourceCode
		}
		if err := s.saveLocked(); err != nil {
			s.mu.Unlock()
			writeError(w, 500, "storage_error", "mod was not saved")
			return
		}
		updated := *mod
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, updated)
		return
	}
	if len(parts) != 2 || parts[1] != "versions" || r.Method != http.MethodPost {
		writeError(w, 404, "not_found", "version endpoint was not found")
		return
	}
	modID := parts[0]
	s.mu.RLock()
	var mod *Mod
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == modID {
			mod = &s.Catalog.Mods[i]
			break
		}
	}
	s.mu.RUnlock()
	if mod == nil || mod.Author.ID != session.User.ID {
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	var req struct {
		Version      string       `json:"version"`
		ReleaseNotes string       `json:"release_notes"`
		Dependencies []Dependency `json:"dependencies"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&req) != nil {
		writeError(w, 400, "validation_failed", "invalid version request")
		return
	}
	id, _ := randomToken()
	id = "ver_" + id[:12]
	now := time.Now().UTC()
	v := Version{ID: id, ModID: modID, Version: strings.TrimSpace(req.Version), CreatedAt: &now, State: "draft", ReleaseNotes: req.ReleaseNotes, Dependencies: req.Dependencies}
	s.mu.Lock()
	if s.Catalog.Versions == nil {
		s.Catalog.Versions = map[string]Version{}
	}
	s.Catalog.Versions[id] = v
	err := s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		writeError(w, 500, "storage_error", "version was not saved")
		return
	}
	writeJSON(w, 201, v)
}

func (s *Store) clearModImages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/author/mods/"), "/"), "/")
	if len(parts) != 2 || parts[1] != "images" {
		writeError(w, 404, "not_found", "image endpoint was not found")
		return
	}
	modID := parts[0]
	sess, ok := s.readSession(r)
	if !ok {
		writeError(w, 401, "unauthenticated", "login is required")
		return
	}
	isAdmin := containsRole(s.effectiveRoles(sess), "admin")
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == modID && (s.Catalog.Mods[i].Author.ID == sess.User.ID || isAdmin) {
			for _, p := range s.Catalog.Mods[i].ImagePaths {
				_ = os.Remove(p)
			}
			s.Catalog.Mods[i].ImagePaths = nil
			if err := s.saveLocked(); err != nil {
				writeError(w, 500, "storage_error", "images were not saved")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	writeError(w, 404, "not_found", "mod was not found")
}

func (s *Store) reorderModImages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method is not supported")
		return
	}
	sess, ok := s.readSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "login is required")
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/author/mods/"), "/"), "/")
	if len(parts) != 2 || parts[1] != "images" {
		writeError(w, http.StatusNotFound, "not_found", "image endpoint was not found")
		return
	}
	var req struct {
		Filenames []string `json:"filenames"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "validation_failed", "invalid image order")
		return
	}
	modID := parts[0]
	isAdmin := containsRole(s.effectiveRoles(sess), "admin")
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.Catalog.Mods {
		mod := &s.Catalog.Mods[i]
		if mod.ID != modID {
			continue
		}
		if mod.Author.ID != sess.User.ID && !isAdmin {
			writeError(w, http.StatusForbidden, "forbidden", "administrator or author permission required")
			return
		}
		byName := make(map[string]string, len(mod.ImagePaths))
		for _, path := range mod.ImagePaths {
			byName[filepath.Base(path)] = path
		}
		ordered := make([]string, 0, len(req.Filenames))
		seen := make(map[string]bool, len(req.Filenames))
		for _, filename := range req.Filenames {
			if filename == "" || filepath.Base(filename) != filename || seen[filename] {
				writeError(w, http.StatusBadRequest, "validation_failed", "image order contains an invalid or duplicate filename")
				return
			}
			path, exists := byName[filename]
			if !exists {
				writeError(w, http.StatusBadRequest, "validation_failed", "image order must reference existing images")
				return
			}
			seen[filename] = true
			ordered = append(ordered, path)
		}
		for _, path := range mod.ImagePaths {
			if !seen[filepath.Base(path)] {
				_ = os.Remove(path)
			}
		}
		mod.ImagePaths = ordered
		if err := s.saveLocked(); err != nil {
			writeError(w, http.StatusInternalServerError, "storage_error", "image order was not saved")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"mod_id": modID, "count": len(ordered)})
		return
	}
	writeError(w, http.StatusNotFound, "not_found", "mod was not found")
}

func (s *Store) uploadModImages(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireSession(w, r)
	if !ok {
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/author/mods/"), "/"), "/")
	if len(parts) != 2 || parts[1] != "images" || r.Method != http.MethodPost {
		writeError(w, 404, "not_found", "image endpoint was not found")
		return
	}
	modID := parts[0]
	s.mu.RLock()
	var mod Mod
	for _, candidate := range s.Catalog.Mods {
		if candidate.ID == modID {
			mod = candidate
			break
		}
	}
	allowed := mod.ID != "" && (mod.Author.ID == session.User.ID || containsRole(s.effectiveRoles(session), "admin"))
	s.mu.RUnlock()
	if !allowed {
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8*maxModImageSize+1024)
	if err := r.ParseMultipartForm(8 * maxModImageSize); err != nil {
		writeError(w, 400, "invalid_upload", "invalid image upload")
		return
	}
	files := r.MultipartForm.File["images"]
	if len(files) == 0 || len(files) > 8 {
		writeError(w, 400, "invalid_upload", "upload one to eight images")
		return
	}
	appendImages := r.URL.Query().Get("append") == "true"
	if appendImages && len(mod.ImagePaths)+len(files) > 8 {
		writeError(w, http.StatusBadRequest, "invalid_upload", "a mod can have at most eight images")
		return
	}
	dir := filepath.Join(s.DataDir, "images", modID)
	if err := os.MkdirAll(dir, 0750); err != nil {
		writeError(w, 500, "storage_error", "image directory was not created")
		return
	}
	paths := make([]string, 0, len(files))
	startIndex := 0
	if appendImages {
		startIndex = len(mod.ImagePaths)
	}
	for i, header := range files {
		if header.Size <= 0 || header.Size > maxModImageSize {
			writeError(w, 413, "image_too_large", "each image must be at most 10 MiB")
			return
		}
		file, err := header.Open()
		if err != nil {
			writeError(w, 400, "invalid_upload", "image could not be opened")
			return
		}
		data, err := io.ReadAll(io.LimitReader(file, maxModImageSize+1))
		_ = file.Close()
		if err != nil || len(data) > maxModImageSize {
			writeError(w, 413, "image_too_large", "each image must be at most 10 MiB")
			return
		}
		ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}[http.DetectContentType(data)]
		if ext == "" {
			writeError(w, 400, "invalid_image", "only PNG, JPEG, WebP, and GIF images are supported")
			return
		}
		path := filepath.Join(dir, fmt.Sprintf("%02d%s", startIndex+i, ext))
		if err := os.WriteFile(path, data, 0640); err != nil {
			writeError(w, 500, "storage_error", "image was not saved")
			return
		}
		paths = append(paths, path)
	}
	s.mu.Lock()
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == modID {
			if appendImages {
				s.Catalog.Mods[i].ImagePaths = append(s.Catalog.Mods[i].ImagePaths, paths...)
			} else {
				for _, old := range s.Catalog.Mods[i].ImagePaths {
					_ = os.Remove(old)
				}
				s.Catalog.Mods[i].ImagePaths = paths
			}
		}
	}
	err := s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		writeError(w, 500, "storage_error", "images were not saved")
		return
	}
	items := make([]map[string]string, 0, len(paths))
	for _, path := range paths {
		items = append(items, map[string]string{"url": "/api/v1/images/" + modID + "/" + filepath.Base(path)})
	}
	writeJSON(w, 200, map[string]any{"mod_id": modID, "count": len(paths), "items": items})
}
func (s *Store) listMods(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	query := r.URL.Query()
	limit := 20
	if raw := query.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, 400, "validation_failed", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	offset := 0
	if raw := query.Get("cursor"); raw != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		if err != nil {
			writeError(w, 400, "validation_failed", "invalid cursor")
			return
		}
		parsed, err := strconv.Atoi(string(decoded))
		if err != nil || parsed < 0 || base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(parsed))) != raw {
			writeError(w, 400, "validation_failed", "invalid cursor")
			return
		}
		offset = parsed
	}
	q := strings.ToLower(strings.TrimSpace(query.Get("q")))
	category := query.Get("category")
	platform := query.Get("platform")
	tag := query.Get("tag")
	items := make([]Mod, 0, len(s.Catalog.Mods))
	for _, m := range s.Catalog.Mods {
		if m.Unpublished {
			continue
		}
		latest, ok := s.Catalog.Versions[m.LatestVersionID]
		if !ok || latest.ModID != m.ID || latest.State != "published" {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(m.Title+" "+m.Summary), q) {
			continue
		}
		if category != "" && m.Category != category {
			continue
		}
		if platform != "" && !slices.Contains(m.SupportedPlatforms, platform) {
			continue
		}
		if tag != "" && !slices.Contains(m.Tags, tag) {
			continue
		}
		items = append(items, cleanPublicMod(m))
	}
	slices.SortFunc(items, func(a, b Mod) int { return strings.Compare(a.ID, b.ID) })
	if offset > len(items) {
		writeError(w, 400, "validation_failed", "invalid cursor")
		return
	}
	end := min(offset+limit, len(items))
	var nextCursor *string
	if end < len(items) {
		next := base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(end)))
		nextCursor = &next
	}
	writeJSON(w, 200, map[string]any{"items": items[offset:end], "next_cursor": nextCursor})
}
func (s *Store) modResource(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/mods/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var mod *Mod
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == parts[0] {
			mod = &s.Catalog.Mods[i]
			break
		}
	}
	if mod == nil {
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	if len(parts) == 2 && parts[1] == "images" && r.Method == http.MethodGet {
		latest, published := s.Catalog.Versions[mod.LatestVersionID]
		public := !mod.Unpublished && published && latest.ModID == mod.ID && latest.State == "published"
		if !public {
			sess, logged := s.readSession(r)
			if !logged || (sess.User.ID != mod.Author.ID && !containsRole(s.effectiveRoles(sess), "admin")) {
				writeError(w, 404, "not_found", "mod was not found")
				return
			}
		}
		items := make([]map[string]string, 0, len(mod.ImagePaths))
		for _, image := range mod.ImagePaths {
			items = append(items, map[string]string{"url": "/api/v1/images/" + mod.ID + "/" + filepath.Base(image)})
		}
		writeJSON(w, 200, map[string]any{"items": items})
		return
	}
	if mod.Unpublished {
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	latest, ok := s.Catalog.Versions[mod.LatestVersionID]
	if !ok || latest.ModID != mod.ID || latest.State != "published" {
		writeError(w, 404, "not_found", "mod was not found")
		return
	}
	if len(parts) == 1 {
		writeJSON(w, 200, cleanPublicMod(*mod))
		return
	}
	if len(parts) == 2 && parts[1] == "versions" && r.Method == http.MethodGet {
		items := make([]Version, 0)
		for _, candidate := range s.Catalog.Versions {
			if candidate.ModID == mod.ID && candidate.State == "published" {
				candidate.ArchivePath = ""
				items = append(items, resolveVersionDependencies(s.Catalog, candidate))
			}
		}
		slices.SortFunc(items, func(a, b Version) int { return strings.Compare(b.Version, a.Version) })
		writeJSON(w, 200, map[string]any{"items": items})
		return
	}
	if len(parts) == 3 && parts[1] == "versions" {
		v, ok := s.Catalog.Versions[parts[2]]
		if !ok || v.ModID != mod.ID || v.State != "published" {
			writeError(w, 404, "not_found", "version was not found")
			return
		}
		v.ArchivePath = ""
		writeJSON(w, 200, resolveVersionDependencies(s.Catalog, v))
		return
	}
	writeError(w, 404, "not_found", "resource was not found")
}
func (s *Store) downloadDescriptor(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/deprecate") {
		s.deprecateVersion(w, r)
		return
	}
	if strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/unpublish") || strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/mark-latest") {
		s.versionLifecycle(w, r)
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/versions/"), "/"), "/")
	if len(parts) != 2 || parts[1] != "download" {
		writeError(w, 404, "not_found", "download descriptor was not found")
		return
	}
	s.mu.RLock()
	v, ok := s.Catalog.Versions[parts[0]]
	s.mu.RUnlock()
	if !ok {
		writeError(w, 404, "not_found", "version was not found")
		return
	}
	if v.ArchivePath == "" || v.State != "published" {
		writeError(w, 404, "not_found", "published archive was not found")
		return
	}
	writeJSON(w, 200, map[string]any{"url": "/api/v1/archives/" + v.ID, "expires_at": time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339), "sha256": v.SHA256, "size_bytes": v.SizeBytes})
}
func (s *Store) uploadArchive(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/author/versions/"), "/"), "/")
	if len(parts) == 2 && parts[1] == "images" {
		s.uploadModImages(w, r)
		return
	}
	usingUploadToken := s.UploadToken != "" && r.Header.Get("Authorization") == "Bearer "+s.UploadToken
	session, hasSession := s.readSession(r)
	if !usingUploadToken && !hasSession {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "login is required")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	if len(parts) != 2 || parts[1] != "archive" {
		writeError(w, 404, "not_found", "upload endpoint was not found")
		return
	}
	versionID := parts[0]
	s.mu.RLock()
	version, exists := s.Catalog.Versions[versionID]
	s.mu.RUnlock()
	if !exists {
		writeError(w, http.StatusNotFound, "not_found", "version was not found")
		return
	}
	if !usingUploadToken {
		owned := false
		s.mu.RLock()
		for _, mod := range s.Catalog.Mods {
			if mod.ID == version.ModID && mod.Author.ID == session.User.ID {
				owned = true
				break
			}
		}
		s.mu.RUnlock()
		if !owned && !containsRole(s.effectiveRoles(session), "admin") {
			writeError(w, http.StatusForbidden, "forbidden", "author permission required")
			return
		}
	}
	if version.State == "published" || version.State == "approved" || version.State == "ready_for_review" {
		writeError(w, http.StatusConflict, "immutable_version", "version archive cannot be replaced")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxArchiveSize+(2<<20))
	if err := r.ParseMultipartForm(maxArchiveSize); err != nil {
		writeError(w, 400, "invalid_upload", err.Error())
		return
	}
	file, header, err := r.FormFile("archive")
	if err != nil {
		writeError(w, 400, "invalid_upload", "multipart field archive is required")
		return
	}
	defer file.Close()
	if !strings.HasSuffix(strings.ToLower(header.Filename), ".zip") {
		writeError(w, 400, "invalid_archive", "archive must be a ZIP file")
		return
	}
	isSpritepack := false
	s.mu.RLock()
	for _, mod := range s.Catalog.Mods {
		if mod.ID == version.ModID {
			isSpritepack = mod.Category == "spritepack"
			break
		}
	}
	s.mu.RUnlock()
	archivePath, size, hash, report, err := s.persistArchive(versionID, file, isSpritepack)
	if err != nil {
		writeError(w, 400, "invalid_archive", err.Error())
		return
	}
	s.mu.Lock()
	v, ok := s.Catalog.Versions[versionID]
	if !ok {
		s.mu.Unlock()
		_ = os.Remove(archivePath)
		writeError(w, 404, "not_found", "version was not found")
		return
	}
	if v.ModID != version.ModID || v.State == "published" || v.State == "approved" || v.State == "ready_for_review" {
		s.mu.Unlock()
		_ = os.Remove(archivePath)
		writeError(w, http.StatusConflict, "immutable_version", "version changed during upload")
		return
	}
	if v.State == "rejected" {
		for i := range s.Catalog.Submissions {
			if s.Catalog.Submissions[i].VersionID == versionID && s.Catalog.Submissions[i].State == "rejected" && s.Catalog.Submissions[i].VersionSnapshot == nil {
				original := v
				original.ArchivePath = ""
				s.Catalog.Submissions[i].VersionSnapshot = &original
				if previousReport, ok := s.Catalog.ScanReports[v.ScanReportID]; ok {
					originalReport := previousReport
					s.Catalog.Submissions[i].ScanReportSnapshot = &originalReport
				}
			}
		}
	}
	v.SizeBytes = size
	oldArchivePath := v.ArchivePath
	v.SHA256 = hash
	v.ArchivePath = archivePath
	if v.Version == "" {
		versions := map[string]struct{}{}
		for _, registration := range report.Submods {
			if registration.Version != "" && !registration.Unknown {
				versions[registration.Version] = struct{}{}
			}
		}
		if len(versions) == 1 {
			for inferred := range versions {
				v.Version = inferred
			}
		}
	}
	// Upload completes scanning; the author must explicitly submit the scanned
	// version to the review queue in a separate request.
	v.State = "uploaded"
	if len(report.Conflicts) > 0 {
		v.State = "scanning"
	}
	v.ScanReportID = "scan_" + versionID
	if len(v.Dependencies) == 0 {
		seen := map[string]bool{}
		for _, registration := range report.Submods {
			for _, dependency := range registration.Dependencies {
				if dependency.Name == "" || seen[dependency.Name] {
					continue
				}
				seen[dependency.Name] = true
				v.Dependencies = append(v.Dependencies, Dependency{ModID: dependency.Name, ModTitle: dependency.Name, VersionRange: dependencyRange(dependency.Minimum, dependency.Maximum), Required: true})
			}
		}
	}
	v = resolveVersionDependencies(s.Catalog, v)
	if s.Catalog.ScanReports == nil {
		s.Catalog.ScanReports = map[string]packagezip.Report{}
	}
	s.Catalog.ScanReports[v.ScanReportID] = report
	s.Catalog.Versions[versionID] = v
	err = s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		_ = os.Remove(archivePath)
		writeError(w, 500, "storage_error", err.Error())
		return
	}
	if oldArchivePath != "" && oldArchivePath != archivePath {
		_ = os.Remove(oldArchivePath)
	}
	writeJSON(w, 201, map[string]any{"version_id": versionID, "version": v.Version, "size_bytes": size, "sha256": hash, "state": v.State, "dependencies": v.Dependencies, "scan_report": report})
}

func (s *Store) downloadImage(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/images/"), "/"), "/")
	if len(parts) != 2 {
		writeError(w, 404, "not_found", "image was not found")
		return
	}
	s.mu.RLock()
	modID := parts[0]
	var mod Mod
	for _, candidate := range s.Catalog.Mods {
		if candidate.ID == modID {
			mod = candidate
			break
		}
	}
	allowed := mod.ID != ""
	var target string
	if allowed {
		latest, published := s.Catalog.Versions[mod.LatestVersionID]
		public := !mod.Unpublished && published && latest.ModID == mod.ID && latest.State == "published"
		if !public {
			sess, logged := s.readSession(r)
			allowed = logged && (sess.User.ID == mod.Author.ID || containsRole(s.effectiveRoles(sess), "admin"))
		}
	}
	if allowed {
		for _, p := range mod.ImagePaths {
			if filepath.Base(p) == parts[1] {
				target = p
				break
			}
		}
	}
	s.mu.RUnlock()
	if target == "" {
		writeError(w, 404, "not_found", "image was not found")
		return
	}
	http.ServeFile(w, r, target)
}

func dependencyRange(minimum, maximum string) string {
	switch {
	case minimum != "" && maximum != "":
		return ">=" + minimum + " <=" + maximum
	case minimum != "":
		return ">=" + minimum
	case maximum != "":
		return "<=" + maximum
	default:
		return "*"
	}
}
func (s *Store) persistArchive(versionID string, src io.Reader, isSpritepack bool) (string, int64, string, packagezip.Report, error) {
	if strings.ContainsAny(versionID, "/\\") || versionID == "." || versionID == ".." {
		return "", 0, "", packagezip.Report{}, errors.New("invalid version id")
	}
	tmp := filepath.Join(s.DataDir, "archives", versionID+".tmp")
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		return "", 0, "", packagezip.Report{}, err
	}
	h := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(f, h), io.LimitReader(src, maxArchiveSize+1))
	closeErr := f.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tmp)
		return "", 0, "", packagezip.Report{}, errors.New("archive write failed")
	}
	if n > maxArchiveSize {
		_ = os.Remove(tmp)
		return "", 0, "", packagezip.Report{}, errors.New("archive exceeds 128 MiB limit")
	}
	b, err := os.ReadFile(tmp)
	if err != nil {
		_ = os.Remove(tmp)
		return "", 0, "", packagezip.Report{}, err
	}
	var report packagezip.Report
	if isSpritepack {
		report, err = packagezip.ScanSpriteArchive(bytes.NewReader(b), int64(len(b)), packagezip.Limits{})
	} else {
		report, err = packagezip.Scan(bytes.NewReader(b), int64(len(b)), packagezip.Limits{})
	}
	if err != nil {
		_ = os.Remove(tmp)
		return "", 0, "", packagezip.Report{}, err
	}
	token, err := randomToken()
	if err != nil {
		_ = os.Remove(tmp)
		return "", 0, "", packagezip.Report{}, err
	}
	final := filepath.Join(s.DataDir, "archives", versionID+"-"+token[:12]+".zip")
	if err = os.Rename(tmp, final); err != nil {
		_ = os.Remove(tmp)
		return "", 0, "", packagezip.Report{}, err
	}
	return final, n, hex.EncodeToString(h.Sum(nil)), report, nil
}
func (s *Store) downloadArchive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/archives/"), "/")
	s.mu.RLock()
	v, ok := s.Catalog.Versions[id]
	s.mu.RUnlock()
	if !ok || v.ArchivePath == "" || v.State != "published" {
		writeError(w, 404, "not_found", "archive was not found")
		return
	}
	f, err := os.Open(v.ArchivePath)
	if err != nil {
		writeError(w, 404, "not_found", "archive was not found")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Length", fmt.Sprint(v.SizeBytes))
	w.Header().Set("X-Archive-SHA256", v.SHA256)
	_, _ = io.Copy(w, f)
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"code": code, "message": message, "details": map[string]any{}})
}
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
