package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
)

const (
	// settingsTransferFormat identifies the document so a stray JSON file is
	// rejected instead of silently overwriting the deployment configuration.
	settingsTransferFormat = "submodhub-settings"
	// settingsTransferVersion is bumped when the document shape changes in a way
	// an older importer cannot read. Importers reject anything else.
	settingsTransferVersion = 1
)

// settingsTransferDocument is the portable snapshot of the admin-configurable
// settings: the GitHub source policy, the tag catalog and the download nodes.
//
// Credentials are never written into an export. The settings API has always
// refused to echo the GitHub token and the node passwords, and an export file is
// meant to be easy to copy between machines — so it carries only the
// non-secret configuration plus the flags that say a credential exists. An
// import keeps the credentials already stored for a node and only accepts a
// replacement when the document carries one explicitly.
type settingsTransferDocument struct {
	Format     string                   `json:"format"`
	Version    int                      `json:"version"`
	ExportedAt time.Time                `json:"exported_at"`
	Settings   settingsTransferSettings `json:"settings"`
	// DownloadNodes is a pointer so an import can tell "leave the nodes alone"
	// (field absent or null) from "replace the list" (an empty array removes
	// them all).
	DownloadNodes *[]settingsTransferNode `json:"download_nodes,omitempty"`
}

type settingsTransferSettings struct {
	GitHubProxyTemplate string     `json:"github_proxy_template"`
	GitHubSyncMaxAge    string     `json:"github_sync_max_age"`
	TagCatalog          []TagGroup `json:"tag_catalog"`
	// GitHubToken is import-only: a non-nil value replaces the stored token, ""
	// clears it, and an absent field keeps whatever the deployment already has.
	GitHubToken *string `json:"github_token,omitempty"`
}

type settingsTransferNode struct {
	ID                     string   `json:"id"`
	Name                   string   `json:"name"`
	Type                   string   `json:"type"`
	Enabled                bool     `json:"enabled"`
	Weight                 int      `json:"weight"`
	Capabilities           []string `json:"capabilities"`
	BaseURL                string   `json:"base_url,omitempty"`
	APIBaseURL             string   `json:"api_base_url,omitempty"`
	Username               string   `json:"username,omitempty"`
	Directory              string   `json:"directory,omitempty"`
	AllowedDownloadOrigins []string `json:"allowed_download_origins,omitempty"`
	// CredentialConfigured is export-only: it tells the operator that restoring
	// this node on a fresh deployment needs a credential supplied in the file.
	CredentialConfigured bool `json:"credential_configured,omitempty"`
	// Password is import-only. An empty value keeps the existing credential of a
	// node with the same ID, which is what makes an exported file re-importable
	// without ever exposing secrets.
	Password string `json:"password,omitempty"`
}

// settingsImportError maps an import failure to the HTTP status and error code
// the handler writes. Validation happens before any state changes, so returning
// one of these never leaves a half-applied configuration behind.
type settingsImportError struct {
	status  int
	code    string
	message string
}

func (e *settingsImportError) Error() string { return e.message }

func importFailure(status int, code, message string) *settingsImportError {
	return &settingsImportError{status: status, code: code, message: message}
}

// deliveryNodeConfigEqual compares the operator-visible configuration of two
// nodes, ignoring credentials, revisions and the result of the last connection
// test. It answers "is this the same node?" for an import that must not discard
// a verdict that still applies.
func deliveryNodeConfigEqual(a, b DeliveryNode) bool {
	return a.ID == b.ID && a.Name == b.Name && a.Type == b.Type && a.Enabled == b.Enabled &&
		a.Weight == b.Weight && slices.Equal(a.Capabilities, b.Capabilities) &&
		a.BaseURL == b.BaseURL && a.APIBaseURL == b.APIBaseURL && a.Username == b.Username &&
		a.Directory == b.Directory && slices.Equal(a.AllowedDownloadOrigins, b.AllowedDownloadOrigins)
}

