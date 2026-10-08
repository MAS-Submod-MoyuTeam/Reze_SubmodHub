package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
)

func (s *Store) getGitHubClientWithProxy(proxyTemplate string) *github.Client {
	s.mu.RLock()
	injected := s.GitHubClient
	s.mu.RUnlock()

	if injected != nil {
		if proxyTemplate != "" {
			return github.NewClient(
				github.WithBaseURL(injected.BaseURL()),
				github.WithProxyTemplate(proxyTemplate),
				github.WithAllowInsecureTestHosts(injected.AllowInsecureTestHosts()),
			)
		}
		return injected
	}

	return github.NewClient(
		github.WithProxyTemplate(proxyTemplate),
	)
}

func (s *Store) relayDownloadArchive(w http.ResponseWriter, r *http.Request, v Version) {
	if v.GitHubSource == nil || v.GitHubSource.DownloadURL == "" {
		writeError(w, 404, "not_found", "upstream download source not found")
		return
	}

	s.mu.RLock()
	proxyTemplate := s.Catalog.Settings.GitHubProxyTemplate
	s.mu.RUnlock()

	client := s.getGitHubClientWithProxy(proxyTemplate)

	// Acquire semaphore slot with timeout
	select {
	case s.downloadSem <- struct{}{}:
		defer func() { <-s.downloadSem }()
	case <-r.Context().Done():
		return
	case <-time.After(5 * time.Second):
		writeError(w, 503, "relay_busy", "download relay is currently busy, please retry later")
		return
	}

	tmpPath, shaHex, totalSize, err := client.DownloadToTemp(r.Context(), v.GitHubSource.DownloadURL, maxArchiveSize)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, context.DeadlineExceeded) {
			writeError(w, 504, "github_upstream_timeout", "github upstream download timed out")
			return
		}
		if github.IsRateLimited(err) {
			if rlErr, ok := github.AsRateLimitError(err); ok && rlErr.RetryAfter > 0 {
				w.Header().Set("Retry-After", fmt.Sprintf("%d", int(rlErr.RetryAfter.Seconds())))
			}
			writeError(w, 503, "github_upstream_rate_limited", "github upstream rate limit exceeded")
			return
		}
		if github.IsNotFound(err) {
			writeError(w, 502, "github_upstream_failed", "github release asset not found on upstream")
			return
		}
		writeError(w, 502, "github_upstream_failed", fmt.Sprintf("github upstream download failed: %v", err))
		return
	}
	defer os.Remove(tmpPath)

	// Verify consistency against published record
	if totalSize != v.SizeBytes || !strings.EqualFold(shaHex, v.SHA256) {
		writeError(w, 502, "upstream_archive_changed", "upstream archive hash or size mismatch")
		return
	}

	// Re-verify version is still published and exists before sending
	s.mu.RLock()
	currentV, currentOk := s.Catalog.Versions[v.ID]
	s.mu.RUnlock()
	if !currentOk || currentV.State != "published" {
		writeError(w, 404, "not_found", "version is no longer available")
		return
	}

	f, err := os.Open(tmpPath)
	if err != nil {
		writeError(w, 500, "storage_error", "failed to read temp archive")
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Length", fmt.Sprint(totalSize))
	w.Header().Set("X-Archive-SHA256", v.SHA256)
	_, _ = io.Copy(w, f)
}
