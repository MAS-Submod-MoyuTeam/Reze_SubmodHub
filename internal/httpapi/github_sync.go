package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
	packagezip "github.com/reze/submodhub/internal/package"
)

// maxPassiveRefreshPerPage bounds how many stale mods one workbench page load
// may refresh, so a cold catalog does not start every download at once.
const maxPassiveRefreshPerPage = 3

// githubSyncSweepInterval is how often the background loop looks for stale
// mods. It is a variable so tests can shrink it.
var githubSyncSweepInterval = time.Minute

type SyncItemResult struct {
	ReleaseID int64  `json:"release_id"`
	Tag       string `json:"tag"`
	Action    string `json:"action"` // "created", "skipped", "failed"
	Reason    string `json:"reason,omitempty"`
	VersionID string `json:"version_id,omitempty"`
	AssetName string `json:"asset_name,omitempty"`
	SHA256    string `json:"sha256,omitempty"`
	SizeBytes int64  `json:"size_bytes,omitempty"`
}

type SyncSummary struct {
	ModID     string           `json:"mod_id"`
	SyncedAt  time.Time        `json:"synced_at"`
	Created   int              `json:"created"`
	Skipped   int              `json:"skipped"`
	Failed    int              `json:"failed"`
	Items     []SyncItemResult `json:"items"`
	LastError string           `json:"last_error,omitempty"`
}

// githubClient builds a client from the catalog's proxy and token settings. The
// read lock is released before the client is constructed because
// getGitHubClientWithProxy takes the same lock: nesting read locks on one
// goroutine can deadlock behind a waiting writer.
func (s *Store) githubClient() *github.Client {
	proxyTemplate, token := s.githubSettings()
	return s.getGitHubClientWithProxy(proxyTemplate, token)
}

func (s *Store) SyncMod(ctx context.Context, modID string) (*SyncSummary, error) {
	return s.syncMod(ctx, modID, false)
}

