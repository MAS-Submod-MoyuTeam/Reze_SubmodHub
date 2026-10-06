package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	packagezip "github.com/reze/submodhub/internal/package"
)

func TestResolveDependencyLinkOnlyForUniquePublishedRegistration(t *testing.T) {
	catalog := Catalog{
		Mods: []Mod{{ID: "one", LatestVersionID: "v1"}, {ID: "two", LatestVersionID: "v2"}},
		Versions: map[string]Version{
			"v1": {ID: "v1", ModID: "one", State: "published", ScanReportID: "scan1"},
			"v2": {ID: "v2", ModID: "two", State: "published", ScanReportID: "scan2"},
		},
		ScanReports: map[string]packagezip.Report{
			"scan1": {Submods: []packagezip.Registration{{Name: "Core"}}},
			"scan2": {Submods: []packagezip.Registration{{Name: "Other"}}},
		},
	}
	if got := resolveDependencyLink(catalog, "Core"); got != "one" {
		t.Fatalf("unique link=%q", got)
	}
	if got := resolveDependencyLink(catalog, "Missing"); got != "" {
		t.Fatalf("missing link=%q", got)
	}
	catalog.ScanReports["scan2"] = packagezip.Report{Submods: []packagezip.Registration{{Name: "Core"}}}
	if got := resolveDependencyLink(catalog, "Core"); got != "" {
		t.Fatalf("ambiguous link=%q", got)
	}
}

func TestAuthorCanLinkUploadedDependencyBeforeReview(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "owner", Author: Author{ID: "author"}}, {ID: "target"}}, Versions: map[string]Version{"v1": {ID: "v1", ModID: "owner", State: "uploaded", Version: "1.0.0", Dependencies: []Dependency{{ModID: "Core", ModTitle: "Core", Required: true}}}}})
	if err != nil {
		t.Fatal(err)
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	s.sessions[sessionKey(token)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	ts := httptest.NewServer(NewStoreHandler(s))
	defer ts.Close()
	call := func(link string) *http.Response {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"version": "1.0.0", "dependencies": []Dependency{{ModID: "Core", ModTitle: "Core", LinkedModID: link, Required: true}}})
		req, _ := http.NewRequest(http.MethodPatch, ts.URL+"/api/v1/author/versions/v1/edit", bytes.NewReader(body))
		req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		res, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	for _, link := range []string{"missing", "owner"} {
		res := call(link)
		if res.StatusCode != 400 {
			t.Fatalf("invalid link %q status=%d", link, res.StatusCode)
		}
		res.Body.Close()
	}
	res := call("target")
	if res.StatusCode != 200 {
		t.Fatalf("valid link status=%d", res.StatusCode)
	}
	res.Body.Close()
	if s.Catalog.Versions["v1"].Dependencies[0].LinkedModID != "target" {
		t.Fatalf("saved link=%+v", s.Catalog.Versions["v1"].Dependencies)
	}
}
