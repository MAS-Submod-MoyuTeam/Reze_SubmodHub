package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type StageArchiveRequest struct {
	APIBase     string `json:"api_base"`
	VersionID   string `json:"version_id"`
	OperationID string `json:"operation_id"`
}

type StagedArchiveInfo struct {
	ArchiveID   string `json:"archive_id"`
	OperationID string `json:"operation_id"`
	SHA256      string `json:"sha256"`
	SizeBytes   int64  `json:"size_bytes"`
	ExpiresAt   string `json:"expires_at"`
}

type StageProgress struct {
	Stage    string `json:"stage"` // "connecting", "downloading", "verifying", "completed", "error"
	Received int64  `json:"received"`
	Total    int64  `json:"total"`
	Error    string `json:"error,omitempty"`
}

type ArchiveDescriptor struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

const (
	maxStagedFileSize       = 128 * 1024 * 1024 // 128 MiB single file limit
	maxTotalStagingCapacity = 512 * 1024 * 1024 // 512 MiB total staging capacity
	stagedHandleExpiry      = 15 * time.Minute  // 15-minute validity
)

type stagedEntry struct {
	ArchiveID   string
	OperationID string
	Path        string
	SHA256      string
	SizeBytes   int64
	ExpiresAt   time.Time
}

type ArchiveStagingManager struct {
	mu           sync.RWMutex
	stageDir     string
	entries      map[string]*stagedEntry       // archive_id -> entry
	progress     map[string]StageProgress      // operation_id -> progress
	cancels      map[string]context.CancelFunc // operation_id -> cancel
	reservations map[string]int64              // operation_id -> reserved bytes
	stopTicker   chan struct{}
}

func isLocalTestHost(host string) bool {
	h := host
	if strings.Contains(h, ":") {
		if parsedHost, _, err := net.SplitHostPort(h); err == nil {
			h = parsedHost
		}
	}
	return h == "127.0.0.1" || h == "localhost" || h == "::1"
}

func NewArchiveStagingManager(stageDir string) (*ArchiveStagingManager, error) {
	if stageDir == "" {
		stageDir = filepath.Join(os.TempDir(), "submodhub_client_stage")
	}
	if err := os.MkdirAll(stageDir, 0700); err != nil {
		return nil, fmt.Errorf("create staging directory failed: %w", err)
	}

	// Startup cleanup: purge any leftover stage files from previous runs
	if files, err := os.ReadDir(stageDir); err == nil {
		for _, f := range files {
			if strings.HasPrefix(f.Name(), "stage-") && strings.HasSuffix(f.Name(), ".zip") {
				_ = os.Remove(filepath.Join(stageDir, f.Name()))
			}
		}
	}

	mgr := &ArchiveStagingManager{
		stageDir:     stageDir,
		entries:      make(map[string]*stagedEntry),
		progress:     make(map[string]StageProgress),
		cancels:      make(map[string]context.CancelFunc),
		reservations: make(map[string]int64),
		stopTicker:   make(chan struct{}),
	}

	// Background ticker for automated expired handle cleanup
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				mgr.mu.Lock()
				mgr.cleanupExpiredLocked()
				mgr.mu.Unlock()
			case <-mgr.stopTicker:
				return
			}
		}
	}()

	return mgr, nil
}

func (m *ArchiveStagingManager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	select {
	case <-m.stopTicker:
	default:
		close(m.stopTicker)
	}
	for id, entry := range m.entries {
		_ = os.Remove(entry.Path)
		delete(m.entries, id)
	}
}

func (m *ArchiveStagingManager) cleanupExpiredLocked() {
	now := time.Now()
	for id, entry := range m.entries {
		if now.After(entry.ExpiresAt) {
			_ = os.Remove(entry.Path)
			delete(m.entries, id)
		}
	}
}

func (m *ArchiveStagingManager) currentTotalSizeLocked() int64 {
	var total int64
	for _, entry := range m.entries {
		total += entry.SizeBytes
	}
	for _, reserved := range m.reservations {
		total += reserved
	}
	return total
}

