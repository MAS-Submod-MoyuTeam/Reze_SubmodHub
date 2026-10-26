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
	// Platforms is set when the mod declares per-platform release assets. Each
	// entry is downloaded and scanned on its own, and the imported version then
	// carries one file per platform instead of a single archive.
	Platforms []platformSelection
}

// perPlatform reports whether this candidate imports several platform files.
func (c releaseCandidate) perPlatform() bool {
	return len(c.Platforms) > 0
}

// assetFor returns the asset to fetch for platform; a single-file candidate
// serves every platform with the same archive.
func (c releaseCandidate) assetFor(platform string) (github.SelectedAsset, bool) {
	if !c.perPlatform() {
		return github.SelectedAsset{
			Kind:        c.SourceKind,
			AssetID:     c.AssetID,
			AssetName:   c.FileName,
			DownloadURL: c.DownloadURL,
		}, true
	}
	for _, entry := range c.Platforms {
		if entry.Platform == platform {
			return entry.Asset, true
		}
	}
	return github.SelectedAsset{}, false
}

// importedArchive is the result of downloading and scanning one candidate.
type importedArchive struct {
	VersionID string
	Path      string
	SizeBytes int64
	SHA256    string
	Report    packagezip.Report
}

// importedPlatformArchive is one platform's downloaded, scanned and stored ZIP.
type importedPlatformArchive struct {
	Platform  string
	Asset     github.SelectedAsset
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
	if cand.perPlatform() {
		return s.importPlatformCandidate(ctx, client, mod, cand, now)
	}
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

// importPlatformCandidate downloads, scans and records one version that carries
// a separate archive per platform. Nothing is committed unless every declared
// platform was fetched and scanned, so a partial release never becomes a
// catalog version that silently lacks a platform.
func (s *Store) importPlatformCandidate(ctx context.Context, client *github.Client, mod Mod, cand releaseCandidate, now time.Time) (SyncItemResult, bool) {
	// The commit step reads archives[0] for the version summary, so an empty
	// selection must never reach it.
	if len(cand.Platforms) == 0 {
		return SyncItemResult{ReleaseID: cand.ReleaseID, Tag: cand.Version, Action: "failed", Reason: "no platform asset was selected"}, false
	}
	versionID, idErr := newVersionID()
	if idErr != nil {
		return SyncItemResult{ReleaseID: cand.ReleaseID, Tag: cand.Version, Action: "failed", Reason: "could not generate token"}, false
	}
	archives := make([]importedPlatformArchive, 0, len(cand.Platforms))
	for _, entry := range cand.Platforms {
		record, err := s.downloadAndScanPlatform(ctx, client, mod, entry, versionID, now)
		if err != nil {
			for _, done := range archives {
				if done.Path != "" {
					_ = os.Remove(done.Path)
				}
			}
			return SyncItemResult{
				ReleaseID: cand.ReleaseID,
				Tag:       cand.Version,
				AssetName: entry.Asset.AssetName,
				Action:    "failed",
				Reason:    fmt.Sprintf("%s: %v", entry.Platform, err),
			}, false
		}
		archives = append(archives, record)
	}
	return s.commitImportedPlatformVersion(mod, cand, versionID, archives, now)
}

// downloadAndScanPlatform fetches and scans one platform's archive and keeps it
// under the version's platform file name.
//
// Every platform stores its bytes, including the release-zipball fallback: a
// catalog entry that advertises a size and a hash must own the bytes those
// numbers describe, or the download endpoint would have to promise a file it
// cannot produce. The fallback only differs in that its source is the zipball,
// so the archive keeps the source name for provenance instead of a release asset
// name.
func (s *Store) downloadAndScanPlatform(ctx context.Context, client *github.Client, mod Mod, entry platformSelection, versionID string, now time.Time) (importedPlatformArchive, error) {
	tmpPath, downloadErr := s.downloadToTemp(ctx, client, entry.Asset.DownloadURL)
	if downloadErr != nil {
		if github.IsRateLimited(downloadErr) {
			s.extendRateLimitBackoff(mod.ID, downloadErr, now)
		}
		return importedPlatformArchive{}, downloadErr
	}
	defer os.Remove(tmpPath)

	f, openErr := os.Open(tmpPath)
	if openErr != nil {
		return importedPlatformArchive{}, openErr
	}
	defer f.Close()

	path, size, hash, report, scanErr := s.persistArchiveAs(versionID, archiveFileBase(versionID, entry.Platform), f, mod.Category == "spritepack")
	if scanErr != nil {
		return importedPlatformArchive{}, scanErr
	}
	if entry.Asset.Kind == github.SourceKindSourceCode {
		allowSourceRootReadme(&report)
	}
	return importedPlatformArchive{Platform: entry.Platform, Asset: entry.Asset, Path: path, SizeBytes: size, SHA256: hash, Report: report}, nil
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

// downloadToTemp fetches one upstream archive into a temporary file under the
// store's download budget, so a sync never exceeds the configured concurrency.
func (s *Store) downloadToTemp(ctx context.Context, client *github.Client, url string) (string, error) {
	select {
	case s.downloadSem <- struct{}{}:
		tmpPath, _, _, err := client.DownloadToTemp(ctx, url, maxArchiveSize)
		<-s.downloadSem
		return tmpPath, err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// commitImportedPlatformVersion writes one version carrying every platform's
// scanned archive. The version-wide SHA256/SizeBytes stay empty on purpose: for
// this shape the per-platform hashes are the only truthful statement, and
// leaving the wide fields empty stops any caller from treating one platform's
// bytes as the whole version.
func (s *Store) commitImportedPlatformVersion(mod Mod, cand releaseCandidate, versionID string, archives []importedPlatformArchive, now time.Time) (SyncItemResult, bool) {
	hasBlockers := false
	reports := map[string]packagezip.Report{}
	for _, entry := range archives {
		if len(entry.Report.Unsupported) > 0 || len(entry.Report.Conflicts) > 0 {
			hasBlockers = true
		}
		reports[entry.Platform] = entry.Report
	}
	state := "ready_for_review"
	if s.AutoPublish {
		state = "published"
	} else if hasBlockers {
		state = "scanning"
	}

	version := Version{
		ID:              versionID,
		ModID:           mod.ID,
		Version:         cand.Version,
		CreatedAt:       &now,
		State:           state,
		ReleaseNotes:    cand.Notes,
		SourceType:      "github_releases",
		GitHubReleaseID: cand.ReleaseID,
		PlatformAssets:  make([]PlatformAssetRule, 0, len(archives)),
	}
	for _, entry := range archives {
		rule := PlatformAssetRule{
			Platform:    entry.Platform,
			AssetName:   entry.Asset.AssetName,
			ArchivePath: entry.Path,
			SizeBytes:   entry.SizeBytes,
			SHA256:      entry.SHA256,
		}
		version.PlatformAssets = append(version.PlatformAssets, rule)
	}
	version.PlatformAssets = version.platformFiles()
	version.ScanReportID = version.summaryScanReportID()
	first := archives[0].Asset
	version.GitHubAssetID = first.AssetID
	// VersionSourceLocation is the single-release provenance used by the relay
	// and by archive mirroring. It names the first platform's asset; each
	// platform's own URL is re-derived from GitHubSource.DownloadURL by replacing
	// the release file name, so the relay never serves the wrong platform.
	version.GitHubSource = &VersionSourceLocation{
		Owner:       cand.Owner,
		Repo:        cand.Repo,
		ReleaseID:   cand.ReleaseID,
		AssetID:     first.AssetID,
		FileName:    first.AssetName,
		DownloadURL: first.DownloadURL,
	}

	// Dependencies are the union over every platform archive: a platform that
	// adds a dependency must not disappear because another platform lacks it.
	seenDeps := map[string]bool{}
	for _, entry := range archives {
		for _, reg := range entry.Report.Submods {
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
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.Catalog.Versions {
		if existing.ModID != mod.ID {
			continue
		}
		releaseMatch := cand.ReleaseID != 0 && existing.GitHubReleaseID == cand.ReleaseID
		if releaseMatch || existing.Version == cand.Version {
			removePlatformArchives(version.PlatformAssets)
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
	// One scan report per platform keeps each platform's file list and sprite
	// index addressable under <version>-<platform>. ScanReportID names the first
	// platform's report, mirroring how the version summary reports one archive.
	for platform, report := range reports {
		s.Catalog.ScanReports[scanReportKey(versionID, platform)] = report
	}
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

	var total int64
	for _, entry := range archives {
		total += entry.SizeBytes
	}
	return SyncItemResult{
		ReleaseID: cand.ReleaseID,
		Tag:       cand.Version,
		Action:    "created",
		VersionID: version.ID,
		AssetName: archives[0].Asset.AssetName,
		SHA256:    archives[0].SHA256,
		SizeBytes: total,
	}, true
}

// removePlatformArchives deletes stored per-platform ZIPs of a version that was
// not committed.
func removePlatformArchives(files []PlatformAssetRule) {
	for _, file := range files {
		if file.ArchivePath != "" {
			_ = os.Remove(file.ArchivePath)
		}
	}
}

// scanReportKey names one platform's scan report inside a version.
func scanReportKey(versionID, platform string) string {
	return "scan_" + archiveFileBase(versionID, platform)
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
