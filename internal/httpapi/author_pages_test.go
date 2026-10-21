package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuthorPages(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("c", 64)
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Roles: []string{"admin", "author"}, Expires: time.Now().Add(time.Hour)}
	for i := 0; i < 23; i++ {
		id := fmt.Sprintf("m%02d", i)
		now := time.Unix(int64(i), 0)
		s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: id, Author: Author{ID: "author"}})
		s.Catalog.Versions[fmt.Sprintf("v%02d", i)] = Version{ID: fmt.Sprintf("v%02d", i), ModID: "m00", State: "draft", CreatedAt: &now, ArchivePath: "private"}
		s.Catalog.Submissions = append(s.Catalog.Submissions, Submission{ID: fmt.Sprintf("s%02d", i), ModID: "m00", AuthorID: "author", State: "rejected", CreatedAt: now})
	}
	s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: "other", Author: Author{ID: "other"}})
	s.Catalog.Versions["other"] = Version{ID: "other", ModID: "other"}
	s.Catalog.Submissions = append(s.Catalog.Submissions, Submission{ID: "other", AuthorID: "other", State: "rejected"})
	handler := NewStoreHandler(s)
	get := func(path string, auth bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if auth {
			r.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{"/api/v1/author/mods", "/api/v1/author/mods/m00/versions", "/api/v1/author/submissions"} {
		seen := map[string]bool{}
		for page := 1; page <= 3; page++ {
			w := get(fmt.Sprintf("%s?page=%d&page_size=10", path, page), true)
			var body struct {
				Items []map[string]json.RawMessage `json:"items"`
				Total int                          `json:"total"`
				Page  int                          `json:"page"`
			}
			if w.Code != 200 {
				t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Total != 23 || body.Page != page {
				t.Fatalf("metadata %s", w.Body.String())
			}
			for _, item := range body.Items {
				var id string
				if raw, ok := item["mod"]; ok {
					var mod Mod
					_ = json.Unmarshal(raw, &mod)
					id = mod.ID
					if item["versions"] != nil || item["scan_reports"] != nil {
						t.Fatal("heavy mod list")
					}
				} else {
					_ = json.Unmarshal(item["id"], &id)
				}
				if seen[id] || id == "other" {
					t.Fatal("duplicate or private row")
				}
				seen[id] = true
				if item["archive_path"] != nil {
					t.Fatal("archive path leaked")
				}
			}
		}
		if len(seen) != 23 {
			t.Fatal("missing records")
		}
		if get(path+"?page_size=101", true).Code != 400 {
			t.Fatal("limit")
		}
		if get(path, false).Code != 401 {
			t.Fatal("authentication")
		}
	}
	if get("/api/v1/author/mods/other/versions", true).Code != 404 {
		t.Fatal("admin must not see another author's workspace")
	}
	w := get("/api/v1/author/mods?focus_mod_id=m00&page_size=10", true)
	if !strings.Contains(w.Body.String(), `"page":3`) {
		t.Fatal("focus does not locate page")
	}
	w = get("/api/v1/author/submissions?state=published", true)
	if !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatal("empty filter")
	}
}
