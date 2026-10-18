package httpapi

import (
	"net/http"

	"github.com/reze/submodhub/internal/version"
)

// versionInfo reports the build metadata of the running API server. It is
// public and uncached so clients (and deployment health checks) can verify which
// release is live.
func (s *Store) versionInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "GET only")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, version.Current())
}
