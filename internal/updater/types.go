package updater

import (
	"context"
	"time"

	"github.com/reze/submodhub/internal/version"
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

// DeliveryType names the source the API announced for one update asset.
type DeliveryType string

const (
	// DeliveryNone means the API did not announce a direct source.
	DeliveryNone DeliveryType = ""
	// DeliveryCloudreve is a verified Cloudreve node mirror link.
	DeliveryCloudreve DeliveryType = "cloudreve"
	// DeliveryGitHub is the GitHub release asset.
	DeliveryGitHub DeliveryType = "github"
)

// DeliverySource is the API's delivery plan for one asset. It is advisory only
// about location: the expected SHA-256 always comes from the published checksum
// listing, so a wrong or replayed link cannot change what gets installed.
type DeliverySource struct {
	Type           DeliveryType `json:"type,omitempty"`
	URL            string       `json:"url,omitempty"`
	NodeID         string       `json:"node_id,omitempty"`
	ExpiresAt      time.Time    `json:"expires_at,omitempty"`
	AllowedOrigins []string     `json:"allowed_origins,omitempty"`
	ExpectedSHA256 string       `json:"expected_sha256,omitempty"`
}

// AssetInfo describes a target binary/package asset to download.
type AssetInfo struct {
	ID                 int64          `json:"id"`
	Name               string         `json:"name"`
	Size               int64          `json:"size"`
	BrowserDownloadURL string         `json:"browser_download_url"`
	ExpectedSHA256     string         `json:"expected_sha256,omitempty"`
	Delivery           DeliverySource `json:"delivery,omitempty"`
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
	DeliverySource            string       `json:"delivery_source,omitempty"`
	DeliveryNodeID            string       `json:"delivery_node_id,omitempty"`
}

// Config controls repository coordinates, proxy settings, and channels.
type Config struct {
	RepoOwner         string
	RepoName          string
	CurrentVersion    string
	IncludePrerelease bool
	ProxyTemplate     string
	// APIBaseURL is the SubmodHub API origin that owns update-check answers and
	// app-asset delivery. Empty keeps the GitHub-only path.
	APIBaseURL string
	// DownloadTimeout bounds the entire download and verification; defaults to 30 minutes.
	DownloadTimeout time.Duration
	CacheDir        string
}

// DefaultOfficialRepoOwner and Name define the authoritative repository.
const (
	DefaultRepoOwner = version.RepoOwner
	DefaultRepoName  = version.RepoName
)

// PlatformInstaller defines the contract for applying downloaded updates on each OS.
type PlatformInstaller interface {
	Install(ctx context.Context, targetFilePath string, currentAppPath string) error
	CanInstallDirectly() bool
}
