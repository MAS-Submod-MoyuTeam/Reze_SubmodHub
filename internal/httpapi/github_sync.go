package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
	packagezip "github.com/reze/submodhub/internal/package"
)

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

func (s *Store) getGitHubClient() *github.Client {
	if s.GitHubClient != nil {
		return s.GitHubClient
	}
	return github.NewClient()
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

	s.mu.RLock()
	proxyTemplate := s.Catalog.Settings.GitHubProxyTemplate
	s.mu.RUnlock()
	client := s.getGitHubClientWithProxy(proxyTemplate)
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
			deadline := now.Add(15 * time.Minute)
			if rlErr, ok := github.AsRateLimitError(err); ok {
				if rlErr.ResetAt.After(now) {
					deadline = rlErr.ResetAt
				} else if rlErr.RetryAfter > 0 {
					deadline = now.Add(rlErr.RetryAfter)
				}
			}
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

	if notModified {
		s.mu.Lock()
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID {
				s.Catalog.Mods[i].GitHubLastSyncAt = &now
				s.Catalog.Mods[i].GitHubLastSyncError = ""
				s.Catalog.Mods[i].GitHubBackoffUntil = nil
				_ = s.saveLocked()
				break
			}
		}
		s.mu.Unlock()
		return &SyncSummary{
			ModID:    modID,
			SyncedAt: now,
			Items:    []SyncItemResult{},
		}, nil
	}

	if len(releases) == 0 {
		s.mu.Lock()
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID {
				s.Catalog.Mods[i].GitHubLastSyncAt = &now
				s.Catalog.Mods[i].GitHubLastSyncError = ""
				s.Catalog.Mods[i].GitHubBackoffUntil = nil
				if newETag != "" {
					s.Catalog.Mods[i].GitHubETag = newETag
				}
				_ = s.saveLocked()
				break
			}
		}
		s.mu.Unlock()
		return &SyncSummary{
			ModID:    modID,
			SyncedAt: now,
			Items:    []SyncItemResult{},
		}, nil
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
			summary.Failed++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				Action:    "failed",
				Reason:    selectErr.Error(),
			})
			continue
		}

		// Download to temp file
		var tmpPath string
		var dlErr error
		select {
		case s.downloadSem <- struct{}{}:
			tmpPath, _, _, dlErr = client.DownloadToTemp(ctx, selected.DownloadURL, maxArchiveSize)
			<-s.downloadSem
		case <-ctx.Done():
			dlErr = ctx.Err()
		}
		if dlErr != nil {
			if github.IsRateLimited(dlErr) {
				deadline := now.Add(15 * time.Minute)
				if rlErr, ok := github.AsRateLimitError(dlErr); ok {
					if rlErr.ResetAt.After(now) {
						deadline = rlErr.ResetAt
					} else if rlErr.RetryAfter > 0 {
						deadline = now.Add(rlErr.RetryAfter)
					}
				}
				s.mu.Lock()
				s.gitHubBackoffUntil = deadline
				for idx := range s.Catalog.Mods {
					if s.Catalog.Mods[idx].ID == modID {
						s.Catalog.Mods[idx].GitHubBackoffUntil = &deadline
						_ = s.saveLocked()
						break
					}
				}
				s.mu.Unlock()
			}
			summary.Failed++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				AssetName: selected.AssetName,
				Action:    "failed",
				Reason:    dlErr.Error(),
			})
			continue
		}

		// Open temp file and persist/scan archive
		f, openErr := os.Open(tmpPath)
		if openErr != nil {
			_ = os.Remove(tmpPath)
			summary.Failed++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				Action:    "failed",
				Reason:    openErr.Error(),
			})
			continue
		}

		token, tokErr := randomToken()
		if tokErr != nil {
			_ = f.Close()
			_ = os.Remove(tmpPath)
			summary.Failed++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				Action:    "failed",
				Reason:    "could not generate token",
			})
			continue
		}
		versionID := "ver_" + token[:12]
		finalPath, archiveSize, hash, report, scanErr := s.persistArchive(versionID, f, targetMod.Category == "spritepack")
		_ = f.Close()
		_ = os.Remove(tmpPath)

		if scanErr != nil {
			summary.Failed++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				AssetName: selected.AssetName,
				Action:    "failed",
				Reason:    scanErr.Error(),
			})
			continue
		}

		// Determine version state
		state := "ready_for_review"
		hasBlockers := len(report.Unsupported) > 0
		if hasBlockers || len(report.Conflicts) > 0 {
			state = "scanning"
		} else if s.AutoPublish {
			state = "published"
		}

		releaseNotes := rel.Body
		if strings.TrimSpace(releaseNotes) == "" {
			releaseNotes = rel.Name
		}

		version := Version{
			ID:              versionID,
			ModID:           modID,
			Version:         tag,
			CreatedAt:       &now,
			State:           state,
			SizeBytes:       archiveSize,
			SHA256:          hash,
			ReleaseNotes:    releaseNotes,
			ScanReportID:    "scan_" + versionID,
			ArchivePath:     finalPath,
			SourceType:      "github_releases",
			GitHubReleaseID: rel.ID,
			GitHubAssetID:   selected.AssetID,
			GitHubSource: &VersionSourceLocation{
				Owner:       targetMod.GitHubOwner,
				Repo:        targetMod.GitHubRepo,
				ReleaseID:   rel.ID,
				AssetID:     selected.AssetID,
				FileName:    selected.AssetName,
				DownloadURL: selected.DownloadURL,
			},
		}

		// Extract dependencies
		seenDeps := map[string]bool{}
		for _, reg := range report.Submods {
			for _, dep := range reg.Dependencies {
				if dep.Name == "" || seenDeps[dep.Name] {
					continue
				}
				seenDeps[dep.Name] = true
				version.Dependencies = append(version.Dependencies, Dependency{
					ModID:        dep.Name,
					ModTitle:     dep.Name,
					VersionRange: dependencyRange(dep.Minimum, dep.Maximum),
					Required:     true,
				})
			}
		}
		version = resolveVersionDependencies(s.Catalog, version)

		// Save under lock
		s.mu.Lock()
		// Double check idempotency under write lock
		concurrentDup := false
		for _, v := range s.Catalog.Versions {
			if v.ModID == modID && (v.GitHubReleaseID == rel.ID || v.Version == tag) {
				concurrentDup = true
				break
			}
		}
		if concurrentDup {
			s.mu.Unlock()
			_ = os.Remove(finalPath)
			summary.Skipped++
			summary.Items = append(summary.Items, SyncItemResult{
				ReleaseID: rel.ID,
				Tag:       tag,
				Action:    "skipped",
				Reason:    "concurrent sync duplicate",
			})
			continue
		}

		if s.Catalog.ScanReports == nil {
			s.Catalog.ScanReports = map[string]packagezip.Report{}
		}
		s.Catalog.ScanReports[version.ScanReportID] = report
		s.Catalog.Versions[versionID] = version

		// Create submission if ready_for_review or published
		if state == "ready_for_review" || state == "published" {
			subToken, _ := randomToken()
			sub := Submission{
				ID:        "sub_" + subToken[:12],
				ModID:     modID,
				VersionID: versionID,
				AuthorID:  targetMod.Author.ID,
				State:     state,
				CreatedAt: now,
			}
			if state == "published" {
				sub.PublishedAt = &now
				for idx := range s.Catalog.Mods {
					if s.Catalog.Mods[idx].ID == modID {
						s.Catalog.Mods[idx].LatestVersionID = versionID
					}
				}
			}
			s.Catalog.Submissions = append(s.Catalog.Submissions, sub)
		}

		// Update mod sync metadata
		for idx := range s.Catalog.Mods {
			if s.Catalog.Mods[idx].ID == modID {
				s.Catalog.Mods[idx].GitHubLastReleaseID = rel.ID
				s.Catalog.Mods[idx].GitHubLastSyncAt = &now
				s.Catalog.Mods[idx].GitHubBackoffUntil = nil
				if hasBlockers {
					s.Catalog.Mods[idx].GitHubLastSyncError = fmt.Sprintf("scan blocked on %s: %s", tag, strings.Join(report.Unsupported, "; "))
				} else {
					s.Catalog.Mods[idx].GitHubLastSyncError = ""
				}
				if newETag != "" {
					s.Catalog.Mods[idx].GitHubETag = newETag
				}
			}
		}
		_ = s.saveLocked()
		s.mu.Unlock()

		summary.Created++
		summary.Items = append(summary.Items, SyncItemResult{
			ReleaseID: rel.ID,
			Tag:       tag,
			Action:    "created",
			VersionID: versionID,
			AssetName: selected.AssetName,
			SHA256:    hash,
			SizeBytes: archiveSize,
		})
	}

	// Update mod error if all failed or any failed
	if summary.Failed > 0 {
		var lastErrMsg string
		for _, it := range summary.Items {
			if it.Action == "failed" {
				lastErrMsg = it.Reason
			}
		}
		s.mu.Lock()
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID {
				s.Catalog.Mods[i].GitHubLastSyncAt = &now
				s.Catalog.Mods[i].GitHubLastSyncError = lastErrMsg
				// The release list was fetched successfully even when one or
				// more individual releases failed to import. Persist its ETag so
				// the next poll can use a conditional request.
				if newETag != "" {
					s.Catalog.Mods[i].GitHubETag = newETag
				}
				_ = s.saveLocked()
				break
			}
		}
		s.mu.Unlock()
		summary.LastError = lastErrMsg
	} else {
		// All releases succeeded or skipped: unconditionally save newETag and clear errors & backoff
		s.mu.Lock()
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID {
				s.Catalog.Mods[i].GitHubLastSyncAt = &now
				s.Catalog.Mods[i].GitHubLastSyncError = ""
				s.Catalog.Mods[i].GitHubBackoffUntil = nil
				if newETag != "" {
					s.Catalog.Mods[i].GitHubETag = newETag
				}
				_ = s.saveLocked()
				break
			}
		}
		s.mu.Unlock()
	}

	return summary, nil
}

