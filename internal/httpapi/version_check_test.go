package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

// releasesProbeServer serves the releases list the six-hour check reads. The
// JSON is the subset of the GitHub payload the client decodes.
func releasesProbeServer(t *testing.T, tags ...string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/reze/demo/releases" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "[")
		for i, tag := range tags {
			if i > 0 {
				fmt.Fprint(w, ",")
			}
			fmt.Fprintf(w, `{"id":%d,"tag_name":%q,"draft":false,"prerelease":false}`, i+1, tag)
		}
		fmt.Fprint(w, "]")
	}))
}

func versionCheckStore(t *testing.T, served string) *Store {
	t.Helper()
	recent := time.Now().UTC()
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{{
			ID:               "mod_gh",
			Title:            "GH",
			Category:         "submod",
			SourceType:       "github_releases",
			GitHubOwner:      "reze",
			GitHubRepo:       "demo",
			GitHubAssetRegex: `.*\.zip`,
			GitHubLastSyncAt: &recent,
		}},
		Versions: map[string]Version{
			"ver_1": {ID: "ver_1", ModID: "mod_gh", Version: served, State: "published"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.GitHubSyncMaxAge = time.Hour
	return store
}

// A release above what the catalog serves is the signal: the mod becomes due and
// the ordinary sync path picks it up. This is the probe every repository already
// supports, because publishing a release is what authors already do.
func TestVersionCheckMarksStaleWhenReleaseTagIsNewer(t *testing.T) {
	probe := releasesProbeServer(t, "v2.0.0", "v1.0.0")
	defer probe.Close()

	store := versionCheckStore(t, "1.0.0")
	store.GitHubClient = github.NewClient(github.WithBaseURL(probe.URL), github.WithHTTPClient(probe.Client()))

	changed, served, announced := store.CheckModVersion(context.Background(), "mod_gh")
	if !changed {
		t.Fatalf("expected a change: served=%q announced=%q", served, announced)
	}
	if served != "1.0.0" || announced != "v2.0.0" {
		t.Fatalf("unexpected comparison: served=%q announced=%q", served, announced)
	}
	if mod := lookupMod(store, "mod_gh"); mod.GitHubLastSyncAt != nil {
		t.Fatal("a newer release must clear the sync clock")
	}
}

// The same tag must not trigger anything, and must not re-trigger on the next
// pass either: an idle repository costs one list read per interval, nothing more.
func TestVersionCheckIsQuietWhenReleaseMatchesServed(t *testing.T) {
	probe := releasesProbeServer(t, "v1.0.0")
	defer probe.Close()

	store := versionCheckStore(t, "1.0.0")
	store.GitHubClient = github.NewClient(github.WithBaseURL(probe.URL), github.WithHTTPClient(probe.Client()))

	for pass := 0; pass < 2; pass++ {
		if changed, _, _ := store.CheckModVersion(context.Background(), "mod_gh"); changed {
			t.Fatalf("pass %d reported a change for an unchanged tag", pass)
		}
		if mod := lookupMod(store, "mod_gh"); mod.GitHubLastSyncAt == nil {
			t.Fatalf("pass %d cleared the sync clock without a change", pass)
		}
	}
}

// An older tag must never count as a change: the repository can hold releases
// the catalog already passed (a back-filled patch, a maintenance branch).
func TestVersionCheckIgnoresOlderReleaseTags(t *testing.T) {
	probe := releasesProbeServer(t, "v0.9.0", "v0.8.0")
	defer probe.Close()

	store := versionCheckStore(t, "1.0.0")
	store.GitHubClient = github.NewClient(github.WithBaseURL(probe.URL), github.WithHTTPClient(probe.Client()))

	if changed, _, announced := store.CheckModVersion(context.Background(), "mod_gh"); changed {
		t.Fatalf("an older release (%q) must not count as a change", announced)
	}
}

// Drafts and prereleases are not importable, so they may not trigger a sync.
func TestVersionCheckSkipsDraftsAndPrereleases(t *testing.T) {
	probe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `[
			{"id":1,"tag_name":"v9.0.0","draft":true,"prerelease":false},
			{"id":2,"tag_name":"v8.0.0","draft":false,"prerelease":true},
			{"id":3,"tag_name":"v1.0.0","draft":false,"prerelease":false}
		]`)
	}))
	defer probe.Close()

	store := versionCheckStore(t, "1.0.0")
	store.GitHubClient = github.NewClient(github.WithBaseURL(probe.URL), github.WithHTTPClient(probe.Client()))

	if changed, _, announced := store.CheckModVersion(context.Background(), "mod_gh"); changed {
		t.Fatalf("drafts/prereleases must not count as changes (got %q)", announced)
	}
}

