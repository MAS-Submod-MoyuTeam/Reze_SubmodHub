package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/reze/submodhub/internal/cloudreve"
)

// fakeAppProvider is a Cloudreve directory that can be listed and whose files can
// be deleted, so retention can be exercised against the same provider contract
// the worker uses.
type fakeAppProvider struct {
	mu          sync.Mutex
	objects     []cloudreve.Object
	deletedIDs  []string
	deletedName []string
	listings    int
	listErr     bool
}

func (p *fakeAppProvider) handler(t *testing.T) http.HandlerFunc {
	t.Helper()
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "session"):
			fmt.Fprint(w, `{"code":0}`)
		case r.Method == "GET" && r.URL.Path == "/directory/SubmodHub":
			p.mu.Lock()
			p.listings++
			listErr, objects := p.listErr, slices.Clone(p.objects)
			p.mu.Unlock()
			if listErr {
				fmt.Fprint(w, `{"code":500}`)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"objects": objects, "policy": map[string]any{"id": "p", "type": "local"}}})
		case r.Method == "DELETE" && r.URL.Path == "/object":
			var payload struct {
				Items []string `json:"items"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Items) == 0 {
				t.Errorf("delete payload: %v %+v", err, payload)
			}
			p.mu.Lock()
			for _, object := range p.objects {
				if slices.Contains(payload.Items, object.ID) {
					p.deletedName = append(p.deletedName, object.Name)
				}
			}
			p.deletedIDs = append(p.deletedIDs, payload.Items...)
			p.objects = slices.DeleteFunc(p.objects, func(o cloudreve.Object) bool { return slices.Contains(payload.Items, o.ID) })
			p.mu.Unlock()
			fmt.Fprint(w, `{"code":0}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			fmt.Fprint(w, `{"code":404}`)
		}
	}
}

// attach seeds the delivery runtime with a client for the test node, which is how
// the worker reaches a provider without node secrets.
func (p *fakeAppProvider) attach(t *testing.T, s *Store) {
	t.Helper()
	p.attachAs(t, s, "cloud", 1)
}

func (p *fakeAppProvider) attachAs(t *testing.T, s *Store, nodeID string, revision uint64) {
	t.Helper()
	srv := httptest.NewServer(p.handler(t))
	t.Cleanup(srv.Close)
	client, err := cloudreve.New(cloudreve.Config{BaseURL: srv.URL, AllowInsecureForTesting: true})
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	if s.deliveryRuntime.clients == nil {
		s.deliveryRuntime.clients = map[string]cloudreveSession{}
	}
	s.deliveryRuntime.clients[nodeID] = cloudreveSession{revision: revision, client: client}
}

func (p *fakeAppProvider) snapshot() (ids, names []string, listings int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.deletedIDs), slices.Clone(p.deletedName), p.listings
}

// readyAppMirrors marks every mirrorable asset of the served release as uploaded
// to the test node, which is the state retention requires before it may delete
// anything.
func readyAppMirrors(t *testing.T, s *Store, provider *fakeAppProvider, tag string) []AppAssetMirror {
	t.Helper()
	rel, sums, ok := s.appReleaseSnapshot()
	if !ok {
		t.Fatal("release not cached")
	}
	rows := []AppAssetMirror{}
	for _, a := range appMirrorCandidates(rel, sums) {
		row := AppAssetMirror{
			NodeID:       "cloud",
			NodeRevision: 1,
			Tag:          tag,
			AssetName:    a.Name,
			SHA256:       sums[a.Name],
			SizeBytes:    a.Size,
			ObjectName:   appObjectName(tag, sums[a.Name], a.Name),
			FileID:       "id-" + a.Name,
			State:        "ready",
		}
		rows = append(rows, row)
		provider.objects = append(provider.objects, cloudreve.Object{ID: row.FileID, Name: row.ObjectName, Type: "file", Size: a.Size})
	}
	return rows
}

