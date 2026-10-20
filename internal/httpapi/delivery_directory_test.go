package httpapi

import (
	"encoding/json"
	"fmt"
	"github.com/reze/submodhub/internal/cloudreve"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNodeConnectionCreatesMissingProjectDirectory(t *testing.T) {
	created := false
	creates := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/user/session" {
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		if r.Method == "PUT" && r.URL.Path == "/directory" {
			created = true
			creates++
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		if r.Method != "GET" || r.URL.Path != "/directory/SubmodHub" {
			t.Errorf("unexpected provider operation: %s %s", r.Method, r.URL.Path)
		}
		if !created {
			fmt.Fprint(w, `{"code":404}`)
			return
		}
		fmt.Fprint(w, `{"code":0,"data":{"policy":{"type":"remote"}}}`)
	}))
	defer provider.Close()
	client, _ := cloudreve.New(cloudreve.Config{BaseURL: provider.URL, AllowInsecureForTesting: true})
	s, admin, csrf, _, _ := createTestStoreWithAdmin(t)
	s.Catalog.DeliveryNodes = []DeliveryNode{{ID: "n", Type: "cloudreve", Directory: "/SubmodHub", Revision: 1}}
	s.deliveryRuntime.clients = map[string]cloudreveSession{"n": {revision: 1, client: client}}
	handler := NewStoreHandler(s)
	for i := 0; i < 2; i++ {
		r := httptest.NewRequest("POST", "/api/v1/admin/download-nodes/n/test", strings.NewReader(fmt.Sprintf(`{"revision":%d}`, s.Catalog.Settings.Revision)))
		r.AddCookie(admin)
		r.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		var result struct {
			OK bool `json:"ok"`
		}
		json.Unmarshal(w.Body.Bytes(), &result)
		if w.Code != 200 || !result.OK {
			t.Fatalf("connection test failed: %d %s", w.Code, w.Body.String())
		}
	}
	if creates != 1 || s.Catalog.DeliveryNodes[0].Status != "available" {
		t.Fatal("directory creation not idempotent")
	}
}
