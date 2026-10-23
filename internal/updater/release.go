package updater

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/reze/submodhub/internal/github"
)

// Service coordinates release discovery, download, integrity check, and handoff.
type Service struct {
	config       Config
	ghClient     *github.Client
	apiClient    *http.Client
	apiBase      atomic.Value // string
	stageManager *StageManager
	installer    PlatformInstaller

	stateMu       sync.RWMutex
	state         State
	activeCancel  context.CancelFunc
	operationBusy bool
}

func NewService(cfg Config, installer PlatformInstaller) (*Service, error) {
	if cfg.RepoOwner == "" {
		cfg.RepoOwner = DefaultRepoOwner
	}
	if cfg.RepoName == "" {
		cfg.RepoName = DefaultRepoName
	}

	stage, err := NewStageManager(cfg.CacheDir)
	if err != nil {
		return nil, err
	}

	ghOpts := []github.Option{
		github.WithUserAgent("SubmodHub-Updater/1.0"),
	}
	if cfg.ProxyTemplate != "" {
		ghOpts = append(ghOpts, github.WithProxyTemplate(cfg.ProxyTemplate))
	}

	svc := &Service{
		config:       cfg,
		ghClient:     github.NewClient(ghOpts...),
		apiClient:    &http.Client{Timeout: 20 * time.Second},
		stageManager: stage,
		installer:    installer,
		state: State{
			Status:         StatusIdle,
			CurrentVersion: cfg.CurrentVersion,
		},
	}
	svc.apiBase.Store(strings.TrimSpace(cfg.APIBaseURL))
	return svc, nil
}

// GetState returns a snapshot of the current update state.
func (s *Service) GetState() State {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	return s.state
}

func (s *Service) setState(updater func(*State)) {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.state.Status == StatusCancelled || installOccupied(s.state.Status) {
		return
	}
	updater(&s.state)
}

// CheckForUpdate asks the API which release is current and how to fetch it.
// GitHub remains the fallback when the API cannot answer, and the only path for
// prerelease channels because those releases are never mirrored.
func (s *Service) CheckForUpdate(ctx context.Context) (*ReleaseInfo, error) {
	s.stateMu.Lock()
	if s.operationBusy || installOccupied(s.state.Status) {
		s.stateMu.Unlock()
		return nil, fmt.Errorf("updater is busy")
	}
	s.operationBusy = true
	s.state.Status = StatusChecking
	s.state.Error = ""
	s.stateMu.Unlock()
	defer func() {
		s.stateMu.Lock()
		s.operationBusy = false
		s.stateMu.Unlock()
	}()

	if s.APIBaseURL() != "" && !s.config.IncludePrerelease {
		info, stale, apiErr := s.checkViaAPI(ctx)
		if apiErr == nil && !stale {
			return info, nil
		}
		if apiErr == nil {
			// The API answered from a snapshot it has not refreshed for too long.
			// GitHub may know about a release the API cannot see; ask it. If GitHub
			// cannot answer either, keep the API's answer instead of failing the
			// check: a blocked GitHub is exactly why the API path exists.
			s.stateMu.Lock()
			apiState := s.state
			s.stateMu.Unlock()
			ghInfo, ghErr := s.checkViaGitHub(ctx)
			if ghErr == nil {
				return ghInfo, nil
			}
			s.stateMu.Lock()
			s.state = apiState
			s.stateMu.Unlock()
			return info, nil
		}
	}
	return s.checkViaGitHub(ctx)
}

