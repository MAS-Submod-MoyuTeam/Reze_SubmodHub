package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// stageWithFakeAPI wires a staging manager to a fake API that records the
// platform query it was asked for and answers with the platform it chooses.
func stageWithFakeAPI(t *testing.T, zipData []byte, zipHash, answeredPlatform string) (*DesktopService, string, *[]string) {
	t.Helper()
	queries := &[]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/versions/v1/download":
			*queries = append(*queries, r.URL.Query().Get("platform"))
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"url":"/api/v1/archives/v1.zip","expires_at":%q,"sha256":%q,"size_bytes":%d,"platform":%q}`,
				time.Now().Add(time.Hour).Format(time.RFC3339), zipHash, len(zipData), answeredPlatform)
		case "/api/v1/archives/v1.zip":
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", fmt.Sprint(len(zipData)))
			_, _ = w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	stagingMgr, err := NewArchiveStagingManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	service.stagingMgr = stagingMgr
	if _, err := service.SetMASRoot(setupTestMASRoot(t)); err != nil {
		t.Fatal(err)
	}
	return service, server.URL + "/api/v1", queries
}

// The client asks for the platform it can install rather than letting the server
// pick one for it.
func TestStageArchiveRequestsOwnPlatform(t *testing.T) {
	platform := downloadPlatform()
	if platform == "" {
		t.Skip("this build target has no per-platform archive")
	}
	zipData, zipHash := createTestZip(t, map[string]string{"Submods/TestMod/header.txt": "data"})
	service, apiBase, queries := stageWithFakeAPI(t, zipData, zipHash, platform)

	if _, err := service.StageArchive(StageArchiveRequest{APIBase: apiBase, VersionID: "v1", OperationID: "op_platform_ok"}); err != nil {
		t.Fatalf("StageArchive failed: %v", err)
	}
	if len(*queries) == 0 || (*queries)[0] != platform {
		t.Fatalf("descriptor requested with platform %q, want %q", *queries, platform)
	}
}

// A descriptor naming another platform must never reach installation.
func TestStageArchiveRejectsOtherPlatformDescriptor(t *testing.T) {
	zipData, zipHash := createTestZip(t, map[string]string{"Submods/TestMod/header.txt": "data"})
	other := "android"
	if downloadPlatform() == "android" {
		other = "windows"
	}
	service, apiBase, _ := stageWithFakeAPI(t, zipData, zipHash, other)

	_, err := service.StageArchive(StageArchiveRequest{APIBase: apiBase, VersionID: "v1", OperationID: "op_platform_mismatch"})
	if err == nil {
		t.Fatal("expected a wrong-platform descriptor to be refused")
	}
	if err.Error() != "wrong_platform_delivered" {
		t.Fatalf("error = %v, want wrong_platform_delivered", err)
	}
}
