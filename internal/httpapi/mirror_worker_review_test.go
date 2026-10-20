package httpapi

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMirrorWorkerRecoversAfterStartupStorageFailure(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m"}}, Versions: map[string]Version{"v": {ID: "v", ModID: "m", State: "published", SHA256: "h", ArchivePath: "missing.zip"}}, DeliveryNodes: []DeliveryNode{{ID: "n", Type: "cloudreve", Enabled: true}}})
	good := s.DataDir
	bad := filepath.Join(t.TempDir(), "file")
	os.WriteFile(bad, []byte("x"), 0600)
	s.DataDir = bad
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { s.runDeliveryWorker(ctx, 5*time.Millisecond); close(done) }()
	// Wait for the first retry tick without assuming the worker has returned.
	timer := time.NewTimer(25 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-done:
		t.Fatal("worker exited after transient storage failure")
	case <-timer.C:
	}
	s.mu.Lock()
	s.DataDir = good
	s.mu.Unlock()
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			t.Fatal("worker stopped")
		case <-deadline.C:
			t.Fatal("worker did not recover")
		case <-ticker.C:
			s.mu.RLock()
			recovered := len(s.Catalog.ArchiveMirrors) == 1 && s.Catalog.ArchiveMirrors[0].Attempts > 0
			s.mu.RUnlock()
			if recovered {
				cancel()
				<-done
				return
			}
		}
	}
}
