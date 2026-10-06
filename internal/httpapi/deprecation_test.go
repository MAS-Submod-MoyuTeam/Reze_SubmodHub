package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAuthorCanClearVersionDeprecation(t *testing.T) {
	dir := t.TempDir()
	store, err := NewStore(dir, Catalog{
		Mods: []Mod{{ID: "mod_1", Author: Author{ID: "author"}, LatestVersionID: "ver_1"}},
		Versions: map[string]Version{"ver_1": {ID: "ver_1", ModID: "mod_1", State: "published", Deprecated: true, DeprecationReason: "old version"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	ownerToken := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	otherToken := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	adminToken := "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	store.sessions[sessionKey(ownerToken)] = authSession{User: authUser{ID: "author"}, Expires: time.Now().Add(time.Hour)}
	store.sessions[sessionKey(otherToken)] = authSession{User: authUser{ID: "other"}, Expires: time.Now().Add(time.Hour)}
	store.sessions[sessionKey(adminToken)] = authSession{User: authUser{ID: "admin"}, Roles: []string{"admin"}, Expires: time.Now().Add(time.Hour)}
	server := httptest.NewServer(NewStoreHandler(store))
	defer server.Close()
	call := func(token string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(http.MethodDelete, server.URL+"/api/v1/versions/ver_1/deprecate", nil)
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: token})
		}
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	for _, test := range []struct {
		token string
		want  int
	}{{"", http.StatusUnauthorized}, {otherToken, http.StatusForbidden}} {
		res := call(test.token)
		res.Body.Close()
		if res.StatusCode != test.want || !store.Catalog.Versions["ver_1"].Deprecated {
			t.Fatalf("unauthorized clear: status=%d version=%+v", res.StatusCode, store.Catalog.Versions["ver_1"])
		}
	}
	res := call(ownerToken)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("owner clear status %d", res.StatusCode)
	}
	var version Version
	if err := json.NewDecoder(res.Body).Decode(&version); err != nil {
		t.Fatal(err)
	}
	if version.Deprecated || version.DeprecationReason != "" {
		t.Fatalf("deprecation not cleared in response: %+v", version)
	}
	reloaded, err := NewStore(dir, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.Catalog.Versions["ver_1"]; got.Deprecated || got.DeprecationReason != "" {
		t.Fatalf("deprecation not cleared in storage: %+v", got)
	}
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/versions/ver_1/deprecate", bytes.NewBufferString(`{"reason":"still old"}`))
	req.AddCookie(&http.Cookie{Name: "submodhub_session", Value: ownerToken})
	res, err = server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !store.Catalog.Versions["ver_1"].Deprecated {
		t.Fatalf("cannot mark again: status=%d", res.StatusCode)
	}
	res = call(adminToken)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || store.Catalog.Versions["ver_1"].Deprecated {
		t.Fatalf("admin cannot clear mark: status=%d", res.StatusCode)
	}
}
