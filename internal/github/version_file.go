package github

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// VersionFileName is the repository-root file that carries the release version.
// It is read from raw.githubusercontent.com, which is not part of the REST rate
// limit, so the server can notice a new release without spending any quota.
const VersionFileName = "VERSION"

// maxVersionFileBytes bounds a file that is expected to hold one short line.
const maxVersionFileBytes = 64

// ErrInvalidVersionFile reports a VERSION file that exists but cannot be read as
// a version. Callers must keep their previous observation instead of treating
// it as "no version".
var ErrInvalidVersionFile = errors.New("invalid " + VersionFileName + " file")

// rawFileBranches are tried in order when a repository-root file is read. HEAD
// always resolves to the default branch, so main/master are only a fallback for
// mirrors that do not support it.
var rawFileBranches = []string{"HEAD", "main", "master"}

// rawFileURL builds the raw.githubusercontent.com address of one repository-root
// file. It is derived from the configured API base so tests and self-hosted
// mirrors that override BaseURL can serve the file from the same origin.
func (c *Client) rawFileURL(owner, repo, ref, file string) string {
	base := c.baseURL
	if base == "" || base == "https://api.github.com" {
		base = "https://raw.githubusercontent.com"
	}
	return fmt.Sprintf("%s/%s/%s/%s/%s", strings.TrimRight(base, "/"),
		url.PathEscape(owner), url.PathEscape(repo), url.PathEscape(ref), url.PathEscape(file))
}

// FetchRepoVersion reads the repository-root VERSION file and returns the
// version without a leading "v".
//
// It is a *probe*, not an authority: a version newer than the served snapshot
// only means "a release probably exists now". Assets, checksums and release
// notes keep coming from the release snapshot, which stays the single source of
// truth for what clients install.
func (c *Client) FetchRepoVersion(ctx context.Context, owner, repo string) (string, error) {
	var notFound bool
	for _, ref := range rawFileBranches {
		version, err := c.fetchVersionFileAt(ctx, owner, repo, ref)
		if err == nil {
			return version, nil
		}
		if errors.Is(err, ErrNotFound) {
			notFound = true
			continue
		}
		return "", err
	}
	if notFound {
		return "", fmt.Errorf("%w: %s not found in %s/%s (tried %s)", ErrNotFound, VersionFileName, owner, repo, strings.Join(rawFileBranches, ", "))
	}
	return "", fmt.Errorf("%w: %s not found in %s/%s", ErrNotFound, VersionFileName, owner, repo)
}

// FetchRepoVersionAt reads the repository-root VERSION file at one exact ref.
//
// Unlike FetchRepoVersion it does not fall back to other branches, because the
// question it answers is about that ref alone: "does this tag exist yet?". A
// fallback would answer a different question. ErrNotFound therefore means the ref
// is not there, not that the file is missing somewhere.
func (c *Client) FetchRepoVersionAt(ctx context.Context, owner, repo, ref string) (string, error) {
	return c.fetchVersionFileAt(ctx, owner, repo, ref)
}

func (c *Client) fetchVersionFileAt(ctx context.Context, owner, repo, ref string) (string, error) {
	endpoint := c.rawFileURL(owner, repo, ref, VersionFileName)
	res, err := c.executeRequest(ctx, endpoint, map[string]string{
		"Accept":     "text/plain",
		"User-Agent": c.userAgent,
	})
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return "", ErrNotFound
	}
	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
		return "", parseRateLimitError(res)
	}
	if res.StatusCode != http.StatusOK {
		return "", &APIError{StatusCode: res.StatusCode, Message: VersionFileName + " lookup failed"}
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxVersionFileBytes+1))
	if err != nil {
		return "", fmt.Errorf("read %s failed: %w", VersionFileName, err)
	}
	if len(body) > maxVersionFileBytes {
		return "", fmt.Errorf("%w: file exceeds %d bytes", ErrInvalidVersionFile, maxVersionFileBytes)
	}
	return parseVersionFile(string(body))
}

// versionFilePattern is deliberately stricter than a lenient semver parser: the
// file holds one version and nothing else, so "1.2" or "0.9.13 stable" mean the
// file is broken and the probe must say so instead of guessing.
var versionFilePattern = regexp.MustCompile(`^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$`)

// parseVersionFile accepts exactly one X.Y.Z line, optionally prefixed with "v".
func parseVersionFile(body string) (string, error) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return "", fmt.Errorf("%w: file is empty", ErrInvalidVersionFile)
	}
	if strings.ContainsAny(trimmed, "\r\n") {
		return "", fmt.Errorf("%w: expected a single line", ErrInvalidVersionFile)
	}
	trimmed = strings.TrimPrefix(trimmed, "v")
	if !versionFilePattern.MatchString(trimmed) {
		return "", fmt.Errorf("%w: %q is not a semantic version", ErrInvalidVersionFile, trimmed)
	}
	return trimmed, nil
}
