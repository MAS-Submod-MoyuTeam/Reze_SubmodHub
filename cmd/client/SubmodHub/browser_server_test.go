package main

import (
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
