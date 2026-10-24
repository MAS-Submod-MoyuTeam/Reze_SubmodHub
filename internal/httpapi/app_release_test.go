package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/cloudreve"
	"github.com/reze/submodhub/internal/github"
)

// fakeAppRelease serves a GitHub repository's release list plus its asset bytes
// so app-update mirroring can be exercised without the real API. It also serves
// the repository-root VERSION file, which the server probes for new releases
// without spending REST quota.
type fakeAppRelease struct {
	server *httptest.Server

	mu         sync.Mutex
	tag        string
	version    string
	tags       map[string]string
	versionErr int
	releaseErr int
	releaseN   int
	versionN   int
	tagN       int

	assets map[string][]byte
	sums   map[string]string
}

func newFakeAppRelease(t *testing.T) *fakeAppRelease {
	t.Helper()
	f := &fakeAppRelease{
		tag:     "v9.9.9",
		version: "9.9.9",
		tags:    map[string]string{"v9.9.9": "9.9.9"},
		assets: map[string][]byte{
			"submodhub-windows-amd64.exe":       []byte("windows-binary"),
			"updater.exe":                       []byte("updater-binary"),
			"submodhub-android-arm64-9.9.9.apk": []byte("apk-binary"),
			"release-source.zip":                []byte("source-archive"),
		},
		sums: map[string]string{},
	}
	listing := &strings.Builder{}
	for name, body := range f.assets {
		sum := sha256.Sum256(body)
		f.sums[name] = hex.EncodeToString(sum[:])
		fmt.Fprintf(listing, "%s  %s\n", f.sums[name], name)
	}
	f.assets["SHA256SUMS.txt"] = []byte(listing.String())

	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/owner/repo/") && strings.HasSuffix(r.URL.Path, "/"+github.VersionFileName) {
			// The raw host serves the file at any ref, so this fake must too: a
			// branch ref yields the VERSION the branch carries, a tag ref yields the
			// version that tag was cut from, and an unknown ref is a 404. That is what
			// lets the probe ask "does the tag exist yet?" without spending REST quota.
			ref := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/owner/repo/"), "/"+github.VersionFileName)
			f.mu.Lock()
			version, status, tags := f.version, f.versionErr, maps.Clone(f.tags)
			branch := ref == "HEAD" || ref == "main" || ref == "master"
			if branch {
				f.versionN++
			} else {
				f.tagN++
			}
			f.mu.Unlock()
			if status != 0 {
				http.Error(w, "version file unavailable", status)
				return
			}
			if branch {
				fmt.Fprint(w, version+"\n")
				return
			}
			if tagged, ok := tags[ref]; ok {
				fmt.Fprint(w, tagged+"\n")
				return
			}
			http.NotFound(w, r)
			return
		}
		switch {
		case r.URL.Path == "/repos/owner/repo/releases":
			f.mu.Lock()
			f.releaseN++
			tag, status := f.tag, f.releaseErr
			f.mu.Unlock()
			if status != 0 {
				http.Error(w, "release api unavailable", status)
				return
			}
			assets := []map[string]any{}
			for _, name := range []string{"submodhub-windows-amd64.exe", "updater.exe", "submodhub-android-arm64-9.9.9.apk", "SHA256SUMS.txt", "release-source.zip"} {
				assets = append(assets, map[string]any{
					"id":                   int64(len(assets) + 1),
					"name":                 name,
					"size":                 len(f.assets[name]),
					"browser_download_url": f.server.URL + "/dl/" + name,
				})
			}
			json.NewEncoder(w).Encode([]map[string]any{
				{"tag_name": "v9.9.10-rc1", "name": "prerelease", "prerelease": true, "assets": []any{}},
				{"tag_name": tag, "name": "RezeHub 9.9.9", "body": "release notes", "published_at": "2026-10-20T10:00:00Z", "assets": assets},
			})
		case strings.HasPrefix(r.URL.Path, "/dl/"):
			body, ok := f.assets[strings.TrimPrefix(r.URL.Path, "/dl/")]
			if !ok {
				http.NotFound(w, r)
				return
			}
			w.Write(body)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeAppRelease) assetURL(name string) string { return f.server.URL + "/dl/" + name }

