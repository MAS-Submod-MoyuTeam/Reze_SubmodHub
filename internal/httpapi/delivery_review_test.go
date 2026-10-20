package httpapi

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDescriptorIssuanceDoesNotPersistOrExhaustGlobalCapacity(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m"}}, Versions: map[string]Version{"v": {ID: "v", ModID: "m", State: "published", SHA256: "hash", SizeBytes: 42}}})
	// Persisting anything would fail. Descriptors must remain a read-only operation.
	invalid := filepath.Join(t.TempDir(), "not-directory")
	os.WriteFile(invalid, []byte("x"), 0600)
	s.DataDir = invalid
	for i := 0; i < 10010; i++ {
		if _, err := s.issueDownloadAttempt(s.Catalog.Versions["v"]); err != nil {
			t.Fatalf("descriptor %d: %v", i, err)
		}
	}
	if s.Catalog.Mods[0].DownloadAttempts != 0 {
		t.Fatal("descriptor modified persisted counters")
	}
}
func TestMetricsRetryPreservesDeltasAndReceiptIdempotence(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m"}}, Versions: map[string]Version{"v": {ID: "v", ModID: "m", State: "published", SHA256: "hash", SizeBytes: 42}}})
	token, err := s.issueDownloadAttempt(s.Catalog.Versions["v"])
	if err != nil {
		t.Fatal(err)
	}
	if err = s.recordCompletion(token, "v", "hash", 42); err != nil {
		t.Fatal(err)
	}
	good := s.DataDir
	bad := filepath.Join(t.TempDir(), "file")
	os.WriteFile(bad, []byte("x"), 0600)
	s.DataDir = bad
	if s.flushDownloadMetrics() == nil {
		t.Fatal("expected persistence error")
	}
	if s.Catalog.Mods[0].ClientReportedDownloads != 0 {
		t.Fatal("failed save changed catalog")
	}
	if err = s.recordCompletion(token, "v", "hash", 42); err != nil {
		t.Fatal(err)
	}
	s.DataDir = good
	if err = s.flushDownloadMetrics(); err != nil {
		t.Fatal(err)
	}
	if s.Catalog.Mods[0].ClientReportedDownloads != 1 || s.Catalog.Mods[0].DownloadAttempts != 1 {
		t.Fatalf("lost or duplicated deltas: %+v", s.Catalog.Mods[0])
	}
	reopened, err := NewStore(good, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Catalog.Mods[0].ClientReportedDownloads != 1 {
		t.Fatal("batch not persisted")
	}
	if reopened.recordCompletion(token, "v", "hash", 42) == nil {
		t.Fatal("process-scoped token survived restart")
	}
}
