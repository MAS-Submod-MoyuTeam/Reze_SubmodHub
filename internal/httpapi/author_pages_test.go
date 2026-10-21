package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type authorModWindow struct {
	Items []struct {
		Mod                Mod    `json:"mod"`
		Published          bool   `json:"is_published"`
		HasPublished       bool   `json:"has_published_version"`
		HasArchived        bool   `json:"has_archived_version"`
		HasPendingReview   bool   `json:"has_pending_review"`
		CandidateVersionID string `json:"candidate_version_id"`
	} `json:"items"`
	Total      int     `json:"total"`
	PageSize   int     `json:"page_size"`
	Start      int     `json:"start"`
	Cursor     *string `json:"cursor"`
	NextCursor *string `json:"next_cursor"`
	PrevCursor *string `json:"prev_cursor"`
}

func (window authorModWindow) ids() []string {
	ids := make([]string, 0, len(window.Items))
	for _, item := range window.Items {
		ids = append(ids, item.Mod.ID)
	}
	return ids
}

func authorSession(t *testing.T, s *Store, token, userID string) http.Handler {
	t.Helper()
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: userID}, Roles: []string{"admin", "author"}, Expires: time.Now().Add(time.Hour)}
	return NewStoreHandler(s)
}

func getAuthor(t *testing.T, handler http.Handler, token, path string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("GET", path, nil)
	if token != "" {
		r.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func authorModWindowOf(t *testing.T, handler http.Handler, token, path string) authorModWindow {
	t.Helper()
	w := getAuthor(t, handler, token, path)
	if w.Code != 200 {
		t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
	}
	var window authorModWindow
	if err := json.Unmarshal(w.Body.Bytes(), &window); err != nil {
		t.Fatal(err)
	}
	return window
}

func TestAuthorModPagesWalkStrictCreationOrder(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("c", 64)
	for i := 0; i < 23; i++ {
		created := time.Unix(int64(i)*60, 0).UTC()
		s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: fmt.Sprintf("m%02d", i), Author: Author{ID: "author"}, CreatedAt: &created})
	}
	s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: "other", Author: Author{ID: "other"}})
	handler := authorSession(t, s, token, "author")
	cursor := ""
	seen := make([]string, 0, 23)
	for {
		path := "/api/v1/author/mods?page_size=10"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		window := authorModWindowOf(t, handler, token, path)
		if window.Total != 23 || window.PageSize != 10 {
			t.Fatalf("metadata %+v", window)
		}
		if window.Start != len(seen) {
			t.Fatalf("window start %d, got %d rows so far", window.Start, len(seen))
		}
		for _, id := range window.ids() {
			if id == "other" {
				t.Fatal("private mod leaked")
			}
			seen = append(seen, id)
		}
		if window.NextCursor == nil {
			if len(window.Items) != 3 {
				t.Fatalf("last window must hold the remaining 3 rows: %v", window.ids())
			}
			break
		}
		cursor = *window.NextCursor
	}
	if len(seen) != 23 {
		t.Fatalf("walked %d rows: %v", len(seen), seen)
	}
	for i := len(seen) - 1; i > 0; i-- {
		if !(seen[i-1] > seen[i]) {
			t.Fatalf("creation order broken at %d: %v", i, seen)
		}
	}
	if getAuthor(t, handler, token, "/api/v1/author/mods?page_size=101").Code != 400 {
		t.Fatal("page size bound")
	}
	if getAuthor(t, handler, token, "/api/v1/author/mods?cursor=not-a-cursor").Code != 400 {
		t.Fatal("invalid cursor")
	}
	if getAuthor(t, handler, "", "/api/v1/author/mods").Code != 401 {
		t.Fatal("authentication")
	}
}

