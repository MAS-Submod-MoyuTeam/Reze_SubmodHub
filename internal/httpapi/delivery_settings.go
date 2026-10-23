package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"
)

// DeliveryNode is persistence only. HTTP handlers must return its explicit DTO.
type DeliveryNode struct {
	ID                     string     `json:"id"`
	Name                   string     `json:"name"`
	Type                   string     `json:"type"`
	Enabled                bool       `json:"enabled"`
	Weight                 int        `json:"weight"`
	Capabilities           []string   `json:"capabilities"`
	BaseURL                string     `json:"base_url,omitempty"`
	APIBaseURL             string     `json:"api_base_url,omitempty"`
	Username               string     `json:"username,omitempty"`
	Directory              string     `json:"directory,omitempty"`
	AllowedDownloadOrigins []string   `json:"allowed_download_origins,omitempty"`
	CredentialCiphertext   string     `json:"credential_ciphertext,omitempty"`
	Revision               uint64     `json:"revision"`
	LastCheckedAt          *time.Time `json:"last_checked_at,omitempty"`
	Status                 string     `json:"status"`
	ErrorCode              string     `json:"error_code,omitempty"`
}
type deliveryNodeDTO struct {
	MirrorStates           map[string]int `json:"mirror_states,omitempty"`
	AppAssetStates         map[string]int `json:"app_asset_states,omitempty"`
	ID                     string         `json:"id"`
	Name                   string         `json:"name"`
	Type                   string         `json:"type"`
	Enabled                bool           `json:"enabled"`
	Weight                 int            `json:"weight"`
	Capabilities           []string       `json:"capabilities"`
	BaseURL                string         `json:"base_url,omitempty"`
	APIBaseURL             string         `json:"api_base_url,omitempty"`
	Username               string         `json:"username,omitempty"`
	Directory              string         `json:"directory,omitempty"`
	AllowedDownloadOrigins []string       `json:"allowed_download_origins,omitempty"`
	CredentialConfigured   bool           `json:"credential_configured"`
	Revision               uint64         `json:"revision"`
	LastCheckedAt          *time.Time     `json:"last_checked_at,omitempty"`
	Status                 string         `json:"status"`
	ErrorCode              string         `json:"error_code,omitempty"`
}
type deliveryNodeInput struct {
	ID                     string   `json:"id"`
	Name                   string   `json:"name"`
	Type                   string   `json:"type"`
	Enabled                bool     `json:"enabled"`
	Weight                 int      `json:"weight"`
	Capabilities           []string `json:"capabilities"`
	BaseURL                string   `json:"base_url"`
	APIBaseURL             string   `json:"api_base_url"`
	Username               string   `json:"username"`
	Password               string   `json:"password"`
	Directory              string   `json:"directory"`
	AllowedDownloadOrigins []string `json:"allowed_download_origins"`
}

func (n DeliveryNode) dto() deliveryNodeDTO {
	return deliveryNodeDTO{
		ID: n.ID, Name: n.Name, Type: n.Type, Enabled: n.Enabled, Weight: n.Weight, Capabilities: slices.Clone(n.Capabilities), BaseURL: n.BaseURL, APIBaseURL: n.APIBaseURL, Username: n.Username, Directory: n.Directory, AllowedDownloadOrigins: slices.Clone(n.AllowedDownloadOrigins), CredentialConfigured: n.CredentialCiphertext != "", Revision: n.Revision, LastCheckedAt: n.LastCheckedAt, Status: n.Status, ErrorCode: n.ErrorCode,
	}
}
func (s *Store) deliverySettingsLocked() any {
	nodes := []deliveryNodeDTO{{ID: "builtin", Name: "主服务器", Type: "builtin", Enabled: true, Weight: 1, Capabilities: []string{"github", "local"}, Status: "available", Revision: s.Catalog.Settings.Revision}}
	for _, n := range s.Catalog.DeliveryNodes {
		dto := n.dto()
		if n.Type == "cloudreve" {
			dto.MirrorStates = map[string]int{}
			for _, m := range s.Catalog.ArchiveMirrors {
				if m.NodeID == n.ID && m.NodeRevision == n.Revision {
					dto.MirrorStates[m.State]++
				}
			}
			dto.AppAssetStates = map[string]int{}
			for _, m := range s.Catalog.AppAssetMirrors {
				if m.NodeID == n.ID && m.NodeRevision == n.Revision {
					dto.AppAssetStates[m.State]++
				}
			}
		}
		nodes = append(nodes, dto)
	}
	active := false
	for _, n := range s.Catalog.DeliveryNodes {
		active = active || n.Enabled
	}
	return struct {
		Items               []deliveryNodeDTO `json:"items"`
		Revision            uint64            `json:"revision"`
		BuiltinFallback     bool              `json:"builtin_fallback"`
		MasterKeyConfigured bool              `json:"master_key_configured"`
	}{nodes, s.Catalog.Settings.Revision, !active, s.DeliverySecrets != nil}
}