// publish moves the fake repository forward in one step: the tag exists and the
// release API lists it.
func (f *fakeAppRelease) publish(tag, version string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tag, f.version = tag, version
	f.tags[tag] = version
}

// bumpVersion models the first half of a release: the workflow has committed the
// new VERSION, but the tag does not exist yet because the client builds are still
// running.
func (f *fakeAppRelease) bumpVersion(version string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.version = version
}

// pushTag models the second half: CI has created the tag but the release is not
// listed yet (it is still a draft, or the release call is still in flight).
func (f *fakeAppRelease) pushTag(tag, version string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tags[tag] = version
}

// failVersion makes the VERSION probe fail while the release API keeps working.
func (f *fakeAppRelease) failVersion(status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.versionErr = status
}

// failRelease makes the release API fail while VERSION stays readable.
func (f *fakeAppRelease) failRelease(status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.releaseErr = status
}

func (f *fakeAppRelease) calls() (releases, versions int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.releaseN, f.versionN
}

// tagLookups reports how many VERSION reads asked for a tag ref instead of a
// branch. They cost no REST quota either, but they are the probe's extra work.
func (f *fakeAppRelease) tagLookups() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.tagN
}

// expireProbeWindow pretends the probe interval has elapsed so the next update
// check reads VERSION again. Moving the recorded timestamp forward is how these
// tests observe several probe windows without sleeping.
func (s *Store) expireProbeWindow() {
	s.appRelease.mu.Lock()
	defer s.appRelease.mu.Unlock()
	s.appRelease.probedAt = time.Now().Add(-2 * appVersionProbeInterval)
}

func newAppUpdateStore(t *testing.T, release *fakeAppRelease, nodes []DeliveryNode) *Store {
	t.Helper()
	s, err := NewStore(t.TempDir(), Catalog{DeliveryNodes: nodes})
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	s.GitHubClient = github.NewClient(github.WithBaseURL(release.server.URL), github.WithAllowInsecureTestHosts(true))
	s.AppReleaseRepoOwner = "owner"
	s.AppReleaseRepoName = "repo"
	return s
}

func cloudreveTestNode() DeliveryNode {
	return DeliveryNode{ID: "cloud", Type: "cloudreve", Enabled: true, Weight: 1, Revision: 1, Directory: "/SubmodHub", AllowedDownloadOrigins: []string{"https://cdn.example"}}
}

func readyAppMirror(asset, sha string, size int64, fileID string) AppAssetMirror {
	return AppAssetMirror{NodeID: "cloud", NodeRevision: 1, Tag: "v9.9.9", AssetName: asset, SHA256: sha, SizeBytes: size, ObjectName: "object", FileID: fileID, State: "ready"}
}

func getAppUpdate(t *testing.T, h http.Handler) (int, appUpdateDTO, string) {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/app-update", nil))
	if w.Code != http.StatusOK {
		return w.Code, appUpdateDTO{}, w.Body.String()
	}
	var out appUpdateDTO
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode descriptor: %v", err)
	}
	return w.Code, out, w.Body.String()
}