func (s *Store) syncMod(ctx context.Context, modID string, force bool) (*SyncSummary, error) {
	now := time.Now().UTC()
	s.mu.RLock()
	var targetMod *Mod
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == modID {
			m := s.Catalog.Mods[i]
			targetMod = &m
			break
		}
	}
	s.mu.RUnlock()

	if targetMod == nil {
		return nil, errors.New("mod not found")
	}
	if targetMod.GetSourceType() != "github_releases" {
		return nil, errors.New("mod is not configured for github_releases source")
	}

	client := s.githubClient()

	// Rate limit backoff check
	s.mu.RLock()
	var inBackoff bool
	var backoffDeadline time.Time
	if !s.gitHubBackoffUntil.IsZero() && now.Before(s.gitHubBackoffUntil) {
		inBackoff = true
		backoffDeadline = s.gitHubBackoffUntil
	} else if targetMod.GitHubBackoffUntil != nil && now.Before(*targetMod.GitHubBackoffUntil) {
		inBackoff = true
		backoffDeadline = *targetMod.GitHubBackoffUntil
	}
	s.mu.RUnlock()

	if inBackoff {
		remaining := backoffDeadline.Sub(now).Round(time.Second)
		msg := fmt.Sprintf("github api rate limit backoff active until %s (remaining: %s)",
			backoffDeadline.UTC().Format(time.RFC3339), remaining)
		return &SyncSummary{
			ModID:     modID,
			SyncedAt:  now,
			Failed:    1,
			LastError: msg,
		}, nil
	}

	etag := targetMod.GitHubETag
	// A failed import must not be mistaken for an unchanged, fully imported
	// release list.
	//
	// Per-platform selection did not always take part in the ETag: a cache
	// written while this mod matched one shared file must not hide the assets the
	// newly declared platform rules need. A mod in per-platform mode therefore
	// re-reads the list until it has imported under those rules.
	if force || targetMod.GitHubLastSyncError != "" || len(targetMod.GitHubPlatformAssets) > 0 {
		etag = ""
	}
	releases, newETag, notModified, err := client.ListReleases(ctx, targetMod.GitHubOwner, targetMod.GitHubRepo, etag)
	if err != nil {
		var backoffDeadline *time.Time
		if github.IsRateLimited(err) {
			deadline := rateLimitDeadline(err, now)
			backoffDeadline = &deadline
		}

		s.mu.Lock()
		if backoffDeadline != nil {
			s.gitHubBackoffUntil = *backoffDeadline
		}
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID {
				s.Catalog.Mods[i].GitHubLastSyncAt = &now
				s.Catalog.Mods[i].GitHubLastSyncError = err.Error()
				if backoffDeadline != nil {
					s.Catalog.Mods[i].GitHubBackoffUntil = backoffDeadline
				}
				_ = s.saveLocked()
				break
			}
		}
		s.mu.Unlock()
		return &SyncSummary{
			ModID:     modID,
			SyncedAt:  now,
			Failed:    1,
			LastError: err.Error(),
		}, nil
	}

	// A 304 proves the release list is byte-identical, so only an explicit sync
	// re-reads GitHub's "latest" marker. Skipping the second unconditional
	// request is what keeps an unchanged repository at zero quota per refresh.
	if !notModified || force {
		latestRelease, latestErr := client.LatestRelease(ctx, targetMod.GitHubOwner, targetMod.GitHubRepo)
		if latestErr == nil {
			// Reconcile after imports, including the not-modified and
			// already-imported paths.
			defer s.followGitHubLatest(modID, latestRelease.ID)
		} else if !github.IsNotFound(latestErr) {
			log.Printf("[github-sync] latest release lookup for %s failed: %v", modID, latestErr)
		}
	}

	if notModified || len(releases) == 0 {
		summary := &SyncSummary{
			ModID:    modID,
			SyncedAt: now,
			Items:    []SyncItemResult{},
		}
		s.finishSync(modID, now, summary, newETag)
		return summary, nil
	}

	summary := &SyncSummary{
		ModID:    modID,
		SyncedAt: now,
		Items:    make([]SyncItemResult, 0, len(releases)),
	}

	// Process releases from oldest to newest so version history builds naturally
	for i := len(releases) - 1; i >= 0; i-- {
		rel := releases[i]
		tag := strings.TrimSpace(rel.TagName)
		if tag == "" {
			summary.Skipped++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Action:    "skipped",
				Reason:    "empty release tag",
			})
			continue
		}

		// Check idempotency against existing versions
		s.mu.RLock()
		alreadySynced := false
		tagExists := false
		for _, v := range s.Catalog.Versions {
			if v.ModID == modID {
				if v.GitHubReleaseID == rel.ID {
					alreadySynced = true
					break
				}
				if v.Version == tag {
					tagExists = true
					break
				}
			}
		}
		s.mu.RUnlock()

		if alreadySynced {
			if s.AutoPublish {
				s.promoteGitHubVersion(modID, rel.ID, now)
			}
			summary.Skipped++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				Action:    "skipped",
				Reason:    "release already synced",
			})
			continue
		}
		if tagExists {
			summary.Skipped++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				Action:    "skipped",
				Reason:    "version tag already exists",
			})
			continue
		}

		// Select release asset. Per-platform rules produce one version carrying
		// every platform's asset; the single-file rule stays the default so an
		// existing mod keeps matching exactly what it matched before.
		var (
			selected  *github.SelectedAsset
			platforms []platformSelection
			selectErr error
		)
		if len(targetMod.GitHubPlatformAssets) > 0 {
			platforms, selectErr = selectPlatformsForRelease(rel, targetMod.GitHubPlatformAssets)
		} else {
			selected, selectErr = github.SelectReleaseAsset(rel, targetMod.GitHubAssetRegex, targetMod.GitHubSourceCode)
		}
		if selectErr != nil {
			if errors.Is(selectErr, github.ErrNoMatchingAsset) {
				summary.Skipped++
				summary.Items = append(summary.Items, SyncItemResult{
					ReleaseID: rel.ID,
					Tag:       tag,
					Action:    "skipped",
					Reason:    selectErr.Error(),
				})
				continue
			}
			summary.Failed++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				Action:    "failed",
				Reason:    selectErr.Error(),
			})
			continue
		}

		releaseNotes := rel.Body
		if strings.TrimSpace(releaseNotes) == "" {
			releaseNotes = rel.Name
		}

		candidate := releaseCandidate{
			Version:   tag,
			Notes:     releaseNotes,
			ReleaseID: rel.ID,
			Owner:     targetMod.GitHubOwner,
			Repo:      targetMod.GitHubRepo,
		}
		if selected != nil {
			candidate.DownloadURL = selected.DownloadURL
			candidate.FileName = selected.AssetName
			candidate.AssetID = selected.AssetID
			candidate.SizeBytes = selected.SizeBytes
			candidate.SourceKind = selected.Kind
		}
		if len(platforms) > 0 {
			// The per-platform candidate downloads and scans one archive per
			// platform; importCandidate owns which shape is written.
			candidate.Platforms = platforms
			candidate.FileName = platforms[0].Asset.AssetName
			candidate.AssetID = platforms[0].Asset.AssetID
			candidate.SizeBytes = platforms[0].Asset.SizeBytes
			candidate.SourceKind = platforms[0].Asset.Kind
		}
		result, created := s.importCandidate(ctx, client, *targetMod, candidate, now, force)
		switch {
		case created:
			summary.Created++
		case result.Action == "failed":
			summary.Failed++
		default:
			summary.Skipped++
		}
		summary.Items = append(summary.Items, result)
	}

	s.finishSync(modID, now, summary, newETag)
	return summary, nil
}

