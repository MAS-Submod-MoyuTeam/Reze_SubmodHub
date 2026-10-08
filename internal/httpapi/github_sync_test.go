package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

func createTestZip(t *testing.T, submodCode string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	entry, err := zw.Create("game/Submods/demo/main.rpy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte(submodCode)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestGitHubLatestFollowsMarkedReleaseEvenWhenListUnchanged(t *testing.T) {
	latestID := int64(101)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/hello/releases/latest" {
			fmt.Fprintf(w, `{"id":%d}`, latestID)
			return
		}
		if r.URL.Path == "/repos/octocat/hello/releases" {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{{ID: "latest", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "hello", LatestVersionID: "newer"}},
		Versions: map[string]Version{
			"older":   {ID: "older", ModID: "latest", State: "published", GitHubReleaseID: 101},
			"newer":   {ID: "newer", ModID: "latest", State: "published", GitHubReleaseID: 102},
			"blocked": {ID: "blocked", ModID: "latest", State: "scanning", GitHubReleaseID: 103},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	for _, tc := range []struct {
		release int64
		want    string
	}{{101, "older"}, {102, "newer"}, {103, "newer"}, {999, "newer"}} {
		latestID = tc.release
		if _, err := store.SyncMod(context.Background(), "latest"); err != nil {
			t.Fatal(err)
		}
		if got := store.Catalog.Mods[0].LatestVersionID; got != tc.want {
			t.Fatalf("latest release %d: got %q, want %q", tc.release, got, tc.want)
		}
	}
}

func TestGitHubSourceZipRootReadmeDoesNotBlockPublishing(t *testing.T) {
	for _, tc := range []struct {
		name, extra, wantState string
	}{
		{"root readme", "repo-abc123/README.md", "published"},
		{"nested readme with auto publish", "repo-abc123/docs/README.md", "published"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			zw := zip.NewWriter(&buf)
			for name, body := range map[string]string{
				"repo-abc123/game/Submods/demo/main.rpy": "init python:\n    pass\n",
				tc.extra:                                 "documentation",
			} {
				entry, err := zw.Create(name)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := entry.Write([]byte(body)); err != nil {
					t.Fatal(err)
				}
			}
			if err := zw.Close(); err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/repos/octocat/hello/releases" {
					fmt.Fprintf(w, `[{"id":101,"tag_name":"v1.0.0","zipball_url":"http://%s/zipball"}]`, r.Host)
					return
				}
				if r.URL.Path == "/zipball" {
					_, _ = w.Write(buf.Bytes())
					return
				}
				http.NotFound(w, r)
			}))
			defer server.Close()
			store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
				ID: "mod_1", Category: "submod", SourceType: "github_releases",
				GitHubOwner: "octocat", GitHubRepo: "hello", GitHubSourceCode: true,
			}}})
			if err != nil {
				t.Fatal(err)
			}
			store.AutoPublish = true
			store.GitHubClient = github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
			summary, err := store.SyncMod(context.Background(), "mod_1")
			if err != nil || summary.Created != 1 {
				t.Fatalf("sync: %+v, %v", summary, err)
			}
			v := store.Catalog.Versions[summary.Items[0].VersionID]
			if v.State != tc.wantState {
				t.Fatalf("state = %q, want %q; report = %+v", v.State, tc.wantState, store.Catalog.ScanReports[v.ScanReportID])
			}
			report := store.Catalog.ScanReports[v.ScanReportID]
			if tc.wantState == "published" && len(report.Files) != 1 {
				t.Fatalf("unexpected report: %+v", report)
			}
			if tc.name == "nested readme with auto publish" && len(report.Unsupported) != 1 {
				t.Fatalf("auto-published version must retain unsupported-file findings: %+v", report)
			}
		})
	}
}

