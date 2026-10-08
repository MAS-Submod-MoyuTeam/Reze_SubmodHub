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

	client := s.getGitHubClient()
	releases, newETag, notModified, err := client.ListReleases(ctx, targetMod.GitHubOwner, targetMod.GitHubRepo, targetMod.GitHubETag)
	if err != nil {
		s.mu.Lock()
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID {
				s.Catalog.Mods[i].GitHubLastSyncAt = &now
				s.Catalog.Mods[i].GitHubLastSyncError = err.Error()
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
		tmpPath, _, _, dlErr := client.DownloadToTemp(ctx, selected.DownloadURL, maxArchiveSize)
		if dlErr != nil {
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
				_ = s.saveLocked()
				break
			}
		}
		s.mu.Unlock()
		summary.LastError = lastErrMsg
	} else if summary.Created > 0 || summary.Skipped > 0 {
		s.mu.Lock()
		for i := range s.Catalog.Mods {
			if s.Catalog.Mods[i].ID == modID {
				s.Catalog.Mods[i].GitHubLastSyncAt = &now
				s.Catalog.Mods[i].GitHubLastSyncError = ""
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