func (s *Store) modHasVersion(modID, version string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, v := range s.Catalog.Versions {
		if v.ModID == modID && v.Version == version {
			return true
		}
	}
	return false
}

// MaybeSyncGitHubMod refreshes one mod if it has not been checked for longer
// than the configured window. Any request that makes the mod relevant triggers
// this; everything else keeps reading the cached state.
// Returns true when a refresh was actually started.
func (s *Store) MaybeSyncGitHubMod(modID string) bool {
	if !s.claimSync(modID, time.Now().UTC()) {
		return false
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		s.runClaimedSync(ctx, modID)
	}()
	return true
}

// claimSync marks a mod as being refreshed. It returns false when the mod is
// not GitHub-backed, is still fresh, or already has a refresh in flight, so the
// caller must not start one. The sweep claims every stale mod up front instead
// of calling claimSync again, which keeps its batch bounded by one pass.
func (s *Store) claimSync(modID string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	var mod *Mod
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == modID {
			mod = &s.Catalog.Mods[i]
			break
		}
	}
	if mod == nil || !s.syncDueLocked(*mod, now) {
		return false
	}
	if s.simultaneousSyncs == nil {
		s.simultaneousSyncs = map[string]bool{}
	}
	if s.simultaneousSyncs[modID] {
		return false
	}
	s.simultaneousSyncs[modID] = true
	return true
}

// runClaimedSync refreshes a mod whose claim already succeeded and releases it.
func (s *Store) runClaimedSync(ctx context.Context, modID string) {
	defer func() {
		s.mu.Lock()
		delete(s.simultaneousSyncs, modID)
		s.mu.Unlock()
	}()
	if _, err := s.SyncMod(ctx, modID); err != nil {
		log.Printf("[github-sync] refresh of %s failed: %v", modID, err)
	}
}

// syncDueLocked reports whether a mod has gone longer than the window without
// being checked. It is the single staleness predicate: the passive path (a page
// view) and the background sweep both call it, so "looked at" and "swept up"
// can never disagree about when a mod is stale.
// Callers must hold the store lock.
func (s *Store) syncDueLocked(mod Mod, now time.Time) bool {
	if mod.GetSourceType() != "github_releases" {
		return false
	}
	if s.GitHubSyncMaxAge <= 0 {
		return false
	}
	if !s.gitHubBackoffUntil.IsZero() && now.Before(s.gitHubBackoffUntil) {
		return false
	}
	if mod.GitHubBackoffUntil != nil && now.Before(*mod.GitHubBackoffUntil) {
		return false
	}
	return mod.GitHubLastSyncAt == nil || now.Sub(*mod.GitHubLastSyncAt) >= s.GitHubSyncMaxAge
}

// maybeSyncGitHubModAsync spawns the passive refresh without blocking the caller.
// Handlers call it while serving a response, so it must never wait on the store
// lock the handler already holds.
func (s *Store) maybeSyncGitHubModAsync(modID string) {
	if modID == "" {
		return
	}
	go s.MaybeSyncGitHubMod(modID)
}

