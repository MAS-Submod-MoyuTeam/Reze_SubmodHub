package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFlarumLoginUsesTokenThenProfile(t *testing.T) {
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		switch r.URL.Path {
		case "/api/token":
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if r.Method != http.MethodPost || body["identification"] != "alice" || body["password"] != "secret" {
				t.Fatalf("bad token request: %v", body)
			}
			_, _ = w.Write([]byte(`{"token":"forum-secret-token","userId":17}`))
		case "/api/users/17":
			if r.Header.Get("Authorization") != "Token forum-secret-token" {
				t.Fatal("missing Flarum token")
			}
			_, _ = w.Write([]byte(`{"data":{"id":"17","attributes":{"username":"alice","displayName":"Alice"},"relationships":{"groups":{"data":[{"id":"16"}]}}},"included":[{"type":"groups","id":"16","attributes":{"nameSingular":"Admins"}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := NewFlarumClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	profile, err := client.Login(context.Background(), "alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if profile.ID != "17" || profile.Username != "alice" || len(profile.Groups) != 1 || profile.Groups[0].Name != "Admins" {
		t.Fatalf("bad profile: %+v", profile)
	}
	if strings.Join(calls, ",") != "/api/token,/api/users/17" {
		t.Fatalf("calls: %v", calls)
	}
	serialized, _ := json.Marshal(profile)
	if strings.Contains(string(serialized), "secret") || strings.Contains(string(serialized), "forum-secret-token") {
		t.Fatal("credentials leaked into profile")
	}
}

func TestFlarumRejectsFailedAuthenticationWithoutLeakingCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "forum-secret-token", http.StatusUnauthorized)
	}))
	defer server.Close()
	client, err := NewFlarumClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Login(context.Background(), "alice", "secret")
	if err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "forum-secret-token") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestFlarumRejectsInsecurePublicURL(t *testing.T) {
	if _, err := NewFlarumClient("http://forum.monika.love", http.DefaultClient); err == nil {
		t.Fatal("accepted plaintext credentials over HTTP")
	}
}

func TestOnlyConfiguredFlarumGroupIDsGrantAdmin(t *testing.T) {
	adminIDs := map[string]bool{"16": true, "22": true}
	for _, tc := range []struct{ groupID, want string }{
		{"16", "admin"}, {"22", "admin"}, {"9", "user"}, {"", "user"},
	} {
		profile := FlarumProfile{Groups: []FlarumGroup{{ID: tc.groupID, Name: "管理员组"}}}
		if got := RoleForFlarum(profile, adminIDs); got != tc.want {
			t.Errorf("group %q: got %q want %q", tc.groupID, got, tc.want)
		}
	}
}

func TestFlarumDoesNotForwardCredentialsToRedirectHost(t *testing.T) {
	forwarded := false
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		forwarded = true
	}))
	defer other.Close()
	forum := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
	}))
	defer forum.Close()
	client, err := NewFlarumClient(forum.URL, forum.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, _ = client.Login(context.Background(), "alice", "secret")
	if forwarded {
		t.Fatal("credentials forwarded to another host")
	}
}

// RoleForGroupIDs is evaluated per request against the deployment's current
// whitelist, so a cached group list must map differently when the whitelist
// changes. This is what makes forum group changes take effect without relogin.
func TestRoleForGroupIDsFollowsCurrentWhitelist(t *testing.T) {
	groups := []string{"1", "21"}
	for _, tc := range []struct {
		name  string
		admin map[string]bool
		want  string
	}{
		{"whitelist excludes both", map[string]bool{"16": true, "22": true}, "user"},
		{"whitelist covers site owner", map[string]bool{"1": true, "16": true, "17": true, "21": true}, "admin"},
		{"whitelist covers hidden backend group", map[string]bool{"1": true}, "admin"},
		{"empty whitelist", map[string]bool{}, "user"},
		{"nil whitelist", nil, "user"},
	} {
		if got := RoleForGroupIDs(groups, tc.admin); got != tc.want {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
}

func TestRoleForGroupIDsIgnoresEmptyAndUnknownGroups(t *testing.T) {
	if got := RoleForGroupIDs([]string{"", "999"}, map[string]bool{"999": false, "16": true}); got != "user" {
		t.Fatalf("got %q want user", got)
	}
	if got := RoleForGroupIDs(nil, map[string]bool{"16": true}); got != "user" {
		t.Fatalf("got %q want user", got)
	}
}

func TestRoleForFlarumDelegatesToGroupIDs(t *testing.T) {
	profile := FlarumProfile{Groups: []FlarumGroup{{ID: "1", Name: "维护人员"}, {ID: "21", Name: "站长"}}}
	if got := RoleForFlarum(profile, map[string]bool{"21": true}); got != "admin" {
		t.Fatalf("got %q want admin", got)
	}
	if got := RoleForFlarum(profile, map[string]bool{"16": true}); got != "user" {
		t.Fatalf("got %q want user", got)
	}
}

func TestParseGroupIDs(t *testing.T) {
	got := ParseGroupIDs("16, 22， 22; ")
	if len(got) != 2 || !got["16"] || !got["22"] {
		t.Fatalf("IDs: %v", got)
	}
}
