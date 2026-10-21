package httpapi

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
	packagezip "github.com/reze/submodhub/internal/package"
)

// releaseCandidate is one importable version offered by a mod's external source:
// where to fetch the archive and the provenance the catalog records for it.
// Both version-discovery modes (releases API and rezehub.yml) produce these, so
// scanning, the review gate and version creation have exactly one owner.
type releaseCandidate struct {
	Version      string
	Notes        string
	DownloadURL  string
	FileName     string
	AssetID      int64
	ReleaseID    int64
	SourceKind   github.SelectedSourceKind
	Owner        string
	Repo         string
	ExpectSHA256 string
}

// importedArchive is the result of downloading and scanning one candidate.
type importedArchive struct {
	VersionID string
	Path      string
	SizeBytes int64
	SHA256    string
	Report    packagezip.Report
}

func newVersionID() (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	return "ver_" + token[:12], nil
}

// importCandidate downloads, scans and records one candidate version.
// The returned bool reports whether a version row was actually created; a false
// result is either a skip (already present) or a failure, as described by the
// result's Action.
func (s *Store) importCandidate(ctx context.Context, client *github.Client, mod Mod, cand releaseCandidate, now time.Time) (SyncItemResult, bool) {
	archive, err := s.downloadAndScanCandidate(ctx, client, mod, cand, now)
	if err != nil {
		return SyncItemResult{
			ReleaseID: cand.ReleaseID,
			Tag:       cand.Version,
			AssetName: cand.FileName,
			Action:    "failed",
			Reason:    err.Error(),
		}, false
	}
	return s.commitImportedVersion(mod, cand, archive, now)
}

// downloadAndScanCandidate fetches the archive into the store's temp space,
// persists it into the immutable archive directory and scans it. Failures are
// returned as-is so the caller can report the exact reason per candidate.
func (s *Store) downloadAndScanCandidate(ctx context.Context, client *github.Client, mod Mod, cand releaseCandidate, now time.Time) (importedArchive, error) {
	var tmpPath string
	var downloadErr error
	select {
	case s.downloadSem <- struct{}{}:
		tmpPath, _, _, downloadErr = client.DownloadToTemp(ctx, cand.DownloadURL, maxArchiveSize)
		<-s.downloadSem
	case <-ctx.Done():
		downloadErr = ctx.Err()
	}
	if downloadErr != nil {
		if github.IsRateLimited(downloadErr) {
			s.extendRateLimitBackoff(mod.ID, downloadErr, now)
		}
		return importedArchive{}, downloadErr
	}
	defer os.Remove(tmpPath)

	f, openErr := os.Open(tmpPath)
	if openErr != nil {
		return importedArchive{}, openErr
	}
	defer f.Close()

	versionID, idErr := newVersionID()
	if idErr != nil {
		return importedArchive{}, errors.New("could not generate token")
	}
	finalPath, archiveSize, hash, report, scanErr := s.persistArchive(versionID, f, mod.Category == "spritepack")
	if scanErr != nil {
		return importedArchive{}, scanErr
	}
	if cand.SourceKind == github.SourceKindSourceCode {
		allowSourceRootReadme(&report)
	}
	if cand.ExpectSHA256 != "" && !strings.EqualFold(cand.ExpectSHA256, hash) {
		_ = os.Remove(finalPath)
		return importedArchive{}, fmt.Errorf("download_hash_mismatch: %s declares %s but the archive is %s", cand.Version, cand.ExpectSHA256, hash)
	}
	return importedArchive{
		VersionID: versionID,
		Path:      finalPath,
		SizeBytes: archiveSize,
		SHA256:    hash,
		Report:    report,
	}, nil
}