// promoteGitHubVersion reconciles versions imported before auto-publish was
// enabled. The archive and scan report remain unchanged; only the review gate
// is bypassed, matching newly imported releases.
func (s *Store) promoteGitHubVersion(modID string, releaseID int64, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for versionID, version := range s.Catalog.Versions {
		if version.ModID != modID || version.GitHubReleaseID != releaseID || version.State != "scanning" {
			continue
		}
		version.State = "published"
		s.Catalog.Versions[versionID] = version
		found := false
		for i := range s.Catalog.Submissions {
			if s.Catalog.Submissions[i].VersionID == versionID {
				s.Catalog.Submissions[i].State = "published"
				if s.Catalog.Submissions[i].PublishedAt == nil {
					s.Catalog.Submissions[i].PublishedAt = &now
				}
				found = true
			}
		}
		if !found {
			token, err := randomToken()
			if err == nil {
				s.Catalog.Submissions = append(s.Catalog.Submissions, Submission{ID: "sub_" + token[:12], ModID: modID, VersionID: versionID, AuthorID: "", State: "published", CreatedAt: now, PublishedAt: &now})
			}
		}
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID && s.Catalog.Mods[i].LatestVersionID == "" {
				s.Catalog.Mods[i].LatestVersionID = versionID
			}
		}
		_ = s.saveLocked()
	}
}

func (s *Store) followGitHubLatest(modID string, releaseID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, version := range s.Catalog.Versions {
		if version.ModID != modID || version.GitHubReleaseID != releaseID || version.State != "published" {
			continue
		}
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID && s.Catalog.Mods[i].LatestVersionID != version.ID {
				s.Catalog.Mods[i].LatestVersionID = version.ID
				_ = s.saveLocked()
			}
		}
		return
	}
}

