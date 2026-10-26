package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"

	"github.com/reze/submodhub/internal/github"
	packagezip "github.com/reze/submodhub/internal/package"
)

// SupportedPlatforms are the only platforms a version may ship per-platform
// files for. The order is also the order authors and clients see.
var SupportedPlatforms = []string{"windows", "android"}

// ErrPlatformRulesRequired reports a GitHub source that switched to per-platform
// discovery without declaring a single platform rule.
var ErrPlatformRulesRequired = errors.New("at least one platform asset rule is required when per-platform download is enabled")

// platformAliases normalizes author input. Only exact platform names are stored;
// aliases exist so "Windows"/"安卓" are not silently dropped as unknown.
var platformAliases = map[string]string{
	"windows": "windows",
	"win":     "windows",
	"win32":   "windows",
	"win64":   "windows",
	"android": "android",
	"安卓":      "android",
}

// normalizePlatform returns the canonical platform name for input, or "" when
// the caller does not name a supported platform. Authors write the canonical
// name in the form; aliases exist so a case difference or "安卓" in a hand-edited
// catalog or a query string is not silently read as unknown.
func normalizePlatform(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if canonical, ok := platformAliases[value]; ok {
		return canonical
	}
	return ""
}

// PlatformAssetRule is one per-platform file of a version. Platform files and the
// version-wide file are interchangeable formats (both are ZIP archives); a
// version never mixes them.
//
// Every file is stored on this server, whether it came from an author upload or
// from a GitHub release asset (including the release-zipball fallback), so
// ArchivePath, SizeBytes and SHA256 always describe bytes this server holds.
// AssetName only records which upstream file the bytes came from.
type PlatformAssetRule struct {
	Platform    string `json:"platform"`
	AssetName   string `json:"asset_name,omitempty"`
	ArchivePath string `json:"archive_path,omitempty"`
	SizeBytes   int64  `json:"size_bytes"`
	SHA256      string `json:"sha256,omitempty"`
}

// GitHubPlatformRule is the author-declared matcher for one platform, stored on
// the mod so every future release is selected with the same rule.
type GitHubPlatformRule struct {
	Platform string `json:"platform"`
	Regex    string `json:"regex,omitempty"`
	// SourceCode allows this platform to fall back to the release zipball when
	// its regex matches nothing.
	SourceCode bool `json:"source_code,omitempty"`
}

// normalizePlatformRules validates author-declared GitHub platform rules. An
// empty result means "one file for every platform". Regex syntax is checked
// with the same RE2 compiler that finally runs during a sync.
func normalizePlatformRules(rules []GitHubPlatformRule) ([]GitHubPlatformRule, error) {
	out := make([]GitHubPlatformRule, 0, len(rules))
	seen := map[string]bool{}
	for _, rule := range rules {
		platform := normalizePlatform(rule.Platform)
		if platform == "" {
			return nil, fmt.Errorf("unsupported platform %q: only windows and android can be configured", rule.Platform)
		}
		if seen[platform] {
			return nil, fmt.Errorf("platform %s is configured twice", platform)
		}
		seen[platform] = true
		pattern := strings.TrimSpace(rule.Regex)
		if pattern != "" {
			if _, err := regexp.Compile(pattern); err != nil {
				return nil, fmt.Errorf("invalid %s asset regex: %w", platform, err)
			}
		}
		out = append(out, GitHubPlatformRule{Platform: platform, Regex: pattern, SourceCode: rule.SourceCode})
	}
	slices.SortFunc(out, func(a, b GitHubPlatformRule) int {
		return platformOrder(a.Platform) - platformOrder(b.Platform)
	})
	return out, nil
}

// splitPlatformDelimited splits one file name into the platforms it declares,
// using the given separators. A segment must name a platform to count; an
// unrelated prefix ("MyMod-windows-..." segment "MyMod") is ignored.
func splitPlatformDelimited(lowerName string, separators map[rune]bool) []string {
	fields := strings.FieldsFunc(lowerName, func(r rune) bool { return separators[r] })
	out := []string{}
	for _, field := range fields {
		platform := normalizePlatform(field)
		if platform != "" && !slices.Contains(out, platform) {
			out = append(out, platform)
		}
	}
	return out
}

// InferPlatformTags guesses which platforms a file name is intended for.
//
// It is used for two honest, visible behaviours: the author form pre-fills a
// platform's regex from an example file name, and uploads are checked against
// the platform they claim. Both keep the last word with the uploader; nothing
// here silently routes a file to another platform.
func InferPlatformTags(fileName string) []string {
	name := strings.TrimSpace(fileName)
	if name == "" {
		return nil
	}
	lower := strings.ToLower(name)
	explicit := splitPlatformDelimited(lower, map[rune]bool{'-': true, '_': true, '.': true, ' ': true, '/': true, '\\': true})
	if len(explicit) > 0 {
		return explicit
	}
	// Conventional suffixes that do not name the platform directly.
	switch {
	case strings.HasSuffix(lower, ".apk"):
		return []string{"android"}
	case strings.HasSuffix(lower, ".exe"):
		return []string{"windows"}
	}
	return nil
}