// "latest" is ordered by creation time, so a back-filled old release can be the
// newest row. The probe must answer "highest version", not "first row".
func TestVersionCheckPicksHighestNotFirstRelease(t *testing.T) {
	probe := releasesProbeServer(t, "v1.0.0", "v2.0.0", "v1.5.0")
	defer probe.Close()

	store := versionCheckStore(t, "1.0.0")
	store.GitHubClient = github.NewClient(github.WithBaseURL(probe.URL), github.WithHTTPClient(probe.Client()))

	changed, _, announced := store.CheckModVersion(context.Background(), "mod_gh")
	if !changed || announced != "v2.0.0" {
		t.Fatalf("expected v2.0.0 to be selected, got changed=%v announced=%q", changed, announced)
	}
}

// A repository with no published release has nothing to compare against. That is
// not a change, and it must not fail the pass either.
func TestVersionCheckHandlesRepositoryWithoutReleases(t *testing.T) {
	probe := releasesProbeServer(t)
	defer probe.Close()

	store := versionCheckStore(t, "1.0.0")
	store.GitHubClient = github.NewClient(github.WithBaseURL(probe.URL), github.WithHTTPClient(probe.Client()))

	if changed, _, _ := store.CheckModVersion(context.Background(), "mod_gh"); changed {
		t.Fatal("a repository without releases must not report a change")
	}
	mod := lookupMod(store, "mod_gh")
	if mod.GitHubVersionCheckedAt == nil {
		t.Fatal("the check clock must advance even without releases")
	}
	if mod.GitHubLastSyncAt == nil {
		t.Fatal("a repository without releases must not force a sync")
	}
}

// An unreachable list is not evidence of a new version. The clock still advances
// so a broken repository is not re-probed on every sweep.
func TestVersionCheckAdvancesClockOnProbeFailure(t *testing.T) {
	probe := httptest.NewServer(http.NotFoundHandler())
	defer probe.Close()

	store := versionCheckStore(t, "1.0.0")
	store.GitHubClient = github.NewClient(github.WithBaseURL(probe.URL), github.WithHTTPClient(probe.Client()))

	if changed, _, _ := store.CheckModVersion(context.Background(), "mod_gh"); changed {
		t.Fatal("a failed probe must not report a change")
	}
	mod := lookupMod(store, "mod_gh")
	if mod.GitHubVersionCheckedAt == nil {
		t.Fatal("a failed probe must still advance the check clock")
	}
	if mod.GitHubLastSyncAt == nil {
		t.Fatal("a failed probe must not force a sync")
	}
}

// The interval is the whole point of a separate clock: a mod checked a minute
// ago is not due, one checked seven hours ago is.
func TestVersionCheckDueFollowsSixHourInterval(t *testing.T) {
	recent := time.Now().UTC()
	old := recent.Add(-7 * time.Hour)

	store := versionCheckStore(t, "1.0.0")
	now := time.Now().UTC()

	fresh := lookupMod(store, "mod_gh")
	fresh.GitHubVersionCheckedAt = &recent
	if store.checkModVersionDueLocked(*fresh, now) {
		t.Fatal("a mod checked a minute ago must not be due")
	}

	stale := lookupMod(store, "mod_gh")
	stale.GitHubVersionCheckedAt = &old
	if !store.checkModVersionDueLocked(*stale, now) {
		t.Fatal("a mod checked seven hours ago must be due")
	}

	never := lookupMod(store, "mod_gh")
	never.GitHubVersionCheckedAt = nil
	if !store.checkModVersionDueLocked(*never, now) {
		t.Fatal("a mod that was never checked must be due")
	}
}

