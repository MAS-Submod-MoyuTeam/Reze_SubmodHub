package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/reze/submodhub/internal/cloudreve"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/delivery"
)

func TestCloudreveReadyOnlyDirectDeliveryAndSafeFallback(t *testing.T) {
	sign := base64.URLEncoding.EncodeToString(make([]byte, 32)) + fmt.Sprintf(":%d", time.Now().Add(10*time.Minute).Unix())
	resolved := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/user/session" {
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		if r.Method != "PUT" || r.URL.Path != "/file/download/object" {
			t.Errorf("API requested archive bytes or unknown object: %s %s", r.Method, r.URL.Path)
		}
		resolved++
		json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": "https://cdn.example/archive?sign=" + sign})
	}))
	defer provider.Close()
	c, _ := cloudreve.New(cloudreve.Config{BaseURL: provider.URL, AllowedDownloadOrigins: []string{"https://cdn.example"}, AllowInsecureForTesting: true})
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m", Category: "submod"}}, Versions: map[string]Version{"v": {ID: "v", ModID: "m", State: "published", ArchivePath: "v.zip", SHA256: strings.Repeat("a", 64), SizeBytes: 42}}, DeliveryNodes: []DeliveryNode{{ID: "cloud", Type: "cloudreve", Enabled: true, Weight: 1, Revision: 1, AllowedDownloadOrigins: []string{"https://cdn.example"}}}, ArchiveMirrors: []ArchiveMirror{{NodeID: "cloud", NodeRevision: 1, VersionID: "v", SHA256: strings.Repeat("a", 64), SizeBytes: 42, State: "pending", FileID: "object"}}})
	s.deliveryRuntime.clients = map[string]cloudreveSession{"cloud": {revision: 1, client: c}}
	r := httptest.NewRequest("GET", "/", nil)
	v := s.Catalog.Versions["v"]
	if out := s.resolveDelivery(r, v); out.DeliveryType != "builtin" || resolved != 0 {
		t.Fatal("pending mirror selected")
	}
	s.Catalog.ArchiveMirrors[0].State = "ready"
	out := s.resolveDelivery(r, v)
	if out.DeliveryType != "cloudreve" || resolved != 1 || out.ExpiresAt.After(time.Now().Add(5*time.Minute)) {
		t.Fatalf("direct delivery: %+v", out)
	}
	if cached := s.resolveDelivery(r, v); cached.DeliveryType != "cloudreve" || resolved != 1 {
		t.Fatal("valid link was not cached")
	}
	s.Catalog.DeliveryNodes[0].Revision = 2
	if out = s.resolveDelivery(r, v); out.DeliveryType != "builtin" || resolved != 1 {
		t.Fatal("stale node mirror selected")
	}
}

func TestDownloadAttemptRechecksPublication(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m", Category: "submod"}}, Versions: map[string]Version{"v": {ID: "v", ModID: "m", State: "published", SHA256: strings.Repeat("a", 64), SizeBytes: 42}}})
	original := s.Catalog.Versions["v"]
	changed := original
	changed.State = "draft"
	s.Catalog.Versions["v"] = changed
	if _, err := s.issueDownloadAttempt(original); err == nil {
		t.Fatal("withdrawn publication received a delivery token")
	}
}

func TestDownloadCompletionReceiptIdempotent(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m", Category: "submod"}}, Versions: map[string]Version{"v": {ID: "v", ModID: "m", State: "published", ArchivePath: "v.zip", SizeBytes: 42, SHA256: strings.Repeat("a", 64)}}})
	h := NewStoreHandler(s)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/versions/v/download", nil))
	var descriptor map[string]any
	json.Unmarshal(w.Body.Bytes(), &descriptor)
	receipt, ok := descriptor["completion_token"].(string)
	if !ok || receipt == "" {
		t.Fatal("completion token missing")
	}
	for i := 0; i < 2; i++ {
		r := httptest.NewRequest("POST", "/api/v1/versions/v/download-complete", strings.NewReader(`{"completion_token":"`+receipt+`","sha256":"`+strings.Repeat("a", 64)+`","size_bytes":42}`))
		out := httptest.NewRecorder()
		h.ServeHTTP(out, r)
		if out.Code != 200 {
			t.Fatalf("receipt: %d %s", out.Code, out.Body.String())
		}
	}
	if err := s.flushDownloadMetrics(); err != nil {
		t.Fatal(err)
	}
	if s.Catalog.Mods[0].ClientReportedDownloads != 1 || s.Catalog.Mods[0].DownloadAttempts != 1 {
		t.Fatalf("counts: %+v", s.Catalog.Mods[0])
	}
	bad := httptest.NewRecorder()
	h.ServeHTTP(bad, httptest.NewRequest("POST", "/api/v1/versions/v/download-complete", strings.NewReader(`{"completion_token":"forged","sha256":"`+strings.Repeat("a", 64)+`","size_bytes":42}`)))
	if bad.Code != 400 {
		t.Fatalf("forged: %d", bad.Code)
	}
}

func TestDeliveryRelayAndBuiltinSpriteBoundary(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m", Category: "submod"}, {ID: "sprite", Category: "spritepack"}}, Versions: map[string]Version{
		"v":      {ID: "v", ModID: "m", State: "published", ArchivePath: "v.zip", SourceType: "github_releases", SHA256: strings.Repeat("a", 64), SizeBytes: 42, GitHubSource: &VersionSourceLocation{DownloadURL: "https://github.com/o/r/releases/download/v/a.zip"}},
		"sprite": {ID: "sprite", ModID: "sprite", State: "published", ArchivePath: "s.zip", SHA256: strings.Repeat("b", 64), SizeBytes: 42, GitHubSource: &VersionSourceLocation{DownloadURL: "https://github.com/o/r/releases/download/v/a.zip"}},
	}})
	s.DeliverySecrets, _ = delivery.NewSecrets(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)))
	secret, _ := s.DeliverySecrets.Seal("relay", strings.Repeat("k", 32))
	s.Catalog.DeliveryNodes = []DeliveryNode{{ID: "relay", Type: "github_relay", BaseURL: "https://relay.example", Enabled: true, Weight: 1, CredentialCiphertext: secret}}
	h := NewStoreHandler(s)
	get := func(id string) map[string]any {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/versions/"+id+"/download", nil))
		if w.Code != 200 {
			t.Fatalf("descriptor: %d %s", w.Code, w.Body.String())
		}
		var out map[string]any
		json.Unmarshal(w.Body.Bytes(), &out)
		return out
	}
	out := get("v")
	if out["delivery_type"] != "github_relay" || out["node_id"] != "relay" || !strings.HasPrefix(out["url"].(string), "https://relay.example/download?ticket=") {
		t.Fatalf("relay not selected: %+v", out)
	}
	out = get("sprite")
	if out["delivery_type"] != "builtin" {
		t.Fatal("sprite routed externally")
	}
	s.Catalog.DeliveryNodes[0].Enabled = false
	out = get("v")
	if out["delivery_type"] != "builtin" || out["url"] != "/api/v1/archives/v" {
		t.Fatal("no builtin fallback")
	}
	if s.Catalog.Mods[0].DownloadsCount != 0 {
		t.Fatal("descriptor counted as completed download")
	}
}
