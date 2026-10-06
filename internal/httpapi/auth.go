package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/auth"
)

type authSession struct {
	User    authUser  `json:"user"`
	Roles   []string  `json:"roles"`
	CSRF    string    `json:"csrf_token"`
	Expires time.Time `json:"expires_at"`
}

type authUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
}

func randomToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func sessionKey(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func (s *Store) saveSession(key string, session authSession) error {
	if s.DB != nil {
		payload, err := json.Marshal(session)
		if err != nil {
			return err
		}
		_, err = s.DB.Exec("INSERT INTO auth_sessions (token_hash, document, expires_at) VALUES ($1, $2, $3)", key, payload, session.Expires)
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[key] = session
	return nil
}

func (s *Store) readSession(r *http.Request) (authSession, bool) {
	cookie, err := r.Cookie("submodhub_session")
	if err != nil || len(cookie.Value) != 64 {
		return authSession{}, false
	}
	key := sessionKey(cookie.Value)
	var session authSession
	if s.DB != nil {
		var payload []byte
		if err := s.DB.QueryRowContext(r.Context(), "SELECT document FROM auth_sessions WHERE token_hash = $1 AND expires_at > now()", key).Scan(&payload); err != nil {
			return authSession{}, false
		}
		if json.Unmarshal(payload, &session) != nil {
			return authSession{}, false
		}
	} else {
		s.mu.RLock()
		session, _ = s.sessions[key]
		s.mu.RUnlock()
	}
	return session, session.User.ID != "" && time.Now().Before(session.Expires)
}

func (s *Store) deleteSession(r *http.Request) {
	cookie, err := r.Cookie("submodhub_session")
	if err != nil {
		return
	}
	key := sessionKey(cookie.Value)
	if s.DB != nil {
		_, _ = s.DB.ExecContext(r.Context(), "DELETE FROM auth_sessions WHERE token_hash = $1", key)
	} else {
		s.mu.Lock()
		delete(s.sessions, key)
		s.mu.Unlock()
	}
}

func (s *Store) session(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	session, ok := s.readSession(r)
	if !ok {
		writeJSON(w, 200, map[string]any{"user": nil, "roles": []string{}, "csrf_token": ""})
		return
	}
	session.Roles = s.effectiveRoles(session)
	writeJSON(w, 200, session)
}

func (s *Store) effectiveRoles(session authSession) []string {
	s.mu.RLock()
	grants := append([]string(nil), s.Catalog.RoleGrants[session.User.ID]...)
	s.mu.RUnlock()
	roles := append([]string(nil), session.Roles...)
	for _, grant := range grants {
		if grant == "author" || grant == "reviewer" {
			roles = append(roles, grant)
		}
	}
	return roles
}

func (s *Store) loginFlarum(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	if r.TLS == nil && os.Getenv("SUBMODHUB_ALLOW_INSECURE_AUTH") != "true" {
		writeError(w, 403, "https_required", "login requires HTTPS")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var payload struct {
		Identification string `json:"identification"`
		Username       string `json:"username"`
		Password       string `json:"password"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		writeError(w, 400, "validation_failed", "invalid login request")
		return
	}
	identification := strings.TrimSpace(payload.Identification)
	if identification == "" {
		identification = strings.TrimSpace(payload.Username)
	}
	if identification == "" || payload.Password == "" {
		writeError(w, 400, "validation_failed", "identification and password are required")
		return
	}
	var profile auth.FlarumProfile
	var err error
	if s.TestMode && identification == s.TestUsername {
		if payload.Password != s.TestPassword {
			writeError(w, http.StatusUnauthorized, "invalid_test_credentials", "test credentials are invalid")
			return
		}
		profile = auth.FlarumProfile{ID: "test-1", Username: s.TestUsername, DisplayName: "SubmodHub 测试用户"}
	} else {
		if s.Flarum == nil {
			writeError(w, 503, "auth_unavailable", "Flarum login is not configured")
			return
		}
		profile, err = s.Flarum.Login(r.Context(), identification, payload.Password)
	}
	if err != nil {
		log.Printf("Flarum login failed for identification=%q: %v", identification, err)
		code := "invalid_flarum_credentials"
		status := http.StatusUnauthorized
		if !strings.Contains(err.Error(), "HTTP 401") && !strings.Contains(err.Error(), "HTTP 422") {
			code = "flarum_provider_error"
			status = http.StatusBadGateway
		}
		writeError(w, status, code, "Flarum login failed")
		return
	}
	role := auth.RoleForFlarum(profile, s.AdminGroupIDs)
	token, err := randomToken()
	if err != nil {
		writeError(w, 500, "auth_error", "session creation failed")
		return
	}
	csrf, err := randomToken()
	if err != nil {
		writeError(w, 500, "auth_error", "session creation failed")
		return
	}
	session := authSession{User: authUser{ID: "flarum:" + profile.ID, Username: profile.Username, DisplayName: profile.DisplayName, AvatarURL: profile.AvatarURL}, Roles: []string{role}, CSRF: csrf, Expires: time.Now().Add(7 * 24 * time.Hour)}
	if err := s.saveSession(sessionKey(token), session); err != nil {
		writeError(w, 500, "storage_error", "session creation failed")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "submodhub_session", Value: token, Path: "/api/v1", Secure: r.TLS != nil, HttpOnly: true, SameSite: http.SameSiteStrictMode, Expires: session.Expires})
	session.Roles = s.effectiveRoles(session)
	writeJSON(w, 200, session)
}

func (s *Store) updateUserRoles(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.readUserRoles(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	session, ok := s.readSession(r)
	if !ok {
		writeError(w, 401, "unauthenticated", "login required")
		return
	}
	if !containsRole(session.Roles, "admin") {
		writeError(w, 403, "forbidden", "administrator role required")
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(session.CSRF)) != 1 {
		writeError(w, 403, "csrf_invalid", "invalid CSRF token")
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/users/")
	if !strings.HasSuffix(path, "/roles") {
		writeError(w, 404, "not_found", "role endpoint was not found")
		return
	}
	targetID := strings.TrimSuffix(path, "/roles")
	if !strings.HasPrefix(targetID, "flarum:") {
		writeError(w, 400, "validation_failed", "Flarum user ID required")
		return
	}
	id := strings.TrimPrefix(targetID, "flarum:")
	parsed, err := strconv.ParseUint(id, 10, 64)
	if err != nil || parsed == 0 || strconv.FormatUint(parsed, 10) != id {
		writeError(w, 400, "validation_failed", "invalid Flarum user ID")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var payload struct {
		Roles []string `json:"roles"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || payload.Roles == nil {
		writeError(w, 400, "validation_failed", "roles array required")
		return
	}
	seen := map[string]bool{}
	for _, role := range payload.Roles {
		if (role != "author" && role != "reviewer") || seen[role] {
			writeError(w, 400, "validation_failed", "roles must contain unique author/reviewer values")
			return
		}
		seen[role] = true
	}
	roles := make([]string, 0, 2)
	for _, role := range []string{"author", "reviewer"} {
		if seen[role] {
			roles = append(roles, role)
		}
	}
	s.mu.Lock()
	if s.Catalog.RoleGrants == nil {
		s.Catalog.RoleGrants = map[string][]string{}
	}
	previous, existed := s.Catalog.RoleGrants[targetID]
	previousAuditLen := len(s.Catalog.RoleAudit)
	if len(roles) == 0 {
		delete(s.Catalog.RoleGrants, targetID)
	} else {
		s.Catalog.RoleGrants[targetID] = roles
	}
	s.Catalog.RoleAudit = append(s.Catalog.RoleAudit, RoleAuditEvent{ActorID: session.User.ID, TargetID: targetID, Roles: roles, At: time.Now().UTC()})
	if err := s.saveLocked(); err != nil {
		if existed {
			s.Catalog.RoleGrants[targetID] = previous
		} else {
			delete(s.Catalog.RoleGrants, targetID)
		}
		s.Catalog.RoleAudit = s.Catalog.RoleAudit[:previousAuditLen]
		s.mu.Unlock()
		writeError(w, 500, "storage_error", "role change was not saved")
		return
	}
	s.mu.Unlock()
	writeJSON(w, 200, map[string]any{"user_id": targetID, "roles": roles})
}

func (s *Store) readUserRoles(w http.ResponseWriter, r *http.Request) {
	session, ok := s.readSession(r)
	if !ok {
		writeError(w, 401, "unauthenticated", "login required")
		return
	}
	if !containsRole(s.effectiveRoles(session), "admin") {
		writeError(w, 403, "forbidden", "administrator role required")
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/users/")
	if !strings.HasSuffix(path, "/roles") {
		writeError(w, 404, "not_found", "role endpoint was not found")
		return
	}
	targetID := strings.TrimSuffix(path, "/roles")
	if !strings.HasPrefix(targetID, "flarum:") {
		writeError(w, 400, "validation_failed", "Flarum user ID required")
		return
	}
	id := strings.TrimPrefix(targetID, "flarum:")
	parsed, err := strconv.ParseUint(id, 10, 64)
	if err != nil || parsed == 0 || strconv.FormatUint(parsed, 10) != id {
		writeError(w, 400, "validation_failed", "invalid Flarum user ID")
		return
	}
	s.mu.RLock()
	roles := append([]string(nil), s.Catalog.RoleGrants[targetID]...)
	s.mu.RUnlock()
	writeJSON(w, 200, map[string]any{"user_id": targetID, "roles": roles})
}

func containsRole(roles []string, wanted string) bool {
	for _, role := range roles {
		if role == wanted {
			return true
		}
	}
	return false
}

func (s *Store) logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	session, ok := s.readSession(r)
	if !ok {
		writeError(w, 401, "unauthenticated", "login required")
		return
	}
	provided := r.Header.Get("X-CSRF-Token")
	if subtle.ConstantTimeCompare([]byte(provided), []byte(session.CSRF)) != 1 {
		writeError(w, 403, "csrf_invalid", "invalid CSRF token")
		return
	}
	s.deleteSession(r)
	http.SetCookie(w, &http.Cookie{Name: "submodhub_session", Path: "/api/v1", MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	w.WriteHeader(http.StatusNoContent)
}
