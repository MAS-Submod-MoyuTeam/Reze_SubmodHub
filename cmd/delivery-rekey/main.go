package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/reze/submodhub/internal/delivery"
	"github.com/reze/submodhub/internal/httpapi"
)

func main() {
	confirmed := flag.Bool("confirm-offline-backup", false, "confirm API is stopped and metadata and both keys are backed up")
	flag.Parse()
	if !*confirmed {
		fmt.Fprintln(os.Stderr, "stop API and back up metadata and keys, then pass -confirm-offline-backup")
		os.Exit(2)
	}
	old, err := delivery.NewSecrets(os.Getenv("SUBMODHUB_DELIVERY_MASTER_KEY"))
	if err != nil {
		fail("old master key invalid")
	}
	next, err := delivery.NewSecrets(os.Getenv("SUBMODHUB_DELIVERY_NEW_MASTER_KEY"))
	if err != nil {
		fail("new master key invalid")
	}
	var store *httpapi.Store
	if dsn := os.Getenv("POSTGRES_DSN"); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		store, err = httpapi.NewPostgresStore(ctx, dsn, os.Getenv("SUBMODHUB_DATA_DIR"), httpapi.Catalog{})
	} else {
		if os.Getenv("SUBMODHUB_DATA_DIR") == "" {
			fail("SUBMODHUB_DATA_DIR required")
		}
		store, err = httpapi.NewStore(os.Getenv("SUBMODHUB_DATA_DIR"), httpapi.Catalog{})
	}
	if err != nil {
		fail("cannot open metadata store")
	}
	defer store.Close()
	store.DeliverySecrets = old
	if err = store.ReencryptDeliveryCredentials(next); err != nil {
		fail(err.Error())
	}
	fmt.Println("credentials re-encrypted; configure new deployment master key before starting API")
}
func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