func (n settingsTransferNode) input() deliveryNodeInput {
	return deliveryNodeInput{
		ID:                     n.ID,
		Name:                   n.Name,
		Type:                   n.Type,
		Enabled:                n.Enabled,
		Weight:                 n.Weight,
		Capabilities:           n.Capabilities,
		BaseURL:                n.BaseURL,
		APIBaseURL:             n.APIBaseURL,
		Username:               n.Username,
		Password:               n.Password,
		Directory:              n.Directory,
		AllowedDownloadOrigins: n.AllowedDownloadOrigins,
	}
}

// handleAdminSettingsExport writes the current configuration as a JSON document
// the operator can keep and re-import. It is a read-only endpoint, so the CSRF
// token is not required; only an authenticated administrator can call it.
func (s *Store) handleAdminSettingsExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	if _, ok := s.requireRole(w, r, "admin"); !ok {
		return
	}

	s.mu.RLock()
	doc := s.settingsTransferLocked()
	s.mu.RUnlock()

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", `attachment; filename="submodhub-settings-`+doc.ExportedAt.Format("20060102-150405")+`.json"`)
	writeJSON(w, http.StatusOK, doc)
}

// settingsTransferLocked renders the current settings under the store lock.
// Callers must hold s.mu (read or write).
func (s *Store) settingsTransferLocked() settingsTransferDocument {
	doc := settingsTransferDocument{
		Format:     settingsTransferFormat,
		Version:    settingsTransferVersion,
		ExportedAt: time.Now().UTC(),
		Settings: settingsTransferSettings{
			GitHubProxyTemplate: s.Catalog.Settings.GitHubProxyTemplate,
			// The stored override, not the effective window: an empty value means
			// "use the built-in default", and exporting the effective duration
			// would silently turn a default into an explicit setting.
			GitHubSyncMaxAge: s.Catalog.Settings.GitHubSyncMaxAge,
			TagCatalog:       s.effectiveTagCatalogLocked(),
		},
	}
	nodes := make([]settingsTransferNode, 0, len(s.Catalog.DeliveryNodes))
	for _, n := range s.Catalog.DeliveryNodes {
		nodes = append(nodes, settingsTransferNode{
			ID:                     n.ID,
			Name:                   n.Name,
			Type:                   n.Type,
			Enabled:                n.Enabled,
			Weight:                 n.Weight,
			Capabilities:           slices.Clone(n.Capabilities),
			BaseURL:                n.BaseURL,
			APIBaseURL:             n.APIBaseURL,
			Username:               n.Username,
			Directory:              n.Directory,
			AllowedDownloadOrigins: slices.Clone(n.AllowedDownloadOrigins),
			CredentialConfigured:   n.CredentialCiphertext != "",
		})
	}
	doc.DownloadNodes = &nodes
	return doc
}