func TestAppUpdateDescriptorPublishesVerifiedCloudreveMirror(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	sign := base64.URLEncoding.EncodeToString(make([]byte, 32)) + fmt.Sprintf(":%d", time.Now().Add(10*time.Minute).Unix())
	resolved := map[string]int{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/user/session" {
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		resolved[strings.TrimPrefix(r.URL.Path, "/file/download/")]++
		json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": "https://cdn.example/" + strings.TrimPrefix(r.URL.Path, "/file/download/") + "?sign=" + sign})
	}))
	defer provider.Close()
	client, _ := cloudreve.New(cloudreve.Config{BaseURL: provider.URL, AllowedDownloadOrigins: []string{"https://cdn.example"}, AllowInsecureForTesting: true})
	s.deliveryRuntime.clients = map[string]cloudreveSession{"cloud": {revision: 1, client: client}}

	windows := "submodhub-windows-amd64.exe"
	s.Catalog.AppAssetMirrors = []AppAssetMirror{readyAppMirror(windows, release.sums[windows], int64(len(release.assets[windows])), "obj-win")}

	code, out, body := getAppUpdate(t, NewStoreHandler(s))
	if code != http.StatusOK {
		t.Fatalf("descriptor: %d %s", code, body)
	}
	if out.Version != "9.9.9" || out.TagName != "v9.9.9" || out.Notes != "release notes" || out.Prerelease {
		t.Fatalf("release metadata: %+v", out)
	}
	if out.SnapshotAgeSeconds < 0 || out.SnapshotAgeSeconds > 60 {
		t.Fatalf("snapshot age must describe a fresh read: %d", out.SnapshotAgeSeconds)
	}
	if out.ChecksumURL != release.assetURL("SHA256SUMS.txt") {
		t.Fatalf("checksum url: %q", out.ChecksumURL)
	}
	if out.ReleaseURL != "https://github.com/owner/repo/releases/tag/v9.9.9" {
		t.Fatalf("release page url: %q", out.ReleaseURL)
	}
	byName := map[string]appUpdateAssetDTO{}
	for _, a := range out.Assets {
		byName[a.Name] = a
	}
	win, ok := byName[windows]
	if !ok {
		t.Fatalf("windows asset missing: %+v", out.Assets)
	}
	if win.DeliveryType != "cloudreve" || win.NodeID != "cloud" || !strings.HasPrefix(win.URL, "https://cdn.example/obj-win?sign=") {
		t.Fatalf("cloudreve delivery not selected: %+v", win)
	}
	if win.ExpiresAt == nil || win.ExpiresAt.After(time.Now().Add(5*time.Minute)) {
		t.Fatalf("descriptor expiry must stay under five minutes: %+v", win.ExpiresAt)
	}
	if win.SHA256 != release.sums[windows] || win.SizeBytes != int64(len(release.assets[windows])) {
		t.Fatalf("published hash/size: %+v", win)
	}
	if len(win.AllowedDownloadOrigins) != 1 || win.AllowedDownloadOrigins[0] != "https://cdn.example" {
		t.Fatalf("allowed origins: %+v", win.AllowedDownloadOrigins)
	}
	if win.GitHubURL != release.assetURL(windows) {
		t.Fatalf("github fallback url: %q", win.GitHubURL)
	}
	updater, ok := byName["updater.exe"]
	if !ok || updater.DeliveryType != "github" || updater.URL != release.assetURL("updater.exe") {
		t.Fatalf("updater asset must stay on github without a ready mirror: %+v", updater)
	}
	if _, ok := byName["release-source.zip"]; ok {
		t.Fatal("non-client assets must not be published")
	}
	if resolved["obj-win"] != 1 {
		t.Fatalf("expected one provider resolution, got %+v", resolved)
	}
	if _, _, body := getAppUpdate(t, NewStoreHandler(s)); resolved["obj-win"] != 1 {
		t.Fatalf("valid link was not cached: %s", body)
	}
}

func TestAppUpdateDescriptorUnavailableWithoutReleaseMetadata(t *testing.T) {
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer broken.Close()
	s, _ := NewStore(t.TempDir(), Catalog{})
	s.GitHubClient = github.NewClient(github.WithBaseURL(broken.URL), github.WithAllowInsecureTestHosts(true))
	s.AppReleaseRepoOwner = "owner"
	s.AppReleaseRepoName = "repo"
	code, _, body := getAppUpdate(t, NewStoreHandler(s))
	if code != http.StatusServiceUnavailable || !strings.Contains(body, "app_release_unavailable") {
		t.Fatalf("unavailable release: %d %s", code, body)
	}
}