func TestGitHubSyncSuccessAndIdempotency(t *testing.T) {
	zipData := createTestZip(t, "init python:\n    pass\n")

	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/hello/releases" {
			w.Header().Set("ETag", `"etag-v1"`)
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `[
				{
					"id": 101,
					"tag_name": "v1.0.0",
					"name": "Release 1.0.0",
					"body": "First release notes",
					"draft": false,
					"zipball_url": "",
					"assets": [
						{
							"id": 501,
							"name": "demo-v1.0.0.zip",
							"size": 1024,
							"browser_download_url": "%s/download/demo-v1.0.0.zip"
						}
					]
				}
			]`, ghServer.URL)
			return
		}
		if r.URL.Path == "/download/demo-v1.0.0.zip" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(zipData)
			return
		}
		http.NotFound(w, r)
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:               "mod_1",
				Title:            "Demo Mod",
				Summary:          "Summary",
				Category:         "submod",
				Author:           Author{ID: "author_1", DisplayName: "Author One"},
				SourceType:       "github_releases",
				GitHubOwner:      "octocat",
				GitHubRepo:       "hello",
				GitHubAssetRegex: `.*\.zip`,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	// 1. First sync: should create version v1.0.0
	summary, err := store.SyncMod(context.Background(), "mod_1")
	if err != nil {
		t.Fatalf("first sync failed: %v", err)
	}
	if summary.Created != 1 || summary.Skipped != 0 || summary.Failed != 0 {
		t.Fatalf("unexpected summary on first sync: %+v", summary)
	}
	if len(summary.Items) != 1 || summary.Items[0].Tag != "v1.0.0" || summary.Items[0].Action != "created" {
		t.Fatalf("unexpected summary items: %+v", summary.Items)
	}

	// Verify catalog state
	store.mu.RLock()
	mod := store.Catalog.Mods[0]
	if mod.GitHubLastSyncAt == nil || mod.GitHubLastSyncError != "" || mod.GitHubLastReleaseID != 101 {
		t.Fatalf("unexpected mod sync state: sync_at=%v, err=%q, last_id=%d",
			mod.GitHubLastSyncAt, mod.GitHubLastSyncError, mod.GitHubLastReleaseID)
	}
	if len(store.Catalog.Versions) != 1 {
		t.Fatalf("expected 1 version, got %d", len(store.Catalog.Versions))
	}
	var createdVer Version
	for _, v := range store.Catalog.Versions {
		createdVer = v
	}
	store.mu.RUnlock()

	if createdVer.Version != "v1.0.0" {
		t.Fatalf("expected version tag v1.0.0, got %q", createdVer.Version)
	}
	if createdVer.GitHubReleaseID != 101 {
		t.Fatalf("expected GitHubReleaseID 101, got %d", createdVer.GitHubReleaseID)
	}
	if createdVer.SourceType != "github_releases" {
		t.Fatalf("expected SourceType github_releases, got %q", createdVer.SourceType)
	}
	if createdVer.State != "ready_for_review" {
		t.Fatalf("expected state ready_for_review, got %q", createdVer.State)
	}
	if createdVer.SHA256 == "" || createdVer.SizeBytes == 0 || createdVer.ScanReportID == "" {
		t.Fatalf("version missing archive details: %+v", createdVer)
	}

	// 2. Second sync: idempotency should skip already synced release
	summary2, err := store.SyncMod(context.Background(), "mod_1")
	if err != nil {
		t.Fatalf("second sync failed: %v", err)
	}
	if summary2.Created != 0 || summary2.Skipped != 1 || summary2.Failed != 0 {
		t.Fatalf("expected 0 created and 1 skipped, got %+v", summary2)
	}
	if len(store.Catalog.Versions) != 1 {
		t.Fatalf("duplicate version created: %d versions", len(store.Catalog.Versions))
	}
}

func TestGitHubSyncSkipsReleaseWithoutMatchingAsset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/no-asset/releases" {
			fmt.Fprint(w, `[{"id":404,"tag_name":"v2.0.0","assets":[{"id":1,"name":"installer.exe","browser_download_url":"https://example.com/installer.exe"}]}]`)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "mod_no_asset", Title: "No Asset", Category: "submod", Author: Author{ID: "author_1"},
		SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "no-asset",
		GitHubAssetRegex: `^Expected-.*\.zip$`, GitHubSourceCode: false,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))

	summary, err := store.SyncMod(context.Background(), "mod_no_asset")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Created != 0 || summary.Failed != 0 || summary.Skipped != 1 {
		t.Fatalf("expected one skipped release and no failures: %+v", summary)
	}
	if summary.Items[0].Action != "skipped" || summary.Items[0].Reason != "no matching zip release asset found and source code fallback is disabled" {
		t.Fatalf("unexpected skipped item: %+v", summary.Items[0])
	}
	if store.Catalog.Mods[0].GitHubLastSyncError != "" {
		t.Fatalf("expected no sync error for skipped release, got %q", store.Catalog.Mods[0].GitHubLastSyncError)
	}
}