func TestAuthorModCursorSkipsConcurrentInsert(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("e", 64)
	for i := 0; i < 12; i++ {
		created := time.Unix(int64(i)*60, 0).UTC()
		s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: fmt.Sprintf("m%02d", i), Author: Author{ID: "author"}, CreatedAt: &created})
	}
	handler := authorSession(t, s, token, "author")
	first := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=5")
	if first.NextCursor == nil || first.Start != 0 || first.Cursor != nil || first.PrevCursor != nil {
		t.Fatalf("first window %+v", first)
	}
	// A newer mod arrives between two pages. With an offset window this would
	// push m07 onto the second page; the keyset window must not move at all.
	newest := time.Unix(700, 0).UTC()
	s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: "mod_newest", Author: Author{ID: "author"}, CreatedAt: &newest})
	second := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=5&cursor="+*first.NextCursor)
	if strings.Join(second.ids(), ",") != "m06,m05,m04,m03,m02" {
		t.Fatalf("second window drifted: %v", second.ids())
	}
	// The rows are pinned by the cursor; only the display index moves, because
	// the inserted mod now sits in front of every existing row.
	if second.Start != 6 || second.PrevCursor == nil || second.NextCursor == nil {
		t.Fatalf("second window metadata %+v", second)
	}
	back := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=5&cursor="+*second.PrevCursor)
	if strings.Join(back.ids(), ",") != "m11,m10,m09,m08,m07" {
		t.Fatalf("previous window %v", back.ids())
	}
	// Deleting a row that the walk already passed also leaves later windows put.
	s.mu.Lock()
	s.Catalog.Mods = s.Catalog.Mods[:len(s.Catalog.Mods)-2]
	s.mu.Unlock()
	third := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=5&cursor="+*second.NextCursor)
	if strings.Join(third.ids(), ",") != "m01,m00" {
		t.Fatalf("tail window %v", third.ids())
	}
}

// A window that starts exactly one page in has the first window as its previous
// neighbour, so it must still offer a way back. That neighbour's cursor is the
// empty string a client already sends to ask for the first window, so prev_cursor
// stays set: a client must not read a null prev_cursor as "nothing before this".
func TestAuthorModSecondWindowOffersWayBack(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("g", 64)
	for i := 0; i < 13; i++ {
		created := time.Unix(int64(i)*60, 0).UTC()
		s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: fmt.Sprintf("m%02d", i), Author: Author{ID: "author"}, CreatedAt: &created})
	}
	handler := authorSession(t, s, token, "author")
	first := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=10")
	second := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=10&cursor="+*first.NextCursor)
	if second.Start != 10 || strings.Join(second.ids(), ",") != "m02,m01,m00" {
		t.Fatalf("second window %+v", second)
	}
	if second.PrevCursor == nil || *second.PrevCursor != "" {
		t.Fatalf("second window must point back at the first window: %+v", second)
	}
	back := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=10&cursor="+*second.PrevCursor)
	if back.Start != 0 || back.Cursor != nil || len(back.Items) != 10 || back.PrevCursor != nil {
		t.Fatalf("first window again %+v", back)
	}
}

func TestAuthorModFocusSnapsToOwningWindow(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("f", 64)
	for i := 0; i < 23; i++ {
		created := time.Unix(int64(i)*60, 0).UTC()
		s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: fmt.Sprintf("m%02d", i), Author: Author{ID: "author"}, CreatedAt: &created})
	}
	s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: "foreign", Author: Author{ID: "other"}})
	handler := authorSession(t, s, token, "author")
	window := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=10&focus_mod_id=m00")
	if window.Start != 20 || strings.Join(window.ids(), ",") != "m02,m01,m00" {
		t.Fatalf("focus window %+v", window)
	}
	if window.Cursor == nil || window.PrevCursor == nil || window.NextCursor != nil {
		t.Fatalf("focus window cursors %+v", window)
	}
	// The returned cursor reproduces the same window, so a refresh after the
	// focus jump no longer falls back to the first page.
	refreshed := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=10&cursor="+*window.Cursor)
	if strings.Join(refreshed.ids(), ",") != strings.Join(window.ids(), ",") {
		t.Fatalf("refresh moved the window: %v", refreshed.ids())
	}
	ignored := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=10&focus_mod_id=foreign")
	if ignored.Start != 0 || ignored.Cursor != nil || strings.Join(ignored.ids(), ",") != "m22,m21,m20,m19,m18,m17,m16,m15,m14,m13" {
		t.Fatalf("foreign focus must be ignored: %+v", ignored)
	}
}

