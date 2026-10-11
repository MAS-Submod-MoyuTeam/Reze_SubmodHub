package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBrowserServiceUsesDesktopInstanceState(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0755); err != nil {
		t.Fatal(err)
	}
	service := &DesktopService{configPath: filepath.Join(t.TempDir(), "instances.json")}
	handler := browserServiceHandler(service)
	request := httptest.NewRequest(http.MethodPost, "/local/AddMASInstance", strings.NewReader(`{"args":["Test",`+strconvQuote(root)+`]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("add instance: %s", response.Body.String())
	}
	var state MASInstancesState
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil || len(state.Instances) != 1 || state.ActiveID == "" {
		t.Fatalf("state=%+v err=%v", state, err)
	}
	request = httptest.NewRequest(http.MethodPost, "/local/ListMASInstances", strings.NewReader(`{"args":[]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://untrusted.example")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin request accepted: %d", response.Code)
	}
}

func strconvQuote(value string) string { data, _ := json.Marshal(value); return string(data) }

func TestBrowserServicePlanEndpoints(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := &DesktopService{configPath: filepath.Join(t.TempDir(), "instances.json")}
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	handler := browserServiceHandler(service)

	// Create test zip base64
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	entry, _ := w.Create("game/Submods/browser_test.rpy")
	_, _ = entry.Write([]byte("test"))
	_ = w.Close()
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())

	// 1. PreviewArchive over HTTP
	reqBody := `{"args":[{"operation_id":"op_b_test","mod_id":"mod_b","archive_base64":"` + b64 + `"}]}`
	req := httptest.NewRequest(http.MethodPost, "/local/PreviewArchive", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PreviewArchive HTTP failed: %d %s", rec.Code, rec.Body.String())
	}
	var preview PlanResult
	if err := json.Unmarshal(rec.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.PlanID == "" || len(preview.Actions) != 1 {
		t.Fatalf("unexpected preview: %+v", preview)
	}

	// 2. ExecutePlan over HTTP
	execBody := `{"args":[{"plan_id":"` + preview.PlanID + `","confirmed":true}]}`
	req = httptest.NewRequest(http.MethodPost, "/local/ExecutePlan", strings.NewReader(execBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ExecutePlan HTTP failed: %d %s", rec.Code, rec.Body.String())
	}

	// 3. PreviewUninstall over HTTP
	unBody := `{"args":["mod_b"]}`
	req = httptest.NewRequest(http.MethodPost, "/local/PreviewUninstall", strings.NewReader(unBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PreviewUninstall HTTP failed: %d %s", rec.Code, rec.Body.String())
	}
	var unPreview PlanResult
	if err := json.Unmarshal(rec.Body.Bytes(), &unPreview); err != nil {
		t.Fatal(err)
	}
	if unPreview.Kind != "uninstall" || len(unPreview.Actions) != 1 {
		t.Fatalf("unexpected unPreview: %+v", unPreview)
	}
}

func TestBrowserServiceListInstalledModFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game", "Submods"), 0755); err != nil {
		t.Fatal(err)
	}
	service := &DesktopService{configPath: filepath.Join(t.TempDir(), "instances.json")}
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatalf("SetMASRoot failed: %v", err)
	}
	handler := browserServiceHandler(service)

	// 1. Call ListInstalledModFiles with non-existent mod
	req := httptest.NewRequest(http.MethodPost, "/local/ListInstalledModFiles", strings.NewReader(`{"args":["missing_mod","missing_mod"]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Must return HTTP 400 Bad Request and not_found error message
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400 Bad Request, got: %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "not_found") {
		t.Fatalf("expected not_found error, got: %s", rec.Body.String())
	}

	// 2. Install a mod and verify ListInstalledModFiles returns file list successfully
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	entry, _ := w.Create("game/Submods/list_test.rpy")
	_, _ = entry.Write([]byte("label list_test:\n    return\n"))
	_ = w.Close()
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())

	previewReq := `{"args":[{"operation_id":"op_list_test","mod_id":"mod_list_test","title":"List Test Mod","version":"1.0.0","archive_base64":"` + b64 + `"}]}`
	req = httptest.NewRequest(http.MethodPost, "/local/PreviewArchive", strings.NewReader(previewReq))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PreviewArchive failed: %d %s", rec.Code, rec.Body.String())
	}
	var preview PlanResult
	if err := json.Unmarshal(rec.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}

	execReq := `{"args":[{"plan_id":"` + preview.PlanID + `","confirmed":true}]}`
	req = httptest.NewRequest(http.MethodPost, "/local/ExecutePlan", strings.NewReader(execReq))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ExecutePlan failed: %d %s", rec.Code, rec.Body.String())
	}

	// Now query installed files via browser server endpoint
	req = httptest.NewRequest(http.MethodPost, "/local/ListInstalledModFiles", strings.NewReader(`{"args":["op_list_test","mod_list_test"]}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var fileList struct {
		ModID   string `json:"mod_id"`
		Summary struct {
			TotalFiles  int `json:"total_files"`
			ActiveFiles int `json:"active_files"`
		} `json:"summary"`
		Files []struct {
			Path    string `json:"path"`
			Drifted bool   `json:"drifted"`
			Active  bool   `json:"active"`
		} `json:"files"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &fileList); err != nil {
		t.Fatalf("failed to parse InstalledFileList: %v", err)
	}
	if fileList.Summary.TotalFiles != 1 || fileList.Summary.ActiveFiles != 1 {
		t.Fatalf("unexpected summary: %+v", fileList.Summary)
	}
	if len(fileList.Files) != 1 || fileList.Files[0].Path != "game/Submods/list_test.rpy" {
		t.Fatalf("unexpected files in list: %+v", fileList.Files)
	}
	if fileList.Files[0].Drifted {
		t.Fatalf("expected file to not be drifted")
	}
}