func TestAppAssetsKeepOnlyTheServedRelease(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	provider := &fakeAppProvider{}
	s.Catalog.AppAssetMirrors = readyAppMirrors(t, s, provider, "v9.9.9")
	// Everything here is what a node accumulates over a few releases: installers
	// of the previous version, the leftover of an upload whose read-back failed,
	// a mod archive and a directory entry.
	provider.objects = append(provider.objects,
		cloudreve.Object{ID: "old-exe", Name: "app-v9.9.8-111111111111-submodhub-windows-amd64.exe", Type: "file"},
		cloudreve.Object{ID: "old-apk", Name: "app-v9.9.8-222222222222-submodhub-android-arm64-9.9.8.apk", Type: "file"},
		cloudreve.Object{ID: "broken", Name: "app-v9.9.9-333333333333-updater.exe-0123456789ab", Type: "file"},
		cloudreve.Object{ID: "archive", Name: "mod-1-abcdefabcdef.zip", Type: "file"},
		cloudreve.Object{ID: "notes", Name: "install-notes.txt", Type: "file"},
		cloudreve.Object{ID: "dir", Name: "app-v9.9.8-444444444444-old.exe", Type: "dir"},
	)
	provider.attach(t, s)

	s.pruneStaleAppAssets(context.Background(), true)

	ids, names, listings := provider.snapshot()
	// Two complete listings (decide what is stale, then confirm) and each complete
	// listing reads two pages because the pass only stops on an empty page.
	if listings != 4 {
		t.Fatalf("one pass must list the directory twice, two pages each: %d", listings)
	}
	slices.Sort(names)
	want := []string{
		"app-v9.9.8-111111111111-submodhub-windows-amd64.exe",
		"app-v9.9.8-222222222222-submodhub-android-arm64-9.9.8.apk",
		"app-v9.9.9-333333333333-updater.exe-0123456789ab",
	}
	if !slices.Equal(names, want) {
		t.Fatalf("retired objects: %+v (ids %+v)", names, ids)
	}
	// The served installers themselves must survive.
	for _, m := range s.Catalog.AppAssetMirrors {
		if slices.Contains(ids, m.FileID) {
			t.Fatalf("served installer was retired: %+v", m)
		}
	}
}

// A release that is only partly mirrored must keep the previous installers: they
// are still the only downloadable copy a client can get.
func TestAppAssetsWaitForEveryCurrentAssetBeforeRetiringOldOnes(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	provider := &fakeAppProvider{}
	rows := readyAppMirrors(t, s, provider, "v9.9.9")
	rows[1].State, rows[1].FileID = "pending", ""
	s.Catalog.AppAssetMirrors = rows
	provider.objects = append(provider.objects, cloudreve.Object{ID: "old-exe", Name: "app-v9.9.8-111111111111-submodhub-windows-amd64.exe", Type: "file"})
	provider.attach(t, s)

	s.pruneStaleAppAssets(context.Background(), true)

	if ids, _, listings := provider.snapshot(); len(ids) != 0 || listings != 0 {
		t.Fatalf("retention must not run before the served release is complete: deleted=%+v listings=%d", ids, listings)
	}
}

func TestAppAssetRetentionSurvivesAnUnreachableProvider(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	provider := &fakeAppProvider{listErr: true}
	s.Catalog.AppAssetMirrors = readyAppMirrors(t, s, provider, "v9.9.9")
	provider.objects = append(provider.objects, cloudreve.Object{ID: "old-exe", Name: "app-v9.9.8-111111111111-submodhub-windows-amd64.exe", Type: "file"})
	provider.attach(t, s)

	// A failing provider must leave the mirrors usable and simply try again later.
	s.pruneStaleAppAssets(context.Background(), true)
	if ids, _, _ := provider.snapshot(); len(ids) != 0 {
		t.Fatalf("a failed listing must not report deletions: %+v", ids)
	}
}

// The worker hook: retention is what an idle app-mirror pass does, and it is paced
// so a steady state does not list every node on every tick.
func TestMaintainAppAssetsRetiresOldInstallersOnceComplete(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	provider := &fakeAppProvider{}
	s.Catalog.AppAssetMirrors = readyAppMirrors(t, s, provider, "v9.9.9")
	provider.objects = append(provider.objects, cloudreve.Object{ID: "old-exe", Name: "app-v9.9.8-111111111111-submodhub-windows-amd64.exe", Type: "file"})
	provider.attach(t, s)

	s.maintainAppAssets(context.Background())
	if _, names, _ := provider.snapshot(); !slices.Equal(names, []string{"app-v9.9.8-111111111111-submodhub-windows-amd64.exe"}) {
		t.Fatalf("an idle pass must retire the previous installers: %+v", names)
	}

	// A second tick inside the pacing window must not list again.
	provider.objects = append(provider.objects, cloudreve.Object{ID: "old-two", Name: "app-v9.9.7-555555555555-submodhub-windows-amd64.exe", Type: "file"})
	_, _, listingsBefore := provider.snapshot()
	s.maintainAppAssets(context.Background())
	if ids, _, listings := provider.snapshot(); len(ids) != 1 || listings != listingsBefore {
		t.Fatalf("pacing violated: deleted=%+v listings=%d→%d", ids, listingsBefore, listings)
	}

	// Forcing the pass is what a later window does.
	s.pruneStaleAppAssets(context.Background(), true)
	if ids, _, _ := provider.snapshot(); !slices.Contains(ids, "old-two") {
		t.Fatalf("forced pass must retire the next leftover: %+v", ids)
	}
}

