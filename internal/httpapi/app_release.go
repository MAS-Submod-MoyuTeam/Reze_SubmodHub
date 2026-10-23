package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/reze/submodhub/internal/checksum"
	"github.com/reze/submodhub/internal/cloudreve"
	"github.com/reze/submodhub/internal/github"
	"github.com/reze/submodhub/internal/version"
)

// App self-update delivery. The API is the update-check authority: it reads the
// official repository's newest stable release, mirrors the client-relevant
// assets into enabled Cloudreve nodes, and publishes one descriptor that tells
// clients where to download each asset and which SHA-256 to expect. GitHub stays
// the fallback and the release-notes source; it is never a second authority for
// which version is current.
const (
	appReleaseRefreshInterval = 10 * time.Minute
	appReleaseRetryInterval   = 2 * time.Minute
	appReleaseRequestBudget   = 4 * time.Second
	appAssetMaxBytes          = 128 << 20
	appMirrorMaxAttempts      = 8
	appChecksumAssetName      = "sha256sums.txt"
	appChecksumMaxBytes       = 1 << 20
)

var (
	errAppChecksumMissing = errors.New("app_asset_checksum_missing")
	errAppReleaseMissing  = errors.New("app_release_unavailable")
)

// AppAssetMirror is persistence only: one app-release asset uploaded to one
// Cloudreve node. Handlers must project it into an explicit DTO.
type AppAssetMirror struct {
	NodeID       string    `json:"node_id"`
	NodeRevision uint64    `json:"node_revision"`
	Tag          string    `json:"tag"`
	AssetName    string    `json:"asset_name"`
	SHA256       string    `json:"sha256"`
	SizeBytes    int64     `json:"size_bytes"`
	ObjectName   string    `json:"object_name"`
	FileID       string    `json:"file_id,omitempty"`
	State        string    `json:"state"`
	Attempts     int       `json:"attempts"`
	RetryAt      time.Time `json:"retry_at"`
	ErrorCode    string    `json:"error_code,omitempty"`
}

type appReleaseState struct {
	mu         sync.Mutex
	release    *github.Release
	checksums  map[string]string
	checkedAt  time.Time
	refreshing bool
}

// appReleaseRepo resolves the published repository coordinates. Tests override
// the Store fields; production uses the shared release coordinates.
func (s *Store) appReleaseRepo() (string, string) {
	owner, name := s.AppReleaseRepoOwner, s.AppReleaseRepoName
	if owner == "" {
		owner = version.RepoOwner
	}
	if name == "" {
		name = version.RepoName
	}
	return owner, name
}

func (s *Store) appReleaseSnapshot() (github.Release, map[string]string, bool) {
	state := &s.appRelease
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.release == nil {
		return github.Release{}, nil, false
	}
	return *state.release, state.checksums, true
}

func (s *Store) appReleaseStale() bool {
	state := &s.appRelease
	state.mu.Lock()
	defer state.mu.Unlock()
	return time.Since(state.checkedAt) >= appReleaseRefreshInterval
}

// reserveAppReleaseRefresh reports whether the caller may refresh, and marks the
// refresh in flight so concurrent callers skip instead of queueing.
func (s *Store) reserveAppReleaseRefresh(force bool) bool {
	state := &s.appRelease
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.refreshing {
		return false
	}
	if !force && time.Since(state.checkedAt) < appReleaseRefreshInterval {
		return false
	}
	state.refreshing = true
	return true
}

func (s *Store) finishAppReleaseRefresh(release *github.Release, sums map[string]string, err error) {
	state := &s.appRelease
	state.mu.Lock()
	defer state.mu.Unlock()
	state.refreshing = false
	if err == nil {
		state.release = release
		state.checksums = sums
		state.checkedAt = time.Now()
		return
	}
	// A failed refresh retries sooner than the steady-state interval, but never
	// on every worker tick.
	state.checkedAt = time.Now().Add(-(appReleaseRefreshInterval - appReleaseRetryInterval))
}

