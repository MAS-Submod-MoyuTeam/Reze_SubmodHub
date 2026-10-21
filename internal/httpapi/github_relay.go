package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
)

var (
	relayMaxDownloadDuration = 10 * time.Minute
	relayReadIdleTimeout     = 30 * time.Second
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
				github.WithToken(injected.Token()),
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

	if v.State != "published" || v.SizeBytes <= 0 || v.SizeBytes > maxArchiveSize {
		writeError(w, 404, "not_found", "version is no longer available")
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

	// Re-verify version is still published before calling upstream
	s.mu.RLock()
	currentV, currentOk := s.Catalog.Versions[v.ID]
	s.mu.RUnlock()
	if !currentOk || currentV.State != "published" {
		writeError(w, 404, "not_found", "version is no longer available")
		return
	}

	downloadCtx, cancelDownload := context.WithTimeout(r.Context(), relayMaxDownloadDuration)
	defer cancelDownload()

	res, err := client.OpenArchiveStream(downloadCtx, v.GitHubSource.DownloadURL)
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
	defer res.Body.Close()

	// Pre-response validation: Check upstream Content-Length if known
	if res.ContentLength >= 0 && res.ContentLength != v.SizeBytes {
		writeError(w, 502, "upstream_archive_changed", fmt.Sprintf("upstream archive size mismatch: expected %d, got %d", v.SizeBytes, res.ContentLength))
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Length", fmt.Sprint(v.SizeBytes))
	w.Header().Set("X-Archive-SHA256", v.SHA256)
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, canFlush := w.(http.Flusher)

	hasher := sha256.New()
	buf := make([]byte, 32*1024)
	var totalTransferred int64
	maxAllowed := v.SizeBytes + 1

	idleTimer := time.AfterFunc(relayReadIdleTimeout, cancelDownload)
	defer idleTimer.Stop()

	for {
		toRead := int64(len(buf))
		if remaining := maxAllowed - totalTransferred; remaining < toRead {
			toRead = remaining
			if toRead <= 0 {
				return
			}
		}

		n, rErr := res.Body.Read(buf[:toRead])
		if n > 0 {
			idleTimer.Reset(relayReadIdleTimeout)
			totalTransferred += int64(n)
			if totalTransferred > v.SizeBytes {
				return
			}

			hasher.Write(buf[:n])
			written, wErr := w.Write(buf[:n])
			if wErr != nil || written != n {
				return
			}
			if canFlush {
				flusher.Flush()
			}
		}

		if rErr != nil {
			if errors.Is(rErr, io.EOF) {
				break
			}
			return
		}
	}

	if totalTransferred == v.SizeBytes {
		actualSHA := hex.EncodeToString(hasher.Sum(nil))
		if strings.EqualFold(actualSHA, v.SHA256) {
			s.recordDownload(v.ModID)
		}
	}
}
