package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
	packagezip "github.com/reze/submodhub/internal/package"
)

// maxPassiveRefreshPerPage bounds how many stale mods one workbench page load
// may refresh, so a cold catalog does not start every download at once.
const maxPassiveRefreshPerPage = 3

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

	// Manifest mode never touches the REST API, so the API rate-limit backoff
	// must not suppress it.
	if targetMod.GitHubManifest {
		return s.syncModFromManifest(ctx, client, *targetMod, force, now)
	}

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
	if force || targetMod.GitHubLastSyncError != "" {
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
		s.finishSync(modID, now, summary, newETag, "")
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

		// Select release asset
		selected, selectErr := github.SelectReleaseAsset(rel, targetMod.GitHubAssetRegex, targetMod.GitHubSourceCode)
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

		result, created := s.importCandidate(ctx, client, *targetMod, releaseCandidate{
			Version:     tag,
			Notes:       releaseNotes,
			DownloadURL: selected.DownloadURL,
			FileName:    selected.AssetName,
			AssetID:     selected.AssetID,
			ReleaseID:   rel.ID,
			SourceKind:  selected.Kind,
			Owner:       targetMod.GitHubOwner,
			Repo:        targetMod.GitHubRepo,
		}, now)
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

	s.finishSync(modID, now, summary, newETag, "")
	return summary, nil
}

// syncModFromManifest imports versions declared by the repository's rezehub.yml.
// It reads raw.githubusercontent.com (no REST quota) and downloads the declared
// asset URLs, so a repository that maintains the file needs no API access at all.
func (s *Store) syncModFromManifest(ctx context.Context, client *github.Client, mod Mod, force bool, now time.Time) (*SyncSummary, error) {
	manifest, digest, err := client.FetchManifest(ctx, mod.GitHubOwner, mod.GitHubRepo)
	if err != nil {
		summary := &SyncSummary{
			ModID:     mod.ID,
			SyncedAt:  now,
			Failed:    1,
			LastError: err.Error(),
			Items:     []SyncItemResult{},
		}
		s.finishSync(mod.ID, now, summary, "", "")
		return summary, nil
	}

	// The digest identifies the exact document. An unchanged manifest declares
	// an unchanged version list, so nothing has to be downloaded.
	if !force && mod.GitHubLastSyncError == "" && digest != "" && digest == mod.GitHubManifestDigest {
		summary := &SyncSummary{ModID: mod.ID, SyncedAt: now, Items: []SyncItemResult{}}
		s.finishSync(mod.ID, now, summary, "", digest)
		return summary, nil
	}

	summary := &SyncSummary{
		ModID:    mod.ID,
		SyncedAt: now,
		Items:    make([]SyncItemResult, 0, len(manifest.Releases)),
	}
	for _, rel := range manifest.Releases {
		if s.modHasVersion(mod.ID, rel.Version) {
			summary.Skipped++
			summary.Items = append(summary.Items, SyncItemResult{
				Tag:    rel.Version,
				Action: "skipped",
				Reason: "version tag already exists",
			})
			continue
		}
		result, created := s.importCandidate(ctx, client, mod, releaseCandidate{
			Version:      rel.Version,
			Notes:        rel.Notes,
			DownloadURL:  rel.URL,
			FileName:     manifestAssetName(rel.URL),
			SourceKind:   github.SourceKindAsset,
			Owner:        mod.GitHubOwner,
			Repo:         mod.GitHubRepo,
			ExpectSHA256: rel.SHA256,
		}, now)
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

	if s.AutoPublish {
		s.followManifestLatest(mod.ID, manifest.Releases)
	}
	s.finishSync(mod.ID, now, summary, "", digest)
	return summary, nil
}

// manifestAssetName recovers a display filename from a declared asset URL.
func manifestAssetName(assetURL string) string {
	parsed, err := url.Parse(assetURL)
	if err != nil {
		return ""
	}
	return path.Base(parsed.Path)
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

// followManifestLatest chooses the last published entry in manifest order,
// including versions imported by an earlier attempt.
func (s *Store) followManifestLatest(modID string, releases []github.ManifestRelease) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(releases) - 1; i >= 0; i-- {
		for _, version := range s.Catalog.Versions {
			if version.ModID != modID || version.Version != releases[i].Version || version.State != "published" {
				continue
			}
			for j := range s.Catalog.Mods {
				if s.Catalog.Mods[j].ID == modID && s.Catalog.Mods[j].LatestVersionID != version.ID {
					s.Catalog.Mods[j].LatestVersionID = version.ID
					_ = s.saveLocked()
				}
			}
			return
		}
	}
}

// MaybeSyncGitHubMod refreshes one mod if it is due. This is the passive
// replacement for background polling: the request that made the mod relevant
// triggers the refresh, everything else keeps reading the cached state.
// Returns true when a refresh was actually started.
func (s *Store) MaybeSyncGitHubMod(modID string) bool {
	now := time.Now().UTC()
	s.mu.Lock()
	var mod *Mod
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID == modID {
			mod = &s.Catalog.Mods[i]
			break
		}
	}
	if mod == nil || mod.GetSourceType() != "github_releases" {
		s.mu.Unlock()
		return false
	}
	if !s.passiveSyncDueLocked(*mod, now) {
		s.mu.Unlock()
		return false
	}
	if s.simultaneousSyncs == nil {
		s.simultaneousSyncs = map[string]bool{}
	}
	if s.simultaneousSyncs[modID] {
		s.mu.Unlock()
		return false
	}
	s.simultaneousSyncs[modID] = true
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.simultaneousSyncs, modID)
			s.mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if _, err := s.SyncMod(ctx, modID); err != nil {
			log.Printf("[github-sync] passive refresh of %s failed: %v", modID, err)
		}
	}()
	return true
}