func (s *Store) SyncAllGitHubMods(ctx context.Context) map[string]*SyncSummary {
	s.mu.RLock()
	globalBackoff := !s.gitHubBackoffUntil.IsZero() && time.Now().Before(s.gitHubBackoffUntil)
	backoffDeadline := s.gitHubBackoffUntil
	modIDs := make([]string, 0)
	for _, m := range s.Catalog.Mods {
		if m.GetSourceType() == "github_releases" {
			modIDs = append(modIDs, m.ID)
		}
	}
	s.mu.RUnlock()

	results := make(map[string]*SyncSummary, len(modIDs))
	if globalBackoff {
		log.Printf("[github-sync] rate limit backoff active until %s, skipping periodic poll", backoffDeadline.UTC().Format(time.RFC3339))
		for _, id := range modIDs {
			results[id] = &SyncSummary{
				ModID:     id,
				SyncedAt:  time.Now(),
				Failed:    1,
				LastError: fmt.Sprintf("github api rate limit backoff active until %s", backoffDeadline.UTC().Format(time.RFC3339)),
			}
		}
		return results
	}

	for _, id := range modIDs {
		summary, err := s.SyncMod(ctx, id)
		if err != nil {
			log.Printf("[github-sync] mod %s sync error: %v", id, err)
		}
		results[id] = summary
	}
	return results
}

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
	ActiveJobs       int        `json:"active_jobs"`
	LastSyncAt       *time.Time `json:"last_sync_at,omitempty"`
	LastSyncError    string     `json:"last_sync_error,omitempty"`
	TotalManagedMods int        `json:"total_managed_mods"`
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

	intervalStr := "disabled"
	if s.GitHubSyncInterval > 0 {
		intervalStr = s.GitHubSyncInterval.String()
	}

	return &GitHubSyncDiagnostics{
		Interval:         intervalStr,
		ActiveJobs:       0,
		LastSyncAt:       latestSync,
		LastSyncError:    latestErr,
		TotalManagedMods: managedCount,
	}
}
