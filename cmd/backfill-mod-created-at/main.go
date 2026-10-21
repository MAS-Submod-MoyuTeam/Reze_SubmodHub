package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/reze/submodhub/internal/httpapi"
)

// backfill-mod-created-at is a one-off data migration: it stamps created_at on
// mods stored before the field existed, so the author workspace can page by
// strict creation order. Run it once against the target backend before
// deploying the service that reads the field.
func main() {
	flag.Parse()
	var (
		store *httpapi.Store
		err   error
	)
	if dsn := os.Getenv("POSTGRES_DSN"); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		store, err = httpapi.NewPostgresStore(ctx, dsn, os.Getenv("SUBMODHUB_DATA_DIR"), httpapi.Catalog{})
	} else {
		if os.Getenv("SUBMODHUB_DATA_DIR") == "" {
			fail("POSTGRES_DSN or SUBMODHUB_DATA_DIR is required")
		}
		store, err = httpapi.NewStore(os.Getenv("SUBMODHUB_DATA_DIR"), httpapi.Catalog{})
	}
	if err != nil {
		fail("cannot open metadata store: " + err.Error())
	}
	defer store.Close()
	stamped, err := store.BackfillModCreatedAt(time.Now().UTC())
	if err != nil {
		fail("mod created_at backfill failed: " + err.Error())
	}
	fmt.Printf("mod created_at backfilled: %d\n", stamped)
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
