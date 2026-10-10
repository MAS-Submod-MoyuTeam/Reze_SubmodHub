package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func createTestZip(t *testing.T, files map[string]string) ([]byte, string) {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()
	sum := sha256.Sum256(data)
	return data, hex.EncodeToString(sum[:])
}

func setupTestMASRoot(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gameDir := filepath.Join(dir, "game")
	if err := os.MkdirAll(filepath.Join(gameDir, "Submods"), 0755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestStageArchiveLifecycle(t *testing.T) {
	zipData, zipHash := createTestZip(t, map[string]string{
		"Submods/TestMod/header.txt": "mod-content-data",
	})

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/versions/v1/download":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"url":"/api/v1/archives/v1.zip","expires_at":%q,"sha256":%q,"size_bytes":%d}`,
				time.Now().Add(time.Hour).Format(time.RFC3339), zipHash, len(zipData))
		case "/api/v1/archives/v1.zip":
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", fmt.Sprint(len(zipData)))
			_, _ = w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	masRoot := setupTestMASRoot(t)
	stageDir := t.TempDir()
	stagingMgr, err := NewArchiveStagingManager(stageDir)
	if err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	service.stagingMgr = stagingMgr
	if _, err := service.SetMASRoot(masRoot); err != nil {
		t.Fatal(err)
	}

	opID := "op_test_stage_1"
	staged, err := service.StageArchive(StageArchiveRequest{
		APIBase:     server.URL + "/api/v1",
		VersionID:   "v1",
		OperationID: opID,
	})
	if err != nil {
		t.Fatalf("StageArchive failed: %v", err)
	}

	if staged.ArchiveID == "" {
		t.Fatal("expected non-empty archive_id")
	}
	if staged.SHA256 != zipHash {
		t.Fatalf("expected sha %s, got %s", zipHash, staged.SHA256)
	}
	if staged.SizeBytes != int64(len(zipData)) {
		t.Fatalf("expected size %d, got %d", len(zipData), staged.SizeBytes)
	}

	prog, err := service.GetStageProgress(opID)
	if err != nil {
		t.Fatal(err)
	}
	if prog.Stage != "completed" {
		t.Fatalf("expected progress stage completed, got %s", prog.Stage)
	}

	// PreviewArchive using the staged archive handle (without Base64 payload!)
	plan, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID: opID,
		ArchiveID:   staged.ArchiveID,
		ExpectedSHA: staged.SHA256,
		ModID:       "mod-1",
		VersionID:   "v1",
		Version:     "1.0.0",
		Title:       "Test Mod",
	})
	if err != nil {
		t.Fatalf("PreviewArchive using staged handle failed: %v", err)
	}
	if plan.PlanID == "" {
		t.Fatal("expected non-empty plan ID")
	}

	// Verify staged file exists before execution
	entry, err := stagingMgr.GetEntry(staged.ArchiveID, opID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(entry.Path); err != nil {
		t.Fatalf("expected staged file to exist: %v", err)
	}

	// Execute plan
	res, err := service.ExecutePlan(ExecutePlanRequest{
		PlanID:    plan.PlanID,
		Confirmed: true,
	})
	if err != nil {
		t.Fatalf("ExecutePlan failed: %v", err)
	}
	if res.State != "committed" {
		t.Fatalf("expected committed state, got %s", res.State)
	}

	// Verify staged file was cleaned up on completion
	if _, err := os.Stat(entry.Path); !os.IsNotExist(err) {
		t.Fatal("expected staged file to be cleaned up after ExecutePlan")
	}
}

