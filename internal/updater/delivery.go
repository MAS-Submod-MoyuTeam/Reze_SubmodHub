package updater

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/delivery"
	"github.com/reze/submodhub/internal/github"
)

// App-update delivery through the API. The API is the update-check authority: it
// names the current release, publishes the SHA-256 it trusts for each asset, and
// says where those bytes can be fetched (a verified Cloudreve mirror first, the
// GitHub release asset as the fallback). GitHub remains usable directly when the
// API is unreachable, but it never overrides a reachable API's answer.
var (
	errAPIDeliveryDisabled = errors.New("app_update_api_unavailable")
	errDeliveryUnavailable = errors.New("delivery_source_unavailable")
	errDeliveryExpired     = errors.New("delivery_link_expired")
	errReleaseChanged      = errors.New("app_update_release_changed")
)

const (
	appUpdateDescriptorPath = "/api/v1/app-update"
	appUpdateDescriptorCap  = 1 << 20
	// appUpdateMaxSnapshotAge is how old the API's GitHub snapshot may be before
	// it stops being an authority: past this, the API may simply be unable to see
	// a release, so the client asks GitHub itself (and keeps the API answer only
	// when GitHub cannot answer either).
	appUpdateMaxSnapshotAge = 30 * time.Minute
)

// apiDescriptor mirrors the API's public app-update contract.
type apiDescriptor struct {
	TagName     string     `json:"tag_name"`
	Version     string     `json:"version"`
	Name        string     `json:"name"`
	Notes       string     `json:"notes"`
	Prerelease  bool       `json:"prerelease"`
	PublishedAt *time.Time `json:"published_at"`
	ChecksumURL string     `json:"checksum_url"`
	Assets      []apiAsset `json:"assets"`
	// SnapshotAgeSeconds is the server's own measure of how stale its release
	// list is; zero means "not reported" (older servers) and is treated as fresh.
	SnapshotAgeSeconds int64 `json:"snapshot_age_seconds"`
}

type apiAsset struct {
	Name                   string     `json:"name"`
	SizeBytes              int64      `json:"size_bytes"`
	SHA256                 string     `json:"sha256"`
	DeliveryType           string     `json:"delivery_type"`
	NodeID                 string     `json:"node_id"`
	URL                    string     `json:"url"`
	ExpiresAt              *time.Time `json:"expires_at"`
	AllowedDownloadOrigins []string   `json:"allowed_download_origins"`
	GitHubURL              string     `json:"github_url"`
}

// APIBaseURL reports the API origin that owns update-check answers.
func (s *Service) APIBaseURL() string {
	if value, ok := s.apiBase.Load().(string); ok {
		return value
	}
	return ""
}

// SetAPIBaseURL repoints update checks at another API origin.
func (s *Service) SetAPIBaseURL(base string) {
	s.apiBase.Store(strings.TrimSpace(base))
}

func (s *Service) apiBaseURL() (*url.URL, error) {
	raw := s.APIBaseURL()
	if raw == "" {
		return nil, errAPIDeliveryDisabled
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, errAPIDeliveryDisabled
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errAPIDeliveryDisabled
	}
	return parsed, nil
}