// handleAdminSettingsImport replaces the current configuration with a document
// produced by the export endpoint (or edited by hand). It writes once, under the
// store lock, and rolls the whole import back when the save fails so settings,
// nodes, tag pruning and the audit trail never disagree.
func (s *Store) handleAdminSettingsImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	session, ok := s.requireRole(w, r, "admin")
	if !ok {
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(session.CSRF)) != 1 {
		writeError(w, http.StatusForbidden, "csrf_invalid", "invalid CSRF token")
		return
	}
	if !isSameOrigin(r) {
		writeError(w, http.StatusForbidden, "cross_origin_forbidden", "cross-origin requests are forbidden")
		return
	}

	// A full tag catalog is ~12 KiB and the node list stays small, so 256 KiB
	// leaves generous headroom while still bounding a hostile body.
	r.Body = http.MaxBytesReader(w, r.Body, 256<<10)
	var doc settingsTransferDocument
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&doc); err != nil {
		writeError(w, http.StatusBadRequest, "validation_failed", "invalid settings document")
		return
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		writeError(w, http.StatusBadRequest, "validation_failed", "a single settings document is required")
		return
	}
	if doc.Format != settingsTransferFormat || doc.Version != settingsTransferVersion {
		writeError(w, http.StatusBadRequest, "unsupported_settings_document", "settings document format or version is not supported")
		return
	}

	tpl := strings.TrimSpace(doc.Settings.GitHubProxyTemplate)
	if err := github.ValidateProxyTemplate(tpl); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_github_proxy", err.Error())
		return
	}
	maxAge, err := normalizeGitHubSyncMaxAge(doc.Settings.GitHubSyncMaxAge)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_github_sync_max_age", err.Error())
		return
	}
	tagCatalog, err := normalizeTagCatalog(doc.Settings.TagCatalog)
	if err != nil {
		writeTagError(w, err)
		return
	}

	s.mu.Lock()
	importErr := s.applySettingsImportLocked(doc, session.User.ID, tpl, maxAge, tagCatalog)
	resp := s.siteSettingsLocked()
	s.mu.Unlock()

	if importErr != nil {
		writeError(w, importErr.status, importErr.code, importErr.message)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// applySettingsImportLocked validates the credential-bearing parts of the
// document and applies it in one save. Everything that can be rejected is
// checked before the first mutation; only a save failure needs a rollback.
// Callers must hold s.mu for writing.
func (s *Store) applySettingsImportLocked(doc settingsTransferDocument, actorID, tpl, maxAge string, catalog []TagGroup) *settingsImportError {
	if s.GitHubSyncMaxAgeOverride != nil {
		// The deployment environment owns this field; silently ignoring the
		// document would make the next export disagree with the import.
		return importFailure(http.StatusConflict, "github_sync_max_age_env_override", "github_sync_max_age is locked by the deployment environment")
	}

	var nextToken *githubTokenSecret
	tokenProvided := doc.Settings.GitHubToken != nil
	if tokenProvided {
		plain := strings.TrimSpace(*doc.Settings.GitHubToken)
		if plain != "" {
			if err := validateGitHubToken(plain); err != nil {
				return importFailure(http.StatusBadRequest, "invalid_github_token", err.Error())
			}
		}
		sealed, err := s.sealGitHubTokenLocked(plain)
		if err != nil {
			return importFailure(http.StatusInternalServerError, "storage_error", "failed to protect the github token")
		}
		nextToken = sealed
	}

	existing := make(map[string]DeliveryNode, len(s.Catalog.DeliveryNodes))
	for _, n := range s.Catalog.DeliveryNodes {
		existing[n.ID] = n
	}

	newRev := s.Catalog.Settings.Revision + 1
	nodes := s.Catalog.DeliveryNodes
	if doc.DownloadNodes != nil {
		// The document becomes the complete node list: nodes it omits are
		// removed, exactly like restoring a backup. Every shape problem is found
		// first, so a document that is rejected never half-seals a credential.
		type parsedNode struct {
			node     DeliveryNode
			password string
		}
		seen := make(map[string]bool, len(*doc.DownloadNodes))
		parsed := make([]parsedNode, 0, len(*doc.DownloadNodes))
		for _, raw := range *doc.DownloadNodes {
			n, err := raw.input().node()
			if err != nil {
				return importFailure(http.StatusBadRequest, "invalid_download_node", "invalid download node configuration")
			}
			if seen[n.ID] {
				return importFailure(http.StatusBadRequest, "duplicate_download_node", "download node IDs must be unique")
			}
			seen[n.ID] = true
			if old, found := existing[n.ID]; found && old.Type != n.Type {
				return importFailure(http.StatusBadRequest, "node_type_immutable", "download node type cannot change")
			}
			parsed = append(parsed, parsedNode{node: n, password: raw.Password})
		}
		nodes = make([]DeliveryNode, 0, len(parsed))
		for _, item := range parsed {
			n := item.node
			old, found := existing[n.ID]
			if item.password != "" {
				sealed, err := s.DeliverySecrets.Seal(n.ID, item.password)
				if err != nil {
					return importFailure(http.StatusServiceUnavailable, "delivery_master_key_unavailable", "deployment master key required")
				}
				n.CredentialCiphertext = sealed
			} else if found {
				// An exported file never carries secrets, so re-importing it keeps
				// the credential this deployment already stores.
				n.CredentialCiphertext = old.CredentialCiphertext
			}
			if n.CredentialCiphertext == "" {
				return importFailure(http.StatusBadRequest, "credential_required", "node credentials required")
			}
			if found && item.password == "" && deliveryNodeConfigEqual(old, n) {
				// Nothing about the node changed, so the last connection test still
				// describes it. Dropping that verdict would make an idempotent
				// re-import look like the node had just been reconfigured.
				n.Status = old.Status
				n.ErrorCode = old.ErrorCode
				n.LastCheckedAt = old.LastCheckedAt
				// The revision is what archive and app-asset mirrors are bound to:
				// keeping it is what lets a re-import of an unchanged document leave
				// the mirrored files alone instead of re-uploading all of them.
				n.Revision = old.Revision
			} else {
				n.Revision = newRev
			}
			nodes = append(nodes, n)
		}
	}

	prev := s.Catalog.Settings
	prevNodes := s.Catalog.DeliveryNodes
	prevSyncMaxAge := s.GitHubSyncMaxAge
	prevAuditLen := len(s.Catalog.SettingsAudit)

	tagsChanged := !tagCatalogEqual(prev.TagCatalog, catalog)
	s.Catalog.Settings.GitHubProxyTemplate = tpl
	s.Catalog.Settings.GitHubSyncMaxAge = maxAge
	s.GitHubSyncMaxAge = resolveGitHubSyncMaxAge(maxAge)
	if tokenProvided {
		s.Catalog.Settings.GitHubToken = nextToken
	}
	s.Catalog.Settings.TagCatalog = catalog
	// Saving the catalog keeps the "a mod only carries catalog tags" invariant:
	// tags nobody can select any more disappear in the same save.
	prunedTags := s.pruneModTagsForCatalogLocked(catalog)
	s.Catalog.DeliveryNodes = nodes
	s.Catalog.Settings.Revision = newRev
	s.Catalog.SettingsAudit = append(s.Catalog.SettingsAudit, SettingsAuditEvent{
		ActorID:          actorID,
		At:               time.Now().UTC(),
		PreviousTemplate: prev.GitHubProxyTemplate,
		NewTemplate:      tpl,
		TokenChanged:     tokenProvided,
		TagsChanged:      tagsChanged,
		PrunedModTags:    len(prunedTags),
		Revision:         newRev,
	})

	// A new proxy or token invalidates any backoff learned under the old
	// credentials: the quota bucket is no longer the one that was exhausted.
	if tpl != prev.GitHubProxyTemplate || tokenProvided {
		s.gitHubBackoffUntil = time.Time{}
		for i := range s.Catalog.Mods {
			s.Catalog.Mods[i].GitHubBackoffUntil = nil
		}
	}

	if err := s.saveLocked(); err != nil {
		s.Catalog.Settings = prev
		s.Catalog.DeliveryNodes = prevNodes
		s.GitHubSyncMaxAge = prevSyncMaxAge
		s.Catalog.SettingsAudit = s.Catalog.SettingsAudit[:prevAuditLen]
		for index, tags := range prunedTags {
			s.Catalog.Mods[index].Tags = tags
		}
		return importFailure(http.StatusInternalServerError, "storage_error", "failed to save settings")
	}

	// A restored document can remove or reconfigure nodes, so cached Cloudreve
	// sessions and retention pacing must not survive the import.
	for id := range existing {
		s.forgetDeliverySession(id)
	}
	for _, n := range nodes {
		s.forgetDeliverySession(n.ID)
	}
	return nil
}