func TestAppMirrorCandidatesSkipSourcesAndUnhashedAssets(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	rel, sums, ok := s.appReleaseSnapshot()
	if !ok {
		t.Fatal("release not cached")
	}
	names := []string{}
	for _, a := range appClientAssets(rel) {
		names = append(names, a.Name)
	}
	if strings.Join(names, ",") != "submodhub-windows-amd64.exe,updater.exe,submodhub-android-arm64-9.9.9.apk" {
		t.Fatalf("client assets: %v", names)
	}
	tampered := rel
	tampered.Assets = append([]github.Asset{}, rel.Assets...)
	for i := range tampered.Assets {
		if tampered.Assets[i].Name == "updater.exe" {
			tampered.Assets[i].Name = "unlisted.exe"
		}
	}
	mirrored := []string{}
	for _, a := range appMirrorCandidates(tampered, sums) {
		mirrored = append(mirrored, a.Name)
	}
	if strings.Join(mirrored, ",") != "submodhub-windows-amd64.exe,submodhub-android-arm64-9.9.9.apk" {
		t.Fatalf("assets without a published hash must not be mirrored: %v", mirrored)
	}
}

func TestAppMirrorReconcileRecoversInterruptedUploads(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	rel, sums, _ := s.appReleaseSnapshot()
	if err := s.reconcileAppMirrors(rel, sums); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	job, _, ok, err := s.claimAppMirror()
	if err != nil || !ok {
		t.Fatalf("claim: %v %v", ok, err)
	}
	if job.State != "uploading" {
		t.Fatalf("claim must reserve the job: %+v", job)
	}

	// The process dies (or the node is disabled) here: the row is persisted as
	// uploading with no worker left to finish it. Reconciliation must put it back
	// in the queue instead of stranding the asset until the next release.
	if err := s.reconcileAppMirrors(rel, sums); err != nil {
		t.Fatalf("reconcile after restart: %v", err)
	}
	index := slices.IndexFunc(s.Catalog.AppAssetMirrors, func(m AppAssetMirror) bool { return m.AssetName == job.AssetName })
	if index < 0 || s.Catalog.AppAssetMirrors[index].State != "pending" {
		t.Fatalf("interrupted upload not recovered: %+v", s.Catalog.AppAssetMirrors)
	}

	// A disabled node must not be claimed, but the recovered row stays queued.
	s.Catalog.DeliveryNodes[0].Enabled = false
	if _, _, ok, _ := s.claimAppMirror(); ok {
		t.Fatal("a disabled node must not claim the recovered job")
	}
	if index := slices.IndexFunc(s.Catalog.AppAssetMirrors, func(m AppAssetMirror) bool { return m.AssetName == job.AssetName }); index < 0 || s.Catalog.AppAssetMirrors[index].State != "pending" {
		t.Fatalf("recovered row lost while the node was disabled: %+v", s.Catalog.AppAssetMirrors)
	}
}

