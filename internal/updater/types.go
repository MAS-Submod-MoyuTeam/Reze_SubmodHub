package updater

import (
	"context"
	"time"
)

// UpdateStatus represents the state of the auto-update process.
type UpdateStatus string

const (
	StatusIdle         UpdateStatus = "idle"
	StatusChecking     UpdateStatus = "checking"
	StatusAvailable    UpdateStatus = "available"
	StatusDownloading  UpdateStatus = "downloading"
	StatusVerifying    UpdateStatus = "verifying"
	StatusReady        UpdateStatus = "ready"
	StatusInstalling   UpdateStatus = "installing"
	StatusAwaitingUser UpdateStatus = "awaiting_user"
	StatusCompleted    UpdateStatus = "completed"
	StatusFailed       UpdateStatus = "failed"
	StatusRolledBack   UpdateStatus = "rolled_back"
	StatusCancelled    UpdateStatus = "cancelled"
)

// ReleaseInfo holds the discovered remote release metadata.
type ReleaseInfo struct {
	TagName      string     `json:"tag_name"`
	Version      string     `json:"version"`
	Name         string     `json:"name"`
	Body         string     `json:"body"`
	Prerelease   bool       `json:"prerelease"`
	PublishedAt  *time.Time `json:"published_at,omitempty"`
	Asset        *AssetInfo `json:"asset,omitempty"`
	UpdaterAsset *AssetInfo `json:"updater_asset,omitempty"`
	ChecksumURL  string     `json:"checksum_url,omitempty"`
}

// AssetInfo describes a target binary/package asset to download.
type AssetInfo struct {
	ID                 int64  `json:"id"`
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
	ExpectedSHA256     string `json:"expected_sha256,omitempty"`
}

// State reports the current auto-update state and progress for clients.
type State struct {
	Status                    UpdateStatus `json:"status"`
	CurrentVersion            string       `json:"current_version"`
	LatestVersion             string       `json:"latest_version,omitempty"`
	ReleaseNotes              string       `json:"release_notes,omitempty"`
	DownloadProgress          float64      `json:"download_progress"` // 0.0 to 1.0
	DownloadedBytes           int64        `json:"downloaded_bytes"`
	TotalBytes                int64        `json:"total_bytes"`
	StagedPath                string       `json:"staged_path,omitempty"`
	Error                     string       `json:"error,omitempty"`
	CanInstall                bool         `json:"can_install"`
	RequiresUserAction        bool         `json:"requires_user_action"`
	RequiresInstallPermission bool         `json:"requires_install_permission"`
}

// Config controls repository coordinates, proxy settings, and channels.
type Config struct {
	RepoOwner         string
	RepoName          string
	CurrentVersion    string
	IncludePrerelease bool
	ProxyTemplate     string
	// DownloadTimeout bounds the entire download and verification; defaults to 30 minutes.
	DownloadTimeout time.Duration
	CacheDir        string
}

// DefaultOfficialRepoOwner and Name define the authoritative repository.
const (
	DefaultRepoOwner = "MAS-Submod-MoyuTeam"
	DefaultRepoName  = "Reze_SubmodHub"
)

// PlatformInstaller defines the contract for applying downloaded updates on each OS.
type PlatformInstaller interface {
	Install(ctx context.Context, targetFilePath string, currentAppPath string) error
	CanInstallDirectly() bool
}
