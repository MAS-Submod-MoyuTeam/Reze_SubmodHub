package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAuthorReviewPublishLifecycle(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "flarum:7", DisplayName: "Author"}, Roles: []string{"admin"}, CSRF: "csrf", Expires: time.Now().Add(time.Hour)}
	ts := httptest.NewServer(NewStoreHandler(s))
	defer ts.Close()
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/author/mods", bytes.NewBufferString(`{"title":"Demo","summary":"summary","description":"## Details\n\n**Markdown** body","category":"submod","tags":["dialogue"],"supported_platforms":["windows"],"mas_version_range":">=0.12.14","recommended_priority":10}`))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, _ := ts.Client().Do(req)
	if res.StatusCode != 201 {
		t.Fatalf("draft %d", res.StatusCode)
	}
	var mod Mod
	_ = json.NewDecoder(res.Body).Decode(&mod)
	res.Body.Close()
	req, _ = http.NewRequest(http.MethodPost, ts.URL+"/api/v1/author/mods/"+mod.ID+"/versions", bytes.NewBufferString(`{"version":"1.0.0","release_notes":"first release","dependencies":[]}`))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, _ = ts.Client().Do(req)
	if res.StatusCode != 201 {
		t.Fatalf("version %d", res.StatusCode)
	}
	if mod.Summary != "summary" || mod.Description != "## Details\n\n**Markdown** body" || len(mod.Tags) != 1 || len(mod.SupportedPlatforms) != 1 || mod.MASVersionRange != ">=0.12.14" || mod.RecommendedPriority != 10 {
		t.Fatalf("mod fields were not decoded: %+v", mod)
	}
	var v Version
	_ = json.NewDecoder(res.Body).Decode(&v)
	res.Body.Close()
	if v.ReleaseNotes != "first release" {
		t.Fatalf("release notes were not decoded: %+v", v)
	}
	req, _ = http.NewRequest(http.MethodPatch, ts.URL+"/api/v1/author/mods/"+mod.ID, bytes.NewBufferString(`{"title":"Updated Demo","summary":"updated summary","description":"## Updated\n\n**Details**","category":"submod","tags":["updated"],"supported_platforms":["windows","linux"],"mas_version_range":">=0.13.0","recommended_priority":42}`))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, _ = ts.Client().Do(req)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("mod update %d", res.StatusCode)
	}
	var updated Mod
	_ = json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if updated.Title != "Updated Demo" || updated.Description != "## Updated\n\n**Details**" || updated.RecommendedPriority != 42 || len(updated.SupportedPlatforms) != 2 {
		t.Fatalf("mod fields were not updated: %+v", updated)
	}
	mod = updated
	s.mu.Lock()
	v.State = "ready_for_review"
	s.Catalog.Versions[v.ID] = v
	now := time.Now().UTC()
	s.Catalog.Submissions = []Submission{{ID: "sub_1", ModID: mod.ID, VersionID: v.ID, AuthorID: "flarum:7", State: "ready_for_review", CreatedAt: now}}
	s.mu.Unlock()
	req, _ = http.NewRequest(http.MethodPost, ts.URL+"/api/v1/review/submissions/sub_1/decision", bytes.NewBufferString(`{"decision":"approve","reason":"ok"}`))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, _ = ts.Client().Do(req)
	if res.StatusCode != 200 {
		t.Fatalf("decision %d", res.StatusCode)
	}
	var decided Submission
	if err := json.NewDecoder(res.Body).Decode(&decided); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if decided.State != "published" || decided.PublishedAt == nil || decided.DecidedAt == nil {
		t.Fatalf("approval did not publish: %+v", decided)
	}
	if s.Catalog.Versions[v.ID].State != "published" || s.Catalog.Mods[0].LatestVersionID != v.ID {
		t.Fatalf("not published: %+v", s.Catalog)
	}
	if len(s.Catalog.ReviewAudit) != 1 || s.Catalog.ReviewAudit[0].Action != "submission_approve" {
		t.Fatalf("approval should be one audited action: %+v", s.Catalog.ReviewAudit)
	}
	req, _ = http.NewRequest(http.MethodGet, ts.URL+"/api/v1/mods/"+mod.ID+"/versions", nil)
	res, _ = ts.Client().Do(req)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("public versions %d", res.StatusCode)
	}
	var publicVersions struct {
		Items []Version `json:"items"`
	}
	if err := json.NewDecoder(res.Body).Decode(&publicVersions); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if len(publicVersions.Items) != 1 || publicVersions.Items[0].ID != v.ID {
		t.Fatalf("approved version is absent from public history: %+v", publicVersions.Items)
	}
	req, _ = http.NewRequest(http.MethodPost, ts.URL+"/api/v1/review/submissions/sub_1/publish", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, _ = ts.Client().Do(req)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate publish %d", res.StatusCode)
	}
	res.Body.Close()
	// Authors can reload their own history, while the endpoint does not expose
	// another author's submissions.
	req, _ = http.NewRequest(http.MethodGet, ts.URL+"/api/v1/author/submissions", nil)
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
	res, _ = ts.Client().Do(req)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("author history %d", res.StatusCode)
	}
	var history struct {
		Items []Submission `json:"items"`
	}
	_ = json.NewDecoder(res.Body).Decode(&history)
	res.Body.Close()
	if len(history.Items) != 1 || history.Items[0].State != "published" || history.Items[0].ReviewerID != "flarum:7" || history.Items[0].PublishedAt == nil {
		t.Fatalf("incomplete author history: %+v", history.Items)
	}
}