// passiveSyncDueLocked reports whether a mod is outside its freshness window.
// Callers must hold the store lock.
func (s *Store) passiveSyncDueLocked(mod Mod, now time.Time) bool {
	if mod.GetSourceType() != "github_releases" {
		return false
	}
	if s.GitHubSyncTTL <= 0 {
		return false
	}
	if !mod.GitHubManifest {
		if !s.gitHubBackoffUntil.IsZero() && now.Before(s.gitHubBackoffUntil) {
			return false
		}
		if mod.GitHubBackoffUntil != nil && now.Before(*mod.GitHubBackoffUntil) {
			return false
		}
	}
	return mod.GitHubLastSyncAt == nil || now.Sub(*mod.GitHubLastSyncAt) >= s.GitHubSyncTTL
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

func allowSourceRootReadme(report *packagezip.Report) {
	if len(report.Files) == 0 {
		return
	}
	root, _, ok := strings.Cut(report.Files[0].Source, "/")
	if !ok || root == "" {
		return
	}
	for _, file := range report.Files[1:] {
		if !strings.HasPrefix(file.Source, root+"/") {
			return
		}
	}
	kept := report.Unsupported[:0]
	for _, name := range report.Unsupported {
		if strings.EqualFold(name, root+"/README.md") {
			report.Warnings = append(report.Warnings, "source archive documentation not installed: "+name)
			continue
		}
		kept = append(kept, name)
	}
	report.Unsupported = kept
}

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

// StartGitHubSync starts the legacy background poller. It is off by default: the
// catalog is refreshed on demand instead (see MaybeSyncGitHubMod), because every
// poll consumes the same GitHub API quota that real requests need.
func (s *Store) StartGitHubSync() {
	if s.GitHubSyncInterval <= 0 {
		return
	}
	s.syncStopChan = make(chan struct{})
	s.syncDoneChan = make(chan struct{})

	go func() {
		defer close(s.syncDoneChan)
		ticker := time.NewTicker(s.GitHubSyncInterval)
		defer ticker.Stop()

		for {
			select {
			case <-s.syncStopChan:
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
				_ = s.SyncAllGitHubMods(ctx)
				cancel()
			}
		}
	}()
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
	Interval         string     `json:"interval"`
	TTL              string     `json:"ttl"`
	ActiveJobs       int        `json:"active_jobs"`
	LastSyncAt       *time.Time `json:"last_sync_at,omitempty"`
	LastSyncError    string     `json:"last_sync_error,omitempty"`
	TotalManagedMods int        `json:"total_managed_mods"`
	ManifestMods     int        `json:"manifest_mods"`
	// TokenConfigured reports whether an API token is stored; the token itself is
	// never part of any response.
	TokenConfigured bool `json:"token_configured"`
	TokenEncrypted  bool `json:"token_encrypted"`
}

func (s *Store) GetGitHubSyncDiagnostics() *GitHubSyncDiagnostics {
	s.mu.RLock()
	defer s.mu.RUnlock()

	managedCount := 0
	manifestCount := 0
	var latestSync *time.Time
	var latestErr string

	for _, m := range s.Catalog.Mods {
		if m.GetSourceType() == "github_releases" {
			managedCount++
			if m.GitHubManifest {
				manifestCount++
			}
			if m.GitHubLastSyncAt != nil && (latestSync == nil || m.GitHubLastSyncAt.After(*latestSync)) {
				latestSync = m.GitHubLastSyncAt
			}
			if m.GitHubLastSyncError != "" {
				latestErr = m.GitHubLastSyncError
			}
		}
	}

	intervalStr := "disabled"
	if s.GitHubSyncInterval > 0 {
		intervalStr = s.GitHubSyncInterval.String()
	}
	ttlStr := "disabled"
	if s.GitHubSyncTTL > 0 {
		ttlStr = s.GitHubSyncTTL.String()
	}

	return &GitHubSyncDiagnostics{
		Interval:         intervalStr,
		TTL:              ttlStr,
		ActiveJobs:       len(s.simultaneousSyncs),
		LastSyncAt:       latestSync,
		LastSyncError:    latestErr,
		TotalManagedMods: managedCount,
		ManifestMods:     manifestCount,
		TokenConfigured:  s.Catalog.Settings.GitHubToken != nil && s.Catalog.Settings.GitHubToken.Value != "",
		TokenEncrypted:   s.Catalog.Settings.GitHubToken != nil && s.Catalog.Settings.GitHubToken.Encrypted,
	}
}
