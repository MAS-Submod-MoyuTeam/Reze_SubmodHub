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

func TestReviewPagination(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "admin"}, Roles: []string{"admin"}, Expires: time.Now().Add(time.Hour)}
	s.sessions[sessionKey(strings.Repeat("b", 64))] = authSession{User: authUser{ID: "author"}, Roles: []string{"user"}, Expires: time.Now().Add(time.Hour)}
	s.Catalog.Mods = []Mod{{ID: "mod", Title: "Title", Category: "spritepack"}}
	for i := 0; i < 45; i++ {
		state := "published"
		if i%2 == 0 {
			state = "ready_for_review"
		}
		s.Catalog.Submissions = append(s.Catalog.Submissions, Submission{ID: fmt.Sprintf("s%02d", i), ModID: "mod", VersionID: "version", State: state, CreatedAt: time.Unix(int64(i/2), 0), VersionSnapshot: &Version{ID: "snapshot", Version: "1.2.3", ReleaseNotes: strings.Repeat("heavy", 1000)}})
		s.Catalog.ReviewAudit = append(s.Catalog.ReviewAudit, ReviewAuditEvent{ID: fmt.Sprintf("a%02d", i), Timestamp: time.Unix(int64(i/2), 0)})
	}
	handler := NewStoreHandler(s)
	get := func(path, auth string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if auth != "" {
			r.AddCookie(&http.Cookie{Name: "submodhub_session", Value: auth})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, endpoint := range []string{"submissions", "audit"} {
		t.Run(endpoint, func(t *testing.T) {
			base := "/api/v1/review/" + endpoint
			var body struct {
				Items    []map[string]any `json:"items"`
				Total    int              `json:"total"`
				Page     int              `json:"page"`
				PageSize int              `json:"page_size"`
				Pending  int              `json:"pending_count"`
			}
			response := get(base, token)
			if response.Code != 200 {
				t.Fatalf("default: %d %s", response.Code, response.Body.String())
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if len(body.Items) != 20 || body.Total != 45 || body.Page != 1 || body.PageSize != 20 {
				t.Fatalf("default page: %+v", body)
			}
			seen := make(map[string]bool)
			previous := "z"
			for page := 1; page <= 5; page++ {
				response = get(fmt.Sprintf("%s?page=%d&page_size=10", base, page), token)
				if response.Code != 200 {
					t.Fatal(response.Body.String())
				}
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				for _, item := range body.Items {
					id := item["id"].(string)
					if seen[id] || id >= previous {
						t.Fatalf("duplicate or unstable ordering: %s after %s", id, previous)
					}
					seen[id], previous = true, id
					if endpoint == "submissions" {
						if item["version_snapshot"] != nil || item["scan_report_snapshot"] != nil || item["version_str"] != "1.2.3" || item["mod_title"] != "Title" {
							t.Fatalf("not a lightweight summary: %+v", item)
						}
					}
				}
			}
			if len(seen) != 45 || len(body.Items) != 5 {
				t.Fatalf("missing records: %d", len(seen))
			}
			response = get(base+"?page=999999999&page_size=10", token)
			_ = json.Unmarshal(response.Body.Bytes(), &body)
			if body.Page != 5 || len(body.Items) != 5 {
				t.Fatalf("out-of-range page: %+v", body)
			}
			for _, query := range []string{"page=0", "page=-1", "page=x", "page=", "page=1&page=2", "page=999999999999999999999999999", "page_size=0", "page_size=101", "page_size=1.5", "page_size="} {
				if response = get(base+"?"+query, token); response.Code != 400 {
					t.Errorf("%s: got %d", query, response.Code)
				}
			}
			if response = get(base, ""); response.Code != 401 {
				t.Errorf("anonymous status %d", response.Code)
			}
			if response = get(base, strings.Repeat("b", 64)); response.Code != 403 {
				t.Errorf("non-admin status %d", response.Code)
			}
		})
	}
	response := get("/api/v1/review/submissions?state=ready_for_review&page_size=10&page=3", token)
	var filtered struct {
		Items   []reviewSubmissionItem `json:"items"`
		Total   int                    `json:"total"`
		Pending int                    `json:"pending_count"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &filtered)
	if filtered.Total != 23 || filtered.Pending != 23 || len(filtered.Items) != 3 {
		t.Fatalf("filter: %+v", filtered)
	}
	for _, item := range filtered.Items {
		if item.State != "ready_for_review" {
			t.Fatal("wrong state")
		}
	}
	if get("/api/v1/review/submissions?state=invalid", token).Code != 400 {
		t.Fatal("invalid state accepted")
	}
	for _, endpoint := range []string{"submissions?state=rejected", "audit"} {
		if strings.HasPrefix(endpoint, "audit") {
			s.Catalog.ReviewAudit = nil
		}
		response = get("/api/v1/review/"+endpoint, token)
		var empty struct {
			Items []json.RawMessage `json:"items"`
			Page  int               `json:"page"`
			Total int               `json:"total"`
		}
		_ = json.Unmarshal(response.Body.Bytes(), &empty)
		if empty.Items == nil || len(empty.Items) != 0 || empty.Page != 1 || empty.Total != 0 {
			t.Fatalf("empty page: %s", response.Body.String())
		}
	}
}
