package updater

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
)

// ProgressWriter monitors bytes written and calls progress callback
type ProgressWriter struct {
	Total      int64
	Downloaded int64
	OnProgress func(downloaded int64, total int64)
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n := len(p)
	atomic.AddInt64(&pw.Downloaded, int64(n))
	if pw.OnProgress != nil {
		pw.OnProgress(atomic.LoadInt64(&pw.Downloaded), pw.Total)
	}
	return n, nil
}

// StageManager handles downloading and storing update assets in a clean temporary staging directory.
type StageManager struct {
	baseDir string
	mu      sync.Mutex
}

func NewStageManager(baseDir string) (*StageManager, error) {
	if baseDir == "" {
		baseDir = filepath.Join(os.TempDir(), "submodhub_updates")
	}
	if err := os.MkdirAll(baseDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create staging directory: %w", err)
	}
	return &StageManager{baseDir: baseDir}, nil
}

// StagingPath returns the absolute destination path for a given version and filename.
func (sm *StageManager) StagingPath(version, filename string) string {
	versionDir := filepath.Join(sm.baseDir, version)
	return filepath.Join(versionDir, SanitizeFilename(filename))
}

// PrepareStagingDir ensures an empty directory for the target version.
func (sm *StageManager) PrepareStagingDir(version string) (string, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	dir := filepath.Join(sm.baseDir, version)
	_ = os.RemoveAll(dir) // Clean previous incomplete attempts
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

type archiveStreamOpener interface {
	OpenArchiveStream(context.Context, string) (*http.Response, error)
}

// DownloadArchive uses the GitHub client's proxy and redirect policy.
func (sm *StageManager) DownloadArchive(ctx context.Context, client archiveStreamOpener, downloadURL, destPath string, expectedSize int64, onProgress func(int64, int64)) error {
	return sm.downloadStream(ctx, func() (*http.Response, error) {
		return client.OpenArchiveStream(ctx, downloadURL)
	}, destPath, expectedSize, onProgress)
}

// DownloadFile downloads an HTTP stream to destPath with progress reporting and cancellation support.
func (sm *StageManager) DownloadFile(ctx context.Context, client *http.Client, downloadURL string, destPath string, expectedSize int64, onProgress func(downloaded int64, total int64)) error {
	return sm.downloadStream(ctx, func() (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
		if err != nil {
			return nil, err
		}
		return client.Do(req)
	}, destPath, expectedSize, onProgress)
}

func (sm *StageManager) downloadStream(ctx context.Context, open func() (*http.Response, error), destPath string, expectedSize int64, onProgress func(int64, int64)) error {
	res, err := open()
	if err != nil {
		return fmt.Errorf("download request failed: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download server returned status: %d", res.StatusCode)
	}

	total := res.ContentLength
	if total <= 0 && expectedSize > 0 {
		total = expectedSize
	}

	partPath := destPath + ".part"
	_ = os.Remove(partPath)

	if err := os.MkdirAll(filepath.Dir(destPath), 0700); err != nil {
		return err
	}

	out, err := os.OpenFile(partPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("failed to open staging file: %w", err)
	}
	defer func() {
		out.Close()
		// If error occurs, leave partPath or let caller clean
	}()

	pw := &ProgressWriter{
		Total:      total,
		OnProgress: onProgress,
	}

	writer := io.MultiWriter(out, pw)
	if _, err := io.Copy(writer, res.Body); err != nil {
		_ = out.Close()
		_ = os.Remove(partPath)
		return fmt.Errorf("download stream error: %w", err)
	}

	if err := ctx.Err(); err != nil {
		_ = out.Close()
		_ = os.Remove(partPath)
		return err
	}

	if err := out.Close(); err != nil {
		return err
	}

	// Rename .part to final
	_ = os.Remove(destPath)
	if err := os.Rename(partPath, destPath); err != nil {
		return fmt.Errorf("failed to finalize staged file: %w", err)
	}

	return nil
}

// CleanOlderStaging deletes staging subdirectories other than the active one.
func (sm *StageManager) CleanOlderStaging(keepVersion string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	entries, err := os.ReadDir(sm.baseDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() && entry.Name() != keepVersion {
			_ = os.RemoveAll(filepath.Join(sm.baseDir, entry.Name()))
		}
	}
}