// checkViaGitHub is the release-notes and fallback discovery path.
func (s *Service) checkViaGitHub(ctx context.Context) (*ReleaseInfo, error) {
	releases, _, _, err := s.ghClient.ListReleases(ctx, s.config.RepoOwner, s.config.RepoName, "")
	if err != nil {
		s.setState(func(st *State) {
			st.Status = StatusFailed
			st.Error = fmt.Sprintf("failed to fetch releases: %v", err)
		})
		return nil, err
	}

	var latest *github.Release
	for _, r := range releases {
		if r.Draft {
			continue
		}
		if r.Prerelease && !s.config.IncludePrerelease {
			continue
		}
		latest = &r
		break
	}

	if latest == nil {
		s.setState(func(st *State) {
			st.Status = StatusIdle
			st.Error = ""
			st.DeliverySource = ""
			st.DeliveryNodeID = ""
		})
		return nil, nil
	}

	targetOS, targetArch := CurrentPlatform()
	matchedAsset, err := SelectAsset(latest.Assets, targetOS, targetArch)
	if err != nil {
		s.setState(func(st *State) {
			st.Status = StatusIdle
			st.Error = fmt.Sprintf("no compatible asset in latest release: %v", err)
		})
		return nil, err
	}

	cleanVersion := strings.TrimPrefix(latest.TagName, "v")
	cmp := CompareSemVer(cleanVersion, s.config.CurrentVersion)
	if cmp <= 0 {
		// Remote version is older than or equal to current version
		s.setState(func(st *State) {
			st.Status = StatusIdle
			st.LatestVersion = cleanVersion
			st.Error = ""
			st.DeliverySource = ""
			st.DeliveryNodeID = ""
		})
		return nil, nil
	}

	// Found newer version! Check for checksum file
	checksumAsset := FindChecksumAsset(latest.Assets)
	var checksumURL string
	if checksumAsset != nil {
		checksumURL = checksumAsset.BrowserDownloadURL
	}

	var updaterInfo *AssetInfo
	if targetOS == "windows" {
		if uAsset := FindUpdaterAsset(latest.Assets); uAsset != nil {
			updaterInfo = &AssetInfo{
				ID:                 uAsset.ID,
				Name:               uAsset.Name,
				Size:               uAsset.Size,
				BrowserDownloadURL: uAsset.BrowserDownloadURL,
			}
		}
	}

	info := &ReleaseInfo{
		TagName:      latest.TagName,
		Version:      cleanVersion,
		Name:         latest.Name,
		Body:         latest.Body,
		Prerelease:   latest.Prerelease,
		PublishedAt:  latest.PublishedAt,
		ChecksumURL:  checksumURL,
		UpdaterAsset: updaterInfo,
		Asset: &AssetInfo{
			ID:                 matchedAsset.ID,
			Name:               matchedAsset.Name,
			Size:               matchedAsset.Size,
			BrowserDownloadURL: matchedAsset.BrowserDownloadURL,
		},
	}

	canInstall := s.installer != nil && s.installer.CanInstallDirectly()

	s.setState(func(st *State) {
		st.Status = StatusAvailable
		st.LatestVersion = cleanVersion
		st.ReleaseNotes = latest.Body
		st.TotalBytes = matchedAsset.Size
		st.DownloadedBytes = 0
		st.DownloadProgress = 0
		st.CanInstall = canInstall
		st.RequiresUserAction = !canInstall
		st.Error = ""
		// Discovery never invents a delivery plan: clear whatever source the
		// previous API check recorded, and let DownloadUpdate report the real one.
		st.DeliverySource = ""
		st.DeliveryNodeID = ""
	})

	return info, nil
}

