package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"time"
)

// retryDeliveryMirrors runs only after the common admin/CSRF/origin guards.
func (s *Store) retryDeliveryMirrors(w http.ResponseWriter, r *http.Request, nodeID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var payload struct {
		Revision *uint64 `json:"revision"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&payload) != nil || payload.Revision == nil || dec.Decode(new(any)) != io.EOF {
		writeError(w, 400, "validation_failed", "revision required")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if *payload.Revision != s.Catalog.Settings.Revision {
		writeError(w, 409, "settings_conflict", "settings revision conflict")
		return
	}
	index := slices.IndexFunc(s.Catalog.DeliveryNodes, func(n DeliveryNode) bool { return n.ID == nodeID && n.Type == "cloudreve" })
	if index < 0 {
		writeError(w, 404, "not_found", "cloudreve node not found")
		return
	}
	previous := s.Catalog.ArchiveMirrors
	updated := slices.Clone(previous)
	count := 0
	for i, m := range updated {
		if m.NodeID == nodeID && m.State == "failed" {
			updated[i].State = "pending"
			updated[i].Attempts = 0
			updated[i].ErrorCode = ""
			updated[i].RetryAt = time.Time{}
			count++
		}
	}
	s.Catalog.ArchiveMirrors = updated
	if err := s.saveLocked(); err != nil {
		s.Catalog.ArchiveMirrors = previous
		writeError(w, 500, "storage_error", "mirror retry not saved")
		return
	}
	writeJSON(w, 200, map[string]any{"retried": count})
}
