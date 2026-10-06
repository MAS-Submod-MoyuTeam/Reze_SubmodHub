package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/auth"
)

func TestFlarumLoginCreatesSessionAndLogoutInvalidatesIt(t *testing.T) {
	forum := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/token":
			_, _ = w.Write([]byte(`{"token":"forum-token","userId":17}`))
		case "/api/users/17":
			_, _ = w.Write([]byte(`{"data":{"id":"17","attributes":{"username":"alice","displayName":"Alice"},"relationships":{"groups":{"data":[{"id":"16"}]}}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer forum.Close()
	client, err := auth.NewFlarumClient(forum.URL, forum.Client())
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	store.Flarum = client
	store.AdminGroupIDs = map[string]bool{"16": true, "22": true}
	server := httptest.NewTLSServer(NewStoreHandler(store))
	defer server.Close()
	login := []byte(`{"identification":"alice","password":"secret"}`)
	res, err := server.Client().Post(server.URL+"/api/v1/auth/flarum/login", "application/json", bytes.NewReader(login))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("login status %d", res.StatusCode)
	}
	if len(res.Cookies()) != 1 || !res.Cookies()[0].Secure || !res.Cookies()[0].HttpOnly {
		t.Fatalf("unsafe cookies: %+v", res.Cookies())
	}
	var logged struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
		Roles []string `json:"roles"`
		CSRF  string   `json:"csrf_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&logged); err != nil {
		t.Fatal(err)
	}
	if logged.User.ID != "flarum:17" || len(logged.Roles) != 1 || logged.Roles[0] != "admin" || logged.CSRF == "" {
		t.Fatalf("bad session: %+v", logged)
	}
	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/session", nil)
	request.AddCookie(res.Cookies()[0])
	session, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Body.Close()
	var current struct {
		User *struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err := json.NewDecoder(session.Body).Decode(&current); err != nil {
		t.Fatal(err)
	}
	if current.User == nil || current.User.ID != "flarum:17" {
		t.Fatalf("session lost: %+v", current)
	}
	request, _ = http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/logout", nil)
	request.AddCookie(res.Cookies()[0])
	request.Header.Set("X-CSRF-Token", logged.CSRF)
	logout, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	logout.Body.Close()
	if logout.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status %d", logout.StatusCode)
	}
	request, _ = http.NewRequest(http.MethodGet, server.URL+"/api/v1/session", nil)
	request.AddCookie(res.Cookies()[0])
	session, err = server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Body.Close()
	if err := json.NewDecoder(session.Body).Decode(&current); err != nil {
		t.Fatal(err)
	}
	if current.User != nil {
		t.Fatal("logged-out cookie still authenticated")
	}
}

func TestTestAccountDoesNotBlockFlarumLogin(t *testing.T) {
	forumCalls := 0
	forum := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/token":
			forumCalls++
			_, _ = w.Write([]byte(`{"token":"forum-token","userId":17}`))
		case "/api/users/17":
			_, _ = w.Write([]byte(`{"data":{"id":"17","attributes":{"username":"alice","displayName":"Alice"},"relationships":{"groups":{"data":[]}}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer forum.Close()
	client, err := auth.NewFlarumClient(forum.URL, forum.Client())
	if err != nil { t.Fatal(err) }
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil { t.Fatal(err) }
	store.TestMode = true
	store.TestUsername = "submodhub-test"
	store.TestPassword = "test-secret"
	store.Flarum = client
	server := httptest.NewTLSServer(NewStoreHandler(store))
	defer server.Close()
	login := func(username, password string) (int, string) {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"identification": username, "password": password})
		res, err := server.Client().Post(server.URL+"/api/v1/auth/flarum/login", "application/json", bytes.NewReader(body))
		if err != nil { t.Fatal(err) }
		defer res.Body.Close()
		var result struct { Code string `json:"code"`; User authUser `json:"user"` }
		if err := json.NewDecoder(res.Body).Decode(&result); err != nil { t.Fatal(err) }
		return res.StatusCode, result.Code + result.User.ID
	}
	if status, result := login("submodhub-test", "test-secret"); status != 200 || result != "flarum:test-1" { t.Fatalf("test login: %d %s", status, result) }
	if status, result := login("submodhub-test", "wrong"); status != 401 || result != "invalid_test_credentials" { t.Fatalf("wrong test password: %d %s", status, result) }
	if status, result := login("alice", "secret"); status != 200 || result != "flarum:17" { t.Fatalf("Flarum login: %d %s", status, result) }
	if forumCalls != 1 { t.Fatalf("Flarum called %d times, want 1", forumCalls) }
}

func TestAdminRoleGrantRequiresCSRFAndRefreshesSession(t *testing.T) {
	forum := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/token" {
			var login struct {
				Identification string `json:"identification"`
			}
			_ = json.NewDecoder(r.Body).Decode(&login)
			id := "17"
			if login.Identification == "bob" {
				id = "23"
			}
			_, _ = w.Write([]byte(`{"token":"forum-token","userId":` + id + `}`))
			return
		}
		if r.URL.Path == "/api/users/17" {
			_, _ = w.Write([]byte(`{"data":{"id":"17","attributes":{"username":"alice"},"relationships":{"groups":{"data":[{"id":"16"}]}}}}`))
			return
		}
		if r.URL.Path == "/api/users/23" {
			_, _ = w.Write([]byte(`{"data":{"id":"23","attributes":{"username":"bob"},"relationships":{"groups":{"data":[]}}}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer forum.Close()
	client, err := auth.NewFlarumClient(forum.URL, forum.Client())
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	store, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	store.Flarum = client
	store.AdminGroupIDs = map[string]bool{"16": true, "22": true}
	server := httptest.NewTLSServer(NewStoreHandler(store))
	defer server.Close()
	login := func(name string) (*http.Cookie, string) {
		res, err := server.Client().Post(server.URL+"/api/v1/auth/flarum/login", "application/json", strings.NewReader(`{"identification":"`+name+`","password":"secret"}`))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("login %s status %d", name, res.StatusCode)
		}
		var session authSession
		if err := json.NewDecoder(res.Body).Decode(&session); err != nil {
			t.Fatal(err)
		}
		return res.Cookies()[0], session.CSRF
	}
	adminCookie, adminCSRF := login("alice")
	userCookie, userCSRF := login("bob")
	grant := func(cookie *http.Cookie, csrf, body string) int {
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/admin/users/flarum:23/roles", strings.NewReader(body))
		req.AddCookie(cookie)
		req.Header.Set("X-CSRF-Token", csrf)
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	if got := grant(userCookie, userCSRF, `{"roles":["reviewer"]}`); got != 403 {
		t.Fatalf("non-admin grant status %d", got)
	}
	if got := grant(adminCookie, "invalid", `{"roles":["author"]}`); got != 403 {
		t.Fatalf("wrong CSRF status %d", got)
	}
	if got := grant(adminCookie, adminCSRF, `{"roles":["admin"]}`); got != 400 {
		t.Fatalf("admin escalation status %d", got)
	}
	if got := grant(adminCookie, adminCSRF, `{"roles":["author","reviewer"]}`); got != 200 {
		t.Fatalf("grant status %d", got)
	}
	readGrant := func(cookie *http.Cookie, id string) (int, []string) {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/admin/users/"+id+"/roles", nil)
		req.AddCookie(cookie)
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var current struct { Roles []string `json:"roles"` }
		_ = json.NewDecoder(res.Body).Decode(&current)
		return res.StatusCode, current.Roles
	}
	if status, _ := readGrant(userCookie, "flarum:23"); status != 403 {
		t.Fatalf("non-admin read status %d", status)
	}
	if status, _ := readGrant(adminCookie, "flarum:0"); status != 400 {
		t.Fatalf("invalid target status %d", status)
	}
	if status, roles := readGrant(adminCookie, "flarum:23"); status != 200 || len(roles) != 2 || roles[0] != "author" || roles[1] != "reviewer" {
		t.Fatalf("granted role read %d %+v", status, roles)
	}
	readRoles := func(cookie *http.Cookie) []string {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/session", nil)
		req.AddCookie(cookie)
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var current struct {
			Roles []string `json:"roles"`
		}
		if err := json.NewDecoder(res.Body).Decode(&current); err != nil {
			t.Fatal(err)
		}
		return current.Roles
	}
	if roles := readRoles(userCookie); len(roles) != 3 || roles[1] != "author" || roles[2] != "reviewer" {
		t.Fatalf("granted roles %+v", roles)
	}
	if got := grant(adminCookie, adminCSRF, `{"roles":[]}`); got != 200 {
		t.Fatalf("revoke status %d", got)
	}
	if roles := readRoles(userCookie); len(roles) != 1 || roles[0] != "user" {
		t.Fatalf("revoked roles %+v", roles)
	}
	if status, roles := readGrant(adminCookie, "flarum:23"); status != 200 || len(roles) != 0 {
		t.Fatalf("revoked role read %d %+v", status, roles)
	}
	if got := grant(adminCookie, adminCSRF, `{"roles":["author"]}`); got != 200 {
		t.Fatalf("regrant status %d", got)
	}
	restarted, err := NewStore(dataDir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if got := restarted.Catalog.RoleGrants["flarum:23"]; len(got) != 1 || got[0] != "author" {
		t.Fatalf("persisted grant %+v", got)
	}
}

func TestFlarumLoginRejectsPlainHTTP(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()
	res, err := server.Client().Post(server.URL+"/api/v1/auth/flarum/login", "application/json", bytes.NewReader([]byte(`{"identification":"alice","password":"secret"}`)))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("plain HTTP login status %d", res.StatusCode)
	}
}
