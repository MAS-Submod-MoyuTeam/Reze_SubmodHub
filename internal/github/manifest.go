package github

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// ManifestFileName is the repository-root file an author maintains to let the
// hub discover new versions without spending any GitHub API quota: it is read
// from raw.githubusercontent.com, which is not part of the REST rate limit.
const ManifestFileName = "rezehub.yml"

// ManifestSchemaVersion is the only schema this build understands.
const ManifestSchemaVersion = 1

const (
	maxManifestBytes    = 1 << 20 // 1 MiB
	maxManifestReleases = 200
)

// ErrInvalidManifest reports a manifest that exists but cannot be trusted. The
// caller must surface it to the author instead of silently importing nothing.
var ErrInvalidManifest = errors.New("invalid " + ManifestFileName + " manifest")

var manifestSHA256Regex = regexp.MustCompile(`^[a-f0-9]{64}$`)

// manifestBranches are tried in order. HEAD always resolves to the default
// branch, so main/master are only a fallback for mirrors that do not support it.
var manifestBranches = []string{"HEAD", "main", "master"}

// ManifestRelease is one publishable version pointed at by the manifest. The
// download URL is copied verbatim from the GitHub release asset, so importing
// it never needs the releases API.
type ManifestRelease struct {
	Version string `yaml:"version" json:"version"`
	URL     string `yaml:"url" json:"url"`
	SHA256  string `yaml:"sha256,omitempty" json:"sha256,omitempty"`
	Notes   string `yaml:"notes,omitempty" json:"notes,omitempty"`
}

// Manifest is the parsed content of ManifestFileName.
type Manifest struct {
	Schema   int               `yaml:"schema,omitempty" json:"schema"`
	Releases []ManifestRelease `yaml:"releases" json:"releases"`
}

// ParseManifest validates a manifest document. Unknown keys are rejected so a
// typo cannot silently produce an empty release list.
func ParseManifest(body []byte) (*Manifest, error) {
	return parseManifest(body, false)
}

// parseManifest is ParseManifest with the transport policy of the calling
// client: only test and self-hosted mirrors may declare plain-http archives.
func parseManifest(body []byte, allowInsecureHosts bool) (*Manifest, error) {
	dec := yaml.NewDecoder(bytes.NewReader(body))
	dec.KnownFields(true)
	var m Manifest
	if err := dec.Decode(&m); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, fmt.Errorf("%w: file is empty", ErrInvalidManifest)
		}
		return nil, fmt.Errorf("%w: %v", ErrInvalidManifest, err)
	}
	if m.Schema == 0 {
		m.Schema = ManifestSchemaVersion
	}
	if m.Schema != ManifestSchemaVersion {
		return nil, fmt.Errorf("%w: unsupported schema %d (this server understands %d)", ErrInvalidManifest, m.Schema, ManifestSchemaVersion)
	}
	if len(m.Releases) > maxManifestReleases {
		return nil, fmt.Errorf("%w: %d releases exceeds the %d limit", ErrInvalidManifest, len(m.Releases), maxManifestReleases)
	}

	seen := make(map[string]bool, len(m.Releases))
	for i := range m.Releases {
		rel := &m.Releases[i]
		rel.Version = strings.TrimSpace(rel.Version)
		rel.URL = strings.TrimSpace(rel.URL)
		rel.SHA256 = strings.ToLower(strings.TrimSpace(rel.SHA256))
		rel.Notes = strings.TrimSpace(rel.Notes)
		if rel.Version == "" {
			return nil, fmt.Errorf("%w: releases[%d].version is required", ErrInvalidManifest, i)
		}
		if seen[rel.Version] {
			return nil, fmt.Errorf("%w: duplicate version %q", ErrInvalidManifest, rel.Version)
		}
		seen[rel.Version] = true
		if rel.URL == "" {
			return nil, fmt.Errorf("%w: releases[%d] (%s) is missing url", ErrInvalidManifest, i, rel.Version)
		}
		parsed, err := url.Parse(rel.URL)
		if err != nil || parsed.Host == "" {
			return nil, fmt.Errorf("%w: releases[%d] (%s) url must be an absolute https URL", ErrInvalidManifest, i, rel.Version)
		}
		if parsed.Scheme != "https" && !(allowInsecureHosts && parsed.Scheme == "http") {
			return nil, fmt.Errorf("%w: releases[%d] (%s) url must be an absolute https URL", ErrInvalidManifest, i, rel.Version)
		}
		if !strings.HasSuffix(strings.ToLower(parsed.Path), ".zip") {
			return nil, fmt.Errorf("%w: releases[%d] (%s) url must point at a .zip asset", ErrInvalidManifest, i, rel.Version)
		}
		if rel.SHA256 != "" && !manifestSHA256Regex.MatchString(rel.SHA256) {
			return nil, fmt.Errorf("%w: releases[%d] (%s) sha256 must be 64 hex characters", ErrInvalidManifest, i, rel.Version)
		}
	}
	return &m, nil
}

// ManifestSourceURL builds the raw.githubusercontent.com address for a repo
// manifest. It is derived from the configured API base so tests and self-hosted
// mirrors that override BaseURL can serve the manifest from the same origin.
func (c *Client) manifestURL(owner, repo, ref string) string {
	base := c.baseURL
	if base == "" || base == "https://api.github.com" {
		base = "https://raw.githubusercontent.com"
	}
	return fmt.Sprintf("%s/%s/%s/%s/%s", strings.TrimRight(base, "/"),
		url.PathEscape(owner), url.PathEscape(repo), url.PathEscape(ref), ManifestFileName)
}

// FetchManifest downloads and validates rezehub.yml for a repository. The
// returned digest identifies the exact document, so an unchanged manifest costs
// one bodyless GET and no archive work.
func (c *Client) FetchManifest(ctx context.Context, owner, repo string) (*Manifest, string, error) {
	var notFound bool
	for _, ref := range manifestBranches {
		m, digest, err := c.fetchManifestAt(ctx, owner, repo, ref)
		if err == nil {
			return m, digest, nil
		}
		if errors.Is(err, ErrNotFound) {
			notFound = true
			continue
		}
		return nil, "", err
	}
	if notFound {
		return nil, "", fmt.Errorf("%w: %s not found in %s/%s (tried %s)", ErrNotFound, ManifestFileName, owner, repo, strings.Join(manifestBranches, ", "))
	}
	return nil, "", fmt.Errorf("%w: %s not found in %s/%s", ErrNotFound, ManifestFileName, owner, repo)
}

func (c *Client) fetchManifestAt(ctx context.Context, owner, repo, ref string) (*Manifest, string, error) {
	endpoint := c.manifestURL(owner, repo, ref)
	res, err := c.executeRequest(ctx, endpoint, map[string]string{
		"Accept":     "text/plain",
		"User-Agent": c.userAgent,
	})
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, "", ErrNotFound
	}
	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
		return nil, "", parseRateLimitError(res)
	}
	if res.StatusCode != http.StatusOK {
		return nil, "", &APIError{StatusCode: res.StatusCode, Message: ManifestFileName + " lookup failed"}
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxManifestBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read %s failed: %w", ManifestFileName, err)
	}
	if len(body) > maxManifestBytes {
		return nil, "", fmt.Errorf("%w: file exceeds 1 MiB", ErrInvalidManifest)
	}
	sum := sha256.Sum256(body)
	parsed, err := parseManifest(body, c.allowInsecureTestHosts)
	if err != nil {
		return nil, "", err
	}
	return parsed, hex.EncodeToString(sum[:]), nil
}