// The predicate decides what may be deleted, so it must match the names this
// server generates (installer, read-back residual) and nothing that merely looks
// similar. Archives share the directory and are never deleted by retention.
func TestAppAssetObjectPredicateCoversGeneratedNamesOnly(t *testing.T) {
	for _, tc := range []struct {
		name string
		want bool
	}{
		{"app-v9.9.9-abcdefabcdef-submodhub-windows-amd64.exe", true},
		{"app-v9.9.9-abcdefabcdef-submodhub-android-arm64.apk", true},
		{"app-v9.9.9-abcdefabcdef-updater.exe", true},
		// A read-back failure renames the object to "<name>-<12 hex>".
		{"app-v9.9.9-abcdefabcdef-updater.exe-0123456789ab", true},
		// Mod archives live in the same directory and are never retired.
		{"mod-1-abcdefabcdef.zip", false},
		{"app-mod-v1-abcdefabcdef.zip", false},
		// "app-" plus an installer suffix in the middle is not an installer.
		{"app-v1-notes.exe.txt", false},
		{"app-v1-notes.apk.bak", false},
		// A name that is not the generated shape must not be adopted as one.
		{"app-lesson.exe", true},
		{"v9.9.9-submodhub.exe", false},
		{"app-v1-updater.exe-notahash12", false},
	} {
		if got := isAppAssetObjectName(tc.name); got != tc.want {
			t.Errorf("isAppAssetObjectName(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// A ready row without an object name would otherwise produce a keep set that
// matches nothing, which is the one failure direction that deletes the served
// installers. Unusable input means "retire nothing".
func TestAppAssetRetentionKeepsInstallersWhenTheKeepSetIsUnusable(t *testing.T) {
	release := newFakeAppRelease(t)
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode()})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	provider := &fakeAppProvider{}
	rows := readyAppMirrors(t, s, provider, "v9.9.9")
	rows[0].ObjectName = ""
	s.Catalog.AppAssetMirrors = rows
	provider.objects = append(provider.objects, cloudreve.Object{ID: "old-exe", Name: "app-v9.9.8-111111111111-submodhub-windows-amd64.exe", Type: "file"})
	provider.attach(t, s)

	s.pruneStaleAppAssets(context.Background(), true)

	if ids, _, listings := provider.snapshot(); len(ids) != 0 || listings != 0 {
		t.Fatalf("an unusable keep set must retire nothing: deleted=%+v listings=%d", ids, listings)
	}
}

// "先齐后删" is a per-node rule: one incomplete node must not stop another node
// from collapsing, and must not be touched itself.
func TestAppAssetRetentionRunsPerNode(t *testing.T) {
	release := newFakeAppRelease(t)
	edge := DeliveryNode{ID: "edge", Type: "cloudreve", Enabled: true, Weight: 1, Revision: 1, Directory: "/SubmodHub"}
	s := newAppUpdateStore(t, release, []DeliveryNode{cloudreveTestNode(), edge})
	if err := s.refreshAppRelease(context.Background(), true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	complete := &fakeAppProvider{}
	rows := readyAppMirrors(t, s, complete, "v9.9.9")
	incomplete := make([]AppAssetMirror, 0, len(rows))
	for _, row := range rows {
		row.NodeID, row.State, row.FileID = "edge", "pending", ""
		incomplete = append(incomplete, row)
	}
	s.Catalog.AppAssetMirrors = append(rows, incomplete...)

	edgeProvider := &fakeAppProvider{}
	complete.objects = append(complete.objects, cloudreve.Object{ID: "old-cloud", Name: "app-v9.9.8-111111111111-submodhub-windows-amd64.exe", Type: "file"})
	edgeProvider.objects = append(edgeProvider.objects, cloudreve.Object{ID: "old-edge", Name: "app-v9.9.8-222222222222-submodhub-windows-amd64.exe", Type: "file"})
	complete.attachAs(t, s, "cloud", 1)
	edgeProvider.attachAs(t, s, "edge", 1)

	s.pruneStaleAppAssets(context.Background(), true)

	if _, names, _ := complete.snapshot(); !slices.Equal(names, []string{"app-v9.9.8-111111111111-submodhub-windows-amd64.exe"}) {
		t.Fatalf("the complete node must retire its old installer: %+v", names)
	}
	if ids, _, listings := edgeProvider.snapshot(); len(ids) != 0 || listings != 0 {
		t.Fatalf("an incomplete node must not be touched: deleted=%+v listings=%d", ids, listings)
	}
}

// Pacing is per node revision, so a node that is reconfigured or re-added must
// not inherit the previous window — and the table must not keep dead keys.
func TestAppAssetPrunePacingIsDroppedWithTheNodeSession(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{DeliveryNodes: []DeliveryNode{cloudreveTestNode()}})
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	node := cloudreveTestNode()
	if !s.reserveAppPrune(node) {
		t.Fatal("the first pass must be allowed")
	}
	if s.reserveAppPrune(node) {
		t.Fatal("a pass inside the window must be paced")
	}

	s.forgetDeliverySession(node.ID)

	if !s.reserveAppPrune(node) {
		t.Fatal("a re-added node must not inherit the old pacing window")
	}
	s.deliveryRuntime.pruneMu.Lock()
	keys := len(s.deliveryRuntime.appPruneAt)
	s.deliveryRuntime.pruneMu.Unlock()
	if keys != 1 {
		t.Fatalf("pacing table must not accumulate dead node keys: %d", keys)
	}
}