func TestAppMirrorReconcileClaimAndFinish(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	rel, sums, _ := s.appReleaseSnapshot()
	if err := s.reconcileAppMirrors(rel, sums); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(s.Catalog.AppAssetMirrors) != 3 {
		t.Fatalf("expected three app assets pending, got %+v", s.Catalog.AppAssetMirrors)
	}
	for _, m := range s.Catalog.AppAssetMirrors {
		if m.State != "pending" || m.SHA256 != sums[m.AssetName] || !strings.HasPrefix(m.ObjectName, "app-v9.9.9-"+sums[m.AssetName][:12]+"-") {
			t.Fatalf("pending mirror: %+v", m)
		}
	}
	if err := s.reconcileAppMirrors(rel, sums); err != nil {
		t.Fatalf("reconcile twice: %v", err)
	}
	if len(s.Catalog.AppAssetMirrors) != 3 {
		t.Fatal("reconciliation duplicated rows")
	}

	job, node, ok, err := s.claimAppMirror()
	if err != nil || !ok || node.ID != "cloud" {
		t.Fatalf("claim: %+v %v %v", job, ok, err)
	}
	if job.State != "uploading" {
		t.Fatalf("claim must reserve the job: %+v", job)
	}
	if err := s.finishAppMirror(job, "file-id", nil); err != nil {
		t.Fatalf("finish: %v", err)
	}
	done := -1
	for i, m := range s.Catalog.AppAssetMirrors {
		if m.AssetName == job.AssetName {
			done = i
		}
	}
	if done < 0 || s.Catalog.AppAssetMirrors[done].State != "ready" || s.Catalog.AppAssetMirrors[done].FileID != "file-id" {
		t.Fatalf("ready mirror: %+v", s.Catalog.AppAssetMirrors[done])
	}

	// A newer release prunes rows of the previous tag; the object stays in the
	// provider.
	rel.TagName = "v9.9.10"
	if err := s.reconcileAppMirrors(rel, map[string]string{}); err != nil {
		t.Fatalf("reconcile new tag: %v", err)
	}
	for _, m := range s.Catalog.AppAssetMirrors {
		if m.Tag != "v9.9.10" {
			t.Fatalf("stale tag retained: %+v", m)
		}
	}
}

func TestAppMirrorUploadRejectsBytesThatDisagreeWithPublishedHash(t *testing.T) {
	release := newFakeAppRelease(t)
	release.assets["submodhub-windows-amd64.exe"] = []byte("tampered-binary")
	// The checksum listing still describes the original bytes, so the download
	// and the published hash cannot agree.
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	hits := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		fmt.Fprint(w, `{"code":0,"data":{"objects":[],"policy":{"id":"p","type":"local"}}}`)
	}))
	defer provider.Close()
	client, _ := cloudreve.New(cloudreve.Config{BaseURL: provider.URL, AllowedDownloadOrigins: []string{"https://cdn.example"}, AllowInsecureForTesting: true})
	s.deliveryRuntime.clients = map[string]cloudreveSession{"cloud": {revision: 1, client: client}}

	rel, sums, _ := s.appReleaseSnapshot()
	if err := s.reconcileAppMirrors(rel, sums); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	job, node, ok, err := s.claimAppMirror()
	if err != nil || !ok {
		t.Fatalf("claim: %v %v", ok, err)
	}
	if _, copyErr := s.copyAppMirror(context.Background(), job, node); copyErr == nil {
		t.Fatal("mismatched bytes must not be uploaded")
	} else if !strings.Contains(copyErr.Error(), "mirror_verification_failed") {
		t.Fatalf("unexpected error: %v", copyErr)
	}
	if hits != 0 {
		t.Fatalf("provider was contacted before local verification: %d", hits)
	}
	if err := s.finishAppMirror(job, "", errMirrorVerification); err != nil {
		t.Fatalf("finish: %v", err)
	}
	var failed *AppAssetMirror
	for i := range s.Catalog.AppAssetMirrors {
		if s.Catalog.AppAssetMirrors[i].AssetName == job.AssetName {
			failed = &s.Catalog.AppAssetMirrors[i]
		}
	}
	if failed == nil || failed.State != "failed" || failed.ErrorCode != "mirror_verification_failed" || failed.Attempts != 1 || failed.RetryAt.IsZero() {
		t.Fatalf("failed mirror state: %+v", failed)
	}
	if !strings.Contains(failed.ObjectName, job.ObjectName) || failed.ObjectName == job.ObjectName {
		t.Fatalf("verification failures must move to a new object name: %+v", failed)
	}
}

