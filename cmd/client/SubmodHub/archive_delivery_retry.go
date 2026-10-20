package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Stage permits one fresh descriptor after expiry or transient transport failure.
// Hash and size failures are terminal and never retried into installation.
func (m *ArchiveStagingManager) Stage(ctx context.Context, req StageArchiveRequest) (StagedArchiveInfo, error) {
	if req.Category == "spritepack" {
		return m.stageAttempt(ctx, req)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	var last error
	for attempt := 0; attempt < 2; attempt++ {
		req.forceBuiltin = attempt > 0
		result, err := m.stageAttempt(ctx, req)
		if err == nil {
			return result, nil
		}
		last = err
		if ctx.Err() != nil {
			return StagedArchiveInfo{}, ctx.Err()
		}
		switch err.Error() {
		case "download_expired", "download_transport_failed", "http_401", "http_403", "http_404", "http_502", "http_503", "http_504":
		default:
			return StagedArchiveInfo{}, err
		}
	}
	return StagedArchiveInfo{}, last
}
func reportArchiveCompletion(ctx context.Context, client *http.Client, base, versionID string, desc ArchiveDescriptor) {
	reportCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]any{"completion_token": desc.CompletionToken, "sha256": desc.SHA256, "size_bytes": desc.SizeBytes})
	req, err := http.NewRequestWithContext(reportCtx, "POST", strings.TrimRight(base, "/")+"/versions/"+url.PathEscape(versionID)+"/download-complete", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if res, err := client.Do(req); err == nil {
		res.Body.Close()
	}
}
