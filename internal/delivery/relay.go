package delivery

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/reze/submodhub/internal/github"
)

type RelayConfig struct {
	Audience, Key, GitHubProxy string
	MaxConcurrent              int
}
type Relay struct {
	cfg   RelayConfig
	slots chan struct{}
	open  func(context.Context, string) (*http.Response, error)
}

func NewRelay(cfg RelayConfig) (*Relay, error) {
	if cfg.Audience == "" || len(cfg.Key) < 32 {
		return nil, errors.New("node audience and key of at least 32 bytes required")
	}
	if cfg.MaxConcurrent == 0 {
		cfg.MaxConcurrent = 8
	}
	if cfg.MaxConcurrent < 1 || cfg.MaxConcurrent > 32 {
		return nil, errors.New("node concurrency must be between 1 and 32")
	}
	if err := github.ValidateProxyTemplate(cfg.GitHubProxy); err != nil {
		return nil, errors.New("invalid node GitHub proxy")
	}
	client := github.NewClient(github.WithProxyTemplate(cfg.GitHubProxy))
	return &Relay{cfg: cfg, slots: make(chan struct{}, cfg.MaxConcurrent), open: client.OpenArchiveStream}, nil
}
func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if req.Method != "GET" {
		http.Error(w, "method_not_allowed", 405)
		return
	}
	if req.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","active":%d,"capacity":%d}`, len(r.slots), cap(r.slots))
		return
	}
	if req.URL.Path != "/download" {
		http.NotFound(w, req)
		return
	}
	token := req.URL.Query().Get("ticket")
	claim, err := VerifyTicket(r.cfg.Key, r.cfg.Audience, token, time.Now())
	if err != nil {
		http.Error(w, "invalid_ticket", 401)
		return
	}
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	default:
		http.Error(w, "relay_busy", 503)
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), 10*time.Minute)
	defer cancel()
	res, err := r.open(ctx, claim.SourceURL)
	if err != nil {
		http.Error(w, "github_upstream_failed", 502)
		return
	}
	defer res.Body.Close()
	if res.ContentLength >= 0 && res.ContentLength != claim.SizeBytes {
		http.Error(w, "upstream_archive_changed", 502)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Length", fmt.Sprint(claim.SizeBytes))
	w.Header().Set("X-Archive-SHA256", claim.SHA256)
	w.Header().Set("X-Accel-Buffering", "no")
	// Clients validate the signed published digest before using any streamed bytes.
	// This node neither scans nor stores archives; input cannot exceed signed size.
	idle := time.AfterFunc(30*time.Second, cancel)
	defer idle.Stop()
	buf := make([]byte, 64<<10)
	remaining := claim.SizeBytes
	for remaining > 0 {
		n, readErr := res.Body.Read(buf[:min(int64(len(buf)), remaining)])
		if n > 0 {
			idle.Reset(30 * time.Second)
			written, writeErr := w.Write(buf[:n])
			if writeErr != nil || written != n {
				return
			}
			remaining -= int64(n)
		}
		if readErr != nil {
			if readErr != io.EOF || remaining != 0 {
				panic(http.ErrAbortHandler)
			}
			return
		}
	}
}
