package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
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
		resp := s.siteSettingsLocked()
		s.mu.RUnlock()
		writeJSON(w, 200, resp)

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
			GitHubToken         *string `json:"github_token"`
			Revision            *uint64 `json:"revision"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&payload); err != nil || payload.Revision == nil {
			writeError(w, 400, "validation_failed", "revision required")
			return
		}
		if payload.GitHubProxyTemplate == nil && payload.GitHubToken == nil {
			writeError(w, 400, "validation_failed", "at least one of github_proxy_template or github_token is required")
			return
		}

		var tpl string
		if payload.GitHubProxyTemplate != nil {
			tpl = strings.TrimSpace(*payload.GitHubProxyTemplate)
			if err := github.ValidateProxyTemplate(tpl); err != nil {
				writeError(w, 400, "invalid_github_proxy", err.Error())
				return
			}
		}

		// An empty token clears the stored credential; nil leaves it untouched.
		var token *string
		if payload.GitHubToken != nil {
			trimmed := strings.TrimSpace(*payload.GitHubToken)
			if trimmed != "" {
				if err := validateGitHubToken(trimmed); err != nil {
					writeError(w, 400, "invalid_github_token", err.Error())
					return
				}
			}
			token = &trimmed
		}

		s.mu.Lock()
		if *payload.Revision != s.Catalog.Settings.Revision {
			s.mu.Unlock()
			writeError(w, 409, "settings_conflict", "settings revision conflict")
			return
		}

		prev := s.Catalog.Settings
		prevAuditLen := len(s.Catalog.SettingsAudit)

		newRev := prev.Revision + 1
		if payload.GitHubProxyTemplate != nil {
			s.Catalog.Settings.GitHubProxyTemplate = tpl
		}
		tokenChanged := false
		if token != nil {
			secret, err := s.sealGitHubTokenLocked(*token)
			if err != nil {
				s.Catalog.Settings = prev
				s.mu.Unlock()
				writeError(w, 500, "storage_error", "failed to protect the github token")
				return
			}
			s.Catalog.Settings.GitHubToken = secret
			tokenChanged = true
		}
		s.Catalog.Settings.Revision = newRev
		s.Catalog.SettingsAudit = append(s.Catalog.SettingsAudit, SettingsAuditEvent{
			ActorID:          session.User.ID,
			At:               time.Now().UTC(),
			PreviousTemplate: prev.GitHubProxyTemplate,
			NewTemplate:      s.Catalog.Settings.GitHubProxyTemplate,
			TokenChanged:     tokenChanged,
			Revision:         newRev,
		})

		// A new proxy or token invalidates any backoff learned under the old
		// credentials: the quota bucket is no longer the one that was exhausted.
		s.gitHubBackoffUntil = time.Time{}
		for i := range s.Catalog.Mods {
			s.Catalog.Mods[i].GitHubBackoffUntil = nil
		}

		if err := s.saveLocked(); err != nil {
			s.Catalog.Settings = prev
			s.Catalog.SettingsAudit = s.Catalog.SettingsAudit[:prevAuditLen]
			s.mu.Unlock()
			writeError(w, 500, "storage_error", "failed to save settings")
			return
		}
		resp := s.siteSettingsLocked()
		s.mu.Unlock()

		writeJSON(w, 200, resp)

	default:
		writeError(w, 405, "method_not_allowed", "method not allowed")
	}
}

// githubTokenSecretID namespaces the token ciphertext. It is bound into the AEAD
// associated data, so a ciphertext copied from a download node cannot be replayed
// here.
const githubTokenSecretID = "github-api"

// siteSettingsLocked renders the settings without ever exposing the token. The
// hint is the last four characters, which is enough to recognise which token is
// installed without being enough to use it.
func (s *Store) siteSettingsLocked() siteSettingsResponse {
	resp := siteSettingsResponse{
		GitHubProxyTemplate: s.Catalog.Settings.GitHubProxyTemplate,
		Revision:            s.Catalog.Settings.Revision,
		MasterKeyConfigured: s.DeliverySecrets != nil,
	}
	secret := s.Catalog.Settings.GitHubToken
	if secret == nil || secret.Value == "" {
		return resp
	}
	resp.GitHubTokenConfigured = true
	resp.GitHubTokenEncrypted = secret.Encrypted
	plain := secret.Value
	if secret.Encrypted {
		plain = ""
		if decrypted, err := s.DeliverySecrets.Open(githubTokenSecretID, secret.Value); err == nil {
			plain = decrypted
		}
	}
	if len(plain) >= 4 {
		resp.GitHubTokenHint = plain[len(plain)-4:]
	}
	return resp
}

// githubSettingsLocked returns the proxy template and the usable API token.
// Callers must hold s.mu. A token that cannot be decrypted degrades to the
// anonymous quota instead of failing the whole request.
func (s *Store) githubSettingsLocked() (proxyTemplate, token string) {
	proxyTemplate = s.Catalog.Settings.GitHubProxyTemplate
	secret := s.Catalog.Settings.GitHubToken
	if secret == nil || secret.Value == "" {
		return proxyTemplate, ""
	}
	if !secret.Encrypted {
		return proxyTemplate, secret.Value
	}
	if plain, err := s.DeliverySecrets.Open(githubTokenSecretID, secret.Value); err == nil {
		return proxyTemplate, plain
	}
	return proxyTemplate, ""
}

// sealGitHubTokenLocked encrypts the token when a master key is configured and
// otherwise stores it verbatim, which the settings API reports honestly.
func (s *Store) sealGitHubTokenLocked(plain string) (*githubTokenSecret, error) {
	if plain == "" {
		return nil, nil
	}
	if s.DeliverySecrets == nil {
		return &githubTokenSecret{Value: plain}, nil
	}
	ciphertext, err := s.DeliverySecrets.Seal(githubTokenSecretID, plain)
	if err != nil {
		return nil, err
	}
	return &githubTokenSecret{Value: ciphertext, Encrypted: true}, nil
}

// GitHubTokenConfigured reports whether an API token is stored, and whether it
// is encrypted. It exists so startup logging can describe the quota state
// without ever handling the token itself.
func (s *Store) GitHubTokenConfigured() (configured, encrypted bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	secret := s.Catalog.Settings.GitHubToken
	if secret == nil || secret.Value == "" {
		return false, false
	}
	return true, secret.Encrypted
}

func validateGitHubToken(token string) error {
	if len(token) > 255 {
		return errors.New("github token must be at most 255 characters")
	}
	for _, r := range token {
		if r <= ' ' || r > '~' {
			return errors.New("github token must be printable ASCII without spaces or newlines")
		}
	}
	return nil
}

type ProxyTestItemResult struct {
	OK        bool   `json:"ok"`
	ElapsedMS int64  `json:"elapsed_ms"`
	ErrorCode string `json:"error_code,omitempty"`
}

// siteSettingsResponse is the admin-facing settings view. It never carries the
// token itself, only whether one is installed, how it is stored, and a hint.
type siteSettingsResponse struct {
	GitHubProxyTemplate   string `json:"github_proxy_template"`
	GitHubTokenConfigured bool   `json:"github_token_configured"`
	GitHubTokenEncrypted  bool   `json:"github_token_encrypted"`
	GitHubTokenHint       string `json:"github_token_hint,omitempty"`
	MasterKeyConfigured   bool   `json:"master_key_configured"`
	Revision              uint64 `json:"revision"`
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
	storedToken := ""
	if _, token := s.githubSettingsLocked(); token != "" {
		storedToken = token
	}
	if s.GitHubClient != nil {
		testClient = github.NewClient(
			github.WithBaseURL(s.GitHubClient.BaseURL()),
			github.WithProxyTemplate(tpl),
			github.WithToken(storedToken),
			github.WithAllowInsecureTestHosts(s.GitHubClient.AllowInsecureTestHosts()),
		)
	} else {
		testClient = github.NewClient(
			github.WithProxyTemplate(tpl),
			github.WithToken(storedToken),
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
