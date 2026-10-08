package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
)

func isSameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" {
			return false
		}
		return strings.EqualFold(u.Host, r.Host)
	}
	referer := r.Header.Get("Referer")
	if referer != "" {
		u, err := url.Parse(referer)
		if err != nil || u.Host == "" {
			return false
		}
		return strings.EqualFold(u.Host, r.Host)
	}
	return true
}

func (s *Store) handleAdminSettings(w http.ResponseWriter, r *http.Request) {
	session, ok := s.readSession(r)
	if !ok {
		writeError(w, 401, "unauthenticated", "login required")
		return
	}
	if !containsRole(s.effectiveRoles(session), "admin") {
		writeError(w, 403, "forbidden", "administrator role required")
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.mu.RLock()
		settings := s.Catalog.Settings
		s.mu.RUnlock()
		writeJSON(w, 200, settings)

	case http.MethodPatch:
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(session.CSRF)) != 1 {
			writeError(w, 403, "csrf_invalid", "invalid CSRF token")
			return
		}
		if !isSameOrigin(r) {
			writeError(w, 403, "cross_origin_forbidden", "cross-origin requests are forbidden")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		var payload struct {
			GitHubProxyTemplate *string `json:"github_proxy_template"`
			Revision            *uint64 `json:"revision"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&payload); err != nil || payload.GitHubProxyTemplate == nil || payload.Revision == nil {
			writeError(w, 400, "validation_failed", "github_proxy_template and revision required")
			return
		}

		tpl := strings.TrimSpace(*payload.GitHubProxyTemplate)
		if err := github.ValidateProxyTemplate(tpl); err != nil {
			writeError(w, 400, "invalid_github_proxy", err.Error())
			return
		}

		s.mu.Lock()
		if *payload.Revision != s.Catalog.Settings.Revision {
			s.mu.Unlock()
			writeError(w, 409, "settings_conflict", "settings revision conflict")
			return
		}

		prevTpl := s.Catalog.Settings.GitHubProxyTemplate
		prevRev := s.Catalog.Settings.Revision
		prevAuditLen := len(s.Catalog.SettingsAudit)

		newRev := prevRev + 1
		s.Catalog.Settings.GitHubProxyTemplate = tpl
		s.Catalog.Settings.Revision = newRev
		s.Catalog.SettingsAudit = append(s.Catalog.SettingsAudit, SettingsAuditEvent{
			ActorID:          session.User.ID,
			At:               time.Now().UTC(),
			PreviousTemplate: prevTpl,
			NewTemplate:      tpl,
			Revision:         newRev,
		})

		// Reset rate limit backoff states on proxy change
		s.gitHubBackoffUntil = time.Time{}
		for i := range s.Catalog.Mods {
			s.Catalog.Mods[i].GitHubBackoffUntil = nil
		}

		if err := s.saveLocked(); err != nil {
			s.Catalog.Settings.GitHubProxyTemplate = prevTpl
			s.Catalog.Settings.Revision = prevRev
			s.Catalog.SettingsAudit = s.Catalog.SettingsAudit[:prevAuditLen]
			s.mu.Unlock()
			writeError(w, 500, "storage_error", "failed to save settings")
			return
		}
		s.mu.Unlock()

		writeJSON(w, 200, SiteSettings{
			GitHubProxyTemplate: tpl,
			Revision:            newRev,
		})

	default:
		writeError(w, 405, "method_not_allowed", "method not allowed")
	}
}

type ProxyTestItemResult struct {
	OK        bool   `json:"ok"`
	ElapsedMS int64  `json:"elapsed_ms"`
	ErrorCode string `json:"error_code,omitempty"`
}

type ProxyTestResponse struct {
	API   ProxyTestItemResult `json:"api"`
	Asset ProxyTestItemResult `json:"asset"`
}

func (s *Store) handleAdminSettingsTestGitHubProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed", "method not allowed")
		return
	}

	session, ok := s.readSession(r)
	if !ok {
		writeError(w, 401, "unauthenticated", "login required")
		return
	}
	if !containsRole(s.effectiveRoles(session), "admin") {
		writeError(w, 403, "forbidden", "administrator role required")
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(session.CSRF)) != 1 {
		writeError(w, 403, "csrf_invalid", "invalid CSRF token")
		return
	}
	if !isSameOrigin(r) {
		writeError(w, 403, "cross_origin_forbidden", "cross-origin requests are forbidden")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var payload struct {
		GitHubProxyTemplate *string `json:"github_proxy_template"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&payload); err != nil || payload.GitHubProxyTemplate == nil {
		writeError(w, 400, "validation_failed", "github_proxy_template required")
		return
	}

	tpl := strings.TrimSpace(*payload.GitHubProxyTemplate)
	if err := github.ValidateProxyTemplate(tpl); err != nil {
		writeError(w, 400, "invalid_github_proxy", err.Error())
		return
	}

	var testClient *github.Client
	s.mu.RLock()
	if s.GitHubClient != nil {
		testClient = github.NewClient(
			github.WithBaseURL(s.GitHubClient.BaseURL()),
			github.WithProxyTemplate(tpl),
			github.WithAllowInsecureTestHosts(s.GitHubClient.AllowInsecureTestHosts()),
		)
	} else {
		testClient = github.NewClient(
			github.WithProxyTemplate(tpl),
		)
	}
	s.mu.RUnlock()

	res := ProxyTestResponse{}

	// Fixed public repo for connection testing
	const testOwner = "Mon1-innovation"
	const testRepo = "MAS_UniSync"

	startAPI := time.Now()
	releases, _, _, apiErr := testClient.ListReleases(r.Context(), testOwner, testRepo, "")
	res.API.ElapsedMS = time.Since(startAPI).Milliseconds()

	if apiErr != nil {
		res.API.OK = false
		res.API.ErrorCode = apiErr.Error()
		res.Asset.OK = false
		res.Asset.ErrorCode = "api_prerequisite_failed"
		writeJSON(w, 200, res)
		return
	}
	res.API.OK = true

	// Test Asset download
	startAsset := time.Now()
	var downloadURL string
	if len(releases) > 0 {
		if len(releases[0].Assets) > 0 && releases[0].Assets[0].BrowserDownloadURL != "" {
			downloadURL = releases[0].Assets[0].BrowserDownloadURL
		} else if releases[0].ZipballURL != "" {
			downloadURL = releases[0].ZipballURL
		}
	}

	if downloadURL == "" {
		res.Asset.ElapsedMS = time.Since(startAsset).Milliseconds()
		res.Asset.OK = false
		res.Asset.ErrorCode = "no_asset_available_to_test"
		writeJSON(w, 200, res)
		return
	}

	tmpPath, _, _, dlErr := testClient.DownloadToTemp(r.Context(), downloadURL, 5*1024*1024)
	res.Asset.ElapsedMS = time.Since(startAsset).Milliseconds()
	if dlErr != nil {
		res.Asset.OK = false
		res.Asset.ErrorCode = dlErr.Error()
		writeJSON(w, 200, res)
		return
	}
	defer os.Remove(tmpPath)

	headerBytes, rErr := os.ReadFile(tmpPath)
	if rErr != nil || len(headerBytes) < 4 {
		res.Asset.OK = false
		res.Asset.ErrorCode = "read_downloaded_file_failed"
		writeJSON(w, 200, res)
		return
	}

	// Verify ZIP magic signature (0x50, 0x4b)
	if headerBytes[0] == 'P' && headerBytes[1] == 'K' {
		res.Asset.OK = true
	} else {
		res.Asset.OK = false
		sample := strings.ToLower(string(headerBytes[:min(len(headerBytes), 64)]))
		if strings.Contains(sample, "html") || strings.Contains(sample, "doctype") {
			res.Asset.ErrorCode = "proxy_returned_html_instead_of_zip"
		} else {
			res.Asset.ErrorCode = "invalid_zip_signature"
		}
	}

	writeJSON(w, 200, res)
}