func TestGitHubSyncAutoPublishPromotesPreviouslyBlockedVersion(t *testing.T) {
	zipData := createTestZip(t, "init python:\n    pass\n")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/reconcile/releases" {
			fmt.Fprint(w, `[{"id":901,"tag_name":"v1.0.0","assets":[{"id":1,"name":"mod.zip","browser_download_url":"`+"PLACEHOLDER"+`"}]}]`)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	// Use the test server URL in the release payload without changing the
	// production client behavior.
	server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/reconcile/releases" {
			fmt.Fprintf(w, `[{"id":901,"tag_name":"v1.0.0","assets":[{"id":1,"name":"mod.zip","browser_download_url":"%s/archive"}]}]`, server.URL)
			return
		}
		if r.URL.Path == "/archive" {
			_, _ = w.Write(zipData)
			return
		}
		http.NotFound(w, r)
	})
	store, err := NewStore(t.TempDir(), Catalog{
		Mods:     []Mod{{ID: "reconcile", Category: "submod", SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "reconcile"}},
		Versions: map[string]Version{"old": {ID: "old", ModID: "reconcile", Version: "v1.0.0", State: "scanning", GitHubReleaseID: 901}},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.AutoPublish = true
	store.GitHubClient = github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))
	summary, err := store.SyncMod(context.Background(), "reconcile")
	if err != nil || summary.Skipped != 1 {
		t.Fatalf("sync = %+v, err = %v", summary, err)
	}
	if got := store.Catalog.Versions["old"].State; got != "published" {
		t.Fatalf("existing blocked version state = %q, want published", got)
	}
}

func TestGitHubSyncPersistsETagWhenReleaseImportFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/octocat/partial/releases" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", `"partial-v1"`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `[{"id":301,"tag_name":"v1.0.0","draft":false,"assets":[]}]`)
	}))
	defer server.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "partial", Author: Author{ID: "author"}, Category: "submod",
		SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "partial",
		GitHubAssetRegex: `[invalid`,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(server.URL), github.WithHTTPClient(server.Client()))

	summary, err := store.SyncMod(context.Background(), "partial")
	if err != nil || summary.Failed != 1 {
		t.Fatalf("expected one failed release import, summary=%+v err=%v", summary, err)
	}
	store.mu.RLock()
	etag := store.Catalog.Mods[0].GitHubETag
	store.mu.RUnlock()
	if etag != `"partial-v1"` {
		t.Fatalf("expected ETag to persist after partial failure, got %q", etag)
	}
}

func TestGitHubSyncRetriesFailedReleaseDespiteETag(t *testing.T) {
	for _, force := range []bool{false, true} {
		t.Run(fmt.Sprintf("force=%t", force), func(t *testing.T) {
			zipData := createTestZip(t, "init python:\n    pass\n")
			var downloads, conditionalRequests int
			var ghServer *httptest.Server
			ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/repos/octocat/retry/releases":
					if r.Header.Get("If-None-Match") != "" {
						conditionalRequests++
						w.WriteHeader(http.StatusNotModified)
						return
					}
					w.Header().Set("ETag", `"retry-v1"`)
					fmt.Fprintf(w, `[{"id":401,"tag_name":"v1.0.0","assets":[{"id":402,"name":"demo.zip","browser_download_url":%q}]}]`, ghServer.URL+"/download/demo.zip")
				case "/download/demo.zip":
					downloads++
					if downloads == 1 {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					_, _ = w.Write(zipData)
				default:
					http.NotFound(w, r)
				}
			}))
			defer ghServer.Close()

			store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
				ID: "retry", Author: Author{ID: "author"}, Category: "submod",
				SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "retry",
				GitHubAssetRegex: `.*\.zip`,
			}}})
			if err != nil {
				t.Fatal(err)
			}
			store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

			first, err := store.SyncMod(context.Background(), "retry")
			if err != nil || first.Failed != 1 {
				t.Fatalf("expected initial download failure, summary=%+v err=%v", first, err)
			}
			if force {
				// Recover the state left by an older 304 that cleared the import error.
				store.Catalog.Mods[0].GitHubLastSyncError = ""
			}
			second, err := store.syncMod(context.Background(), "retry", force)
			if err != nil || second.Created != 1 || second.Failed != 0 {
				t.Fatalf("expected failed release to retry, summary=%+v err=%v", second, err)
			}
			if downloads != 2 || conditionalRequests != 0 {
				t.Fatalf("retry was skipped by ETag: downloads=%d conditionalRequests=%d", downloads, conditionalRequests)
			}
		})
	}
}

