package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/httpapi"
)

// The migration exists for one documented failure: a snapshot whose child tags
// are still strings cannot be decoded by the current server. The conversion has
// to keep every name, keep their order, and add no description of its own.
func TestMigrateCatalogDocumentConvertsStringChildren(t *testing.T) {
	document := []byte(`{
  "mods": [{"id": "m1", "tags": ["工具", "绘图"]}],
  "versions": {},
  "settings": {
    "tag_catalog": [
      {"name": "工具", "children": ["绘图", "脚本"]},
      {"name": "音乐", "children": []},
      {"name": "杂项"}
    ],
    "revision": 7
  }
}`)

	updated, converted, err := migrateCatalogDocument(document)
	if err != nil {
		t.Fatalf("migrate = %v", err)
	}
	if converted != 2 {
		t.Fatalf("converted = %d, want 2", converted)
	}

	var root struct {
		Mods []struct {
			ID   string   `json:"id"`
			Tags []string `json:"tags"`
		} `json:"mods"`
		Settings struct {
			TagCatalog []struct {
				Name        string          `json:"name"`
				Description string          `json:"description"`
				Children    json.RawMessage `json:"children"`
			} `json:"tag_catalog"`
			Revision uint64 `json:"revision"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(updated, &root); err != nil {
		t.Fatalf("migrated document does not decode: %v\n%s", err, updated)
	}

	if len(root.Mods) != 1 || len(root.Mods[0].Tags) != 2 {
		t.Fatalf("mod tags must not be touched: %+v", root.Mods)
	}
	if root.Settings.Revision != 7 {
		t.Fatalf("revision = %d, want 7", root.Settings.Revision)
	}

	var children []httpapi.TagChild
	if err := json.Unmarshal(root.Settings.TagCatalog[0].Children, &children); err != nil {
		t.Fatalf("children are not the object shape: %v (%s)", err, root.Settings.TagCatalog[0].Children)
	}
	if len(children) != 2 || children[0].Name != "绘图" || children[1].Name != "脚本" {
		t.Fatalf("children = %+v, want 绘图, 脚本 in order", children)
	}
	if children[0].Description != "" {
		t.Fatalf("migration must not invent a description, got %q", children[0].Description)
	}

	// An empty child list stays absent rather than becoming a stored empty array.
	if raw := string(root.Settings.TagCatalog[1].Children); raw != "null" && raw != "" {
		t.Fatalf("empty children should stay omitted, got %q", raw)
	}
}

// A catalog that was already migrated has to come back byte-identical: the
// script may be run against every deployment, including ones that are current.
func TestMigrateCatalogDocumentIsIdempotent(t *testing.T) {
	document := []byte(`{"settings":{"tag_catalog":[{"name":"工具","description":"自动修复","children":[{"name":"绘图","description":"生成图片"}]}],"revision":3},"mods":[],"versions":{}}`)

	updated, converted, err := migrateCatalogDocument(document)
	if err != nil {
		t.Fatalf("migrate = %v", err)
	}
	if converted != 0 {
		t.Fatalf("converted = %d, want 0", converted)
	}
	if string(updated) != string(document) {
		t.Fatalf("a current snapshot was rewritten:\n%s", updated)
	}
}

func TestMigrateCatalogDocumentRejectsUnknownChildShape(t *testing.T) {
	document := []byte(`{"settings":{"tag_catalog":[{"name":"工具","children":[42]}]}}`)
	if _, _, err := migrateCatalogDocument(document); err == nil {
		t.Fatal("a child that is neither a string nor an object must be reported, not dropped")
	}
}

func TestMigrateCatalogDocumentToleratesDocumentWithoutCatalog(t *testing.T) {
	for _, document := range []string{
		`{"mods":[],"versions":{}}`,
		`{"settings":{"tag_catalog":null}}`,
	} {
		updated, converted, err := migrateCatalogDocument([]byte(document))
		if err != nil {
			t.Fatalf("migrate %s = %v", document, err)
		}
		if converted != 0 || string(updated) != document {
			t.Fatalf("unexpected rewrite of %s: %d %s", document, converted, updated)
		}
	}
}

// End to end on the file-backed store: the old snapshot must fail to load with
// an error that names this command, and the migrated one must serve the object
// shape from the public catalog endpoint.
func TestMigratedLocalCatalogLoads(t *testing.T) {
	dataDir := t.TempDir()
	old := []byte(`{"mods":[],"versions":{},"settings":{"tag_catalog":[{"name":"工具","children":["绘图"]}],"revision":0}}`)
	path := filepath.Join(dataDir, "catalog.json")
	if err := os.WriteFile(path, old, 0o640); err != nil {
		t.Fatal(err)
	}

	if _, err := httpapi.NewStore(dataDir, httpapi.Catalog{}); err == nil {
		t.Fatal("the old snapshot should not load before the migration")
	} else if !strings.Contains(err.Error(), "migrate-tag-children") {
		t.Fatalf("decode failure must point at the migration, got %q", err)
	}

	if err := migrateLocal(path, false, filepath.Join(dataDir, "backup.json")); err != nil {
		t.Fatalf("migrateLocal = %v", err)
	}
	if backup, err := os.ReadFile(filepath.Join(dataDir, "backup.json")); err != nil || string(backup) != string(old) {
		t.Fatalf("the original document must be recoverable from the backup (err=%v)", err)
	}

	store, err := httpapi.NewStore(dataDir, httpapi.Catalog{})
	if err != nil {
		t.Fatalf("migrated snapshot does not load: %v", err)
	}
	server := httptest.NewServer(httpapi.NewStoreHandler(store))
	defer server.Close()

	res, err := server.Client().Get(server.URL + "/api/v1/tags")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var payload struct {
		Groups []struct {
			Name     string             `json:"name"`
			Children []httpapi.TagChild `json:"children"`
		} `json:"groups"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Groups) != 1 || payload.Groups[0].Name != "工具" {
		t.Fatalf("groups = %+v", payload.Groups)
	}
	if len(payload.Groups[0].Children) != 1 || payload.Groups[0].Children[0].Name != "绘图" {
		t.Fatalf("children = %+v", payload.Groups[0].Children)
	}
}
