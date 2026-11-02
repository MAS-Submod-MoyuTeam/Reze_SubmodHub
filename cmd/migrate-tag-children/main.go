// Command migrate-tag-children is a one-off data migration for the tag-catalog
// shape change: a child tag used to be a bare string ("绘图") and is now a
// {name, description} object. The server decodes the stored catalog into the new
// shape, so a snapshot written by the old build no longer loads and the backend
// refuses to start until the document is converted.
//
// The conversion invents nothing: a string child becomes {"name": <string>} with
// no description, which is exactly what the old catalog meant. The script is
// idempotent — running it twice reports zero changes — and it never touches mod
// tags, which were already flat names at both levels.
//
// It reads the same metadata location the server reads: POSTGRES_DSN selects the
// catalog_snapshot row, otherwise SUBMODHUB_DATA_DIR/catalog.json. The original
// document is written to -backup before anything is replaced, because the test
// instance's data has to stay restorable.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "report the conversion without writing anything")
	backupPath := flag.String("backup", "catalog-snapshot.backup.json", "write the original document here before rewriting it (empty disables the backup)")
	flag.Parse()

	if dsn := os.Getenv("POSTGRES_DSN"); dsn != "" {
		if err := migratePostgres(dsn, *dryRun, *backupPath); err != nil {
			fail(err.Error())
		}
		return
	}
	dataDir := os.Getenv("SUBMODHUB_DATA_DIR")
	if dataDir == "" {
		fail("POSTGRES_DSN or SUBMODHUB_DATA_DIR is required")
	}
	if err := migrateLocal(filepath.Join(dataDir, "catalog.json"), *dryRun, *backupPath); err != nil {
		fail(err.Error())
	}
}

func migratePostgres(dsn string, dryRun bool, backupPath string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("cannot connect to postgres: %w", err)
	}
	defer conn.Close(ctx)

	var document []byte
	err = conn.QueryRow(ctx, "SELECT document FROM catalog_snapshot WHERE id = 1").Scan(&document)
	if errors.Is(err, pgx.ErrNoRows) {
		fmt.Println("catalog_snapshot is empty: nothing to migrate")
		return nil
	}
	if err != nil {
		return fmt.Errorf("cannot read catalog_snapshot: %w", err)
	}

	updated, converted, err := migrateCatalogDocument(document)
	if err != nil {
		return err
	}
	if converted == 0 {
		fmt.Println("tag children already use the object shape: nothing to migrate")
		return nil
	}
	if dryRun {
		fmt.Printf("dry run: %d string tag children would be converted; snapshot left untouched\n", converted)
		return nil
	}
	if backupPath != "" {
		if err := os.WriteFile(backupPath, document, 0o640); err != nil {
			return fmt.Errorf("cannot write backup: %w", err)
		}
	}
	if _, err := conn.Exec(ctx, "UPDATE catalog_snapshot SET document = $1 WHERE id = 1", updated); err != nil {
		return fmt.Errorf("cannot write catalog_snapshot: %w", err)
	}
	fmt.Printf("%d string tag children converted; restart the backend so it reloads the snapshot\n", converted)
	return nil
}

func migrateLocal(path string, dryRun bool, backupPath string) error {
	document, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		fmt.Println("no catalog.json: nothing to migrate")
		return nil
	}
	if err != nil {
		return fmt.Errorf("cannot read %s: %w", path, err)
	}

	updated, converted, err := migrateCatalogDocument(document)
	if err != nil {
		return err
	}
	if converted == 0 {
		fmt.Println("tag children already use the object shape: nothing to migrate")
		return nil
	}
	if dryRun {
		fmt.Printf("dry run: %d string tag children would be converted; %s left untouched\n", converted, path)
		return nil
	}
	if backupPath != "" {
		if err := os.WriteFile(backupPath, document, 0o640); err != nil {
			return fmt.Errorf("cannot write backup: %w", err)
		}
	}
	// Same write-the-temporary-then-rename dance the server uses, so an
	// interrupted run cannot leave a half-written catalog behind.
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, updated, 0o640); err != nil {
		return fmt.Errorf("cannot write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("cannot replace %s: %w", path, err)
	}
	fmt.Printf("%d string tag children converted in %s\n", converted, path)
	return nil
}

// migrateCatalogDocument rewrites settings.tag_catalog so every child is a
// {name, description} object, and reports how many string children it converted.
// A document that is already in the new shape is returned unchanged, so a
// repeated run cannot rewrite or reorder anything.
func migrateCatalogDocument(document []byte) ([]byte, int, error) {
	var root map[string]any
	decoder := json.NewDecoder(bytes.NewReader(document))
	// Settings and mod data share this document; keeping numbers exact means the
	// revision counter survives the round trip untouched.
	decoder.UseNumber()
	if err := decoder.Decode(&root); err != nil {
		return nil, 0, fmt.Errorf("snapshot is not a JSON object: %w", err)
	}

	settings, ok := root["settings"].(map[string]any)
	if !ok {
		return document, 0, nil
	}
	groups, ok := settings["tag_catalog"].([]any)
	if !ok {
		return document, 0, nil
	}

	converted := 0
	for groupIndex, rawGroup := range groups {
		group, ok := rawGroup.(map[string]any)
		if !ok {
			return nil, 0, fmt.Errorf("tag_catalog[%d] is not an object", groupIndex)
		}
		children, ok := group["children"].([]any)
		if !ok {
			continue
		}
		// nil keeps "no children" as an omitted key instead of an empty array.
		var rewritten []any
		for childIndex, rawChild := range children {
			switch child := rawChild.(type) {
			case string:
				rewritten = append(rewritten, map[string]any{"name": child})
				converted++
			case map[string]any:
				rewritten = append(rewritten, child)
			default:
				return nil, 0, fmt.Errorf("tag_catalog[%d].children[%d] is neither a string nor an object", groupIndex, childIndex)
			}
		}
		if rewritten == nil {
			delete(group, "children")
			continue
		}
		group["children"] = rewritten
	}
	if converted == 0 {
		return document, 0, nil
	}

	// Indented to match what the server writes back, so the backup and the live
	// document stay diffable by eye.
	updated, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return nil, 0, fmt.Errorf("cannot encode the migrated snapshot: %w", err)
	}
	return updated, converted, nil
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
