package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

// brokenBundleZip is an archive whose entries disagree about the package root: two
// sibling folders each carry their own game/, which is what the L&DL release bundle
// looks like. The scanner rejects it before anything is imported.
func brokenBundleZip(t *testing.T) []byte {
	t.Helper()
	return createTestZipFiles(t, map[string]string{
		"Literary Submod/game/mod_assets/monika/a.json":   "{}",
		"Spritepacks/frame/game/mod_assets/monika/b.json": "{}",
	})
}

// A repository that keeps uploading structurally broken archives must not be
// retried by the sweep: each attempt pays for a full download first, and the next
// release usually fails the same way. The catalogue records the verdicts, so the
// pause survives a restart; an explicit sync is still the retry path.
func TestGitHubSyncStopsRetryingStructuralRejects(t *testing.T) {
	broken := brokenBundleZip(t)

	var downloads int
	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/repos/octocat/bundle/releases":
			fmt.Fprintf(w, `[{"id":601,"tag_name":"v3.0.0","assets":[{"id":602,"name":"bundle.zip","size":%d,"browser_download_url":%q}]},`+
				`{"id":603,"tag_name":"v2.0.0","assets":[{"id":604,"name":"bundle.zip","size":%d,"browser_download_url":%q}]},`+
				`{"id":605,"tag_name":"v1.0.0","assets":[{"id":606,"name":"bundle.zip","size":%d,"browser_download_url":%q}]}]`,
				len(broken), ghServer.URL+"/download/3.zip",
				len(broken), ghServer.URL+"/download/2.zip",
				len(broken), ghServer.URL+"/download/1.zip")
		case strings.HasPrefix(r.URL.Path, "/download/"):
			downloads++
			_, _ = w.Write(broken)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "bundle", Author: Author{ID: "author"}, Category: "submod",
		SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "bundle",
		GitHubAssetRegex: `.*\.zip`,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	// First pass: it tries releases until the threshold is reached, then skips the
	// backlog instead of draining the remaining releases.
	summary, err := store.SyncMod(context.Background(), "bundle")
	if err != nil {
		t.Fatalf("first sync failed: %v", err)
	}
	if summary.Failed != githubRejectedAutoRetryLimit {
		t.Fatalf("first pass: expected %d rejections, got %+v", githubRejectedAutoRetryLimit, summary)
	}
	if downloads != githubRejectedAutoRetryLimit {
		t.Fatalf("first pass downloaded %d archives, want %d", downloads, githubRejectedAutoRetryLimit)
	}
	if last := summary.Items[len(summary.Items)-1]; last.Action != "skipped" || !strings.Contains(last.Reason, "automatic sync paused") {
		t.Fatalf("first pass did not report the pause: %+v", last)
	}
	// The rejections must be the structural kind the threshold exists for, not a
	// size or network verdict that stays retryable.
	if reason := summary.Items[0].Reason; !strings.Contains(reason, "ambiguous package roots") {
		t.Fatalf("unexpected rejection reason: %q", reason)
	}
	if rejected, _, _ := store.rejectionVerdicts("bundle"); rejected != githubRejectedAutoRetryLimit {
		t.Fatalf("recorded rejections = %d, want %d", rejected, githubRejectedAutoRetryLimit)
	}

	// Second pass: nothing is downloaded. Neither the recorded releases nor the
	// untouched backlog behind the pause are worth another attempt.
	before := downloads
	if _, err := store.SyncMod(context.Background(), "bundle"); err != nil {
		t.Fatalf("second sync failed: %v", err)
	}
	if downloads != before {
		t.Fatalf("second pass downloaded %d more archives, want 0", downloads-before)
	}
	// Whatever the pass decides, the mod must say why: the workbench renders
	// github_last_sync_error, and a silent mod looks merely "without versions".
	store.mu.RLock()
	lastError := store.Catalog.Mods[0].GitHubLastSyncError
	store.mu.RUnlock()
	if !strings.Contains(lastError, "ambiguous package roots") {
		t.Fatalf("second pass left no explanation: %q", lastError)
	}

	// An explicit sync still retries everything, because it is the operator's
	// decision rather than the sweep's schedule.
	before = downloads
	if summary, err := store.syncMod(context.Background(), "bundle", true); err != nil {
		t.Fatalf("forced sync failed: %v", err)
	} else if summary.Failed != 3 {
		t.Fatalf("forced sync: expected three attempts, got %+v", summary)
	}
	if got := downloads - before; got != 3 {
		t.Fatalf("forced sync downloaded %d archives, want 3", got)
	}
}