func TestStageArchiveHashMismatch(t *testing.T) {
	zipData, zipHash := createTestZip(t, map[string]string{
		"Submods/TestMod/header.txt": "mod-content-data",
	})

	corruptedZip := make([]byte, len(zipData))
	copy(corruptedZip, zipData)
	corruptedZip[len(corruptedZip)-1] ^= 0xff

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/versions/v1/download":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"url":"/api/v1/archives/v1.zip","expires_at":%q,"sha256":%q,"size_bytes":%d}`,
				time.Now().Add(time.Hour).Format(time.RFC3339), zipHash, len(zipData))
		case "/api/v1/archives/v1.zip":
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", fmt.Sprint(len(corruptedZip)))
			_, _ = w.Write(corruptedZip)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stageDir := t.TempDir()
	stagingMgr, err := NewArchiveStagingManager(stageDir)
	if err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	service.stagingMgr = stagingMgr

	opID := "op_bad_hash"
	_, err = service.StageArchive(StageArchiveRequest{
		APIBase:     server.URL + "/api/v1",
		VersionID:   "v1",
		OperationID: opID,
	})
	if err == nil || !strings.Contains(err.Error(), "download_hash_mismatch") {
		t.Fatalf("expected download_hash_mismatch error, got %v", err)
	}

	// Verify no stray files remain in stageDir
	entries, _ := os.ReadDir(stageDir)
	if len(entries) != 0 {
		t.Fatalf("expected 0 files in stageDir after failure, got %d", len(entries))
	}
}

func TestStageArchiveSizeLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"url":"/api/v1/archives/v1.zip","expires_at":%q,"sha256":%q,"size_bytes":%d}`,
			time.Now().Add(time.Hour).Format(time.RFC3339), strings.Repeat("a", 64), 130*1024*1024)
	}))
	defer server.Close()

	service := NewDesktopService()
	_, err := service.StageArchive(StageArchiveRequest{
		APIBase:     server.URL + "/api/v1",
		VersionID:   "v1",
		OperationID: "op_too_large",
	})
	if err == nil || !strings.Contains(err.Error(), "download_too_large") {
		t.Fatalf("expected download_too_large error, got %v", err)
	}
}

func TestPreviewArchiveRejectLargeBase64(t *testing.T) {
	masRoot := setupTestMASRoot(t)
	service := NewDesktopService()
	if _, err := service.SetMASRoot(masRoot); err != nil {
		t.Fatal(err)
	}

	// Base64 payload exceeding bridge limit (23 MB > 22 MB limit)
	hugeBase64 := strings.Repeat("A", 23*1024*1024)
	_, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_large_bridge",
		ArchiveBase64: hugeBase64,
	})
	if err == nil || !strings.Contains(err.Error(), "archive_too_large_for_bridge") {
		t.Fatalf("expected archive_too_large_for_bridge, got %v", err)
	}
}


func TestStageArchiveOriginAndProtocolConstraints(t *testing.T) {
	// 1. Cross-origin archive URL in descriptor
	crossOriginServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"url":"https://evil.example.com/payload.zip","expires_at":%q,"sha256":%q,"size_bytes":100}`,
			time.Now().Add(time.Hour).Format(time.RFC3339), strings.Repeat("a", 64))
	}))
	defer crossOriginServer.Close()

	service := NewDesktopService()
	_, err := service.StageArchive(StageArchiveRequest{
		APIBase:     crossOriginServer.URL + "/api/v1",
		VersionID:   "v-cross",
		OperationID: "op_cross",
	})
	if err == nil || !strings.Contains(err.Error(), "cross_origin_archive_url_rejected") {
		t.Fatalf("expected cross_origin_archive_url_rejected, got %v", err)
	}

	// 2. Protocol-relative archive URL
	protoRelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"url":"//attacker.com/payload.zip","expires_at":%q,"sha256":%q,"size_bytes":100}`,
			time.Now().Add(time.Hour).Format(time.RFC3339), strings.Repeat("a", 64))
	}))
	defer protoRelServer.Close()

	_, err = service.StageArchive(StageArchiveRequest{
		APIBase:     protoRelServer.URL + "/api/v1",
		VersionID:   "v-proto",
		OperationID: "op_proto",
	})
	if err == nil || !strings.Contains(err.Error(), "protocol_relative_url_rejected") {
		t.Fatalf("expected protocol_relative_url_rejected, got %v", err)
	}

	// 3. Expired descriptor
	expiredServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"url":"/api/v1/archives/1.zip","expires_at":%q,"sha256":%q,"size_bytes":100}`,
			time.Now().Add(-time.Hour).Format(time.RFC3339), strings.Repeat("a", 64))
	}))
	defer expiredServer.Close()

	_, err = service.StageArchive(StageArchiveRequest{
		APIBase:     expiredServer.URL + "/api/v1",
		VersionID:   "v-expired",
		OperationID: "op_expired",
	})
	if err == nil || !strings.Contains(err.Error(), "download_expired") {
		t.Fatalf("expected download_expired, got %v", err)
	}
}