// allowSourceRootReadme drops the repository README of a source archive from the
// unsupported list. Sources keep the archive's own spelling (a Windows-built ZIP
// writes `\`), so both sides are normalized before they are compared.
func allowSourceRootReadme(report *packagezip.Report) {
	if len(report.Files) == 0 {
		return
	}
	normalize := func(name string) string { return strings.ReplaceAll(name, `\`, "/") }
	root, _, ok := strings.Cut(normalize(report.Files[0].Source), "/")
	if !ok || root == "" {
		return
	}
	for _, file := range report.Files[1:] {
		if !strings.HasPrefix(normalize(file.Source), root+"/") {
			return
		}
	}
	kept := report.Unsupported[:0]
	for _, name := range report.Unsupported {
		if strings.EqualFold(normalize(name), root+"/README.md") {
			report.Warnings = append(report.Warnings, "source archive documentation not installed: "+name)
			continue
		}
		kept = append(kept, name)
	}
	report.Unsupported = kept
}

// SyncAllGitHubMods refreshes every GitHub-backed mod. It is the explicit
// "check everything now" entry point, so it ignores the staleness window and
// only skips mods whose own backoff is still running.
func (s *Store) SyncAllGitHubMods(ctx context.Context) map[string]*SyncSummary {
	s.mu.RLock()
	modIDs := make([]string, 0)
	for _, m := range s.Catalog.Mods {
		if m.GetSourceType() == "github_releases" {
			modIDs = append(modIDs, m.ID)
		}
	}
	s.mu.RUnlock()

	results := make(map[string]*SyncSummary, len(modIDs))

	for _, id := range modIDs {
		summary, err := s.SyncMod(ctx, id)
		if err != nil {
			log.Printf("[github-sync] mod %s sync error: %v", id, err)
		}
		results[id] = summary
	}
	return results
}

// SyncStaleGitHubMods refreshes only the mods whose last check is older than the
// configured window. This is what the background loop runs: a mod that was just
// refreshed because somebody opened its page is not checked again.
func (s *Store) SyncStaleGitHubMods(ctx context.Context) int {
	now := time.Now().UTC()
	s.mu.RLock()
	stale := make([]string, 0)
	for _, m := range s.Catalog.Mods {
		if s.syncDueLocked(m, now) {
			stale = append(stale, m.ID)
		}
	}
	s.mu.RUnlock()

	refreshed := 0
	for _, id := range stale {
		if ctx.Err() != nil {
			return refreshed
		}
		// The list is already filtered by syncDueLocked, so claiming only has
		// to win the in-flight race. Sweeps run one mod at a time on purpose:
		// a catalog-wide burst is exactly what the API quota cannot absorb.
		if !s.claimSync(id, now) {
			continue
		}
		s.runClaimedSync(ctx, id)
		refreshed++
	}
	return refreshed
}

// ApplyGitHubSyncMaxAgeSetting seeds the runtime window from persisted settings.
// Callers apply environment overrides afterwards.
func (s *Store) ApplyGitHubSyncMaxAgeSetting() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.GitHubSyncMaxAge = resolveGitHubSyncMaxAge(s.Catalog.Settings.GitHubSyncMaxAge)
}

// StartGitHubSync starts the background sweep. It wakes up in short slices and
// only looks for stale mods once per slice, so a window changed in the settings
// page takes effect without a restart and an idle catalog costs nothing.
func (s *Store) StartGitHubSync() {
	s.syncStopChan = make(chan struct{})
	s.syncDoneChan = make(chan struct{})

	go func() {
		defer close(s.syncDoneChan)
		// The sweep interval only bounds how often we look for stale mods; the
		// window itself decides which ones are refreshed.
		ticker := time.NewTicker(githubSyncSweepInterval)
		defer ticker.Stop()

		for {
			select {
			case <-s.syncStopChan:
				return
			case <-ticker.C:
				// A disabled window means the operator wants no unattended
				// GitHub traffic at all, and the version probe is GitHub
				// traffic: it stays inside the same switch.
				if s.syncMaxAge() <= 0 {
					continue
				}
				// The six-hour comparison is cheaper and rarer than a sync, and
				// it is what notices a change in an idle catalog even when the
				// stale-sweep has nothing to do.
				versionCtx, versionCancel := context.WithTimeout(context.Background(), 5*time.Minute)
				s.CheckStaleModVersions(versionCtx)
				versionCancel()

				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
				s.SyncStaleGitHubMods(ctx)
				cancel()
			}
		}
	}()
}

// MarkGitHubReleaseStale implements the push half of GitHub discovery. A release
// published by the bound repository is the only signal the hub cannot poll for,
// so the notify endpoint turns it into ordinary staleness: the mod is marked due
// and the existing passive and sweep paths refresh it exactly as they would
// after the staleness window expired.
//
// Every unbound owner/repo pair reads as "not found" rather than as an error: the
// binding is the only capability here, and reporting whether some other
// repository is bound would leak the catalog to any caller that can reach the
// endpoint.
func (s *Store) MarkGitHubReleaseStale(owner, repo string) (int, bool) {
	owner = strings.TrimSpace(owner)
	repo = strings.TrimSpace(repo)
	if owner == "" || repo == "" {
		return 0, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	matched := 0
	for i := range s.Catalog.Mods {
		mod := &s.Catalog.Mods[i]
		if mod.GetSourceType() != "github_releases" {
			continue
		}
		if !strings.EqualFold(mod.GitHubOwner, owner) || !strings.EqualFold(mod.GitHubRepo, repo) {
			continue
		}
		if mod.GitHubLastSyncAt != nil {
			mod.GitHubLastSyncAt = nil
		}
		matched++
	}
	if matched == 0 {
		return 0, false
	}
	if err := s.saveLocked(); err != nil {
		log.Printf("[github-sync] marking %s/%s stale was not persisted: %v", owner, repo, err)
	}
	return matched, true
}

// githubReleaseNotify handles the push trigger a repository's release workflow
// sends after publishing. It is deliberately unauthenticated: the owner/repo pair
// already has to match a mod the hub bound to GitHub, and a caller that cannot
// name a bound repository changes nothing. It never starts a download itself.
func (s *Store) githubReleaseNotify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed", "method is not supported")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	var req struct {
		Owner   string                `json:"owner"`
		Repo    string                `json:"repo"`
		Version string                `json:"version,omitempty"`
		Rules   *workflowPlatformRules `json:"rules,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid_body", "owner and repo are required")
		return
	}
	// Rules are optional so a workflow generated before they existed keeps
	// working, but when present they must be usable patterns: a malformed regex
	// is reported here rather than silently matching every asset later.
	if req.Rules != nil {
		if err := validateWorkflowRuleSet(*req.Rules); err != nil {
			writeError(w, 400, "invalid_rules", err.Error())
			return
		}
	}
	matched, ok := s.MarkGitHubReleaseStale(req.Owner, req.Repo)
	if !ok {
		// An unbound repository is indistinguishable from a typo. Both are
		// dropped, so the endpoint cannot be used to discover bindings.
		writeError(w, 404, "not_found", "no mod is bound to this repository")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"matched_mods": matched,
		"status":       "stale",
	})
}