func (s *Service) fetchAPIDescriptor(ctx context.Context) (*apiDescriptor, error) {
	base, err := s.apiBaseURL()
	if err != nil {
		return nil, err
	}
	endpoint := *base
	endpoint.Path = strings.TrimSuffix(base.Path, "/") + appUpdateDescriptorPath
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := s.apiClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("app update descriptor returned status %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, appUpdateDescriptorCap+1))
	if err != nil {
		return nil, err
	}
	if len(body) > appUpdateDescriptorCap {
		return nil, errors.New("app update descriptor too large")
	}
	var descriptor apiDescriptor
	if err := json.Unmarshal(body, &descriptor); err != nil {
		return nil, fmt.Errorf("decode app update descriptor: %w", err)
	}
	return &descriptor, nil
}

// assetInfo projects one descriptor asset into the download plan. The GitHub URL
// stays attached even when Cloudreve is selected so a failed direct download can
// fall back without another API round-trip.
func assetInfo(descriptor *apiDescriptor, name string) *AssetInfo {
	for _, a := range descriptor.Assets {
		if a.Name != name {
			continue
		}
		info := &AssetInfo{Name: a.Name, Size: a.SizeBytes, BrowserDownloadURL: a.GitHubURL, ExpectedSHA256: a.SHA256}
		switch DeliveryType(a.DeliveryType) {
		case DeliveryCloudreve:
			if a.URL != "" && a.SHA256 != "" {
				source := DeliverySource{Type: DeliveryCloudreve, URL: a.URL, NodeID: a.NodeID, AllowedOrigins: a.AllowedDownloadOrigins, ExpectedSHA256: a.SHA256}
				if a.ExpiresAt != nil {
					source.ExpiresAt = *a.ExpiresAt
				}
				info.Delivery = source
			}
		case DeliveryGitHub:
			info.Delivery = DeliverySource{Type: DeliveryGitHub, ExpectedSHA256: a.SHA256}
		}
		return info
	}
	return nil
}

func assetNameKey(assets []apiAsset) []github.Asset {
	out := make([]github.Asset, 0, len(assets))
	for _, a := range assets {
		out = append(out, github.Asset{Name: a.Name, Size: a.SizeBytes, BrowserDownloadURL: a.GitHubURL})
	}
	return out
}

// checkViaAPI asks the API which release is current and how it should be
// fetched. A response of (nil, false, nil) means the API answered and no update
// exists. stale reports that the API itself has not reached GitHub recently, so
// its silence about a newer release does not mean there is none.
func (s *Service) checkViaAPI(ctx context.Context) (*ReleaseInfo, bool, error) {
	descriptor, err := s.fetchAPIDescriptor(ctx)
	if err != nil {
		return nil, false, err
	}
	stale := descriptor.SnapshotAgeSeconds > int64(appUpdateMaxSnapshotAge.Seconds())
	cleanVersion := strings.TrimPrefix(strings.TrimSpace(descriptor.Version), "v")
	if cleanVersion == "" {
		cleanVersion = strings.TrimPrefix(descriptor.TagName, "v")
	}
	if cleanVersion == "" {
		return nil, stale, errors.New("app update descriptor has no version")
	}
	if CompareSemVer(cleanVersion, s.config.CurrentVersion) <= 0 {
		s.setState(func(st *State) {
			st.Status = StatusIdle
			st.LatestVersion = cleanVersion
			st.Error = ""
			st.DeliverySource = ""
			st.DeliveryNodeID = ""
		})
		return nil, stale, nil
	}

	targetOS, targetArch := CurrentPlatform()
	assets := assetNameKey(descriptor.Assets)
	matched, err := SelectAsset(assets, targetOS, targetArch)
	if err != nil {
		s.setState(func(st *State) {
			st.Status = StatusIdle
			st.Error = fmt.Sprintf("no compatible asset in latest release: %v", err)
		})
		return nil, stale, err
	}
	selected := assetInfo(descriptor, matched.Name)
	if selected == nil {
		return nil, stale, errors.New("app update descriptor is missing the selected asset")
	}

	info := &ReleaseInfo{
		TagName:     descriptor.TagName,
		Version:     cleanVersion,
		Name:        descriptor.Name,
		Body:        descriptor.Notes,
		Prerelease:  descriptor.Prerelease,
		PublishedAt: descriptor.PublishedAt,
		ChecksumURL: descriptor.ChecksumURL,
		Asset:       selected,
	}
	if targetOS == "windows" {
		if helper := FindUpdaterAsset(assets); helper != nil {
			info.UpdaterAsset = assetInfo(descriptor, helper.Name)
		}
	}

	canInstall := s.installer != nil && s.installer.CanInstallDirectly()
	s.setState(func(st *State) {
		st.Status = StatusAvailable
		st.LatestVersion = cleanVersion
		st.ReleaseNotes = descriptor.Notes
		st.TotalBytes = selected.Size
		st.DownloadedBytes = 0
		st.DownloadProgress = 0
		st.CanInstall = canInstall
		st.RequiresUserAction = !canInstall
		st.Error = ""
		st.DeliverySource = string(selected.Delivery.Type)
		st.DeliveryNodeID = selected.Delivery.NodeID
	})
	return info, stale, nil
}

// refreshDeliveryFromAPI re-reads the descriptor so a stale or revoked Cloudreve
// link can be replaced without re-running the whole update check. It refuses to
// adopt a newer release: the staged version and the user's choice were made for
// one tag, so a descriptor that moved on must not swap the expected hash.
func (s *Service) refreshDeliveryFromAPI(ctx context.Context, asset *AssetInfo, tag string) error {
	descriptor, err := s.fetchAPIDescriptor(ctx)
	if err != nil {
		return err
	}
	if tag != "" && descriptor.TagName != tag {
		return errReleaseChanged
	}
	refreshed := assetInfo(descriptor, asset.Name)
	if refreshed == nil {
		return errDeliveryUnavailable
	}
	asset.Delivery = refreshed.Delivery
	if refreshed.ExpectedSHA256 != "" {
		asset.ExpectedSHA256 = refreshed.ExpectedSHA256
	}
	if refreshed.BrowserDownloadURL != "" {
		asset.BrowserDownloadURL = refreshed.BrowserDownloadURL
	}
	if refreshed.Size > 0 {
		asset.Size = refreshed.Size
	}
	return nil
}

func (s *Service) recordDelivery(source DeliveryType, nodeID string) {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.state.Status == StatusCancelled || installOccupied(s.state.Status) {
		return
	}
	s.state.DeliverySource = string(source)
	s.state.DeliveryNodeID = nodeID
}

// downloadAsset fetches one asset from its announced delivery source, refreshing
// a stale link once, and then uses the GitHub release asset as the fallback.
// Only the primary asset reports its source: the Windows updater helper is an
// implementation detail of the same update. tag is the release the caller
// approved, so a refresh can never silently adopt another one.
func (s *Service) downloadAsset(ctx context.Context, asset *AssetInfo, tag, destPath string, onProgress func(int64, int64), primary bool) error {
	if asset == nil {
		return fmt.Errorf("no release asset provided")
	}
	if asset.Delivery.Type == DeliveryCloudreve {
		deliveryErr := s.downloadViaDelivery(ctx, asset, destPath, onProgress, primary)
		if deliveryErr == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if refreshErr := s.refreshDeliveryFromAPI(ctx, asset, tag); refreshErr == nil {
			if asset.Delivery.Type == DeliveryCloudreve {
				if retryErr := s.downloadViaDelivery(ctx, asset, destPath, onProgress, primary); retryErr == nil {
					return nil
				} else if ctx.Err() != nil {
					return ctx.Err()
				}
			}
		}
	}
	if asset.BrowserDownloadURL == "" {
		return fmt.Errorf("no download location for %s", asset.Name)
	}
	if primary {
		s.recordDelivery(DeliveryGitHub, "")
	}
	return s.stageManager.DownloadArchive(ctx, s.ghClient, asset.BrowserDownloadURL, destPath, asset.Size, onProgress)
}

// downloadViaDelivery streams an API-declared Cloudreve link through the shared
// origin policy: no cookies, no environment proxy, no private destinations.
func (s *Service) downloadViaDelivery(ctx context.Context, asset *AssetInfo, destPath string, onProgress func(int64, int64), primary bool) error {
	if asset.Delivery.Type != DeliveryCloudreve || asset.Delivery.URL == "" {
		return errDeliveryUnavailable
	}
	if !asset.Delivery.ExpiresAt.IsZero() && !time.Now().Before(asset.Delivery.ExpiresAt) {
		return errDeliveryExpired
	}
	base, err := s.apiBaseURL()
	if err != nil {
		return errDeliveryUnavailable
	}
	if _, err := delivery.ValidateOriginURL(base, asset.Delivery.URL, asset.Delivery.AllowedOrigins); err != nil {
		return err
	}
	client := delivery.NewOriginClient(base, asset.Delivery.AllowedOrigins, 4)
	if primary {
		s.recordDelivery(DeliveryCloudreve, asset.Delivery.NodeID)
	}
	return s.stageManager.DownloadFile(ctx, client, asset.Delivery.URL, destPath, asset.Size, onProgress)
}