func TestMaintainAppAssetsUploadsThroughProvider(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	var mu sync.Mutex
	uploaded := map[string]int{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/user/session":
			fmt.Fprint(w, `{"code":0}`)
		case r.Method == "PUT" && r.URL.Path == "/file/upload":
			var payload struct {
				Name string `json:"name"`
				Size int64  `json:"size"`
			}
			json.NewDecoder(r.Body).Decode(&payload)
			mu.Lock()
			uploaded[payload.Name] = int(payload.Size)
			mu.Unlock()
			fmt.Fprint(w, `{"code":0,"data":{"sessionID":"s1","chunkSize":0,"uploadURLs":[],"credential":""}}`)
		case r.URL.Path == "/directory/SubmodHub":
			fmt.Fprint(w, `{"code":0,"data":{"objects":[],"policy":{"id":"p","type":"local"}}}`)
		default:
			fmt.Fprint(w, `{"code":0}`)
		}
	}))
	defer provider.Close()
	client, _ := cloudreve.New(cloudreve.Config{BaseURL: provider.URL, AllowedDownloadOrigins: []string{"https://cdn.example"}, AllowInsecureForTesting: true})
	s.deliveryRuntime.clients = map[string]cloudreveSession{"cloud": {revision: 1, client: client}}

	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	s.maintainAppAssets(context.Background())

	mu.Lock()
	defer mu.Unlock()
	if len(uploaded) != 1 {
		t.Fatalf("exactly one asset per worker pass must be attempted: %+v", uploaded)
	}
	for name, size := range uploaded {
		if !strings.HasPrefix(name, "app-v9.9.9-") {
			t.Fatalf("unexpected object name: %s", name)
		}
		if size <= 0 {
			t.Fatalf("upload size not declared: %s=%d", name, size)
		}
	}
	if len(s.Catalog.AppAssetMirrors) != 3 {
		t.Fatalf("all client assets must be tracked: %+v", s.Catalog.AppAssetMirrors)
	}
	failed := 0
	for _, m := range s.Catalog.AppAssetMirrors {
		if m.State == "failed" {
			failed++
		}
	}
	if failed != 1 {
		t.Fatalf("a provider that never confirms the object must fail once: %+v", s.Catalog.AppAssetMirrors)
	}
}

func TestRetryDeliveryMirrorsResetsFailedAppAssets(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{DeliveryNodes: []DeliveryNode{{ID: "cloud", Type: "cloudreve", Enabled: true, Revision: 1}}, AppAssetMirrors: []AppAssetMirror{{NodeID: "cloud", NodeRevision: 1, Tag: "v1", AssetName: "a.exe", State: "failed", Attempts: 8, ErrorCode: "mirror_provider_failed", RetryAt: time.Now().Add(time.Hour)}}})
	s.Catalog.Settings.Revision = 3
	w := httptest.NewRecorder()
	s.retryDeliveryMirrors(w, httptest.NewRequest("POST", "/api/v1/admin/download-nodes/cloud/retry-mirrors", strings.NewReader(`{"revision":3}`)), "cloud")
	if w.Code != 200 {
		t.Fatalf("retry: %d %s", w.Code, w.Body.String())
	}
	m := s.Catalog.AppAssetMirrors[0]
	if m.State != "pending" || m.Attempts != 0 || m.ErrorCode != "" || !m.RetryAt.IsZero() {
		t.Fatalf("app asset mirror not reset: %+v", m)
	}
}

// A VERSION newer than the served release means a release probably exists now.
// The descriptor must then serve it, so a passive check discovers the new
// version without waiting for the ten-minute snapshot window.
func TestAppUpdateProbePromotesNewerVersion(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if rel, _, ok := s.appReleaseSnapshot(); !ok || rel.TagName != "v9.9.9" {
		t.Fatalf("initial snapshot: %+v", rel)
	}

	release.publish("v9.9.10", "9.9.10")
	code, out, body := getAppUpdate(t, NewStoreHandler(s))
	if code != http.StatusOK {
		t.Fatalf("descriptor: %d %s", code, body)
	}
	if out.Version != "9.9.10" || out.TagName != "v9.9.10" {
		t.Fatalf("VERSION probe did not promote the newer release: %+v", out)
	}
	if _, versions := release.calls(); versions != 1 {
		t.Fatalf("VERSION must be probed once, got %d", versions)
	}
}

