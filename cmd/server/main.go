package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/reze/submodhub/internal/auth"
	"github.com/reze/submodhub/internal/httpapi"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		client := &http.Client{Timeout: 2 * time.Second}
		resp, err := client.Get("http://127.0.0.1:8080/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		resp.Body.Close()
		return
	}
	catalog := httpapi.Catalog{Mods: []httpapi.Mod{}, Versions: map[string]httpapi.Version{}}
	addr := os.Getenv("SUBMODHUB_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	dataDir := os.Getenv("SUBMODHUB_DATA_DIR")
	var store *httpapi.Store
	var err error
	if dsn := os.Getenv("POSTGRES_DSN"); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		store, err = httpapi.NewPostgresStore(ctx, dsn, dataDir, catalog)
	} else {
		store, err = httpapi.NewStore(dataDir, catalog)
	}
	if err != nil {
		log.Fatal(err)
	}
	store.UploadToken = os.Getenv("SUBMODHUB_UPLOAD_TOKEN")
	store.AutoPublish = os.Getenv("SUBMODHUB_AUTO_PUBLISH") == "true"
	store.TestMode = os.Getenv("SUBMODHUB_TEST_MODE") == "true"
	store.TestUsername = os.Getenv("SUBMODHUB_TEST_USERNAME")
	store.TestPassword = os.Getenv("SUBMODHUB_TEST_PASSWORD")
	if store.TestMode {
		if store.TestUsername == "" {
			store.TestUsername = "submodhub-test"
		}
		if store.TestPassword == "" {
			store.TestPassword = "submodhub-test"
		}
	}
	if forumURL := os.Getenv("FLARUM_URL"); forumURL != "" {
		store.Flarum, err = auth.NewFlarumClient(forumURL, nil)
		if err != nil {
			log.Fatal(err)
		}
		store.AdminGroupIDs = auth.ParseGroupIDs(os.Getenv("ADMIN_FLARUM_GROUP_IDS"))
	}

	syncIntervalStr := os.Getenv("GITHUB_SYNC_INTERVAL")
	var syncInterval time.Duration = 15 * time.Minute
	if syncIntervalStr == "0" {
		syncInterval = 0
		log.Printf("GitHub Releases background sync disabled (GITHUB_SYNC_INTERVAL=0)")
	} else if syncIntervalStr != "" {
		parsed, parseErr := time.ParseDuration(syncIntervalStr)
		if parseErr != nil {
			log.Printf("Invalid GITHUB_SYNC_INTERVAL=%q, falling back to 15m default: %v", syncIntervalStr, parseErr)
		} else {
			syncInterval = parsed
		}
	}
	store.GitHubSyncInterval = syncInterval
	if store.GitHubSyncInterval > 0 {
		store.StartGitHubSync()
		log.Printf("GitHub Releases background sync started (interval: %s)", store.GitHubSyncInterval)
	}

	log.Printf("SubmodHub API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, httpapi.NewStoreHandler(store)))
}