func TestAuthorVersionAndSubmissionPages(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("b", 64)
	for i := 0; i < 23; i++ {
		now := time.Unix(int64(i), 0)
		id := fmt.Sprintf("m%02d", i)
		s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: id, Author: Author{ID: "author"}})
		s.Catalog.Versions[fmt.Sprintf("v%02d", i)] = Version{ID: fmt.Sprintf("v%02d", i), ModID: "m00", State: "draft", CreatedAt: &now, ArchivePath: "private"}
		s.Catalog.Submissions = append(s.Catalog.Submissions, Submission{ID: fmt.Sprintf("s%02d", i), ModID: "m00", AuthorID: "author", State: "rejected", CreatedAt: now})
	}
	s.Catalog.Mods = append(s.Catalog.Mods, Mod{ID: "other", Author: Author{ID: "other"}})
	s.Catalog.Versions["other"] = Version{ID: "other", ModID: "other"}
	s.Catalog.Submissions = append(s.Catalog.Submissions, Submission{ID: "other", AuthorID: "other", State: "rejected"})
	handler := authorSession(t, s, token, "author")
	for _, path := range []string{"/api/v1/author/mods/m00/versions", "/api/v1/author/submissions"} {
		seen := map[string]bool{}
		for page := 1; page <= 3; page++ {
			w := getAuthor(t, handler, token, fmt.Sprintf("%s?page=%d&page_size=10", path, page))
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
				_ = json.Unmarshal(item["id"], &id)
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
		if getAuthor(t, handler, token, path+"?page_size=101").Code != 400 {
			t.Fatal("limit")
		}
		if getAuthor(t, handler, "", path).Code != 401 {
			t.Fatal("authentication")
		}
	}
	if getAuthor(t, handler, token, "/api/v1/author/mods/other/versions").Code != 404 {
		t.Fatal("admin must not see another author's workspace")
	}
	if body := getAuthor(t, handler, token, "/api/v1/author/submissions?state=published").Body.String(); !strings.Contains(body, `"items":[]`) {
		t.Fatal("empty filter")
	}
}

func TestAuthorModPageReportsVersionAggregates(t *testing.T) {
	now := time.Now().UTC()
	earlier := now.Add(-time.Hour)
	oldest := now.Add(-3 * time.Hour)
	uploaded := now.Add(-2 * time.Hour)
	retired := now.Add(-4 * time.Hour)
	s, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{ID: "uploading", Author: Author{ID: "author"}, CreatedAt: &now},
			{ID: "live", Author: Author{ID: "author"}, LatestVersionID: "live_v1", CreatedAt: &uploaded},
			{ID: "hidden", Author: Author{ID: "author"}, LatestVersionID: "hidden_v1", Unpublished: true, CreatedAt: &oldest},
			{ID: "empty", Author: Author{ID: "author"}},
			{ID: "foreign", Author: Author{ID: "other"}, LatestVersionID: "foreign_v1", CreatedAt: &now},
		},
		Versions: map[string]Version{
			"live_v1":      {ID: "live_v1", ModID: "live", State: "published", CreatedAt: &earlier},
			"live_v2":      {ID: "live_v2", ModID: "live", State: "draft", CreatedAt: &now},
			"hidden_v1":    {ID: "hidden_v1", ModID: "hidden", State: "published", CreatedAt: &earlier},
			"hidden_v0":    {ID: "hidden_v0", ModID: "hidden", State: "unpublished", CreatedAt: &retired},
			"uploading_v1": {ID: "uploading_v1", ModID: "uploading", State: "ready_for_review", CreatedAt: &now},
			"foreign_v1":   {ID: "foreign_v1", ModID: "foreign", State: "published", CreatedAt: &now},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("d", 64)
	handler := authorSession(t, s, token, "author")
	window := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=10")
	if window.Total != 4 || len(window.Items) != 4 {
		t.Fatalf("owned mods only: %+v", window)
	}
	// Strict creation order, not version activity: `live` has the newest version
	// but was created after `uploading`. Mods without created_at fall to the end.
	for i, id := range []string{"uploading", "live", "hidden", "empty"} {
		if window.Items[i].Mod.ID != id {
			t.Fatalf("item %d = %q, want %q", i, window.Items[i].Mod.ID, id)
		}
	}
	if uploading := window.Items[0]; !uploading.HasPendingReview || uploading.Published || uploading.HasArchived || uploading.CandidateVersionID != "" {
		t.Fatalf("pending review aggregate: %+v", uploading)
	}
	// A live version and a draft are not an archived version: `live` released
	// nothing that was retired, so its draft is still deletable.
	if live := window.Items[1]; !live.Published || !live.HasPublished || live.HasArchived || live.HasPendingReview || live.CandidateVersionID != "live_v2" {
		t.Fatalf("published aggregate: %+v", live)
	}
	// `hidden` was taken down: it still has a published version and, separately,
	// a retired one, so neither flag may be collapsed into the other.
	if hidden := window.Items[2]; hidden.Published || !hidden.HasPublished || !hidden.HasArchived {
		t.Fatalf("unpublished mod keeps both published and archived facts: %+v", hidden)
	}
	if empty := window.Items[3]; empty.Published || empty.HasPublished || empty.HasArchived || empty.HasPendingReview || empty.CandidateVersionID != "" {
		t.Fatalf("empty mod aggregate: %+v", empty)
	}
	if getAuthor(t, handler, token, "/api/v1/author/mods/missing/versions").Code != 404 {
		t.Fatal("unknown mod versions must be 404")
	}
}