// An unchanged VERSION means nothing to do: the REST API must stay untouched
// until the snapshot window expires.
func TestAppUpdateProbeLeavesEqualVersionAlone(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	releasesBefore, _ := release.calls()

	code, out, body := getAppUpdate(t, NewStoreHandler(s))
	if code != http.StatusOK || out.Version != "9.9.9" {
		t.Fatalf("descriptor: %d %s", code, body)
	}
	if releasesAfter, versions := release.calls(); releasesAfter != releasesBefore || versions != 1 {
		t.Fatalf("equal VERSION must not refresh: releases %d→%d, probes %d", releasesBefore, releasesAfter, versions)
	}
}

// The probe is cached for a minute: a burst of clients is one raw request, not
// one per request.
func TestAppUpdateProbeIsCachedForAMinute(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	h := NewStoreHandler(s)
	for i := 0; i < 3; i++ {
		if code, _, body := getAppUpdate(t, h); code != http.StatusOK {
			t.Fatalf("descriptor %d: %d %s", i, code, body)
		}
	}
	if _, versions := release.calls(); versions != 1 {
		t.Fatalf("probe window did not cache: %d VERSION requests", versions)
	}
}

// The release workflow bumps VERSION first and creates the tag only after every
// client build has finished, so "VERSION ahead of the served tag" is the normal
// state for the whole build window. The probe must recognise that the tag is not
// there yet and spend no REST refresh on it — otherwise a passive update check
// becomes a REST poll for as long as CI runs.
func TestAppUpdateProbeWaitsForTheTagBeforeRefreshing(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	// VERSION bumped; the tag does not exist yet because CI is still building.
	release.bumpVersion("9.9.10")
	releasesBefore, _ := release.calls()

	h := NewStoreHandler(s)
	for i := 0; i < 5; i++ {
		s.expireProbeWindow()
		if code, _, body := getAppUpdate(t, h); code != http.StatusOK {
			t.Fatalf("descriptor window %d: %d %s", i, code, body)
		}
	}
	releasesAfter, probes := release.calls()
	if releasesAfter != releasesBefore {
		t.Fatalf("a version without a tag must cost no REST refresh: releases %d→%d",
			releasesBefore, releasesAfter)
	}
	if probes != 5 {
		t.Fatalf("every probe window must still read VERSION: got %d", probes)
	}
	if release.tagLookups() != 5 {
		t.Fatalf("every ahead observation must check the tag: got %d", release.tagLookups())
	}
}

// When the tag finally appears the next probe window must promote the release, so
// the wait above costs latency only until CI finishes — not a full snapshot window.
func TestAppUpdateProbePromotesWhenTheTagAppears(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	release.bumpVersion("9.9.10")
	h := NewStoreHandler(s)
	if code, _, body := getAppUpdate(t, h); code != http.StatusOK {
		t.Fatalf("descriptor: %d %s", code, body)
	}
	releasesBefore, _ := release.calls()

	// The build finishes: the tag exists and the release is published.
	release.publish("v9.9.10", "9.9.10")
	s.expireProbeWindow()
	code, out, body := getAppUpdate(t, h)
	if code != http.StatusOK || out.Version != "9.9.10" || out.TagName != "v9.9.10" {
		t.Fatalf("the published release must be served: %d %+v %s", code, out, body)
	}
	if after, _ := release.calls(); after != releasesBefore+1 {
		t.Fatalf("promotion must cost exactly one refresh: %d→%d", releasesBefore, after)
	}
}