func TestStageArchiveCapacityAndConcurrentReservations(t *testing.T) {
	stageDir := t.TempDir()
	mgr, err := NewArchiveStagingManager(stageDir)
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	// Simulate existing active reservation of 500 MiB
	mgr.mu.Lock()
	mgr.reservations["op_large_in_flight"] = 500 * 1024 * 1024
	mgr.mu.Unlock()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"url":"/api/v1/archives/1.zip","expires_at":%q,"sha256":%q,"size_bytes":%d}`,
			time.Now().Add(time.Hour).Format(time.RFC3339), strings.Repeat("a", 64), 20*1024*1024)
	}))
	defer server.Close()

	service := NewDesktopService()
	service.stagingMgr = mgr

	// 500 MiB reserved + 20 MiB new exceeds 512 MiB total staging capacity
	_, err = service.StageArchive(StageArchiveRequest{
		APIBase:     server.URL + "/api/v1",
		VersionID:   "v1",
		OperationID: "op_would_overflow",
	})
	if err == nil || !strings.Contains(err.Error(), "staging_capacity_exceeded") {
		t.Fatalf("expected staging_capacity_exceeded, got %v", err)
	}

	// Duplicate operation ID in flight is rejected
	_, err = service.StageArchive(StageArchiveRequest{
		APIBase:     server.URL + "/api/v1",
		VersionID:   "v1",
		OperationID: "op_large_in_flight",
	})
	if err == nil || !strings.Contains(err.Error(), "operation_already_in_progress") {
		t.Fatalf("expected operation_already_in_progress, got %v", err)
	}
}

func TestArchiveStagingStartupAndManualCleanup(t *testing.T) {
	stageDir := t.TempDir()

	// Create a leftover file from an old crashed run
	oldFile := filepath.Join(stageDir, "stage-leftover-123.zip")
	if err := os.WriteFile(oldFile, []byte("leftover"), 0644); err != nil {
		t.Fatal(err)
	}

	// New manager should purge old stage-*.zip files on startup
	mgr, err := NewArchiveStagingManager(stageDir)
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Fatal("expected startup cleanup to remove leftover stage files")
	}

	// Test CancelStage cleans up active files
	tmpFile, err := os.CreateTemp(stageDir, "stage-active.zip")
	if err != nil {
		t.Fatal(err)
	}
	tmpPath := tmpFile.Name()
	_ = tmpFile.Close()

	mgr.mu.Lock()
	mgr.entries["test_archive_id"] = &stagedEntry{
		ArchiveID:   "test_archive_id",
		OperationID: "op_cancel_me",
		Path:        tmpPath,
		ExpiresAt:   time.Now().Add(time.Hour),
	}
	mgr.mu.Unlock()

	service := NewDesktopService()
	service.stagingMgr = mgr

	if err := service.CancelStage("op_cancel_me"); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Fatal("expected CancelStage to delete staged file")
	}
}


func TestStageArchivePackagedModeUsesConfiguredAPIURL(t *testing.T) {
	zipData, zipHash := createTestZip(t, map[string]string{
		"Submods/PackagedMod/header.txt": "packaged-mode-data",
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/versions/v-pack/download":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"url":"/api/v1/archives/pack.zip","expires_at":%q,"sha256":%q,"size_bytes":%d}`,
				time.Now().Add(time.Hour).Format(time.RFC3339), zipHash, len(zipData))
		case "/api/v1/archives/pack.zip":
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", fmt.Sprint(len(zipData)))
			_, _ = w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	masRoot := setupTestMASRoot(t)
	stageDir := t.TempDir()
	stagingMgr, err := NewArchiveStagingManager(stageDir)
	if err != nil {
		t.Fatal(err)
	}
	defer stagingMgr.Close()

	service := NewDesktopService()
	service.stagingMgr = stagingMgr
	service.SetAPIURL(server.URL)
	if _, err := service.SetMASRoot(masRoot); err != nil {
		t.Fatal(err)
	}

	// In packaged mode, webview has relative /api/v1 or empty or wails:// scheme
	for _, webviewBase := range []string{"", "/", "/api/v1", "wails://localhost/api/v1", "http://wails.localhost:18082/api/v1"} {
		opID := fmt.Sprintf("op_pack_%d", time.Now().UnixNano())
		staged, err := service.StageArchive(StageArchiveRequest{
			APIBase:     webviewBase,
			VersionID:   "v-pack",
			OperationID: opID,
		})
		if err != nil {
			t.Fatalf("StageArchive in packaged mode with apiBase=%q failed: %v", webviewBase, err)
		}
		if staged.ArchiveID == "" {
			t.Fatalf("expected non-empty archive_id for apiBase=%q", webviewBase)
		}
		if staged.SHA256 != zipHash {
			t.Fatalf("expected sha %s, got %s", zipHash, staged.SHA256)
		}
		service.ReleaseArchive(staged.ArchiveID)
	}
}

