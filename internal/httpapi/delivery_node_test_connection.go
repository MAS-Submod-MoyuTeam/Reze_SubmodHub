package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/cloudreve"
)

// testDeliveryNode is reached only after the common admin/CSRF/origin checks.
// It authenticates and checks configured directory metadata without creating files.
func (s *Store) testDeliveryNode(w http.ResponseWriter, r *http.Request, id string) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var payload struct {
		Revision *uint64 `json:"revision"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&payload) != nil || payload.Revision == nil {
		writeError(w, 400, "validation_failed", "revision required")
		return
	}
	s.mu.RLock()
	index := slices.IndexFunc(s.Catalog.DeliveryNodes, func(n DeliveryNode) bool { return n.ID == id })
	if index < 0 {
		s.mu.RUnlock()
		writeError(w, 404, "not_found", "node not found")
		return
	}
	n := s.Catalog.DeliveryNodes[index]
	revision := s.Catalog.Settings.Revision
	s.mu.RUnlock()
	if *payload.Revision != revision {
		writeError(w, 409, "settings_conflict", "settings revision conflict")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	start := time.Now()
	var err error
	if n.Type == "cloudreve" {
		var client *cloudreve.Client
		client, err = s.cloudreveClient(n)
		if err == nil {
			var listing cloudreve.Listing
			listing, err = client.List(ctx, n.Directory)
			if err == nil && listing.Policy.Type != "local" && listing.Policy.Type != "remote" {
				err = errors.New("cloudreve_upload_policy_unsupported")
			}
		}
	} else {
		var request *http.Request
		request, err = http.NewRequestWithContext(ctx, "GET", strings.TrimRight(n.BaseURL, "/")+"/healthz", nil)
		if err == nil {
			transport, transportErr := configuredNodeTransport(n.BaseURL)
			if transportErr != nil {
				writeError(w, 400, "validation_failed", "invalid configured node origin")
				return
			}
			defer transport.CloseIdleConnections()
			client := &http.Client{Timeout: 20 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("node_redirect_forbidden") }}
			var response *http.Response
			response, err = client.Do(request)
			if err == nil {
				response.Body.Close()
				if response.StatusCode != 200 {
					err = errors.New("node_health_failed")
				}
			}
		}
	}
	code := ""
	status := "available"
	if err != nil {
		status = "failed"
		code = "node_connection_failed"
		if errors.Is(err, cloudreve.ErrAuthentication) {
			code = "cloudreve_authentication_failed"
		}
		if ctx.Err() != nil {
			code = "node_connection_timeout"
		}
	}
	checked := time.Now().UTC()
	s.mu.Lock()
	index = slices.IndexFunc(s.Catalog.DeliveryNodes, func(current DeliveryNode) bool { return current.ID == id && current.Revision == n.Revision })
	if index < 0 {
		s.mu.Unlock()
		writeError(w, 409, "settings_conflict", "node changed during test")
		return
	}
	previous := s.Catalog.DeliveryNodes[index]
	updated := previous
	updated.LastCheckedAt = &checked
	updated.Status = status
	updated.ErrorCode = code
	s.Catalog.DeliveryNodes[index] = updated
	if saveErr := s.saveLocked(); saveErr != nil {
		s.Catalog.DeliveryNodes[index] = previous
		s.mu.Unlock()
		writeError(w, 500, "storage_error", "test status not saved")
		return
	}
	s.mu.Unlock()
	writeJSON(w, 200, map[string]any{"ok": err == nil, "error_code": code, "elapsed_ms": time.Since(start).Milliseconds(), "scope": "authentication_and_directory_metadata", "creates_temporary_files": false})
}
