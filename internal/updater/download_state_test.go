package updater

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/reze/submodhub/internal/github"
)

type stateTestInstaller bool

func (i stateTestInstaller) CanInstallDirectly() bool                      { return bool(i) }
func (i stateTestInstaller) Install(context.Context, string, string) error { return nil }

func testDownloadService(t *testing.T, timeout time.Duration) *Service {
	t.Helper()
	s, err := NewService(Config{CacheDir: t.TempDir(), DownloadTimeout: timeout}, nil)
	if err != nil {
		t.Fatal(err)
	}
	s.ghClient = github.NewClient(github.WithAllowInsecureTestHosts(true))
	return s
}

func TestDownloadAllAssetsUseRedirectProxy(t *testing.T) {
	payload := "application"
	helper := "installer"
	var hits atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		target := strings.TrimPrefix(r.RequestURI, "/")
		switch target {
		case "https://github.com/test/app":
			w.Header().Set("Location", "https://release-assets.githubusercontent.com/app")
			w.WriteHeader(http.StatusFound)
		case "https://release-assets.githubusercontent.com/app":
			fmt.Fprint(w, payload)
		case "https://github.com/test/helper":
			fmt.Fprint(w, helper)
		case "https://github.com/test/checksums":
			fmt.Fprintf(w, "%x  app.zip\n%x  helper.exe\n", sha256.Sum256([]byte(payload)), sha256.Sum256([]byte(helper)))
		default:
			http.Error(w, target, http.StatusNotFound)
		}
	}))
	defer proxy.Close()
	s := testDownloadService(t, time.Second)
	s.ghClient = github.NewClient(github.WithProxyTemplate(proxy.URL+"/{url}"), github.WithAllowInsecureTestHosts(true))
	release := &ReleaseInfo{Version: "2", Asset: &AssetInfo{Name: "app.zip", BrowserDownloadURL: "https://github.com/test/app"}, UpdaterAsset: &AssetInfo{Name: "helper.exe", BrowserDownloadURL: "https://github.com/test/helper"}, ChecksumURL: "https://github.com/test/checksums"}
	if _, err := s.DownloadUpdate(t.Context(), release); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 4 || s.GetState().Status != StatusReady {
		t.Fatalf("hits=%d state=%+v", hits.Load(), s.GetState())
	}
}

func TestDownloadUsesHTTPProxy(t *testing.T) {
	var hits atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if !r.URL.IsAbs() {
			t.Error("HTTP proxy request must use an absolute URL")
		}
		switch r.URL.Host {
		case "github.com":
			w.Header().Set("Location", "http://release-assets.githubusercontent.com/app")
			w.WriteHeader(http.StatusFound)
		case "release-assets.githubusercontent.com":
			fmt.Fprint(w, "app")
		default:
			http.Error(w, "unexpected proxy target", http.StatusBadRequest)
		}
	}))
	defer proxy.Close()
	s := testDownloadService(t, time.Second)
	s.ghClient = github.NewClient(github.WithProxyTemplate(proxy.URL), github.WithAllowInsecureTestHosts(true))
	_, err := s.DownloadUpdate(t.Context(), &ReleaseInfo{Version: "2", Asset: &AssetInfo{Name: "app.zip", BrowserDownloadURL: "http://github.com/test/app", ExpectedSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte("app")))}})
	if err != nil || hits.Load() != 2 || s.GetState().Status != StatusReady {
		t.Fatalf("err=%v hits=%d state=%+v", err, hits.Load(), s.GetState())
	}
}

