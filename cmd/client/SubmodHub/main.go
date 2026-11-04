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

	"github.com/reze/submodhub/internal/updater"
	"github.com/reze/submodhub/internal/version"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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
	if err := updater.RecoverStartup(""); errors.Is(err, updater.ErrRecoveryStarted) {
		return
	} else if err != nil {
		log.Printf("Update recovery: %v", err)
	}

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
	// Windows 上把 `rezehub://` 指向当前 exe（HKCU，免管理员、幂等）。
	// 失败不影响启动：表现为「点链接没反应」，而不是程序起不来。
	registerModProtocol()
	// 链接就是本次启动参数时（客户端没在运行），系统不会再有别的通知渠道，
	// 这里先把它收进 inbox，前端挂载后通过 TakePendingModLink 领取。
	if modID, ok := findModLinkInArgs(os.Args[1:]); ok {
		pendingModLinks.put(modID)
	}
	app := application.New(application.Options{
		Name: "RezeHub", Description: "MAS submod manager",
		Services: []application.Service{application.NewService(service)},
		Assets:   application.AssetOptions{Handler: handler},
		// 客户端已在运行时再点一次分享链接，系统会再起一个进程；单实例把它的
		// argv 交回正在运行的这个进程，于是「再点链接」只是让窗口跳到详情。
		// Android 走 intent（singleTask + onNewIntent），不会经过这里。
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: singleInstanceID,
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				for _, arg := range data.Args {
					if deliverModLink(arg) != "" {
						return
					}
				}
			},
		},
	})
	// The desktop client renders its own title bar in the web UI
	// (clients/desktop/src/components/TitleBar.tsx). Keep the native window
	// frameless so Windows does not draw a second, non-functional caption bar
	// above it. Android already has no window frame and ignores this option.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "RezeHub " + version.Version,
		Width:            1280,
		Height:           800,
		BackgroundColour: application.NewRGB(10, 12, 16),
		URL:              "/",
		Frameless:        !isAndroidPlatform,
	})
	// 冷启动时链接随 argv 进来；系统也可能通过「应用被 URL 打开」事件再交付一次。
	// 两条路径都进同一个 inbox，前端只领取一次，不会重复打开。
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl,
		func(e *application.ApplicationEvent) { deliverModLink(e.Context().URL()) })
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
