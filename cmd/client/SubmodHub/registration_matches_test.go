package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestMatchRegistrationsSendsJSON(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/registrations/match" || request.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected request: %s %s", request.Method, request.URL)
		}
		var payload struct {
			Names []string `json:"names"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || len(payload.Names) != 1 || payload.Names[0] != "A&B" {
			t.Errorf("unexpected payload: %+v, %v", payload, err)
		}
		_, _ = writer.Write([]byte(`{"results":[]}`))
	}))
	defer backend.Close()
	service := &DesktopService{apiURL: backend.URL}
	result, err := service.MatchRegistrations([]string{"A&B"})
	if err != nil || result != `{"results":[]}` {
		t.Fatalf("result=%q error=%v", result, err)
	}
}

func TestMatchRegistrationsRejectsBackendError(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "unavailable", http.StatusServiceUnavailable)
	}))
	defer backend.Close()
	service := &DesktopService{apiURL: backend.URL}
	if _, err := service.MatchRegistrations([]string{"test"}); err == nil {
		t.Fatal("expected backend error")
	}
}

func TestAndroidAPIPreservesEncodedURL(t *testing.T) {
	source, err := os.ReadFile("build/android/app/src/main/java/com/wails/app/MainActivity.java")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), "request.getUrl().getEncodedPath()") || !strings.Contains(string(source), "request.getUrl().getEncodedQuery()") {
		t.Fatal("Android API bridge must preserve encoded path and query")
	}
}