func TestDownloadCancellationAndTimeoutRemainTerminal(t *testing.T) {
	for _, mode := range []string{"cancel", "deadline", "parent"} {
		t.Run(mode, func(t *testing.T) {
			entered := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Length", "100")
				fmt.Fprint(w, "partial")
				w.(http.Flusher).Flush()
				close(entered)
				<-r.Context().Done()
			}))
			defer server.Close()
			timeout := time.Second
			if mode == "deadline" {
				timeout = 100 * time.Millisecond
			}
			s := testDownloadService(t, timeout)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, err := s.DownloadUpdate(ctx, &ReleaseInfo{Version: "2", Asset: &AssetInfo{Name: "app.zip", BrowserDownloadURL: server.URL}})
				done <- err
			}()
			<-entered
			if mode == "cancel" {
				s.Cancel()
			} else if mode == "parent" {
				cancel()
			}
			select {
			case err := <-done:
				want := context.Canceled
				if mode == "deadline" {
					want = context.DeadlineExceeded
				}
				if !errors.Is(err, want) {
					t.Fatalf("got %v, want %v", err, want)
				}
				if s.GetState().Error != want.Error() {
					t.Fatalf("state error=%q, want %q", s.GetState().Error, want.Error())
				}
			case <-time.After(3 * time.Second):
				t.Fatal("download did not stop")
			}
			wantStatus := StatusCancelled
			if mode == "deadline" {
				wantStatus = StatusFailed
			}
			if s.GetState().Status != wantStatus {
				t.Fatalf("state=%+v, want %s", s.GetState(), wantStatus)
			}
			if mode != "deadline" {
				s.setState(func(st *State) { st.Status = StatusReady })
				s.setState(func(st *State) { st.Status = StatusFailed })
				if s.GetState().Status != StatusCancelled {
					t.Fatal("cancelled overwritten")
				}
			}
		})
	}
}

type cancelBeforeReadyInstaller struct{ cancel func() }

func (i cancelBeforeReadyInstaller) CanInstallDirectly() bool                      { i.cancel(); return true }
func (i cancelBeforeReadyInstaller) Install(context.Context, string, string) error { return nil }

func TestCancellationImmediatelyBeforeReady(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "app") }))
	defer server.Close()
	s := testDownloadService(t, time.Second)
	s.installer = cancelBeforeReadyInstaller{cancel: s.Cancel}
	_, err := s.DownloadUpdate(t.Context(), &ReleaseInfo{Version: "2", Asset: &AssetInfo{Name: "app.zip", BrowserDownloadURL: server.URL, ExpectedSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte("app")))}})
	if !errors.Is(err, context.Canceled) || s.GetState().Status != StatusCancelled || s.GetState().StagedPath != "" {
		t.Fatalf("err=%v state=%+v", err, s.GetState())
	}
}

func TestActiveCheckExcludesDownloadAndInstall(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		fmt.Fprint(w, "[]")
	}))
	defer server.Close()
	s := testDownloadService(t, time.Second)
	s.ghClient = github.NewClient(github.WithBaseURL(server.URL))
	done := make(chan error, 1)
	go func() { _, err := s.CheckForUpdate(t.Context()); done <- err }()
	<-entered
	if _, err := s.DownloadUpdate(t.Context(), &ReleaseInfo{Asset: &AssetInfo{}}); err == nil {
		t.Error("download admitted during check")
	}
	if _, err := s.ClaimInstall(); err == nil {
		t.Error("install admitted during check")
	}
	s.Cancel()
	if s.GetState().Status != StatusChecking {
		t.Error("cancel overwrote active check")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestClaimInstallAtomicAndRecovery(t *testing.T) {
	for _, direct := range []bool{true, false} {
		t.Run(fmt.Sprint(direct), func(t *testing.T) {
			s := testDownloadService(t, time.Second)
			s.installer = stateTestInstaller(direct)
			s.state = State{Status: StatusReady, StagedPath: "verified.zip"}
			var wins atomic.Int32
			var wg sync.WaitGroup
			for range 20 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					if _, err := s.ClaimInstall(); err == nil {
						wins.Add(1)
					}
				}()
			}
			wg.Wait()
			want := StatusAwaitingUser
			if direct {
				want = StatusInstalling
			}
			if wins.Load() != 1 || s.GetState().Status != want {
				t.Fatalf("wins=%d state=%+v", wins.Load(), s.GetState())
			}
			if _, err := s.CheckForUpdate(t.Context()); err == nil {
				t.Fatal("check admitted while installing")
			}
			if _, err := s.DownloadUpdate(t.Context(), &ReleaseInfo{Asset: &AssetInfo{}}); err == nil {
				t.Fatal("download admitted while installing")
			}
			s.Cancel()
			if s.GetState().Status != want {
				t.Fatal("cancel overwrote install")
			}
			s.RestoreInstallReady(errors.New("handoff failed"))
			st := s.GetState()
			if st.Status != StatusReady || st.StagedPath != "verified.zip" || st.Error != "handoff failed" {
				t.Fatalf("state=%+v", st)
			}
			if _, err := s.ClaimInstall(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
