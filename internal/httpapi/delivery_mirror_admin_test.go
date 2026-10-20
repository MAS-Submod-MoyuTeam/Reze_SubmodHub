package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMirrorManualRetryPermissionsAndRollbackBoundary(t *testing.T) {
	s, admin, csrf, _, _ := createTestStoreWithAdmin(t)
	s.Catalog.DeliveryNodes = []DeliveryNode{{ID: "cloud", Type: "cloudreve"}}
	s.Catalog.ArchiveMirrors = []ArchiveMirror{{NodeID: "cloud", VersionID: "v", State: "failed", Attempts: 8, ErrorCode: "cloudreve_failed", RetryAt: time.Now().Add(time.Hour)}, {NodeID: "cloud", VersionID: "ready", State: "ready", Attempts: 1}}
	h := NewStoreHandler(s)
	call := func(auth bool, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/v1/admin/download-nodes/cloud/retry-mirrors", strings.NewReader(body))
		if auth {
			r.AddCookie(admin)
			r.Header.Set("X-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := call(false, `{"revision":0}`); w.Code != 401 {
		t.Fatalf("permission: %d", w.Code)
	}
	if w := call(true, `{"revision":9}`); w.Code != 409 {
		t.Fatalf("conflict: %d", w.Code)
	}
	if w := call(true, `{"revision":0}`); w.Code != 200 {
		t.Fatalf("retry: %d %s", w.Code, w.Body.String())
	}
	if a := s.Catalog.ArchiveMirrors[0]; a.State != "pending" || a.Attempts != 0 || a.ErrorCode != "" || !a.RetryAt.IsZero() {
		t.Fatalf("not reset: %+v", a)
	}
	if s.Catalog.ArchiveMirrors[1].State != "ready" {
		t.Fatal("ready object disturbed")
	}
}