// A tag without a listed release (a draft, a prerelease, or a release call still
// in flight) is the one state where the probe genuinely cannot tell "not yet" from
// "never". That must cost one refresh per VERSION value, not one per probe window.
func TestAppUpdateProbePaysOnceForATagWithoutARelease(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	release.bumpVersion("9.9.10")
	release.pushTag("v9.9.10", "9.9.10")
	releasesBefore, _ := release.calls()

	h := NewStoreHandler(s)
	if code, _, body := getAppUpdate(t, h); code != http.StatusOK {
		t.Fatalf("descriptor: %d %s", code, body)
	}
	releasesAfterFirst, _ := release.calls()
	if releasesAfterFirst != releasesBefore+1 {
		t.Fatalf("an existing tag with no release must be checked once: %d→%d",
			releasesBefore, releasesAfterFirst)
	}

	for i := 0; i < 5; i++ {
		s.expireProbeWindow()
		if code, _, body := getAppUpdate(t, h); code != http.StatusOK {
			t.Fatalf("descriptor window %d: %d %s", i, code, body)
		}
	}
	if releasesAfter, _ := release.calls(); releasesAfter != releasesAfterFirst {
		t.Fatalf("the same unreleased tag must not buy another refresh: %d→%d",
			releasesAfterFirst, releasesAfter)
	}
}

// A different VERSION must buy its own refresh: retiring one value must not make
// the server blind to the next release.
func TestAppUpdateProbeRearmsWhenVersionChanges(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	release.bumpVersion("9.9.10")
	release.pushTag("v9.9.10", "9.9.10")
	h := NewStoreHandler(s)
	if code, _, body := getAppUpdate(t, h); code != http.StatusOK {
		t.Fatalf("descriptor: %d %s", code, body)
	}
	retired, _ := release.calls()

	release.bumpVersion("9.9.11")
	release.pushTag("v9.9.11", "9.9.11")
	s.expireProbeWindow()
	code, out, body := getAppUpdate(t, h)
	if code != http.StatusOK {
		t.Fatalf("descriptor: %d %s", code, body)
	}
	if out.Version != "9.9.9" {
		t.Fatalf("no release exists yet, so the snapshot must be served: %+v", out)
	}
	if after, _ := release.calls(); after != retired+1 {
		t.Fatalf("a changed ahead VERSION must buy one refresh: %d→%d", retired, after)
	}
}

// A broken probe must be invisible: the descriptor keeps serving the last
// snapshot and the refresh rhythm does not change.
func TestAppUpdateProbeFailureKeepsServingSnapshot(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	releasesBefore, _ := release.calls()
	release.failVersion(http.StatusInternalServerError)

	code, out, body := getAppUpdate(t, NewStoreHandler(s))
	if code != http.StatusOK || out.Version != "9.9.9" {
		t.Fatalf("failed probe must not affect the descriptor: %d %s", code, body)
	}
	if releasesAfter, versions := release.calls(); releasesAfter != releasesBefore || versions != 1 {
		t.Fatalf("failed probe changed the refresh rhythm: releases %d→%d, probes %d", releasesBefore, releasesAfter, versions)
	}
}

// The probe must not shorten the retry window of a failing release API: after a
// failure the server waits for the retry interval regardless of VERSION.
func TestAppUpdateProbeDoesNotRetryFasterThanTheRetryInterval(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, nil)
	release.failRelease(http.StatusInternalServerError)
	if code, _, body := getAppUpdate(t, NewStoreHandler(s)); code != http.StatusServiceUnavailable {
		t.Fatalf("unavailable release must be reported: %d %s", code, body)
	}
	releasesBefore, _ := release.calls()

	release.failVersion(0)
	release.publish("v9.9.10", "9.9.10")
	if code, _, body := getAppUpdate(t, NewStoreHandler(s)); code != http.StatusServiceUnavailable {
		t.Fatalf("retry interval must still gate the refresh: %d %s", code, body)
	}
	if releasesAfter, _ := release.calls(); releasesAfter != releasesBefore {
		t.Fatalf("refresh ran before the retry interval: %d→%d", releasesBefore, releasesAfter)
	}
}