func TestStageArchiveCancelRaceBeforeRegistration(t *testing.T) {
	zipData, zipHash := createTestZip(t, map[string]string{
		"Submods/RaceMod/header.txt": "race-test-data",
	})

	downloadStarted := make(chan struct{})
	allowDownloadFinish := make(chan struct{})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/versions/v-race/download":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"url":"/api/v1/archives/race.zip","expires_at":%q,"sha256":%q,"size_bytes":%d}`,
				time.Now().Add(time.Hour).Format(time.RFC3339), zipHash, len(zipData))
		case "/api/v1/archives/race.zip":
			close(downloadStarted)
			<-allowDownloadFinish
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", fmt.Sprint(len(zipData)))
			_, _ = w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stageDir := t.TempDir()
	stagingMgr, err := NewArchiveStagingManager(stageDir)
	if err != nil {
		t.Fatal(err)
	}
	defer stagingMgr.Close()

	service := NewDesktopService()
	service.stagingMgr = stagingMgr
	service.SetAPIURL(server.URL)

	opID := "op_cancel_race_test"

	errChan := make(chan error, 1)
	go func() {
		_, err := service.StageArchive(StageArchiveRequest{
			APIBase:     server.URL + "/api/v1",
			VersionID:   "v-race",
			OperationID: opID,
		})
		errChan <- err
	}()

	// Wait for download to start, then cancel
	<-downloadStarted
	stagingMgr.Cancel(opID)
	close(allowDownloadFinish)

	err = <-errChan
	if err == nil {
		t.Fatal("expected StageArchive to fail when cancelled")
	}

	// Verify no entries registered for this opID
	stagingMgr.mu.RLock()
	for _, entry := range stagingMgr.entries {
		if entry.OperationID == opID {
			t.Fatalf("lingering entry found after cancellation: %+v", entry)
		}
	}
	stagingMgr.mu.RUnlock()

	// Verify no files in stageDir
	entries, _ := os.ReadDir(stageDir)
	if len(entries) != 0 {
		t.Fatalf("lingering temp files in stageDir: %d", len(entries))
	}
}


func TestStageArchiveAllowsConfiguredHTTPBase(t *testing.T) {
	zipData, zipHash := createTestZip(t, map[string]string{
		"Submods/HTTPMod/header.txt": "http-base-data",
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/versions/v-http/download":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"url":"/api/v1/archives/http.zip","expires_at":%q,"sha256":%q,"size_bytes":%d}`,
				time.Now().Add(time.Hour).Format(time.RFC3339), zipHash, len(zipData))
		case "/api/v1/archives/http.zip":
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", fmt.Sprint(len(zipData)))
			_, _ = w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stageDir := t.TempDir()
	stagingMgr, err := NewArchiveStagingManager(stageDir)
	if err != nil {
		t.Fatal(err)
	}
	defer stagingMgr.Close()

	service := NewDesktopService()
	service.stagingMgr = stagingMgr
	// Configure with an explicit HTTP backend (e.g. Tailnet or local network IP)
	service.SetAPIURL(server.URL)

	staged, err := service.StageArchive(StageArchiveRequest{
		APIBase:     server.URL + "/api/v1",
		VersionID:   "v-http",
		OperationID: "op_http_test",
	})
	if err != nil {
		t.Fatalf("expected HTTP API base to be allowed, got error: %v", err)
	}
	if staged.SHA256 != zipHash {
		t.Fatalf("expected sha %s, got %s", zipHash, staged.SHA256)
	}
}
