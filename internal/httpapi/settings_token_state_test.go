package httpapi

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/reze/submodhub/internal/delivery"
)

func TestGitHubTokenConfiguredReflectsStorageState(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if configured, encrypted := store.GitHubTokenConfigured(); configured || encrypted {
		t.Fatalf("empty settings reported a token: %v %v", configured, encrypted)
	}

	store.Catalog.Settings.GitHubToken = &githubTokenSecret{Value: "ghp_plain"}
	if configured, encrypted := store.GitHubTokenConfigured(); !configured || encrypted {
		t.Fatalf("plaintext token reported as %v/%v", configured, encrypted)
	}

	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("s", 32)))
	if store.DeliverySecrets, err = delivery.NewSecrets(key); err != nil {
		t.Fatal(err)
	}
	sealed, err := store.sealGitHubTokenLocked("ghp_sealed")
	if err != nil {
		t.Fatal(err)
	}
	store.Catalog.Settings.GitHubToken = sealed
	if configured, encrypted := store.GitHubTokenConfigured(); !configured || !encrypted {
		t.Fatalf("sealed token reported as %v/%v", configured, encrypted)
	}

	// Clearing the field must look identical to never having set one.
	store.Catalog.Settings.GitHubToken = nil
	if configured, _ := store.GitHubTokenConfigured(); configured {
		t.Fatal("cleared settings still report a token")
	}
}