// platformConflictsWithName reports whether planning fileName for platform
// would hand a file explicitly named for another platform to this one.
func platformConflictsWithName(platform, fileName string) bool {
	tags := InferPlatformTags(fileName)
	if len(tags) == 0 || slices.Contains(tags, platform) {
		return false
	}
	// Tags disjoint from the declared platform: the name points elsewhere.
	return !slices.Contains(tags, platform)
}

// validArchiveFile reports whether a stored archive is a regular file that is
// still on disk. A path recorded in the catalog is not proof: the file can be
// gone after a partial deploy or a manual cleanup.
func validArchiveFile(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// requireSubmittableArchives is the review gate for every shape: a version must
// physically have every archive it claims. For per-platform versions that means
// all declared platforms and no others, so a submission never reaches review
// while one platform's file is missing.
func (s *Store) requireSubmittableArchives(v Version) error {
	if len(v.PlatformAssets) == 0 {
		if !validArchiveFile(v.ArchivePath) {
			return errors.New("upload a ZIP archive before submitting for review")
		}
		return nil
	}
	missing := []string{}
	for _, platform := range SupportedPlatforms {
		index := slices.IndexFunc(v.PlatformAssets, func(file PlatformAssetRule) bool { return file.Platform == platform })
		if index < 0 {
			continue
		}
		if !validArchiveFile(v.PlatformAssets[index].ArchivePath) {
			missing = append(missing, platform)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("upload the ZIP archive for %s before submitting for review", strings.Join(missing, ", "))
	}
	return nil
}

// requirePlatformScanReports is the review gate for the scan half of the same
// promise: every platform file a version ships must have been scanned on its
// own. A per-platform version whose summary report exists but whose second
// platform was never scanned would send an unaudited archive into review.
func (s *Store) requirePlatformScanReports(v Version) error {
	missing := []string{}
	for _, file := range v.platformFiles() {
		if _, ok := s.Catalog.ScanReports[scanReportKey(v.ID, file.Platform)]; !ok {
			missing = append(missing, file.Platform)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("rescan the ZIP archive for %s before submitting for review", strings.Join(missing, ", "))
	}
	return nil
}

// storeArchiveScanReport records the report of the archive that was just scanned
// under that file's own key, then points the version summary at the first
// platform the version ships.
//
// The report describes one file, so it may only be filed under that file's key.
// Filing it under the summary key instead damages both ends: the platform that
// was not just uploaded would end up with no report of its own (which makes the
// version permanently unsubmittable, because the submit gate demands one per
// platform), and re-uploading android would replace the windows report a reviewer
// reads with android's file list.
//
// Callers must hold the write lock: it mutates the catalog's reports.
func (s *Store) storeArchiveScanReport(v *Version, platform string, report packagezip.Report) {
	if s.Catalog.ScanReports == nil {
		s.Catalog.ScanReports = map[string]packagezip.Report{}
	}
	s.Catalog.ScanReports[scanReportKey(v.ID, platform)] = report
	v.ScanReportID = v.summaryScanReportID()
}

// versionScanReports lists every scan report a version owns, keyed by report ID:
// one per shipped file, or the single version-wide report.
//
// Review and author surfaces read this instead of the summary key alone, so a
// per-platform version cannot be decided on while one of its platforms was never
// shown. Callers must hold at least the read lock.
func (s *Store) versionScanReports(v Version) map[string]packagezip.Report {
	out := map[string]packagezip.Report{}
	for _, key := range v.scanReportKeys() {
		if report, ok := s.Catalog.ScanReports[key]; ok {
			out[key] = report
		}
	}
	return out
}

// scanReportKeys lists every scan report key a version owns: one per shipped
// file, or the single version-wide key. Deleting or retiring a version drops
// exactly these, so no per-platform report outlives the archive it describes.
func (v Version) scanReportKeys() []string {
	if len(v.PlatformAssets) == 0 {
		if v.ScanReportID == "" {
			return nil
		}
		return []string{v.ScanReportID}
	}
	keys := make([]string, 0, len(v.PlatformAssets))
	for _, file := range v.platformFiles() {
		keys = append(keys, scanReportKey(v.ID, file.Platform))
	}
	return keys
}

// platformDelivery describes one platform's file as it will be delivered.
type platformDelivery struct {
	Platform string
	File     PlatformAssetRule
	// Local reports whether this server holds the bytes; false means the file is
	// relayed from the release asset recorded on the rule.
	Local bool
}

// ErrUnknownPlatform reports a request for a platform this version does not
// ship, as opposed to a request that named no platform at all.
var ErrUnknownPlatform = errors.New("this version has no archive for the requested platform")

// ErrPlatformRequired reports a request for a per-platform version that did not
// say which platform's build it can install.
var ErrPlatformRequired = errors.New("name the platform to download")

// platformQueryError validates the `?platform=` query string and returns the only
// error a caller may answer.
//
// Two different questions hide behind one query:
//   - a version that ships one shared archive serves every platform, so naming
//     any supported platform is a no-op and must not narrow or reject anything.
//     Clients that always name their own platform (Android, Windows desktop)
//     depend on this, otherwise every historical single-file version would 404;
//   - a per-platform version has no default build, so naming none is
//     ErrPlatformRequired and naming one it does not ship is ErrUnknownPlatform.
//
// A value that is not a platform at all is ErrUnknownPlatform either way: the
// contract only ever describes the supported platforms.
//
// Every entry point that reads the query goes through here, so no handler can
// accept "linux" on one endpoint and reject it on another.
func (v Version) platformQueryError(raw string) error {
	requested := strings.TrimSpace(raw)
	if requested == "" {
		if len(v.PlatformAssets) > 0 {
			return ErrPlatformRequired
		}
		return nil
	}
	if normalizePlatform(requested) == "" {
		return ErrUnknownPlatform
	}
	if len(v.PlatformAssets) == 0 {
		return nil
	}
	if _, found := v.platformFileFor(requested); !found {
		return ErrUnknownPlatform
	}
	return nil
}

// writePlatformQueryError answers a rejected `?platform=` query. Both the
// descriptor and the archive endpoint use it so a client sees the same status
// and the same code on either endpoint.
func writePlatformQueryError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrPlatformRequired) {
		writeError(w, 400, "platform_required", err.Error()+": "+strings.Join(SupportedPlatforms, ", "))
		return
	}
	writeError(w, 404, "platform_not_found", err.Error())
}

// platformFileFor returns the file a request asked for, and false when it names
// no supported platform or one this version does not ship. A per-platform
// version has no "default" build: silently serving another platform's bytes
// would install the wrong one, so callers reject false instead of falling back.
// Callers that accept a platform-less request for a single-file version never
// reach this function.
func (v Version) platformFileFor(rawPlatform string) (PlatformAssetRule, bool) {
	files := v.platformFiles()
	if len(files) == 0 {
		return PlatformAssetRule{}, false
	}
	platform := normalizePlatform(rawPlatform)
	if platform == "" {
		return PlatformAssetRule{}, false
	}
	index := slices.IndexFunc(files, func(file PlatformAssetRule) bool { return file.Platform == platform })
	if index < 0 {
		return PlatformAssetRule{}, false
	}
	return files[index], true
}

// platformSelection is one platform's asset inside a release, resolved against
// the mod's declared rules.
type platformSelection struct {
	Platform string
	Asset    github.SelectedAsset
}

// selectPlatformsForRelease resolves every declared platform. A release that
// cannot serve one of the declared platforms fails as a whole: publishing a
// version that advertises Android but only contains Windows bytes would put the
// lie in the catalog instead of in the sync summary.
func selectPlatformsForRelease(rel github.Release, rules []GitHubPlatformRule) ([]platformSelection, error) {
	selected, missing, err := selectReleaseAssetsForPlatforms(rel, rules)
	if err != nil {
		return nil, err
	}
	if len(missing) > 0 {
		names := make([]string, 0, len(missing))
		for _, rule := range missing {
			names = append(names, rule.Platform)
		}
		return nil, fmt.Errorf("%w: %s", github.ErrNoMatchingAsset, strings.Join(names, ", "))
	}
	out := make([]platformSelection, 0, len(rules))
	for _, rule := range rules {
		out = append(out, platformSelection{Platform: rule.Platform, Asset: selected[rule.Platform]})
	}
	return out, nil
}

// selectReleaseAssetsForPlatforms resolves one platform rule per platform against
// a release. Rules are independent: a platform whose regex matches nothing is
// reported instead of silently borrowing another platform's archive.
func selectReleaseAssetsForPlatforms(rel github.Release, rules []GitHubPlatformRule) (map[string]github.SelectedAsset, []GitHubPlatformRule, error) {
	selected := map[string]github.SelectedAsset{}
	missing := []GitHubPlatformRule{}
	for _, rule := range rules {
		// Selection runs through the shared selector so sorting, the .zip
		// restriction and the source-code fallback stay owned in one place.
		chosen, err := github.SelectReleaseAsset(rel, rule.Regex, rule.SourceCode)
		if err != nil {
			if errors.Is(err, github.ErrNoMatchingAsset) {
				missing = append(missing, rule)
				continue
			}
			return nil, nil, err
		}
		selected[rule.Platform] = *chosen
	}
	return selected, missing, nil
}