func TestGitHubSyncPublishedVersionNotOverwritten(t *testing.T) {
	zipData := createTestZip(t, "init python:\n    pass\n")
	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/hello/releases" {
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `[
				{
					"id": 202,
					"tag_name": "v1.0.0",
					"name": "Modified Release",
					"assets": [
						{
							"id": 601,
							"name": "demo.zip",
							"size": 1024,
							"browser_download_url": "%s/download/demo.zip"
						}
					]
				}
			]`, ghServer.URL)
			return
		}
		if r.URL.Path == "/download/demo.zip" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(zipData)
			return
		}
		http.NotFound(w, r)
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:               "mod_1",
				Title:            "Demo Mod",
				Summary:          "Summary",
				Category:         "submod",
				Author:           Author{ID: "author_1", DisplayName: "Author One"},
				SourceType:       "github_releases",
				GitHubOwner:      "octocat",
				GitHubRepo:       "hello",
				GitHubAssetRegex: `.*\.zip`,
				LatestVersionID:  "ver_published",
			},
		},
		Versions: map[string]Version{
			"ver_published": {
				ID:          "ver_published",
				ModID:       "mod_1",
				Version:     "v1.0.0",
				State:       "published",
				SHA256:      "original_sha256",
				ArchivePath: "/path/to/original.zip",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	summary, err := store.SyncMod(context.Background(), "mod_1")
	if err != nil {
		t.Fatalf("sync failed: %v", err)
	}
	if summary.Created != 0 || summary.Skipped != 1 {
		t.Fatalf("expected already existing published tag to be skipped, got %+v", summary)
	}
	// Verify original version remains untouched
	v := store.Catalog.Versions["ver_published"]
	if v.SHA256 != "original_sha256" || v.State != "published" {
		t.Fatalf("published version was mutated: %+v", v)
	}
}

func TestGitHubSyncDownloadFailureCleansUp(t *testing.T) {
	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/hello/releases" {
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `[
				{
					"id": 303,
					"tag_name": "v1.0.0",
					"assets": [
						{
							"id": 701,
							"name": "demo.zip",
							"size": 1024,
							"browser_download_url": "%s/download/corrupt.zip"
						}
					]
				}
			]`, ghServer.URL)
			return
		}
		if r.URL.Path == "/download/corrupt.zip" {
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprint(w, "internal server error")
			return
		}
		http.NotFound(w, r)
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:               "mod_1",
				Title:            "Demo Mod",
				Summary:          "Summary",
				Category:         "submod",
				Author:           Author{ID: "author_1", DisplayName: "Author One"},
				SourceType:       "github_releases",
				GitHubOwner:      "octocat",
				GitHubRepo:       "hello",
				GitHubAssetRegex: `.*\.zip`,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	summary, err := store.SyncMod(context.Background(), "mod_1")
	if err != nil {
		t.Fatalf("sync should not return fatal error on individual release download failure: %v", err)
	}
	if summary.Failed != 1 || summary.Created != 0 {
		t.Fatalf("expected 1 failed and 0 created, got %+v", summary)
	}

	// Verify no partial version was created
	if len(store.Catalog.Versions) != 0 {
		t.Fatalf("expected 0 versions created, got %d", len(store.Catalog.Versions))
	}
	// Verify mod recorded the error
	mod := store.Catalog.Mods[0]
	if mod.GitHubLastSyncError == "" {
		t.Fatal("expected GitHubLastSyncError to be recorded")
	}
}

func TestGitHubSyncTickerLifecycle(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubSyncInterval = 10 * time.Millisecond
	store.StartGitHubSync()

	// Wait briefly to let ticker tick
	time.Sleep(30 * time.Millisecond)

	// Closing store should stop loop gracefully
	if err := store.Close(); err != nil {
		t.Fatalf("close failed: %v", err)
	}

	// Calling Close again should be idempotent
	if err := store.Close(); err != nil {
		t.Fatalf("second close failed: %v", err)
	}
}

