package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/auth"
	"github.com/reze/submodhub/internal/delivery"
	"github.com/reze/submodhub/internal/httpapi"
	"github.com/reze/submodhub/internal/version"
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
	if key := os.Getenv("SUBMODHUB_DELIVERY_MASTER_KEY"); key != "" {
		store.DeliverySecrets, err = delivery.NewSecrets(key)
		if err != nil {
			log.Fatal("invalid SUBMODHUB_DELIVERY_MASTER_KEY: expected base64 encoded 32 bytes")
		}
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

	// GitHub access is demand-driven: the background poller is off unless an
	// operator asks for it, and stale mods are refreshed when someone actually
	// looks at them. The API token lives in the admin settings page so it can be
	// rotated without redeploying; it lifts the anonymous 60 requests/hour quota
	// to 5000 requests/hour.
	if configured, encrypted := store.GitHubTokenConfigured(); configured {
		if encrypted {
			log.Printf("GitHub API token loaded from settings (encrypted, 5000 requests/hour)")
		} else {
			log.Printf("GitHub API token loaded from settings (plaintext, 5000 requests/hour); configure SUBMODHUB_DELIVERY_MASTER_KEY to encrypt it")
		}
	} else {
		log.Printf("No GitHub API token in settings: requests share the anonymous 60 requests/hour quota (set one in the admin settings page)")
	}

	// The window is owned by the admin settings page and falls back to a
	// 60-minute default. A non-empty GITHUB_SYNC_MAX_AGE is a deployment-level
	// lock; the settings API reports that lock and rejects window edits.
	store.ApplyGitHubSyncMaxAgeSetting()
	if raw := strings.TrimSpace(os.Getenv("GITHUB_SYNC_MAX_AGE")); raw != "" {
		parsed, parseErr := time.ParseDuration(raw)
		if parseErr != nil {
			log.Printf("Invalid GITHUB_SYNC_MAX_AGE=%q, keeping the configured window: %v", raw, parseErr)
		} else {
			store.GitHubSyncMaxAgeOverride = &parsed
			store.GitHubSyncMaxAge = parsed
			log.Printf("GITHUB_SYNC_MAX_AGE=%q overrides the stored settings window for this process", raw)
		}
	}
	store.StartGitHubSync()
	if maxAge := store.GitHubSyncMaxAge; maxAge > 0 {
		log.Printf("GitHub Releases refresh window: %s (a mod unchecked for longer is refreshed on view or by the sweep)", maxAge)
	} else {
		log.Printf("GitHub Releases automatic refresh disabled: only explicit sync refreshes mods")
	}

	store.StartDeliveryMetricsWorker(context.Background())
	store.StartDeliveryWorker(context.Background())
	log.Printf("SubmodHub API %s listening on %s", version.Current().String(), addr)
	log.Fatal(http.ListenAndServe(addr, httpapi.NewStoreHandler(store)))
}
