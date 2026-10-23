package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

func platformAssetName() string {
	targetOS, targetArch := CurrentPlatform()
	switch targetOS {
	case "windows":
		return "submodhub-windows-" + targetArch + ".exe"
	case "android":
		return "submodhub-android-" + targetArch + ".apk"
	case "darwin":
		return "submodhub-darwin-" + targetArch + ".zip"
	default:
		return "submodhub-linux-" + targetArch + ".tar.gz"
	}
}

// updateFixture serves the API descriptor, the Cloudreve delivery bytes, and a
// GitHub release, so the update-check authority and its fallback can be compared.
type updateFixture struct {
	payload        []byte
	hash           string
	helperPayload  []byte
	helperHash     string
	deliveryCode   int
	expiresAt      time.Time
	deliveryHits   atomic.Int32
	githubHits     atomic.Int32
	api            *httptest.Server
	gh             *httptest.Server
	deliveryPath   string
	descriptorHits atomic.Int32
	// Knobs for the fallback and staleness tests.
	snapshotAgeSeconds int64
	omitPlatformAsset  bool
	githubListCode     int
	apiStatus          int
}

func newUpdateFixture(t *testing.T) *updateFixture {
	t.Helper()
	f := &updateFixture{
		payload:       []byte("update-binary"),
		helperPayload: []byte("updater-binary"),
		deliveryCode:  http.StatusOK,
		expiresAt:     time.Now().Add(5 * time.Minute),
		deliveryPath:  "/blob",
	}
	sum := sha256.Sum256(f.payload)
	f.hash = hex.EncodeToString(sum[:])
	helperSum := sha256.Sum256(f.helperPayload)
	f.helperHash = hex.EncodeToString(helperSum[:])
	f.api = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/app-update":
			f.descriptorHits.Add(1)
			if f.apiStatus != 0 {
				http.Error(w, "descriptor unavailable", f.apiStatus)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(f.descriptor())
		case f.deliveryPath:
			f.deliveryHits.Add(1)
			if f.deliveryCode != http.StatusOK {
				http.Error(w, "provider unavailable", f.deliveryCode)
				return
			}
			w.Write(f.payload)
		default:
			http.NotFound(w, r)
		}
	}))
	f.gh = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/repos/"+DefaultRepoOwner+"/"+DefaultRepoName+"/releases":
			if f.githubListCode != 0 {
				http.Error(w, "github unavailable", f.githubListCode)
				return
			}
			json.NewEncoder(w).Encode([]map[string]any{{
				"tag_name": "v99.0.0",
				"name":     "newer than the API",
				"assets": []map[string]any{{
					"id":                   1,
					"name":                 platformAssetName(),
					"size":                 len(f.payload),
					"browser_download_url": f.gh.URL + "/github-asset",
				}},
			}})
		case r.URL.Path == "/github-asset":
			f.githubHits.Add(1)
			w.Write(f.payload)
		case r.URL.Path == "/github-helper":
			w.Write(f.helperPayload)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.api.Close)
	t.Cleanup(f.gh.Close)
	return f
}

func (f *updateFixture) descriptor() map[string]any {
	asset := map[string]any{
		"name":                     platformAssetName(),
		"size_bytes":               len(f.payload),
		"sha256":                   f.hash,
		"delivery_type":            "cloudreve",
		"node_id":                  "cloud-1",
		"url":                      f.api.URL + f.deliveryPath,
		"expires_at":               f.expiresAt.UTC().Format(time.RFC3339),
		"allowed_download_origins": []string{},
		"github_url":               f.gh.URL + "/github-asset",
	}
	helper := map[string]any{
		"name":          "updater.exe",
		"size_bytes":    len(f.helperPayload),
		"sha256":        f.helperHash,
		"delivery_type": "github",
		"url":           f.gh.URL + "/github-helper",
		"github_url":    f.gh.URL + "/github-helper",
	}
	assets := []any{helper}
	if !f.omitPlatformAsset {
		assets = append(assets, asset)
	}
	return map[string]any{
		"tag_name":             "v9.9.9",
		"version":              "9.9.9",
		"name":                 "RezeHub 9.9.9",
		"notes":                "release notes",
		"assets":               assets,
		"snapshot_age_seconds": f.snapshotAgeSeconds,
	}
}

func newFixtureService(t *testing.T, f *updateFixture, apiBase string) *Service {
	t.Helper()
	service, err := NewService(Config{
		CacheDir:        t.TempDir(),
		CurrentVersion:  "0.9.11",
		APIBaseURL:      apiBase,
		DownloadTimeout: 30 * time.Second,
	}, stateTestInstaller(false))
	if err != nil {
		t.Fatal(err)
	}
	service.ghClient = github.NewClient(github.WithBaseURL(f.gh.URL), github.WithAllowInsecureTestHosts(true))
	return service
}