func TestGitHubSyncEmptyReleasesSavesETag(t *testing.T) {
	etagSent := false
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/empty/releases" {
			if r.Header.Get("If-None-Match") == `"etag-empty-1"` {
				etagSent = true
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", `"etag-empty-1"`)
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `[]`)
			return
		}
		http.NotFound(w, r)
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:          "mod_empty",
				Title:       "Empty Repo Mod",
				Summary:     "Summary",
				Category:    "submod",
				Author:      Author{ID: "author_1", DisplayName: "Author One"},
				SourceType:  "github_releases",
				GitHubOwner: "octocat",
				GitHubRepo:  "empty",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	// 1. Initial sync with empty releases from GitHub: should save ETag and timestamp
	summary, err := store.SyncMod(context.Background(), "mod_empty")
	if err != nil {
		t.Fatalf("sync empty repo failed: %v", err)
	}
	if summary.Created != 0 || summary.Skipped != 0 || summary.Failed != 0 {
		t.Fatalf("unexpected summary for empty releases: %+v", summary)
	}

	store.mu.RLock()
	mod := store.Catalog.Mods[0]
	if mod.GitHubETag != `"etag-empty-1"` {
		t.Fatalf("expected GitHubETag \"etag-empty-1\", got %q", mod.GitHubETag)
	}
	if mod.GitHubLastSyncAt == nil {
		t.Fatal("expected GitHubLastSyncAt to be updated on empty release list")
	}
	if mod.GitHubLastSyncError != "" {
		t.Fatalf("expected empty GitHubLastSyncError, got %q", mod.GitHubLastSyncError)
	}
	store.mu.RUnlock()

	// 2. Second sync: must send saved If-None-Match header
	summary2, err := store.SyncMod(context.Background(), "mod_empty")
	if err != nil {
		t.Fatalf("second sync failed: %v", err)
	}
	if !etagSent {
		t.Fatal("expected If-None-Match header to be sent on second sync")
	}
	if summary2.Created != 0 || summary2.Failed != 0 {
		t.Fatalf("unexpected summary2: %+v", summary2)
	}
}

func TestGitHubSyncRateLimitBackoff(t *testing.T) {
	requestsCount := 0
	futureReset := time.Now().Add(45 * time.Minute)
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestsCount++
		w.Header().Set("X-Ratelimit-Reset", fmt.Sprintf("%d", futureReset.Unix()))
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"message":"API rate limit exceeded"}`)
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{
			{
				ID:          "mod_ratelimit",
				Title:       "Ratelimit Mod",
				Summary:     "Summary",
				Category:    "submod",
				Author:      Author{ID: "author_1", DisplayName: "Author One"},
				SourceType:  "github_releases",
				GitHubOwner: "octocat",
				GitHubRepo:  "ratelimited",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	// 1. First sync hits 429
	summary1, err := store.SyncMod(context.Background(), "mod_ratelimit")
	if err != nil {
		t.Fatalf("SyncMod should not return fatal err: %v", err)
	}
	if summary1.Failed != 1 {
		t.Fatalf("expected 1 failure on rate limit, got %+v", summary1)
	}
	if requestsCount != 1 {
		t.Fatalf("expected 1 request, got %d", requestsCount)
	}

	store.mu.RLock()
	mod := store.Catalog.Mods[0]
	if mod.GitHubBackoffUntil == nil {
		t.Fatal("expected GitHubBackoffUntil to be recorded on mod")
	}
	if mod.GitHubBackoffUntil.Unix() != futureReset.Unix() {
		t.Fatalf("expected backoff until %v, got %v", futureReset.Unix(), mod.GitHubBackoffUntil.Unix())
	}
	store.mu.RUnlock()

	// 2. Second sync immediately: should be suppressed by backoff, NOT making a network request
	summary2, err := store.SyncMod(context.Background(), "mod_ratelimit")
	if err != nil {
		t.Fatalf("SyncMod should not return fatal err: %v", err)
	}
	if summary2.Failed != 1 {
		t.Fatalf("expected failure recorded: %+v", summary2)
	}
	if requestsCount != 1 {
		t.Fatalf("expected requestsCount to stay 1 due to backoff, got %d", requestsCount)
	}

	// 3. SyncAllGitHubMods should also be suppressed by store-level backoff
	allResults := store.SyncAllGitHubMods(context.Background())
	if requestsCount != 1 {
		t.Fatalf("SyncAllGitHubMods should have skipped network requests, got %d calls", requestsCount)
	}
	if allResults["mod_ratelimit"] == nil || allResults["mod_ratelimit"].Failed != 1 {
		t.Fatalf("expected backoff summary in SyncAllGitHubMods: %+v", allResults)
	}
}