var deliveryNodeID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func validateDeliveryURL(raw string, originOnly bool) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return false
	}
	return !originOnly || u.Path == ""
}
func (in deliveryNodeInput) node() (DeliveryNode, error) {
	n := DeliveryNode{ID: in.ID, Name: strings.TrimSpace(in.Name), Type: in.Type, Enabled: in.Enabled, Weight: in.Weight, Capabilities: slices.Clone(in.Capabilities), BaseURL: strings.TrimRight(in.BaseURL, "/"), APIBaseURL: strings.TrimRight(in.APIBaseURL, "/"), Username: strings.TrimSpace(in.Username), Directory: in.Directory, AllowedDownloadOrigins: slices.Clone(in.AllowedDownloadOrigins), Status: "untested"}
	invalid := errors.New("invalid download node configuration")
	if !deliveryNodeID.MatchString(n.ID) || n.ID == "builtin" || n.Name == "" || len(n.Name) > 128 || n.Weight < 1 || n.Weight > 100 || len(n.Capabilities) != 1 {
		return n, invalid
	}
	switch n.Type {
	case "github_relay":
		if in.Password != "" && len(in.Password) < 32 {
			return n, invalid
		}
		if n.Capabilities[0] != "github" || !validateDeliveryURL(n.BaseURL, true) || n.APIBaseURL != "" || n.Username != "" || n.Directory != "" || len(n.AllowedDownloadOrigins) != 0 {
			return n, invalid
		}
	case "cloudreve":
		if n.Capabilities[0] != "cloudreve" || !validateDeliveryURL(n.APIBaseURL, false) || n.BaseURL != "" || n.Username == "" || !strings.HasPrefix(n.Directory, "/") || path.Clean(n.Directory) != n.Directory || n.Directory == "/" || len(n.AllowedDownloadOrigins) == 0 || len(n.AllowedDownloadOrigins) > 16 {
			return n, invalid
		}
		for _, origin := range n.AllowedDownloadOrigins {
			if !validateDeliveryURL(origin, true) {
				return n, invalid
			}
		}
	default:
		return n, invalid
	}
	return n, nil
}
func (s *Store) handleDeliveryNodes(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireRole(w, r, "admin")
	if !ok {
		return
	}
	if r.Method != "GET" {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(session.CSRF)) != 1 {
			writeError(w, 403, "csrf_invalid", "invalid CSRF token")
			return
		}
		if !isSameOrigin(r) {
			writeError(w, 403, "cross_origin_forbidden", "cross-origin requests are forbidden")
			return
		}
	}
	suffix := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/download-nodes")
	if suffix == "" && r.Method == "GET" {
		s.mu.RLock()
		out := s.deliverySettingsLocked()
		s.mu.RUnlock()
		writeJSON(w, 200, out)
		return
	}
	id := strings.TrimPrefix(suffix, "/")
	if strings.HasSuffix(id, "/retry-mirrors") && r.Method == "POST" {
		s.retryDeliveryMirrors(w, r, strings.TrimSuffix(id, "/retry-mirrors"))
		return
	}
	if strings.HasSuffix(id, "/test") && r.Method == "POST" {
		s.testDeliveryNode(w, r, strings.TrimSuffix(id, "/test"))
		return
	}
	if (r.Method != "POST" || suffix != "") && (r.Method != "PUT" && r.Method != "DELETE" || id == "" || strings.Contains(id, "/")) {
		writeError(w, 405, "method_not_allowed", "method not allowed")
		return
	}
	if id == "builtin" {
		writeError(w, 400, "builtin_node_immutable", "built-in node cannot be changed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	var payload struct {
		Revision *uint64            `json:"revision"`
		Node     *deliveryNodeInput `json:"node"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&payload); err != nil || payload.Revision == nil || dec.Decode(new(any)) != io.EOF {
		writeError(w, 400, "validation_failed", "revision and valid node required")
		return
	}
	var n DeliveryNode
	if r.Method != "DELETE" {
		if payload.Node == nil {
			writeError(w, 400, "validation_failed", "node required")
			return
		}
		var err error
		n, err = payload.Node.node()
		if err != nil || (r.Method == "PUT" && n.ID != id) {
			writeError(w, 400, "validation_failed", "invalid node configuration")
			return
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if *payload.Revision != s.Catalog.Settings.Revision {
		writeError(w, 409, "settings_conflict", "settings revision conflict")
		return
	}
	target := id
	if r.Method == "POST" {
		target = n.ID
	}
	index := -1
	for i, old := range s.Catalog.DeliveryNodes {
		if old.ID == target {
			index = i
			break
		}
	}
	if r.Method == "POST" && index >= 0 {
		writeError(w, 409, "node_exists", "node already exists")
		return
	}
	if r.Method != "POST" && index < 0 {
		writeError(w, 404, "not_found", "node not found")
		return
	}
	if r.Method != "DELETE" {
		if index >= 0 {
			old := s.Catalog.DeliveryNodes[index]
			if old.Type != n.Type {
				writeError(w, 400, "validation_failed", "node type cannot change")
				return
			}
			n.CredentialCiphertext = old.CredentialCiphertext
		}
		if payload.Node.Password != "" {
			encrypted, err := s.DeliverySecrets.Seal(n.ID, payload.Node.Password)
			if err != nil {
				writeError(w, 503, "delivery_master_key_unavailable", "deployment master key required")
				return
			}
			n.CredentialCiphertext = encrypted
		}
		if n.CredentialCiphertext == "" {
			writeError(w, 400, "credential_required", "node credentials required")
			return
		}
	}
	previous := s.Catalog.DeliveryNodes
	revision := s.Catalog.Settings.Revision
	updated := slices.Clone(previous)
	n.Revision = revision + 1
	switch r.Method {
	case "POST":
		updated = append(updated, n)
	case "PUT":
		updated[index] = n
	case "DELETE":
		updated = slices.Delete(updated, index, index+1)
	}
	s.Catalog.DeliveryNodes = updated
	s.Catalog.Settings.Revision++
	if err := s.saveLocked(); err != nil {
		s.Catalog.DeliveryNodes = previous
		s.Catalog.Settings.Revision = revision
		writeError(w, 500, "storage_error", "node configuration not saved")
		return
	}
	s.forgetDeliverySession(target)
	status := 200
	if r.Method == "POST" {
		status = 201
	}
	writeJSON(w, status, s.deliverySettingsLocked())
}
