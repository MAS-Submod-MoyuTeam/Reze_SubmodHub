package httpapi

import (
	"fmt"
	"strconv"
	"strings"

	packagezip "github.com/reze/submodhub/internal/package"
)

// archiveLimit is the effective per-archive ceiling of this process: upload,
// GitHub release sync, relay download and the size check on already-stored
// versions all ask this one method.
func (s *Store) archiveLimit() int64 {
	if s.MaxArchiveSize > 0 {
		return s.MaxArchiveSize
	}
	return defaultMaxArchiveSize
}

// archiveScanLimits derives the ZIP scan budget from the archive ceiling. The
// uncompressed budget must stay above the archive size, otherwise a legitimately
// large package is rejected as "ZIP size limit exceeded" — which reads like
// corruption instead of "big package". The compression-ratio guard inside
// packagezip still bounds zip bombs.
//
// The budget never drops below twice the product default, so lowering the archive
// ceiling does not retroactively make an already-stored 1 GiB package unscannable.
func archiveScanLimits(limit int64) packagezip.Limits {
	if limit < defaultMaxArchiveSize {
		limit = defaultMaxArchiveSize
	}
	return packagezip.Limits{MaxUncompressedBytes: uint64(limit) * 2}
}

// maxArchiveLimit is the sanity ceiling for configuration. Past it the tmpfs that
// holds a download temp file cannot be sized sensibly, so an operator typo
// ("4096GiB") would take the service down on the first big upload instead of
// failing at startup where it is cheap to notice.
const maxArchiveLimit int64 = 64 << 30

// ParseArchiveSize parses the SUBMODHUB_MAX_ARCHIVE_SIZE value.
//
// It accepts a plain byte count ("1073741824") or a size with a suffix
// ("512MiB", "1GiB", "1G", "1024m"). Every suffix is a power of 1024 — KB and
// KiB both mean 1024 bytes — so an operator never has to guess which one this
// program picked.
func ParseArchiveSize(raw string) (int64, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return 0, fmt.Errorf("archive size is empty")
	}
	multiplier := int64(1)
	for _, suffix := range []struct {
		name  string
		scale int64
	}{
		{"kib", 1 << 10}, {"kb", 1 << 10}, {"k", 1 << 10},
		{"mib", 1 << 20}, {"mb", 1 << 20}, {"m", 1 << 20},
		{"gib", 1 << 30}, {"gb", 1 << 30}, {"g", 1 << 30},
		{"b", 1},
	} {
		if strings.HasSuffix(value, suffix.name) {
			multiplier = suffix.scale
			value = strings.TrimSpace(strings.TrimSuffix(value, suffix.name))
			break
		}
	}
	number, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid archive size %q: expected bytes or a value like 1GiB", raw)
	}
	if number <= 0 {
		return 0, fmt.Errorf("archive size must be positive, got %q", raw)
	}
	if number > (1<<62)/multiplier {
		return 0, fmt.Errorf("archive size %q is out of range", raw)
	}
	size := number * multiplier
	if size < minArchiveSize {
		return 0, fmt.Errorf("archive size %q is below the %d MiB floor", raw, minArchiveSize>>20)
	}
	if size > maxArchiveLimit {
		return 0, fmt.Errorf("archive size %q is above the %d GiB ceiling", raw, maxArchiveLimit>>30)
	}
	return size, nil
}