// validateWorkflowRuleSet rejects patterns the hub cannot compile. The empty set
// is valid: it means the workflow predates rule delivery, and the mod's stored
// configuration decides what to publish.
func validateWorkflowRuleSet(rules workflowPlatformRules) error {
	for name, pattern := range map[string]string{
		"shared":  rules.Shared,
		"windows": rules.Windows,
		"android": rules.Android,
	} {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		if len(pattern) > 512 {
			return fmt.Errorf("%s pattern is longer than 512 characters", name)
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return fmt.Errorf("%s pattern is not a valid regular expression: %w", name, err)
		}
	}
	return nil
}

// GitHubVersionCheckInterval is how often the hub re-compares the version a mod
// serves against the version its repository announces. It is slower than the
// sync window on purpose: this check answers "did anything change at all", so
// running it every minute would only re-read an unchanged number.
var GitHubVersionCheckInterval = 6 * time.Hour

// checkModVersionDueLocked reports whether the slow version comparison is due.
// It reads only stored timestamps, so it costs nothing on a catalog-wide pass.
// Callers must hold the store lock.
func (s *Store) checkModVersionDueLocked(mod Mod, now time.Time) bool {
	if mod.GetSourceType() != "github_releases" {
		return false
	}
	return mod.GitHubVersionCheckedAt == nil || now.Sub(*mod.GitHubVersionCheckedAt) >= GitHubVersionCheckInterval
}

// CheckModVersion re-reads the version the repository announces and marks the
// mod stale when it differs from what the hub currently serves. The signal is
// the release tag the repository already publishes, so the author maintains
// nothing extra and the check stays cheap enough to run unattended every six
// hours.
//
// It never downloads an archive: a difference only clears the sync clock, and
// the ordinary passive/sweep path does the actual import. Anything it cannot
// determine leaves the previous observation in place instead of turning into a
// sync, because a wrong "changed" verdict costs a full refresh on every pass.
func (s *Store) CheckModVersion(ctx context.Context, modID string) (changed bool, served, announced string) {
	now := time.Now().UTC()
	s.mu.RLock()
	var mod *Mod
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == modID {
			m := s.Catalog.Mods[i]
			mod = &m
			break
		}
	}
	served = s.servedLatestVersionLocked(modID)
	s.mu.RUnlock()
	if mod == nil || mod.GetSourceType() != "github_releases" {
		return false, "", ""
	}

	client := s.githubClient()
	announced, err := announcedReleaseVersion(ctx, client, mod.GitHubOwner, mod.GitHubRepo)
	if err != nil {
		// An unreachable or missing probe is not evidence of a new version. The
		// clock still advances so a broken repository is not re-probed on every
		// sweep; the recorded observation is left untouched.
		log.Printf("[github-sync] version probe for %s (%s/%s) failed: %v", modID, mod.GitHubOwner, mod.GitHubRepo, err)
		s.markVersionChecked(modID, now, "", false)
		return false, served, ""
	}

	announced = strings.TrimSpace(announced)
	// Only a version the catalog does not already have counts. Two false
	// positives are avoided here:
	//
	//   - string comparison would read every v-prefixed tag as different, so the
	//     sides are compared as versions;
	//   - a repository may hold releases the catalog already passed (a back-filled
	//     patch, a maintenance branch), so an older tag is not a change either.
	changed = announced != "" && !sameVersion(announced, served) && isNewerVersion(announced, served)

	s.markVersionChecked(modID, now, announced, changed)
	return changed, served, announced
}

// announcedReleaseVersion reports the version a repository's newest release
// carries, which is the version signal that every repository already publishes:
// a release tag needs no file the author has to remember to maintain.
//
// /releases/latest is deliberately not used here. It answers "latest by
// created_at", so back-filling an older release, editing a draft into
// publication, or publishing a patch for a maintenance branch can all move a
// repository's "latest" backwards. Reading the first page and keeping the
// highest tag is stable against that, and it is the same question the catalog
// actually asks — "is there a version above what I serve?".
//
// Drafts and prereleases are skipped: neither is something the catalog should
// import, so neither may count as a new version. The page is small and the call
// runs once per six hours per mod, so the extra request budget is irrelevant.
func announcedReleaseVersion(ctx context.Context, client *github.Client, owner, repo string) (string, error) {
	releases, _, _, err := client.ListReleases(ctx, owner, repo, "")
	if err != nil {
		return "", err
	}
	best := ""
	for _, release := range releases {
		if release.Draft || release.Prerelease {
			continue
		}
		tag := strings.TrimSpace(release.TagName)
		if tag == "" {
			continue
		}
		if best == "" || isNewerVersion(tag, best) {
			best = tag
		}
	}
	if best == "" {
		return "", fmt.Errorf("%w: %s/%s has no published release yet", github.ErrNotFound, owner, repo)
	}
	return best, nil
}