// The pause lifts on an author change, not on a timer: a release newer than every
// recorded verdict is tried, and so is a release we already rejected whose asset was
// replaced (same tag, new bytes). The untouched one stays skipped.
func TestGitHubSyncRetriesWhenAuthorRepublishes(t *testing.T) {
	broken := brokenBundleZip(t)
	verdictAt := time.Now().UTC().Add(-24 * time.Hour)

	var downloads int
	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/repos/octocat/bundle/releases":
			fmt.Fprintf(w, `[{"id":805,"tag_name":"v4.0.0","assets":[{"id":806,"name":"bundle.zip","size":%d,"browser_download_url":%q}]},`+
				`{"id":801,"tag_name":"v3.0.0","assets":[{"id":899,"name":"bundle.zip","size":%d,"browser_download_url":%q}]},`+
				`{"id":803,"tag_name":"v2.0.0","assets":[{"id":804,"name":"bundle.zip","size":%d,"browser_download_url":%q}]}]`,
				len(broken), ghServer.URL+"/download/4.zip",
				len(broken), ghServer.URL+"/download/3-replaced.zip",
				len(broken), ghServer.URL+"/download/2.zip")
		case strings.HasPrefix(r.URL.Path, "/download/"):
			downloads++
			t.Logf("downloaded %s", r.URL.Path)
			_, _ = w.Write(broken)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "bundle", Author: Author{ID: "author"}, Category: "submod",
		SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "bundle",
		GitHubAssetRegex: `.*\.zip`,
		GitHubReleaseFailures: []GitHubReleaseFailure{
			// Two rejections: the pause is on before the pass starts.
			{ReleaseID: 801, Tag: "v3.0.0", AssetID: 802, AssetName: "bundle.zip", AssetSize: 1024,
				Kind: releaseFailureRejected, Reason: "archive rejected: ambiguous package roots", RecordedAt: verdictAt},
			{ReleaseID: 803, Tag: "v2.0.0", AssetID: 804, AssetName: "bundle.zip", AssetSize: int64(len(broken)),
				Kind: releaseFailureRejected, Reason: "archive rejected: ambiguous package roots", RecordedAt: verdictAt},
		},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	summary, err := store.SyncMod(context.Background(), "bundle")
	if err != nil {
		t.Fatalf("sync failed: %v", err)
	}
	// v4.0.0 is new, v3.0.0 was re-uploaded, v2.0.0 is untouched and stays skipped.
	if downloads != 2 {
		t.Fatalf("downloaded %d archives, want 2 (new release + replaced asset); items=%+v", downloads, summary.Items)
	}
	// The untouched release is answered from its record instead of a new download.
	var untouched *SyncItemResult
	for i := range summary.Items {
		if summary.Items[i].ReleaseID == 803 {
			untouched = &summary.Items[i]
		}
	}
	if untouched == nil || !strings.Contains(untouched.Reason, "recorded") {
		t.Fatalf("untouched release was not answered from its verdict: %+v", summary.Items)
	}
}

// A backlog entry that was never attempted (older than every verdict) is not an
// author update, so the pause keeps it skipped.
func TestGitHubSyncPauseSkipsUntouchedBacklog(t *testing.T) {
	broken := brokenBundleZip(t)
	verdictAt := time.Now().UTC().Add(-24 * time.Hour)

	var downloads int
	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/repos/octocat/bundle/releases":
			fmt.Fprintf(w, `[{"id":701,"tag_name":"v1.0.0","assets":[{"id":702,"name":"bundle.zip","size":%d,"browser_download_url":%q}]}]`,
				len(broken), ghServer.URL+"/download/1.zip")
		case strings.HasPrefix(r.URL.Path, "/download/"):
			downloads++
			_, _ = w.Write(broken)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ghServer.Close()

	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "bundle", Author: Author{ID: "author"}, Category: "submod",
		SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "bundle",
		GitHubAssetRegex: `.*\.zip`,
		GitHubReleaseFailures: []GitHubReleaseFailure{
			{ReleaseID: 900, Tag: "v9.0.0", AssetID: 901, AssetName: "bundle.zip", AssetSize: 1024,
				Kind: releaseFailureRejected, Reason: "archive rejected: ambiguous package roots", RecordedAt: verdictAt},
			{ReleaseID: 902, Tag: "v8.0.0", AssetID: 903, AssetName: "bundle.zip", AssetSize: 1024,
				Kind: releaseFailureRejected, Reason: "archive rejected: ambiguous package roots", RecordedAt: verdictAt},
		},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	if _, err := store.SyncMod(context.Background(), "bundle"); err != nil {
		t.Fatalf("sync failed: %v", err)
	}
	if downloads != 0 {
		t.Fatalf("backlog release was downloaded %d times; the pause should hold it", downloads)
	}
	// A pass that is nothing but pause-skips still says so, instead of clearing the
	// error and looking like a healthy mod.
	store.mu.RLock()
	lastError := store.Catalog.Mods[0].GitHubLastSyncError
	store.mu.RUnlock()
	if !strings.Contains(lastError, "automatic sync paused") {
		t.Fatalf("paused pass did not surface a reason: %q", lastError)
	}
}

// A pass that learns nothing about the archives (unchanged release list, so the
// ETag short-circuits the walk) must not erase the reason the last import failed —
// that line is the only place the author workbench explains why a release never
// appeared.
func TestGitHubSyncKeepsRejectionVisibleWhenNothingChanged(t *testing.T) {
	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/octocat/bundle/releases" {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		http.NotFound(w, r)
	}))
	defer ghServer.Close()

	const verdict = "archive rejected: ambiguous package roots (recorded 2026-11-12T10:00:36Z)"
	store, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{
		ID: "bundle", Author: Author{ID: "author"}, Category: "submod",
		SourceType: "github_releases", GitHubOwner: "octocat", GitHubRepo: "bundle",
		GitHubAssetRegex:    `.*\.zip`,
		GitHubLastSyncError: verdict,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubClient = github.NewClient(github.WithBaseURL(ghServer.URL), github.WithHTTPClient(ghServer.Client()))

	if _, err := store.SyncMod(context.Background(), "bundle"); err != nil {
		t.Fatalf("sync failed: %v", err)
	}
	store.mu.RLock()
	mod := store.Catalog.Mods[0]
	store.mu.RUnlock()
	if mod.GitHubLastSyncError != verdict {
		t.Fatalf("empty release list erased the verdict: %q", mod.GitHubLastSyncError)
	}
	if mod.GitHubLastSyncAt == nil {
		t.Fatal("the pass did not record its own timestamp")
	}
}
