package main

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/reze/submodhub/internal/updater"
	"github.com/reze/submodhub/internal/version"
)

// Keep this cache-relative directory aligned with Android file_paths.xml.
const appUpdateCacheDirectory = "submodhub_updates"

// AppUpdateBindings exposes auto-update workflows to the frontend.
type AppUpdateBindings struct {
	mu            sync.Mutex
	service       *updater.Service
	bridge        PlatformUpdateBridge
	latestRelease *updater.ReleaseInfo
}

func newAppUpdateBindings(bridge PlatformUpdateBridge, cacheDir string, proxyTemplate string) (*AppUpdateBindings, error) {
	if bridge == nil {
		bridge = newPlatformUpdateBridge()
	}
	cfg := updater.Config{
		RepoOwner:      updater.DefaultRepoOwner,
		RepoName:       updater.DefaultRepoName,
		CurrentVersion: version.Version,
		CacheDir:       cacheDir,
		ProxyTemplate:  proxyTemplate,
	}
	svc, err := updater.NewService(cfg, bridge)
	if err != nil {
		return nil, err
	}
	return &AppUpdateBindings{
		service: svc,
		bridge:  bridge,
	}, nil
}

// stateWithPermissions enriches every response with the current platform grant.
func (b *AppUpdateBindings) stateWithPermissions() updater.State {
	state := b.service.GetState()
	if !b.bridge.CanInstallDirectly() {
		allowed, err := b.bridge.CanRequestPackageInstalls()
		state.RequiresInstallPermission = err == nil && !allowed
	}
	return state
}

// CheckForAppUpdate triggers a check against GitHub releases.
func (s *DesktopService) CheckForAppUpdate() (updater.State, error) {
	if s.appUpdater == nil {
		return updater.State{Status: updater.StatusFailed, Error: "updater_not_initialized"}, fmt.Errorf("updater not initialized")
	}
	release, err := s.appUpdater.service.CheckForUpdate(context.Background())
	s.appUpdater.mu.Lock()
	if err == nil {
		s.appUpdater.latestRelease = release
	}
	s.appUpdater.mu.Unlock()
	return s.GetAppUpdateStatus(), err
}

// DownloadAppUpdate starts downloading the asset discovered in CheckForAppUpdate.
func (s *DesktopService) DownloadAppUpdate() (updater.State, error) {
	if s.appUpdater == nil {
		return updater.State{Status: updater.StatusFailed, Error: "no_update_available"}, fmt.Errorf("no update available")
	}
	s.appUpdater.mu.Lock()
	release := s.appUpdater.latestRelease
	s.appUpdater.mu.Unlock()
	if release == nil {
		return s.appUpdater.stateWithPermissions(), fmt.Errorf("no update available")
	}

	started := make(chan struct{})
	go func() {
		close(started)
		_, _ = s.appUpdater.service.DownloadUpdate(context.Background(), release)
	}()
	<-started
	// Wait a tiny moment to ensure initial download state is reflected
	for i := 0; i < 10; i++ {
		st := s.appUpdater.service.GetState()
		if st.Status == updater.StatusDownloading || st.Status == updater.StatusVerifying || st.Status == updater.StatusReady || st.Status == updater.StatusFailed {
			return s.GetAppUpdateStatus(), nil
		}
		time.Sleep(10 * time.Millisecond)
	}

	return s.appUpdater.stateWithPermissions(), nil
}

// CancelAppUpdate cancels in-flight download.
func (s *DesktopService) CancelAppUpdate() updater.State {
	if s.appUpdater != nil {
		s.appUpdater.service.Cancel()
		return s.appUpdater.stateWithPermissions()
	}
	return updater.State{Status: updater.StatusIdle}
}

// GetAppUpdateStatus returns the current status and progress.
func (s *DesktopService) GetAppUpdateStatus() updater.State {
	if s.appUpdater != nil {
		b := s.appUpdater
		// Serialize result reads with launching a new installer. A terminal result
		// from the previous attempt must never release the next attempt's claim.
		b.mu.Lock()
		defer b.mu.Unlock()
		state := b.service.GetState()
		if !b.bridge.CanInstallDirectly() {
			if state.Status == updater.StatusAwaitingUser {
				result, err := b.bridge.GetLastInstallResult()
				if err == nil {
					b.service.ApplyInstallResult(result)
				}
			}
		}
		return b.stateWithPermissions()
	}
	return updater.State{
		Status:         updater.StatusIdle,
		CurrentVersion: version.Version,
	}
}

// InstallAppUpdate executes the platform update (independent updater on Windows, PackageInstaller on Android).
func (s *DesktopService) InstallAppUpdate() (updater.State, error) {
	if s.appUpdater == nil {
		return updater.State{Status: updater.StatusFailed, Error: "updater_not_initialized"}, fmt.Errorf("updater not initialized")
	}
	s.appUpdater.mu.Lock()
	defer s.appUpdater.mu.Unlock()

	direct := s.appUpdater.bridge.CanInstallDirectly()
	handedOff := false
	if direct {
		if err := s.mutations.claimUpdate(); err != nil {
			return s.appUpdater.stateWithPermissions(), err
		}
		defer func() {
			if !handedOff {
				s.mutations.releaseUpdate()
			}
		}()
	}

	state, err := s.appUpdater.service.ClaimInstall()
	if err != nil {
		return state, err
	}

	currentExe, _ := os.Executable()
	err = s.appUpdater.bridge.Install(context.Background(), state.StagedPath, currentExe)
	if err != nil {
		s.appUpdater.service.RestoreInstallReady(err)
		return s.appUpdater.stateWithPermissions(), err
	}

	// For Windows, exit main application immediately so the independent updater can replace files without timeout
	if direct {
		handedOff = true
		go func() {
			time.Sleep(500 * time.Millisecond)
			os.Exit(0)
		}()
	}

	return s.appUpdater.stateWithPermissions(), nil
}

// ConfirmAppUpdateStartup is invoked by the rendered frontend after its initial
// instance configuration has loaded. A pending update must reach this normal
// startup path before its updater can discard the previous executable.
func (s *DesktopService) ConfirmAppUpdateStartup() error {
	if s.stagingMgr == nil || s.appUpdater == nil {
		return fmt.Errorf("startup services are not ready")
	}
	if _, err := s.ListMASInstances(); err != nil {
		return fmt.Errorf("startup configuration is not ready: %w", err)
	}
	return updater.ConfirmStartup()
}

// OpenAppUpdateSettings opens settings screen for unknown apps install on Android.
func (s *DesktopService) OpenAppUpdateSettings() (bool, error) {
	if s.appUpdater != nil && s.appUpdater.bridge != nil {
		return s.appUpdater.bridge.OpenAppUpdateSettings()
	}
	return false, nil
}