func generateSecureArchiveID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (m *ArchiveStagingManager) GetEntry(archiveID, operationID string) (*stagedEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.cleanupExpiredLocked()

	entry, ok := m.entries[archiveID]
	if !ok {
		return nil, errors.New("invalid_archive_handle")
	}
	if time.Now().After(entry.ExpiresAt) {
		_ = os.Remove(entry.Path)
		delete(m.entries, archiveID)
		return nil, errors.New("archive_handle_expired")
	}
	if operationID != "" && entry.OperationID != operationID {
		return nil, errors.New("archive_handle_operation_mismatch")
	}
	return entry, nil
}

func (m *ArchiveStagingManager) ReleaseArchive(archiveID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if entry, ok := m.entries[archiveID]; ok {
		_ = os.Remove(entry.Path)
		delete(m.entries, archiveID)
	}
}

func (m *ArchiveStagingManager) GetProgress(operationID string) StageProgress {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if p, ok := m.progress[operationID]; ok {
		return p
	}
	return StageProgress{Stage: "connecting", Received: 0, Total: 0}
}

func (m *ArchiveStagingManager) setProgress(operationID string, p StageProgress) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.progress[operationID] = p
}

func (m *ArchiveStagingManager) Cancel(operationID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if cancel, ok := m.cancels[operationID]; ok {
		cancel()
		delete(m.cancels, operationID)
	}
	delete(m.reservations, operationID)
	for id, entry := range m.entries {
		if entry.OperationID == operationID {
			_ = os.Remove(entry.Path)
			delete(m.entries, id)
		}
	}
	m.progress[operationID] = StageProgress{Stage: "error", Error: "cancelled"}
}