func (s *Store) refreshAppRelease(ctx context.Context, force bool) error {
	if !s.reserveAppReleaseRefresh(force) {
		return nil
	}
	release, sums, err := s.fetchAppRelease(ctx)
	s.finishAppReleaseRefresh(release, sums, err)
	return err
}

// kickAppReleaseRefresh starts one background refresh and returns immediately.
// The delivery worker must never block on GitHub: archive mirroring stays
// responsive even when the API is unreachable.
func (s *Store) kickAppReleaseRefresh() {
	if !s.reserveAppReleaseRefresh(false) {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		release, sums, err := s.fetchAppRelease(ctx)
		s.finishAppReleaseRefresh(release, sums, err)
	}()
}

func (s *Store) fetchAppRelease(ctx context.Context) (*github.Release, map[string]string, error) {
	owner, repo := s.appReleaseRepo()
	client := s.githubClient()
	releases, _, _, err := client.ListReleases(ctx, owner, repo, "")
	if err != nil {
		return nil, nil, err
	}
	var latest *github.Release
	for i := range releases {
		if releases[i].Draft || releases[i].Prerelease {
			continue
		}
		latest = &releases[i]
		break
	}
	if latest == nil {
		return nil, nil, errAppReleaseMissing
	}
	sums := map[string]string{}
	if asset := findReleaseAssetByName(latest.Assets, appChecksumAssetName); asset != nil {
		body, readErr := readReleaseAssetText(ctx, client, asset.BrowserDownloadURL, appChecksumMaxBytes)
		if readErr != nil {
			return nil, nil, readErr
		}
		sums = checksum.Parse(body)
	}
	return latest, sums, nil
}

func findReleaseAssetByName(assets []github.Asset, name string) *github.Asset {
	for i := range assets {
		if strings.EqualFold(assets[i].Name, name) {
			return &assets[i]
		}
	}
	return nil
}

func readReleaseAssetText(ctx context.Context, client *github.Client, url string, limit int64) (string, error) {
	res, err := client.OpenArchiveStream(ctx, url)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, limit))
	if err != nil {
		return "", err
	}
	if int64(len(body)) >= limit {
		return "", errors.New("app_release_checksum_too_large")
	}
	return string(body), nil
}

// appClientAssets lists release assets a client can install: Windows binaries,
// Android packages and the independent updater. Asset naming stays owned by the
// client's selector; the server only decides what is worth mirroring.
func appClientAssets(release github.Release) []github.Asset {
	out := []github.Asset{}
	for _, a := range release.Assets {
		if a.Size <= 0 || a.Size > appAssetMaxBytes || a.Name == "" || path.Base(a.Name) != a.Name {
			continue
		}
		lower := strings.ToLower(a.Name)
		if !strings.HasSuffix(lower, ".exe") && !strings.HasSuffix(lower, ".apk") {
			continue
		}
		out = append(out, a)
	}
	return out
}

// appMirrorCandidates keeps only assets whose SHA-256 is published in the
// release checksum listing. Without that hash the server cannot verify its own
// upload, so such assets stay on the GitHub path.
func appMirrorCandidates(release github.Release, sums map[string]string) []github.Asset {
	out := []github.Asset{}
	for _, a := range appClientAssets(release) {
		if sums[a.Name] == "" {
			continue
		}
		out = append(out, a)
	}
	return out
}

func appObjectName(tag, sha, assetName string) string {
	safeTag := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, tag)
	short := sha
	if len(short) > 12 {
		short = short[:12]
	}
	return fmt.Sprintf("app-%s-%s-%s", safeTag, short, assetName)
}