// DownloadUpdate downloads the selected asset and verifies its SHA-256.
func (s *Service) DownloadUpdate(ctx context.Context, release *ReleaseInfo) (string, error) {
	if release == nil || release.Asset == nil {
		return "", fmt.Errorf("no release asset provided")
	}

	s.stateMu.Lock()
	if s.operationBusy || installOccupied(s.state.Status) {
		s.stateMu.Unlock()
		return "", fmt.Errorf("updater is busy")
	}
	timeout := s.config.DownloadTimeout
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	s.operationBusy = true
	s.activeCancel = cancel
	s.state.Status = StatusDownloading
	s.state.Error = ""
	s.state.StagedPath = ""
	s.state.TotalBytes = release.Asset.Size
	s.state.DownloadedBytes = 0
	s.state.DownloadProgress = 0
	s.state.DeliverySource = string(release.Asset.Delivery.Type)
	if release.Asset.Delivery.Type == DeliveryNone {
		s.state.DeliverySource = string(DeliveryGitHub)
	}
	s.state.DeliveryNodeID = release.Asset.Delivery.NodeID
	s.stateMu.Unlock()
	defer func() {
		cancel()
		s.stateMu.Lock()
		s.activeCancel = nil
		s.operationBusy = false
		s.stateMu.Unlock()
	}()

	update := func(fn func(*State)) {
		s.stateMu.Lock()
		defer s.stateMu.Unlock()
		if s.state.Status == StatusCancelled || installOccupied(s.state.Status) {
			return
		}
		if err := ctx.Err(); err != nil {
			s.state.Status = StatusFailed
			if errors.Is(err, context.Canceled) {
				s.state.Status = StatusCancelled
			}
			s.state.Error = err.Error()
			return
		}
		fn(&s.state)
	}

	if _, err := s.stageManager.PrepareStagingDir(release.Version); err != nil {
		update(func(st *State) {
			st.Status = StatusFailed
			st.Error = err.Error()
		})
		return "", err
	}

	stagedPath := s.stageManager.StagingPath(release.Version, release.Asset.Name)

	onProgress := func(downloaded, total int64) {
		update(func(st *State) {
			st.DownloadedBytes = downloaded
			if total > 0 {
				st.TotalBytes = total
				st.DownloadProgress = float64(downloaded) / float64(total)
			}
		})
	}

	// 1. Download Asset
	if err := s.downloadAsset(ctx, release.Asset, release.TagName, stagedPath, onProgress, true); err != nil {
		update(func(st *State) {
			st.Status = StatusFailed
			st.Error = fmt.Sprintf("download failed: %v", err)
		})
		return "", err
	}

	// 1.1 Download Updater if present on Windows
	var updaterStagedPath string
	if release.UpdaterAsset != nil && release.UpdaterAsset.BrowserDownloadURL != "" {
		updaterStagedPath = s.stageManager.StagingPath(release.Version, release.UpdaterAsset.Name)
		if err := s.downloadAsset(ctx, release.UpdaterAsset, release.TagName, updaterStagedPath, nil, false); err != nil {
			update(func(st *State) {
				st.Status = StatusFailed
				st.Error = fmt.Sprintf("failed to download updater helper: %v", err)
			})
			return "", fmt.Errorf("failed to download updater helper: %w", err)
		}
	}

	// 2. Verification - Checksum MUST be verified
	update(func(st *State) {
		st.Status = StatusVerifying
	})

	expectedSHA := release.Asset.ExpectedSHA256
	expectedUpdaterSHA := ""
	if release.UpdaterAsset != nil {
		expectedUpdaterSHA = release.UpdaterAsset.ExpectedSHA256
	}

	if expectedSHA == "" || (release.UpdaterAsset != nil && expectedUpdaterSHA == "") {
		if release.ChecksumURL == "" {
			err := fmt.Errorf("%w: release does not provide SHA256SUMS.txt or asset hash", ErrMissingHash)
			update(func(st *State) {
				st.Status = StatusFailed
				st.Error = err.Error()
			})
			return "", err
		}
		// Download checksums file
		checksumPath := s.stageManager.StagingPath(release.Version, "SHA256SUMS.txt")
		if err := s.stageManager.DownloadArchive(ctx, s.ghClient, release.ChecksumURL, checksumPath, 0, nil); err != nil {
			err := fmt.Errorf("failed to download checksum file: %w", err)
			update(func(st *State) {
				st.Status = StatusFailed
				st.Error = err.Error()
			})
			return "", err
		}
		data, err := os.ReadFile(checksumPath)
		if err != nil {
			err := fmt.Errorf("failed to read checksum file: %w", err)
			update(func(st *State) {
				st.Status = StatusFailed
				st.Error = err.Error()
			})
			return "", err
		}
		checksumMap := ParseChecksums(string(data))
		if expectedSHA == "" {
			hash, ok := checksumMap[release.Asset.Name]
			if !ok || hash == "" {
				err := fmt.Errorf("%w: %s not listed in SHA256SUMS.txt", ErrChecksumNotFound, release.Asset.Name)
				update(func(st *State) {
					st.Status = StatusFailed
					st.Error = err.Error()
				})
				return "", err
			}
			expectedSHA = hash
		}
		if release.UpdaterAsset != nil && expectedUpdaterSHA == "" {
			uHash, ok := checksumMap[release.UpdaterAsset.Name]
			if !ok || uHash == "" {
				err := fmt.Errorf("%w: %s not listed in SHA256SUMS.txt", ErrChecksumNotFound, release.UpdaterAsset.Name)
				update(func(st *State) {
					st.Status = StatusFailed
					st.Error = err.Error()
				})
				return "", err
			}
			expectedUpdaterSHA = uHash
		}
	}

	if err := VerifyFileSHA256(stagedPath, expectedSHA); err != nil {
		update(func(st *State) {
			st.Status = StatusFailed
			st.Error = fmt.Sprintf("verification failed: %v", err)
		})
		return "", err
	}

	if updaterStagedPath != "" && expectedUpdaterSHA != "" {
		if err := VerifyFileSHA256(updaterStagedPath, expectedUpdaterSHA); err != nil {
			update(func(st *State) {
				st.Status = StatusFailed
				st.Error = fmt.Sprintf("updater helper verification failed: %v", err)
			})
			return "", err
		}
	}

	canInstall := s.installer != nil && s.installer.CanInstallDirectly()

	update(func(st *State) {
		st.Status = StatusReady
		st.StagedPath = stagedPath
		st.CanInstall = canInstall
		st.RequiresUserAction = !canInstall
	})

	if err := ctx.Err(); err != nil {
		return "", err
	}
	return stagedPath, nil
}