func (m *ArchiveStagingManager) Stage(ctx context.Context, req StageArchiveRequest) (StagedArchiveInfo, error) {
	if req.OperationID == "" {
		return StagedArchiveInfo{}, errors.New("operation_id_required")
	}
	if req.VersionID == "" {
		return StagedArchiveInfo{}, errors.New("version_id_required")
	}
	apiBase := strings.TrimRight(req.APIBase, "/")
	if apiBase == "" {
		apiBase = "http://127.0.0.1:8080/api/v1"
	}

	baseParsed, err := url.Parse(apiBase)
	if err != nil || (baseParsed.Scheme != "http" && baseParsed.Scheme != "https") || baseParsed.Host == "" {
		return StagedArchiveInfo{}, fmt.Errorf("invalid_api_base: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	m.mu.Lock()
	m.cleanupExpiredLocked()

	// Prevent duplicate in-flight operations with same operation_id
	if _, active := m.reservations[req.OperationID]; active {
		m.mu.Unlock()
		return StagedArchiveInfo{}, errors.New("operation_already_in_progress")
	}
	if _, active := m.cancels[req.OperationID]; active {
		m.mu.Unlock()
		return StagedArchiveInfo{}, errors.New("operation_already_in_progress")
	}

	m.cancels[req.OperationID] = cancel
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		delete(m.cancels, req.OperationID)
		delete(m.reservations, req.OperationID)
		m.mu.Unlock()
	}()

	m.setProgress(req.OperationID, StageProgress{Stage: "connecting", Received: 0, Total: 0})

	// Safe HTTP client enforcing same-origin and safe redirect destinations
	safeClient := &http.Client{
		CheckRedirect: func(redirectReq *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too_many_redirects")
			}
			if redirectReq.URL.Host != baseParsed.Host {
				return fmt.Errorf("cross_origin_redirect_blocked: %s", redirectReq.URL.Host)
			}
			if redirectReq.URL.Scheme != baseParsed.Scheme && redirectReq.URL.Scheme != "https" && !isLocalTestHost(redirectReq.URL.Hostname()) {
				return fmt.Errorf("insecure_redirect_blocked: %s", redirectReq.URL.Scheme)
			}
			return nil
		},
	}

	// 1. Fetch archive descriptor
	descURL := fmt.Sprintf("%s/versions/%s/download", apiBase, url.PathEscape(req.VersionID))
	dReq, err := http.NewRequestWithContext(ctx, http.MethodGet, descURL, nil)
	if err != nil {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: err.Error()})
		return StagedArchiveInfo{}, err
	}
	dRes, err := safeClient.Do(dReq)
	if err != nil {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: err.Error()})
		return StagedArchiveInfo{}, fmt.Errorf("descriptor fetch failed: %w", err)
	}
	defer dRes.Body.Close()

	if dRes.StatusCode != http.StatusOK {
		var errObj struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(dRes.Body).Decode(&errObj)
		code := errObj.Code
		if code == "" {
			code = fmt.Sprintf("http_%d", dRes.StatusCode)
		}
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: code})
		return StagedArchiveInfo{}, errors.New(code)
	}

	var desc ArchiveDescriptor
	if err := json.NewDecoder(dRes.Body).Decode(&desc); err != nil {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "invalid_descriptor"})
		return StagedArchiveInfo{}, fmt.Errorf("decode descriptor failed: %w", err)
	}

	// Validate descriptor expiration
	expiry, err := time.Parse(time.RFC3339, desc.ExpiresAt)
	if err != nil || time.Now().After(expiry) {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "download_expired"})
		return StagedArchiveInfo{}, errors.New("download_expired")
	}

	if desc.SizeBytes < 1 || desc.SizeBytes > maxStagedFileSize {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "download_too_large"})
		return StagedArchiveInfo{}, errors.New("download_too_large")
	}
	if len(desc.SHA256) != 64 {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "invalid_descriptor_hash"})
		return StagedArchiveInfo{}, errors.New("invalid_descriptor_hash")
	}

	// Quota reservation check: include both current files and active reservations
	m.mu.Lock()
	if m.currentTotalSizeLocked()+desc.SizeBytes > maxTotalStagingCapacity {
		m.mu.Unlock()
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "staging_capacity_exceeded"})
		return StagedArchiveInfo{}, errors.New("staging_capacity_exceeded")
	}
	m.reservations[req.OperationID] = desc.SizeBytes
	m.mu.Unlock()

	// 2. Validate descriptor download URL: reject protocol-relative and cross-origin
	if strings.HasPrefix(desc.URL, "//") {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "protocol_relative_url_rejected"})
		return StagedArchiveInfo{}, errors.New("protocol_relative_url_rejected")
	}

	relParsed, err := url.Parse(desc.URL)
	if err != nil {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "invalid_descriptor_url"})
		return StagedArchiveInfo{}, fmt.Errorf("parse descriptor url failed: %w", err)
	}
	archiveParsed := baseParsed.ResolveReference(relParsed)

	if archiveParsed.Host != baseParsed.Host {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "cross_origin_archive_url_rejected"})
		return StagedArchiveInfo{}, fmt.Errorf("cross_origin_archive_url_rejected: %s", archiveParsed.Host)
	}
	// Allow scheme if it matches the configured API base scheme, or is https, or is local test host
	if archiveParsed.Scheme != baseParsed.Scheme && archiveParsed.Scheme != "https" && !isLocalTestHost(archiveParsed.Hostname()) {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "insecure_archive_url_rejected"})
		return StagedArchiveInfo{}, fmt.Errorf("insecure_archive_url_rejected: %s", archiveParsed.Scheme)
	}

	// 3. Create temp staged file
	tmpFile, err := os.CreateTemp(m.stageDir, "stage-*.zip")
	if err != nil {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "create_temp_failed"})
		return StagedArchiveInfo{}, fmt.Errorf("create temp file failed: %w", err)
	}
	tmpPath := tmpFile.Name()
	cleanedUp := false
	defer func() {
		if !cleanedUp {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
		}
	}()

	m.setProgress(req.OperationID, StageProgress{Stage: "downloading", Received: 0, Total: desc.SizeBytes})

	// 4. Stream download directly to client local file
	aReq, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveParsed.String(), nil)
	if err != nil {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: err.Error()})
		return StagedArchiveInfo{}, err
	}
	aRes, err := safeClient.Do(aReq)
	if err != nil {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: err.Error()})
		return StagedArchiveInfo{}, fmt.Errorf("download archive failed: %w", err)
	}
	defer aRes.Body.Close()

	if aRes.StatusCode != http.StatusOK {
		var errObj struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(aRes.Body).Decode(&errObj)
		code := errObj.Code
		if code == "" {
			code = fmt.Sprintf("http_%d", aRes.StatusCode)
		}
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: code})
		return StagedArchiveInfo{}, errors.New(code)
	}

	hasher := sha256.New()
	buf := make([]byte, 32*1024)
	var totalRead int64
	var lastUpdate time.Time

	for {
		n, rErr := aRes.Body.Read(buf)
		if n > 0 {
			totalRead += int64(n)
			if totalRead > desc.SizeBytes {
				m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "download_size_mismatch"})
				return StagedArchiveInfo{}, errors.New("download_size_mismatch")
			}
			if _, wErr := tmpFile.Write(buf[:n]); wErr != nil {
				m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "write_failed"})
				return StagedArchiveInfo{}, fmt.Errorf("write archive failed: %w", wErr)
			}
			hasher.Write(buf[:n])

			now := time.Now()
			if now.Sub(lastUpdate) >= 50*time.Millisecond || totalRead == desc.SizeBytes {
				lastUpdate = now
				m.setProgress(req.OperationID, StageProgress{Stage: "downloading", Received: totalRead, Total: desc.SizeBytes})
			}
		}
		if rErr != nil {
			if errors.Is(rErr, io.EOF) {
				break
			}
			m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: rErr.Error()})
			return StagedArchiveInfo{}, fmt.Errorf("stream read failed: %w", rErr)
		}
	}

	if totalRead != desc.SizeBytes {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "download_size_mismatch"})
		return StagedArchiveInfo{}, errors.New("download_size_mismatch")
	}

	_ = tmpFile.Close()

	// 5. Verification stage
	m.setProgress(req.OperationID, StageProgress{Stage: "verifying", Received: totalRead, Total: desc.SizeBytes})
	computedSHA := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(computedSHA, desc.SHA256) {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "download_hash_mismatch"})
		return StagedArchiveInfo{}, errors.New("download_hash_mismatch")
	}

	// 6. Generate unguessable handle
	archiveID, err := generateSecureArchiveID()
	if err != nil {
		m.setProgress(req.OperationID, StageProgress{Stage: "error", Error: "handle_generation_failed"})
		return StagedArchiveInfo{}, err
	}

	expiresAt := time.Now().Add(stagedHandleExpiry)
	entry := &stagedEntry{
		ArchiveID:   archiveID,
		OperationID: req.OperationID,
		Path:        tmpPath,
		SHA256:      desc.SHA256,
		SizeBytes:   totalRead,
		ExpiresAt:   expiresAt,
	}

	m.mu.Lock()
	// Confirm that the operation was not canceled while streaming/verifying
	if _, stillActive := m.cancels[req.OperationID]; !stillActive {
		delete(m.reservations, req.OperationID)
		m.mu.Unlock()
		return StagedArchiveInfo{}, errors.New("cancelled")
	}
	delete(m.reservations, req.OperationID) // release reservation and register final entry
	m.entries[archiveID] = entry
	m.mu.Unlock()

	cleanedUp = true // file kept on disk for handle owner
	m.setProgress(req.OperationID, StageProgress{Stage: "completed", Received: totalRead, Total: totalRead})

	return StagedArchiveInfo{
		ArchiveID:   archiveID,
		OperationID: req.OperationID,
		SHA256:      desc.SHA256,
		SizeBytes:   totalRead,
		ExpiresAt:   expiresAt.Format(time.RFC3339),
	}, nil
}