func TestCheckForUpdateUsesAPIDescriptorAsAuthority(t *testing.T) {
	f := newUpdateFixture(t)
	service := newFixtureService(t, f, f.api.URL)

	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info == nil || info.Version != "9.9.9" || info.TagName != "v9.9.9" || info.Body != "release notes" {
		t.Fatalf("API descriptor did not define the release: %+v", info)
	}
	if info.Asset == nil || info.Asset.Delivery.Type != DeliveryCloudreve || info.Asset.Delivery.NodeID != "cloud-1" {
		t.Fatalf("delivery plan: %+v", info.Asset)
	}
	if info.Asset.ExpectedSHA256 != f.hash {
		t.Fatalf("published hash not carried into the plan: %+v", info.Asset)
	}
	if info.Asset.BrowserDownloadURL != f.gh.URL+"/github-asset" {
		t.Fatalf("github fallback location lost: %+v", info.Asset)
	}
	if info.UpdaterAsset == nil || info.UpdaterAsset.Delivery.Type != DeliveryGitHub {
		t.Fatalf("updater asset delivery: %+v", info.UpdaterAsset)
	}
	state := service.GetState()
	if state.Status != StatusAvailable || state.DeliverySource != "cloudreve" || state.DeliveryNodeID != "cloud-1" {
		t.Fatalf("state: %+v", state)
	}
	if f.deliveryHits.Load() != 0 || f.githubHits.Load() != 0 {
		t.Fatal("checking for an update downloaded bytes")
	}
}

func TestDownloadUpdatePrefersCloudreveDelivery(t *testing.T) {
	f := newUpdateFixture(t)
	service := newFixtureService(t, f, f.api.URL)

	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	stagedPath, err := service.DownloadUpdate(context.Background(), info)
	if err != nil {
		t.Fatal(err)
	}
	staged, err := os.ReadFile(stagedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(staged) != string(f.payload) {
		t.Fatalf("staged bytes: %q", staged)
	}
	state := service.GetState()
	if state.Status != StatusReady || state.DeliverySource != "cloudreve" || state.DeliveryNodeID != "cloud-1" {
		t.Fatalf("state: %+v", state)
	}
	if f.deliveryHits.Load() != 1 {
		t.Fatalf("delivery link was used %d times", f.deliveryHits.Load())
	}
	if f.githubHits.Load() != 0 {
		t.Fatal("GitHub was used while the API mirror was healthy")
	}
}

func TestDownloadUpdateFallsBackToGitHubWhenDeliveryFails(t *testing.T) {
	f := newUpdateFixture(t)
	f.deliveryCode = http.StatusBadGateway
	service := newFixtureService(t, f, f.api.URL)

	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	stagedPath, err := service.DownloadUpdate(context.Background(), info)
	if err != nil {
		t.Fatal(err)
	}
	staged, err := os.ReadFile(stagedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(staged) != string(f.payload) {
		t.Fatalf("staged bytes: %q", staged)
	}
	if f.githubHits.Load() != 1 {
		t.Fatalf("github fallback was used %d times", f.githubHits.Load())
	}
	if f.deliveryHits.Load() != 2 {
		t.Fatalf("a failed delivery link must be refreshed and retried once, got %d attempts", f.deliveryHits.Load())
	}
	if state := service.GetState(); state.Status != StatusReady || state.DeliverySource != "github" || state.DeliveryNodeID != "" {
		t.Fatalf("state: %+v", state)
	}
}

func TestDownloadUpdateSkipsExpiredDeliveryLink(t *testing.T) {
	f := newUpdateFixture(t)
	f.expiresAt = time.Now().Add(-time.Minute)
	service := newFixtureService(t, f, f.api.URL)

	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.DownloadUpdate(context.Background(), info); err != nil {
		t.Fatal(err)
	}
	if f.deliveryHits.Load() != 0 {
		t.Fatalf("an expired link was requested %d times", f.deliveryHits.Load())
	}
	if f.githubHits.Load() != 1 {
		t.Fatalf("github fallback was used %d times", f.githubHits.Load())
	}
	if state := service.GetState(); state.DeliverySource != "github" {
		t.Fatalf("state: %+v", state)
	}
}

func TestCheckForUpdateFallsBackToGitHubWhenAPIUnavailable(t *testing.T) {
	f := newUpdateFixture(t)
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no descriptor", http.StatusServiceUnavailable)
	}))
	defer broken.Close()
	service := newFixtureService(t, f, broken.URL)

	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info == nil || info.Version != "99.0.0" {
		t.Fatalf("github fallback discovery: %+v", info)
	}
	if info.Asset == nil || info.Asset.Delivery.Type != DeliveryNone || info.Asset.ExpectedSHA256 != "" {
		t.Fatalf("github discovery must not invent a delivery plan: %+v", info.Asset)
	}
	if state := service.GetState(); state.Status != StatusAvailable || state.DeliverySource != "" {
		t.Fatalf("state: %+v", state)
	}
}

func TestSetAPIBaseURLRepointsUpdateChecks(t *testing.T) {
	f := newUpdateFixture(t)
	service := newFixtureService(t, f, "")
	if _, err := service.CheckForUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if service.GetState().LatestVersion != "99.0.0" {
		t.Fatal("an unset API must use the github path")
	}
	service.SetAPIBaseURL(f.api.URL)
	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info == nil || info.Version != "9.9.9" {
		t.Fatalf("repointed API did not answer: %+v", info)
	}
}