func (s *Store) reconcileAppMirrors(release github.Release, sums map[string]string) error {
	candidates := appMirrorCandidates(release, sums)
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.Catalog.AppAssetMirrors
	updated := slices.DeleteFunc(slices.Clone(previous), func(m AppAssetMirror) bool {
		if m.Tag != release.TagName {
			return true
		}
		if !slices.ContainsFunc(candidates, func(a github.Asset) bool { return a.Name == m.AssetName }) {
			return true
		}
		return !slices.ContainsFunc(s.Catalog.DeliveryNodes, func(n DeliveryNode) bool { return n.ID == m.NodeID && n.Type == "cloudreve" })
	})
	changed := len(updated) != len(previous)
	for _, n := range s.Catalog.DeliveryNodes {
		if !n.Enabled || n.Type != "cloudreve" {
			continue
		}
		for _, a := range candidates {
			fresh := AppAssetMirror{NodeID: n.ID, NodeRevision: n.Revision, Tag: release.TagName, AssetName: a.Name, SHA256: sums[a.Name], SizeBytes: a.Size, ObjectName: appObjectName(release.TagName, sums[a.Name], a.Name), State: "pending"}
			index := slices.IndexFunc(updated, func(m AppAssetMirror) bool { return m.NodeID == n.ID && m.AssetName == a.Name })
			if index < 0 {
				updated = append(updated, fresh)
				changed = true
				continue
			}
			old := updated[index]
			if old.NodeRevision != n.Revision || old.SHA256 != fresh.SHA256 || old.SizeBytes != fresh.SizeBytes {
				updated[index] = fresh
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	s.Catalog.AppAssetMirrors = updated
	if err := s.saveLocked(); err != nil {
		s.Catalog.AppAssetMirrors = previous
		return err
	}
	return nil
}

func (s *Store) claimAppMirror() (AppAssetMirror, DeliveryNode, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, job := range s.Catalog.AppAssetMirrors {
		if job.State != "pending" && (job.State != "failed" || job.Attempts >= appMirrorMaxAttempts || time.Now().Before(job.RetryAt)) {
			continue
		}
		for _, n := range s.Catalog.DeliveryNodes {
			if n.ID != job.NodeID || n.Type != "cloudreve" || !n.Enabled || n.Revision != job.NodeRevision {
				continue
			}
			previous := job
			job.State = "uploading"
			s.Catalog.AppAssetMirrors[i] = job
			if err := s.saveLocked(); err != nil {
				s.Catalog.AppAssetMirrors[i] = previous
				return AppAssetMirror{}, DeliveryNode{}, false, err
			}
			return job, n, true, nil
		}
	}
	return AppAssetMirror{}, DeliveryNode{}, false, nil
}

func (s *Store) finishAppMirror(job AppAssetMirror, fileID string, workErr error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !slices.ContainsFunc(s.Catalog.DeliveryNodes, func(n DeliveryNode) bool {
		return n.ID == job.NodeID && n.Enabled && n.Revision == job.NodeRevision
	}) {
		return nil
	}
	index := slices.IndexFunc(s.Catalog.AppAssetMirrors, func(m AppAssetMirror) bool {
		return m.NodeID == job.NodeID && m.Tag == job.Tag && m.AssetName == job.AssetName && m.NodeRevision == job.NodeRevision
	})
	if index < 0 {
		return nil
	}
	previous := s.Catalog.AppAssetMirrors[index]
	next := previous
	next.Attempts++
	if workErr == nil {
		next.State = "ready"
		next.FileID = fileID
		next.ErrorCode = ""
		next.RetryAt = time.Time{}
	} else {
		next.State = "failed"
		next.ErrorCode = "mirror_provider_failed"
		switch {
		case errors.Is(workErr, errAppChecksumMissing):
			next.ErrorCode = errAppChecksumMissing.Error()
		case errors.Is(workErr, cloudreve.ErrUnknownExpiry):
			next.ErrorCode = "cloudreve_download_expiry_unknown"
		case errors.Is(workErr, errMirrorVerification):
			next.ErrorCode = errMirrorVerification.Error()
			if nonce, err := randomToken(); err == nil {
				next.ObjectName = appObjectName(job.Tag, job.SHA256, job.AssetName) + "-" + nonce[:12]
			}
		}
		next.RetryAt = time.Now().UTC().Add(time.Minute * time.Duration(1<<min(next.Attempts, 10)))
	}
	s.Catalog.AppAssetMirrors[index] = next
	if err := s.saveLocked(); err != nil {
		s.Catalog.AppAssetMirrors[index] = previous
		return err
	}
	return nil
}

// verifyCloudreveReadback streams an independent unauthenticated read of an
// uploaded object and checks every byte against the published hash.
func verifyCloudreveReadback(ctx context.Context, client *cloudreve.Client, link cloudreve.Link, size int64, sha string) error {
	res, err := client.OpenDownload(ctx, link)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.ContentLength >= 0 && res.ContentLength != size {
		return errMirrorVerification
	}
	h := sha256.New()
	count, err := io.CopyBuffer(h, io.LimitReader(res.Body, size+1), make([]byte, 64<<10))
	if err != nil || count != size || hex.EncodeToString(h.Sum(nil)) != sha {
		return errMirrorVerification
	}
	return nil
}

func (s *Store) copyAppMirror(ctx context.Context, job AppAssetMirror, n DeliveryNode) (string, error) {
	if job.SHA256 == "" {
		return "", errAppChecksumMissing
	}
	release, _, ok := s.appReleaseSnapshot()
	if !ok {
		return "", errAppReleaseMissing
	}
	asset := findReleaseAssetByName(release.Assets, job.AssetName)
	if asset == nil || asset.Size != job.SizeBytes {
		return "", errMirrorVerification
	}
	tmpPath, sha, size, err := s.githubClient().DownloadToTemp(ctx, asset.BrowserDownloadURL, appAssetMaxBytes)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpPath)
	if sha != job.SHA256 || size != job.SizeBytes {
		return "", errMirrorVerification
	}
	file, err := os.Open(tmpPath)
	if err != nil {
		return "", errors.New("mirror_local_asset_unavailable")
	}
	defer file.Close()
	client, err := s.cloudreveClient(n)
	if err != nil {
		return "", err
	}
	obj, err := client.Upload(ctx, n.Directory, job.ObjectName, file, job.SizeBytes)
	if err != nil {
		return "", err
	}
	link, err := client.Download(ctx, obj.ID)
	if err != nil {
		return "", err
	}
	if err := verifyCloudreveReadback(ctx, client, link, job.SizeBytes, job.SHA256); err != nil {
		return "", err
	}
	return obj.ID, nil
}

// maintainAppAssets advances app-update mirroring by at most one asset. It runs
// inside the single delivery worker, so app uploads never overlap archive
// uploads and no archive-sized memory is held.
func (s *Store) maintainAppAssets(ctx context.Context) {
	// With no enabled Cloudreve node there is nothing to mirror, and polling
	// GitHub for every tick would be pure waste.
	s.mu.RLock()
	hasCloudreve := slices.ContainsFunc(s.Catalog.DeliveryNodes, func(n DeliveryNode) bool {
		return n.Enabled && n.Type == "cloudreve" && n.Directory != ""
	})
	s.mu.RUnlock()
	if !hasCloudreve {
		return
	}
	s.kickAppReleaseRefresh()
	release, sums, ok := s.appReleaseSnapshot()
	if !ok {
		return
	}
	if err := s.reconcileAppMirrors(release, sums); err != nil {
		log.Print("[app-release] mirror reconciliation persistence failed; retrying")
		return
	}
	job, n, ok, err := s.claimAppMirror()
	if err != nil {
		log.Print("[app-release] mirror claim persistence failed; retrying")
		return
	}
	if !ok {
		return
	}
	workCtx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	fileID, workErr := s.copyAppMirror(workCtx, job, n)
	cancel()
	if s.finishAppMirror(job, fileID, workErr) != nil {
		log.Print("[app-release] mirror completion persistence failed; retrying")
	}
}

type appUpdateAssetDTO struct {
	Name                   string     `json:"name"`
	SizeBytes              int64      `json:"size_bytes"`
	SHA256                 string     `json:"sha256,omitempty"`
	DeliveryType           string     `json:"delivery_type"`
	NodeID                 string     `json:"node_id,omitempty"`
	URL                    string     `json:"url"`
	ExpiresAt              *time.Time `json:"expires_at,omitempty"`
	AllowedDownloadOrigins []string   `json:"allowed_download_origins"`
	GitHubURL              string     `json:"github_url"`
}

type appUpdateDTO struct {
	TagName     string              `json:"tag_name"`
	Version     string              `json:"version"`
	Name        string              `json:"name"`
	Notes       string              `json:"notes"`
	Prerelease  bool                `json:"prerelease"`
	PublishedAt *time.Time          `json:"published_at,omitempty"`
	ChecksumURL string              `json:"checksum_url,omitempty"`
	Assets      []appUpdateAssetDTO `json:"assets"`
}

// appUpdateDescriptor is the public update-check and delivery contract. It
// reports the newest stable release, the SHA-256 the API trusts for each asset,
// and a Cloudreve direct link when a verified mirror exists.
func (s *Store) appUpdateDescriptor(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "GET only")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), appReleaseRequestBudget)
	defer cancel()
	if s.appReleaseStale() {
		_ = s.refreshAppRelease(ctx, false)
	}
	release, sums, ok := s.appReleaseSnapshot()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "app_release_unavailable", "app release metadata is not available yet")
		return
	}

	s.mu.RLock()
	nodes := slices.Clone(s.Catalog.DeliveryNodes)
	mirrors := slices.Clone(s.Catalog.AppAssetMirrors)
	s.mu.RUnlock()

	out := appUpdateDTO{
		TagName:     release.TagName,
		Version:     strings.TrimPrefix(release.TagName, "v"),
		Name:        release.Name,
		Notes:       release.Body,
		Prerelease:  release.Prerelease,
		PublishedAt: release.PublishedAt,
		Assets:      []appUpdateAssetDTO{},
	}
	if checksumAsset := findReleaseAssetByName(release.Assets, appChecksumAssetName); checksumAsset != nil {
		out.ChecksumURL = checksumAsset.BrowserDownloadURL
	}

	ready := []DeliveryNode{}
	for _, n := range nodes {
		if n.Enabled && n.Type == "cloudreve" {
			ready = append(ready, n)
		}
	}
	for _, asset := range appClientAssets(release) {
		entry := appUpdateAssetDTO{
			Name:                   asset.Name,
			SizeBytes:              asset.Size,
			SHA256:                 sums[asset.Name],
			DeliveryType:           "github",
			URL:                    asset.BrowserDownloadURL,
			AllowedDownloadOrigins: []string{},
			GitHubURL:              asset.BrowserDownloadURL,
		}
		for _, n := range weightedDeliveryOrder(ready) {
			index := slices.IndexFunc(mirrors, func(m AppAssetMirror) bool {
				return m.NodeID == n.ID && m.NodeRevision == n.Revision && m.Tag == release.TagName && m.AssetName == asset.Name && m.State == "ready" && m.FileID != "" && m.SHA256 == entry.SHA256 && m.SizeBytes == asset.Size
			})
			if index < 0 || entry.SHA256 == "" {
				continue
			}
			link, err := s.resolveCloudreveLink(ctx, n, mirrors[index].FileID)
			if err != nil {
				continue
			}
			expiry := minTime(link.ExpiresAt.Add(-15*time.Second), time.Now().Add(5*time.Minute))
			if !expiry.After(time.Now()) {
				continue
			}
			entry.DeliveryType = "cloudreve"
			entry.NodeID = n.ID
			entry.URL = link.URL
			entry.ExpiresAt = &expiry
			entry.AllowedDownloadOrigins = slices.Clone(n.AllowedDownloadOrigins)
			break
		}
		out.Assets = append(out.Assets, entry)
	}
	writeJSON(w, http.StatusOK, out)
}