// commitImportedVersion writes the scanned version, its submission and the
// release pointer under the write lock, re-checking idempotency first because
// another sync (or another server) may have imported the same version already.
func (s *Store) commitImportedVersion(mod Mod, cand releaseCandidate, archive importedArchive, now time.Time) (SyncItemResult, bool) {
	autoPublish := s.AutoPublish
	hasBlockers := len(archive.Report.Unsupported) > 0
	state := "ready_for_review"
	if autoPublish {
		// Auto-publish explicitly disables the review gate. Keep the complete
		// scan report and sync error metadata so administrators can still audit
		// unsupported files or conflicts after publication.
		state = "published"
	} else if hasBlockers || len(archive.Report.Conflicts) > 0 {
		state = "scanning"
	}

	version := Version{
		ID:              archive.VersionID,
		ModID:           mod.ID,
		Version:         cand.Version,
		CreatedAt:       &now,
		State:           state,
		SizeBytes:       archive.SizeBytes,
		SHA256:          archive.SHA256,
		ReleaseNotes:    cand.Notes,
		ScanReportID:    "scan_" + archive.VersionID,
		ArchivePath:     archive.Path,
		SourceType:      "github_releases",
		GitHubReleaseID: cand.ReleaseID,
		GitHubAssetID:   cand.AssetID,
		GitHubSource: &VersionSourceLocation{
			Owner:       cand.Owner,
			Repo:        cand.Repo,
			ReleaseID:   cand.ReleaseID,
			AssetID:     cand.AssetID,
			FileName:    cand.FileName,
			DownloadURL: cand.DownloadURL,
		},
	}

	// Extract dependencies from the submod registrations found by the scan.
	seenDeps := map[string]bool{}
	for _, reg := range archive.Report.Submods {
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

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.Catalog.Versions {
		if existing.ModID != mod.ID {
			continue
		}
		releaseMatch := cand.ReleaseID != 0 && existing.GitHubReleaseID == cand.ReleaseID
		if releaseMatch || existing.Version == cand.Version {
			_ = os.Remove(archive.Path)
			return SyncItemResult{
				ReleaseID: cand.ReleaseID,
				Tag:       cand.Version,
				Action:    "skipped",
				Reason:    "concurrent sync duplicate",
			}, false
		}
	}
	version = resolveVersionDependencies(s.Catalog, version)

	if s.Catalog.ScanReports == nil {
		s.Catalog.ScanReports = map[string]packagezip.Report{}
	}
	s.Catalog.ScanReports[version.ScanReportID] = archive.Report
	s.Catalog.Versions[version.ID] = version

	if state == "ready_for_review" || state == "published" {
		subToken, _ := randomToken()
		sub := Submission{
			ID:        "sub_" + subToken[:12],
			ModID:     mod.ID,
			VersionID: version.ID,
			AuthorID:  mod.Author.ID,
			State:     state,
			CreatedAt: now,
		}
		if state == "published" {
			sub.PublishedAt = &now
		}
		s.Catalog.Submissions = append(s.Catalog.Submissions, sub)
	}

	if cand.ReleaseID != 0 {
		for idx := range s.Catalog.Mods {
			if s.Catalog.Mods[idx].ID == mod.ID {
				s.Catalog.Mods[idx].GitHubLastReleaseID = cand.ReleaseID
				break
			}
		}
	}
	_ = s.saveLocked()

	return SyncItemResult{
		ReleaseID: cand.ReleaseID,
		Tag:       cand.Version,
		Action:    "created",
		VersionID: version.ID,
		AssetName: cand.FileName,
		SHA256:    archive.SHA256,
		SizeBytes: archive.SizeBytes,
	}, true
}

// finishSync records the outcome of one refresh attempt and is the only writer
// of a mod's sync metadata (time, error, backoff, cache cursors).
func (s *Store) finishSync(modID string, now time.Time, summary *SyncSummary, etag, manifestDigest string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].ID != modID {
			continue
		}
		mod := &s.Catalog.Mods[i]
		mod.GitHubLastSyncAt = &now
		if summary.Failed > 0 {
			var lastErr string
			for _, item := range summary.Items {
				if item.Action == "failed" {
					lastErr = item.Reason
				}
			}
			if lastErr == "" {
				lastErr = summary.LastError
			}
			mod.GitHubLastSyncError = lastErr
			summary.LastError = lastErr
		} else {
			mod.GitHubLastSyncError = ""
			mod.GitHubBackoffUntil = nil
		}
		// A successful listing is cached even when some individual versions
		// failed afterwards: the ETag describes the release list, not the import.
		if etag != "" {
			mod.GitHubETag = etag
		}
		if manifestDigest != "" {
			mod.GitHubManifestDigest = manifestDigest
		}
		_ = s.saveLocked()
		return
	}
}

// rateLimitDeadline resolves how long GitHub asked us to stay away, falling back
// to 15 minutes when the response carried no usable hint.
func rateLimitDeadline(err error, now time.Time) time.Time {
	deadline := now.Add(15 * time.Minute)
	if rlErr, ok := github.AsRateLimitError(err); ok {
		if rlErr.ResetAt.After(now) {
			deadline = rlErr.ResetAt
		} else if rlErr.RetryAfter > 0 {
			deadline = now.Add(rlErr.RetryAfter)
		}
	}
	return deadline
}

// extendRateLimitBackoff locks the mod (and the whole sync loop) out of the
// GitHub API until the reported reset, so a throttled server does not keep
// burning the shared quota.
func (s *Store) extendRateLimitBackoff(modID string, err error, now time.Time) {
	deadline := rateLimitDeadline(err, now)
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