func TestCheckForUpdateFallsBackWhenAPISnapshotIsStale(t *testing.T) {
	f := newUpdateFixture(t)
	f.snapshotAgeSeconds = int64((appUpdateMaxSnapshotAge + time.Minute).Seconds())
	service := newFixtureService(t, f, f.api.URL)

	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info == nil || info.Version != "99.0.0" {
		t.Fatalf("a stale API snapshot must not outrank GitHub: %+v", info)
	}
	if state := service.GetState(); state.DeliverySource != "" || state.DeliveryNodeID != "" {
		t.Fatalf("a GitHub fallback must clear the API delivery plan: %+v", state)
	}
}

func TestCheckForUpdateKeepsAPISnapshotWhenGitHubCannotAnswer(t *testing.T) {
	f := newUpdateFixture(t)
	f.snapshotAgeSeconds = int64((2 * time.Hour).Seconds())
	f.githubListCode = http.StatusServiceUnavailable
	service := newFixtureService(t, f, f.api.URL)

	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatalf("a blocked GitHub must not fail an API-answered check: %v", err)
	}
	if info == nil || info.Version != "9.9.9" {
		t.Fatalf("API answer lost: %+v", info)
	}
	state := service.GetState()
	if state.Status != StatusAvailable || state.DeliverySource != "cloudreve" || state.Error != "" {
		t.Fatalf("API state was not restored: %+v", state)
	}
}

func TestCheckForUpdateClearsStaleErrorAndSourceAfterFallback(t *testing.T) {
	f := newUpdateFixture(t)
	service := newFixtureService(t, f, f.api.URL)
	if _, err := service.CheckForUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if source := service.GetState().DeliverySource; source != "cloudreve" {
		t.Fatalf("setup: %q", source)
	}
	// The descriptor now has no asset for this platform, so the API path records
	// an error and the client falls back to GitHub's newer release.
	f.omitPlatformAsset = true
	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info == nil || info.Version != "99.0.0" {
		t.Fatalf("fallback discovery: %+v", info)
	}
	if state := service.GetState(); state.Error != "" || state.DeliverySource != "" || state.DeliveryNodeID != "" {
		t.Fatalf("fallback kept stale API state: %+v", state)
	}
}

func TestDownloadUpdateDoesNotAdoptANewerReleaseOnRefresh(t *testing.T) {
	oldPayload := []byte("old-release-binary")
	newPayload := []byte("new-release-binary")
	oldSum := sha256.Sum256(oldPayload)
	newSum := sha256.Sum256(newPayload)
	var gh *httptest.Server
	var api *httptest.Server
	gh = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/github-asset" {
			w.Write(oldPayload)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(gh.Close)
	descriptors := atomic.Int32{}
	api = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/app-update":
			version, tag, hash, size, link := "9.9.9", "v9.9.9", hex.EncodeToString(oldSum[:]), len(oldPayload), api.URL+"/old-link"
			if descriptors.Add(1) > 1 {
				version, tag, hash, size, link = "9.9.10", "v9.9.10", hex.EncodeToString(newSum[:]), len(newPayload), api.URL+"/new-link"
			}
			json.NewEncoder(w).Encode(map[string]any{
				"tag_name": tag,
				"version":  version,
				"name":     tag,
				"assets": []any{map[string]any{
					"name":                     platformAssetName(),
					"size_bytes":               size,
					"sha256":                   hash,
					"delivery_type":            "cloudreve",
					"url":                      link,
					"expires_at":               time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339),
					"github_url":               gh.URL + "/github-asset",
					"allowed_download_origins": []string{},
				}},
			})
		case "/old-link":
			http.Error(w, "gone", http.StatusBadGateway)
		case "/new-link":
			t.Error("refresh adopted a newer release instead of keeping the approved one")
			w.Write(newPayload)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(api.Close)

	service, err := NewService(Config{
		CacheDir:        t.TempDir(),
		CurrentVersion:  "0.9.11",
		APIBaseURL:      api.URL,
		DownloadTimeout: 30 * time.Second,
	}, stateTestInstaller(false))
	if err != nil {
		t.Fatal(err)
	}
	service.ghClient = github.NewClient(github.WithBaseURL(gh.URL), github.WithAllowInsecureTestHosts(true))

	info, err := service.CheckForUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info == nil || info.Version != "9.9.9" {
		t.Fatalf("setup check: %+v", info)
	}
	stagedPath, err := service.DownloadUpdate(context.Background(), info)
	if err != nil {
		t.Fatal(err)
	}
	staged, err := os.ReadFile(stagedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(staged) != string(oldPayload) {
		t.Fatalf("staged bytes came from another release: %q", staged)
	}
	if info.Asset.ExpectedSHA256 != hex.EncodeToString(oldSum[:]) {
		t.Fatalf("expected hash moved to another release: %q", info.Asset.ExpectedSHA256)
	}
	if state := service.GetState(); state.Status != StatusReady || state.DeliverySource != "github" {
		t.Fatalf("state: %+v", state)
	}
	if descriptors.Load() != 2 {
		t.Fatalf("expected one refresh, got %d descriptor reads", descriptors.Load())
	}
}