// sameVersion compares two version labels after normalizing the usual tag
// decoration. It is deliberately lenient in one direction only: it answers
// "are these the same version", never "which is newer", because a false
// "different" would cost a full sync on every pass.
func sameVersion(a, b string) bool {
	if a == b {
		return true
	}
	return normalizeVersionLabel(a) == normalizeVersionLabel(b)
}

// normalizeVersionLabel strips the decoration version labels carry in the wild:
// a leading "v"/"V", surrounding space, and trailing build noise.
func normalizeVersionLabel(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "v")
	s = strings.TrimPrefix(s, "V")
	return s
}

// compareVersionLabels orders two release labels, answering -1/0/+1.
//
// Release tags are not always strict semver: this catalog ships versions like
// "1.4.2.2", which Masterminds/semver rejects outright. Comparing those as
// "not newer" would silently exempt every such mod from the six-hour check, so
// the numeric segments are compared directly and a stricter parser is not
// required. Labels whose numeric prefixes tie fall back to the raw string so
// the order stays total and comparisons never claim equality they cannot prove.
func compareVersionLabels(a, b string) int {
	an, aok := numericVersionSegments(a)
	bn, bok := numericVersionSegments(b)
	if !aok || !bok {
		return strings.Compare(normalizeVersionLabel(a), normalizeVersionLabel(b))
	}
	for i := 0; i < len(an) || i < len(bn); i++ {
		var av, bv int
		if i < len(an) {
			av = an[i]
		}
		if i < len(bn) {
			bv = bn[i]
		}
		if av != bv {
			if av < bv {
				return -1
			}
			return 1
		}
	}
	// The numeric prefixes tie. A label that has something after the numeric run
	// (a prerelease like "1.2.3-beta") sorts BELOW the bare release, which is
	// the one ordering rule callers rely on. Two labels with the same shape fall
	// back to the raw string so the order stays total.
	aSuffix := versionSuffix(a)
	bSuffix := versionSuffix(b)
	switch {
	case aSuffix == "" && bSuffix == "":
		return strings.Compare(normalizeVersionLabel(a), normalizeVersionLabel(b))
	case aSuffix == "":
		return 1
	case bSuffix == "":
		return -1
	}
	return strings.Compare(aSuffix, bSuffix)
}

// versionSuffix returns whatever follows the leading dotted numeric run, which
// is the prerelease/build part of a label ("1.2.3-beta" → "-beta").
func versionSuffix(label string) string {
	label = normalizeVersionLabel(label)
	lastDigit := -1
	for i := 0; i < len(label); i++ {
		c := label[i]
		if c >= '0' && c <= '9' {
			lastDigit = i
			continue
		}
		if c == '.' {
			continue
		}
		return label[i:]
	}
	if lastDigit == -1 {
		return label
	}
	return ""
}

// numericVersionSegments extracts the leading dotted run of integers from a
// label. Anything after it (a prerelease marker, build metadata) is ignored
// here and left to the raw comparison in compareVersionLabels.
func numericVersionSegments(label string) ([]int, bool) {
	label = normalizeVersionLabel(label)
	if label == "" {
		return nil, false
	}
	var segments []int
	for _, part := range strings.Split(label, ".") {
		end := 0
		for end < len(part) && part[end] >= '0' && part[end] <= '9' {
			end++
		}
		if end == 0 {
			break
		}
		value, err := strconv.Atoi(part[:end])
		if err != nil {
			break
		}
		segments = append(segments, value)
		if end != len(part) {
			// Trailing non-numeric text ends the numeric run (1.2.3-beta).
			break
		}
	}
	if len(segments) == 0 {
		return nil, false
	}
	return segments, true
}

// isNewerVersion reports whether announced is a version above served.
func isNewerVersion(announced, served string) bool {
	if served == "" {
		// Nothing is served yet, so any announced version is new.
		return strings.TrimSpace(announced) != ""
	}
	return compareVersionLabels(announced, served) > 0
}

