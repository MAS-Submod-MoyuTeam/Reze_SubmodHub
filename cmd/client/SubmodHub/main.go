package main

import (
	"embed"
	"errors"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

const defaultAPIURL = "http://100.72.137.92:18082"

func desktopAssets(apiURL string, frontend http.Handler) (http.Handler, error) {
	target, err := url.Parse(apiURL)
	if err != nil || target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") {
		return nil, errors.New("invalid API URL")
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
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
	handler, err := desktopAssets(apiURL, application.AssetFileServerFS(assets))
	if err != nil {
		log.Fatal(err)
	}
	app := application.New(application.Options{
		Name: "SubmodHub", Description: "MAS submod manager",
		Services: []application.Service{application.NewService(service)},
		Assets:   application.AssetOptions{Handler: handler},
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{Title: "SubmodHub", Width: 1280, Height: 800, BackgroundColour: application.NewRGB(10, 12, 16), URL: "/"})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
