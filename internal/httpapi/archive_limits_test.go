package httpapi

import (
	"path/filepath"
	"testing"
)

// The archive ceiling is a deployment knob (SUBMODHUB_MAX_ARCHIVE_SIZE) with a
// 1 GiB product default. These tests pin the three things that made the old
// hard-coded 256 MiB limit painful: the default, the parsing an operator writes
// in compose, and the derived budgets that must stay above whatever is chosen.

func TestParseArchiveSize(t *testing.T) {
	cases := []struct {
		raw  string
		want int64
	}{
		{"1073741824", 1 << 30},
		{"1GiB", 1 << 30},
		{"1G", 1 << 30},
		{"1gb", 1 << 30},
		{"1024MiB", 1 << 30},
		{"512m", 512 << 20},
		{"2 GiB", 2 << 30},
		{"4MiB", 4 << 20},
		{"1048576", 1 << 20},
		{"64GiB", 64 << 30},
	}
	for _, tc := range cases {
		got, err := ParseArchiveSize(tc.raw)
		if err != nil {
			t.Fatalf("ParseArchiveSize(%q) failed: %v", tc.raw, err)
		}
		if got != tc.want {
			t.Fatalf("ParseArchiveSize(%q) = %d, want %d", tc.raw, got, tc.want)
		}
	}

	for _, raw := range []string{"", "  ", "abc", "0", "-5", "10", "1KiB", "1TiB", "65GiB"} {
		if got, err := ParseArchiveSize(raw); err == nil {
			t.Fatalf("ParseArchiveSize(%q) = %d, want an error", raw, got)
		}
	}
}

func TestArchiveLimitDefaultsToOneGiB(t *testing.T) {
	if defaultMaxArchiveSize != 1<<30 {
		t.Fatalf("defaultMaxArchiveSize = %d, want %d (1 GiB)", defaultMaxArchiveSize, int64(1<<30))
	}

	// The asset that exposed the old 256 MiB cap must fit the default.
	const largestKnownAsset int64 = 450718433
	if defaultMaxArchiveSize <= largestKnownAsset {
		t.Fatalf("largest known archive (%d bytes) does not fit in the default (%d bytes)",
			largestKnownAsset, defaultMaxArchiveSize)
	}
}

func TestStoreArchiveLimitFollowsConfiguration(t *testing.T) {
	store, err := NewStore(t.TempDir(), Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if got := store.archiveLimit(); got != defaultMaxArchiveSize {
		t.Fatalf("new store archiveLimit() = %d, want default %d", got, defaultMaxArchiveSize)
	}

	store.MaxArchiveSize = 2 << 30
	if got := store.archiveLimit(); got != 2<<30 {
		t.Fatalf("configured archiveLimit() = %d, want %d", got, int64(2<<30))
	}

	// A store built without the constructor still answers with the default
	// rather than zero (which would reject every archive).
	zero := &Store{DataDir: filepath.Join(t.TempDir(), "data")}
	if got := zero.archiveLimit(); got != defaultMaxArchiveSize {
		t.Fatalf("zero-value archiveLimit() = %d, want default %d", got, defaultMaxArchiveSize)
	}
}

// The ZIP scan budget is derived from the archive limit, not fixed: a package at
// the limit may expand well past it, and a fixed budget below the limit rejects
// legitimate big packages as "ZIP size limit exceeded".
func TestArchiveScanLimitsStayAboveArchiveLimit(t *testing.T) {
	for _, limit := range []int64{1 << 20, 256 << 20, 1 << 30, 3 << 30} {
		limits := archiveScanLimits(limit)
		if limits.MaxUncompressedBytes <= uint64(limit) {
			t.Fatalf("scan budget %d is not above archive limit %d", limits.MaxUncompressedBytes, limit)
		}
	}
}