// markVersionChecked records one comparison result. A changed verdict reuses the
// release notification's lever: the mod simply becomes due, and the existing
// passive and sweep paths do the import.
func (s *Store) markVersionChecked(modID string, now time.Time, announced string, changed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID != modID {
			continue
		}
		s.Catalog.Mods[i].GitHubVersionCheckedAt = &now
		if announced != "" {
			s.Catalog.Mods[i].GitHubVersionSeen = announced
		}
		if changed {
			s.Catalog.Mods[i].GitHubLastSyncAt = nil
		}
	}
	if err := s.saveLocked(); err != nil {
		log.Printf("[github-sync] version check for %s was not persisted: %v", modID, err)
	}
}

// servedLatestVersionLocked returns the highest published version the mod
// serves. Callers must hold the store lock.
func (s *Store) servedLatestVersionLocked(modID string) string {
	best := ""
	for _, version := range s.Catalog.Versions {
		if version.ModID != modID || version.State != "published" {
			continue
		}
		// Same comparator the release probe uses: the catalog serves four-part
		// versions too, and a stricter parser would quietly drop them here and
		// report an empty "served" version.
		if best == "" || isNewerVersion(version.Version, best) {
			best = version.Version
		}
	}
	return best
}

// CheckStaleModVersions runs the six-hour self-check across the catalog. Mods
// whose check is not due are skipped without any network access.
func (s *Store) CheckStaleModVersions(ctx context.Context) int {
	now := time.Now().UTC()
	s.mu.RLock()
	due := make([]string, 0)
	for _, m := range s.Catalog.Mods {
		if s.checkModVersionDueLocked(m, now) {
			due = append(due, m.ID)
		}
	}
	s.mu.RUnlock()

	checked := 0
	for _, id := range due {
		if ctx.Err() != nil {
			return checked
		}
		s.CheckModVersion(ctx, id)
		checked++
	}
	return checked
}

func (s *Store) Close() error {
	var err error
	s.syncCloseOnce.Do(func() {
		if s.syncStopChan != nil {
			close(s.syncStopChan)
			select {
			case <-s.syncDoneChan:
			case <-time.After(3 * time.Second):
			}
		}
	})
	return err
}

type GitHubSyncDiagnostics struct {
	// MaxAge is the staleness window; "disabled" means nothing refreshes
	// automatically. StaleMods is how many mods are past it right now.
	MaxAge           string     `json:"max_age"`
	StaleMods        int        `json:"stale_mods"`
	ActiveJobs       int        `json:"active_jobs"`
	LastSyncAt       *time.Time `json:"last_sync_at,omitempty"`
	LastSyncError    string     `json:"last_sync_error,omitempty"`
	TotalManagedMods int        `json:"total_managed_mods"`
	// TokenConfigured reports whether an API token is stored; the token itself is
	// never part of any response.
	TokenConfigured bool `json:"token_configured"`
	TokenEncrypted  bool `json:"token_encrypted"`
}

func (s *Store) GetGitHubSyncDiagnostics() *GitHubSyncDiagnostics {
	s.mu.RLock()
	defer s.mu.RUnlock()

	managedCount := 0
	var latestSync *time.Time
	var latestErr string

	for _, m := range s.Catalog.Mods {
		if m.GetSourceType() == "github_releases" {
			managedCount++
			if m.GitHubLastSyncAt != nil && (latestSync == nil || m.GitHubLastSyncAt.After(*latestSync)) {
				latestSync = m.GitHubLastSyncAt
			}
			if m.GitHubLastSyncError != "" {
				latestErr = m.GitHubLastSyncError
			}
		}
	}

	maxAgeStr := "disabled"
	if s.GitHubSyncMaxAge > 0 {
		maxAgeStr = s.GitHubSyncMaxAge.String()
	}
	now := time.Now().UTC()
	staleCount := 0
	for _, m := range s.Catalog.Mods {
		if s.syncDueLocked(m, now) {
			staleCount++
		}
	}

	return &GitHubSyncDiagnostics{
		MaxAge:           maxAgeStr,
		StaleMods:        staleCount,
		ActiveJobs:       len(s.simultaneousSyncs),
		LastSyncAt:       latestSync,
		LastSyncError:    latestErr,
		TotalManagedMods: managedCount,
		TokenConfigured:  s.Catalog.Settings.GitHubToken != nil && s.Catalog.Settings.GitHubToken.Value != "",
		TokenEncrypted:   s.Catalog.Settings.GitHubToken != nil && s.Catalog.Settings.GitHubToken.Encrypted,
	}
}
