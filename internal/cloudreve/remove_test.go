package cloudreve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// fakeDirectory is the smallest provider that supports retention: it lists the
// project directory and deletes by object ID.
type fakeDirectory struct {
	objects    []Object
	deleted    []string
	keepDelete bool
	listError  bool
	deletes    int
}

func (f *fakeDirectory) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "session"):
			fmt.Fprint(w, `{"code":0}`)
		case r.Method == "GET" && r.URL.Path == "/directory/SubmodHub":
			if f.listError {
				fmt.Fprint(w, `{"code":500}`)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"objects": f.objects, "policy": map[string]any{"id": "p", "type": "local"}}})
		case r.Method == "DELETE" && r.URL.Path == "/object":
			var payload struct {
				Items []string `json:"items"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Items) == 0 {
				t.Errorf("delete payload: %v %+v", err, payload)
			}
			f.deletes++
			if f.keepDelete {
				fmt.Fprint(w, `{"code":0}`)
				return
			}
			f.deleted = append(f.deleted, payload.Items...)
			f.objects = slices.DeleteFunc(f.objects, func(o Object) bool { return slices.Contains(payload.Items, o.ID) })
			fmt.Fprint(w, `{"code":0}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			fmt.Fprint(w, `{"code":404}`)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestRemoveObjectsDeletesOnlyTheListedIDsAndConfirms(t *testing.T) {
	dir := &fakeDirectory{objects: []Object{
		{ID: "old", Name: "app-v1-abc-old.exe", Type: "file", Size: 10},
		{ID: "keep", Name: "app-v2-def-new.exe", Type: "file", Size: 10},
	}}
	srv := dir.server(t)
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})
	if err := c.RemoveObjects(context.Background(), "/SubmodHub", []string{"old", "old"}); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if !slices.Equal(dir.deleted, []string{"old"}) || dir.deletes != 1 {
		t.Fatalf("deletion must be deduplicated and ID-scoped: %+v calls=%d", dir.deleted, dir.deletes)
	}
	if len(dir.objects) != 1 || dir.objects[0].ID != "keep" {
		t.Fatalf("wrong object removed: %+v", dir.objects)
	}
}

// A provider that reports success but keeps the object must not be believed: the
// caller would otherwise record a deletion that never happened.
func TestRemoveObjectsFailsWhenTheObjectSurvives(t *testing.T) {
	dir := &fakeDirectory{
		objects:    []Object{{ID: "old", Name: "app-v1-abc-old.exe", Type: "file", Size: 10}},
		keepDelete: true,
	}
	srv := dir.server(t)
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})
	err := c.RemoveObjects(context.Background(), "/SubmodHub", []string{"old"})
	if err == nil || err.Error() != "cloudreve_cleanup_not_confirmed" {
		t.Fatalf("unconfirmed deletion must fail: %v", err)
	}
}

func TestRemoveObjectsRejectsUnownedInputBeforeTouchingTheProvider(t *testing.T) {
	dir := &fakeDirectory{}
	srv := dir.server(t)
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})
	for _, tc := range []struct {
		name      string
		directory string
		ids       []string
	}{
		{"empty ids", "/SubmodHub", nil},
		{"relative directory", "SubmodHub", []string{"a"}},
		{"path in id", "/SubmodHub", []string{"a/b"}},
		{"blank id", "/SubmodHub", []string{""}},
	} {
		if err := c.RemoveObjects(context.Background(), tc.directory, tc.ids); err == nil || err.Error() != "cloudreve_cleanup_identity_invalid" {
			t.Fatalf("%s: unexpected error %v", tc.name, err)
		}
	}
	if dir.deletes != 0 {
		t.Fatalf("invalid input reached the provider: %d deletes", dir.deletes)
	}
}
