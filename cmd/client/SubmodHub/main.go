//go:build !browser

package main

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"

	"github.com/reze/submodhub/internal/version"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

const defaultAPIURL = "https://rezehub.0721play.icu"

var (
	globalAssetHandlerMu sync.RWMutex
	globalAssetHandler   http.Handler
)

func setGlobalAssetHandler(h http.Handler) {
	globalAssetHandlerMu.Lock()
	defer globalAssetHandlerMu.Unlock()
	globalAssetHandler = h
}

func getGlobalAssetHandler() http.Handler {
	globalAssetHandlerMu.RLock()
	defer globalAssetHandlerMu.RUnlock()
	return globalAssetHandler
}

func serveAssetDetailed(method, uri string, reqHeaders map[string]string, reqBody []byte) (int, string, []byte, error) {
	h := getGlobalAssetHandler()
	if h == nil {
		apiURL := os.Getenv("SUBMODHUB_API_URL")
		if apiURL == "" {
			apiURL = defaultAPIURL
		}
		var err error
		h, err = desktopAssets(apiURL, application.AssetFileServerFS(assets))
		if err == nil {
			setGlobalAssetHandler(h)
		}
	}
	if h == nil {
		return 503, "application/json", []byte(`{"error":"asset_handler_not_ready"}`), errors.New("handler not ready")
	}
	if method == "" {
		method = http.MethodGet
	}
	req, err := http.NewRequest(method, "https://wails.localhost"+uri, bytes.NewReader(reqBody))
	if err != nil {
		return 400, "application/json", []byte(fmt.Sprintf(`{"error":"invalid_request","detail":%q}`, err.Error())), err
	}
	for k, v := range reqHeaders {
		req.Header.Set(k, v)
	}
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, req)

	res := recorder.Result()
	defer res.Body.Close()

	respBody, _ := io.ReadAll(res.Body)
	contentType := res.Header.Get("Content-Type")
	if contentType == "" {
		contentType = http.DetectContentType(respBody)
	}
	return res.StatusCode, contentType, respBody, nil
}

func desktopAssets(apiURL string, frontend http.Handler) (http.Handler, error) {
	target, err := url.Parse(apiURL)
	if err != nil || target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") {
		return nil, errors.New("invalid API URL")
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalHost := req.Host
		director(req)
		req.Host = target.Host
		if originalHost != "" {
			req.Header.Set("X-Forwarded-Host", originalHost)
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			proxy.ServeHTTP(w, r)
			return
		}
		frontend.ServeHTTP(w, r)
	}), nil
}

func main() {
	service := NewDesktopService()
	apiURL := os.Getenv("SUBMODHUB_API_URL")
	if apiURL == "" {
		apiURL = defaultAPIURL
	}
	service.SetAPIURL(apiURL)
	handler, err := desktopAssets(apiURL, application.AssetFileServerFS(assets))
	if err != nil {
		log.Fatal(err)
	}
	setGlobalAssetHandler(handler)
	app := application.New(application.Options{
		Name: "SubmodHub", Description: "MAS submod manager",
		Services: []application.Service{application.NewService(service)},
		Assets:   application.AssetOptions{Handler: handler},
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{Title: "SubmodHub " + version.Version, Width: 1280, Height: 800, BackgroundColour: application.NewRGB(10, 12, 16), URL: "/"})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