// Tag decoration is presentation: comparing it as a string would make every
// v-prefixed repository look changed on every pass, forever.
func TestSameVersionNormalizesTagPrefix(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"v1.0.0", "1.0.0", true},
		{"V1.0.0", "1.0.0", true},
		{"1.0.0", "1.0.0", true},
		{" v1.0.0 ", "1.0.0", true},
		{"v1.0.1", "1.0.0", false},
		{"2.0.0", "1.0.0", false},
		// Four-part versions are what this catalog actually ships.
		{"1.4.2.2", "1.4.2.2", true},
		{"v1.4.2.2", "1.4.2.2", true},
	}
	for _, c := range cases {
		if got := sameVersion(c.a, c.b); got != c.want {
			t.Fatalf("sameVersion(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

// Release tags in this catalog are not always strict semver: several mods ship
// four-part versions like "1.4.2.2", which Masterminds/semver rejects outright.
// Treating those as unparsable would silently exempt them from the check.
func TestCompareVersionLabelsHandlesFourPartVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.4.2.2", "1.4.2.1", 1},
		{"1.4.2.1", "1.4.2.2", -1},
		{"1.4.2.2", "1.4.2.2", 0},
		{"v1.4.2.2", "1.4.2.2", 0},
		{"1.4.3", "1.4.2.9", 1},
		// Numerically tied but textually distinct: ordering falls through to the
		// raw label, so the pair never compares equal on a technicality.
		{"1.4.2", "1.4.2.0", -1},
		{"1.4.2.0", "1.4.2", 1},
		{"2.0.0", "1.9.9.9", 1},
		{"1.2.3-beta", "1.2.3", -1},
		{"1.2.3", "1.2.3-beta", 1},
	}
	for _, c := range cases {
		got := compareVersionLabels(c.a, c.b)
		if (got < 0 && c.want < 0) || (got > 0 && c.want > 0) || (got == 0 && c.want == 0) {
			continue
		}
		t.Fatalf("compareVersionLabels(%q, %q) = %d, want sign of %d", c.a, c.b, got, c.want)
	}
}

// A four-part release above the served version must actually trigger.
func TestVersionCheckDetectsFourPartRelease(t *testing.T) {
	probe := releasesProbeServer(t, "1.4.2.2", "1.4.2.1")
	defer probe.Close()

	store := versionCheckStore(t, "1.4.2.1")
	store.GitHubClient = github.NewClient(github.WithBaseURL(probe.URL), github.WithHTTPClient(probe.Client()))

	changed, served, announced := store.CheckModVersion(context.Background(), "mod_gh")
	if !changed {
		t.Fatalf("a four-part release above served must be a change: served=%q announced=%q", served, announced)
	}
	if announced != "1.4.2.2" {
		t.Fatalf("expected the highest four-part tag, got %q", announced)
	}
}

// The served side must be read with the same lenient comparator: this catalog
// publishes four-part versions, and dropping them would make "served" look empty
// and turn every pass into a change.
func TestServedLatestVersionHandlesFourPartVersions(t *testing.T) {
	recent := time.Now().UTC()
	store, err := NewStore(t.TempDir(), Catalog{
		Mods: []Mod{{ID: "mod_gh", SourceType: "github_releases", GitHubOwner: "reze", GitHubRepo: "demo", GitHubLastSyncAt: &recent}},
		Versions: map[string]Version{
			"v1": {ID: "v1", ModID: "mod_gh", Version: "1.4.2.1", State: "published"},
			"v2": {ID: "v2", ModID: "mod_gh", Version: "1.4.2.2", State: "published"},
			"v3": {ID: "v3", ModID: "mod_gh", Version: "1.4.2.10", State: "published"},
			"v4": {ID: "v4", ModID: "mod_gh", Version: "9.9.9.9", State: "draft"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	store.mu.RLock()
	got := store.servedLatestVersionLocked("mod_gh")
	store.mu.RUnlock()
	if got != "1.4.2.10" {
		t.Fatalf("served latest = %q, want 1.4.2.10 (numeric, published only)", got)
	}
}