// Cancel cancels the current download without releasing its operation slot early.
func (s *Service) Cancel() {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if installOccupied(s.state.Status) || s.activeCancel == nil ||
		(s.state.Status != StatusDownloading && s.state.Status != StatusVerifying) {
		return
	}
	s.activeCancel()
	s.state.Status = StatusCancelled
	s.state.Error = context.Canceled.Error()
}

func installOccupied(status UpdateStatus) bool {
	return status == StatusInstalling || status == StatusAwaitingUser
}

// ClaimInstall atomically reserves the ready artifact for one installation caller.
func (s *Service) ClaimInstall() (State, error) {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.operationBusy || s.state.Status != StatusReady || s.state.StagedPath == "" {
		return s.state, fmt.Errorf("update is not ready for installation")
	}
	direct := s.installer != nil && s.installer.CanInstallDirectly()
	s.state.CanInstall = direct
	s.state.RequiresUserAction = !direct
	s.state.Error = ""
	if direct {
		s.state.Status = StatusInstalling
	} else {
		s.state.Status = StatusAwaitingUser
	}
	return s.state, nil
}

// ApplyInstallResult reconciles the system installer result with its active claim.
// Non-terminal or unknown results must not release a running installation.
func (s *Service) ApplyInstallResult(result string) {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.state.Status != StatusAwaitingUser {
		return
	}
	switch {
	case result == "completed":
		s.state.Status = StatusCompleted
		s.state.Error = ""
	case result == "cancelled":
		s.state.Status = StatusReady
		s.state.Error = "已取消系统安装，可重试"
	case result == "returned":
		s.state.Status = StatusReady
		s.state.Error = "系统安装未完成，可重试"
	case result == "failed" || strings.HasPrefix(result, "intent_failed:"):
		s.state.Status = StatusReady
		s.state.Error = "系统安装失败，可重试：" + result
	}
}

// RestoreInstallReady permits retry after a failed installation handoff.
func (s *Service) RestoreInstallReady(err error) {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if !installOccupied(s.state.Status) {
		return
	}
	s.state.Status = StatusReady
	s.state.Error = ""
	if err != nil {
		s.state.Error = err.Error()
	}
}