func TestAuthorModDraftStampsCreatedAt(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	handler := authorSession(t, s, token, "author")
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/author/mods", bytes.NewBufferString(`{"title":"Dated","summary":"s","category":"submod"}`))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("draft %d %s", w.Code, w.Body.String())
	}
	var created Mod
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.CreatedAt == nil {
		t.Fatal("new drafts must carry created_at")
	}
	window := authorModWindowOf(t, handler, token, "/api/v1/author/mods?page_size=10")
	if len(window.Items) != 1 || window.Items[0].Mod.CreatedAt == nil || !window.Items[0].Mod.CreatedAt.Equal(*created.CreatedAt) {
		t.Fatalf("list must expose the stamped creation time: %+v", window.Items)
	}
}

func TestBackfillModCreatedAt(t *testing.T) {
	versionTime := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	submissionTime := time.Date(2026, 1, 3, 3, 4, 5, 0, time.UTC)
	known := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	fallback := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	s, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{ID: "versioned"},
			{ID: "submitted"},
			{ID: "bare"},
			{ID: "known", CreatedAt: &known},
		},
		Versions: map[string]Version{
			"v_late":   {ID: "v_late", ModID: "versioned", CreatedAt: ptrTime(versionTime.Add(time.Hour))},
			"v_early":  {ID: "v_early", ModID: "versioned", CreatedAt: ptrTime(versionTime)},
			"v_orphan": {ID: "v_orphan", ModID: "gone", CreatedAt: ptrTime(versionTime)},
		},
		Submissions: []Submission{{ID: "s1", ModID: "submitted", CreatedAt: submissionTime}},
	})
	if err != nil {
		t.Fatal(err)
	}
	stamped, err := s.BackfillModCreatedAt(fallback)
	if err != nil {
		t.Fatal(err)
	}
	if stamped != 3 {
		t.Fatalf("stamped %d mods, want 3", stamped)
	}
	byID := map[string]Mod{}
	for _, mod := range s.Catalog.Mods {
		byID[mod.ID] = mod
	}
	for id, want := range map[string]time.Time{"versioned": versionTime, "submitted": submissionTime, "bare": fallback, "known": known} {
		if byID[id].CreatedAt == nil || !byID[id].CreatedAt.Equal(want) {
			t.Fatalf("%s created_at = %v, want %v", id, byID[id].CreatedAt, want)
		}
	}
	again, err := s.BackfillModCreatedAt(fallback)
	if err != nil {
		t.Fatal(err)
	}
	if again != 0 {
		t.Fatalf("backfill is not idempotent: %d", again)
	}
}

func ptrTime(value time.Time) *time.Time { return &value }
