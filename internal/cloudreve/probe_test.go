package cloudreve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeleteObjectRequiresExactIdentityAndConfirmsAbsence(t *testing.T) {
	deleted := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/user/session":
			fmt.Fprint(w, `{"code":0}`)
		case r.Method == "DELETE" && r.URL.Path == "/object":
			var body struct {
				Items []string `json:"items"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if len(body.Items) != 1 || body.Items[0] != "own-id" {
				t.Error("wrong object deleted")
			}
			deleted = true
			fmt.Fprint(w, `{"code":0}`)
		case r.Method == "GET":
			if deleted {
				fmt.Fprint(w, `{"code":0,"data":{"objects":[]}}`)
			} else {
				fmt.Fprint(w, `{"code":0,"data":{"objects":[{"id":"own-id","name":"unique-probe.zip","size":42,"type":"file"}]}}`)
			}
		}
	}))
	defer srv.Close()
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})
	wrong := Object{ID: "other", Name: "unique-probe.zip", Size: 42, Type: "file"}
	if err := c.DeleteCreatedObject(context.Background(), "/project", wrong); err == nil || deleted {
		t.Fatal("deleted different identity")
	}
	if err := c.DeleteCreatedObject(context.Background(), "/project", Object{ID: "own-id", Name: "unique-probe.zip", Size: 42, Type: "file"}); err != nil || !deleted {
		t.Fatalf("delete: %v", err)
	}
}
