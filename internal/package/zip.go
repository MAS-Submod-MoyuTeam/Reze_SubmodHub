package packagezip

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"

	"github.com/reze/submodhub/internal/maspath"
)

type Limits struct {
	MaxEntries           int
	MaxUncompressedBytes uint64
	MaxCompressionRatio  float64
}

type File struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Size   uint64 `json:"size"`
	SHA256 string `json:"sha256"`
	Class  string `json:"class"`
}

type Registration struct {
	Source              string             `json:"source"`
	Author              string             `json:"author"`
	Name                string             `json:"name"`
	Version             string             `json:"version"`
	Unknown             bool               `json:"unknown"`
	Dependencies        []SubmodDependency `json:"dependencies,omitempty"`
	DependenciesUnknown bool               `json:"dependencies_unknown,omitempty"`
}
type SubmodDependency struct {
	Name    string `json:"name"`
	Minimum string `json:"minimum"`
	Maximum string `json:"maximum"`
}
type Sprite struct {
	Source, Identity, GiftName, GiftGroup string
	Unknown                               bool
}
type Derived struct{ Source, Target string }
type Conflict struct{ Kind, Value, First, Second string }
type Report struct {
	Files              []File         `json:"files"`
	SpriteIndexVersion int            `json:"sprite_index_version,omitempty"`
	SpriteSets         []SpriteSet    `json:"sprite_sets,omitempty"`
	Unsupported        []string       `json:"unsupported"`
	Warnings           []string       `json:"warnings"`
	Submods            []Registration `json:"submods"`
	Sprites            []Sprite       `json:"sprites"`
	Derived            []Derived      `json:"derived"`
	Conflicts          []Conflict     `json:"conflicts"`
}

func (l Limits) defaults() Limits {
	if l.MaxEntries <= 0 {
		l.MaxEntries = 4096
	}
	if l.MaxUncompressedBytes == 0 {
		l.MaxUncompressedBytes = 512 << 20
	}
	if l.MaxCompressionRatio == 0 {
		l.MaxCompressionRatio = 200
	}
	return l
}

// entryPath returns the separator-normalized entry name used for validation and
// mapping. The ZIP specification says `/`, but archives built by Windows tools
// (the MAS mod releases are built that way) store `game\Submods\x.rpy`. Reading
// only the spec spelling would reject a perfectly installable package, so the
// separator is normalized before it reaches maspath — which still sees and
// rejects traversal, absolute paths and the rest.
//
// The reported File.Source keeps the original spelling because clients open the
// entry by that exact name.
func entryPath(name string) string {
	if strings.ContainsRune(name, '\\') {
		name = strings.ReplaceAll(name, `\`, "/")
	}
	// Directory entries carry a trailing separator in either spelling
	// (`game\Submods\`); it has to go before the path is split into segments.
	return strings.TrimSuffix(name, "/")
}

// dirEntry reports whether f names a directory rather than a file. zip.FileInfo
// only understands the `/` spelling, so an entry written as `game\Submods\` by a
// Windows archiver is not seen as a directory by IsDir alone — and then it ends
// up reported as an unsupported file.
func dirEntry(f *zip.File) bool {
	return f.FileInfo().IsDir() || strings.HasSuffix(f.Name, "/") || strings.HasSuffix(f.Name, `\`)
}

func Scan(reader io.ReaderAt, size int64, limits Limits) (Report, error) {
	var report Report
	limits = limits.defaults()
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return report, err
	}
	if len(z.File) > limits.MaxEntries {
		return report, fmt.Errorf("ZIP entry limit exceeded")
	}
	seen := make(map[string]string)
	var total uint64
	for _, f := range z.File {
		name := entryPath(f.Name)
		if name == "" {
			return report, fmt.Errorf("empty ZIP path")
		}
		_, key, err := maspath.Validate(name)
		if err != nil {
			return report, err
		}
		if other, ok := seen[key]; ok {
			return report, fmt.Errorf("colliding ZIP entries %q and %q", other, f.Name)
		}
		seen[key] = f.Name
		if f.Mode()&0o170000 == 0o120000 {
			return report, fmt.Errorf("symlink entry %q", f.Name)
		}
		if f.Mode().IsRegular() || !dirEntry(f) {
			if f.UncompressedSize64 > limits.MaxUncompressedBytes-total {
				return report, fmt.Errorf("ZIP size limit exceeded")
			}
			total += f.UncompressedSize64
			if f.UncompressedSize64 > 0 && float64(f.UncompressedSize64)/float64(max(f.CompressedSize64, 1)) > limits.MaxCompressionRatio {
				return report, fmt.Errorf("ZIP compression ratio exceeded")
			}
		}
	}
	prefix, err := detectRoot(z.File)
	if err != nil {
		return report, err
	}
	// A package that spells no MAS root at all may still be one submod folder meant
	// to be dropped into `game/Submods/`; the mapping below then supplies the
	// `Submods/` root that the archive itself left implicit, keeping the folder as
	// the submod's own directory.
	folderShape := false
	if prefix == "" {
		if _, ok := detectSubmodFolder(z.File); ok {
			folderShape = true
		}
	}
	regNames, spriteIDs, gifts := map[string]string{}, map[string]string{}, map[string]string{}
	targets := make(map[string]string)
	for _, f := range z.File {
		if dirEntry(f) {
			continue
		}
		name := strings.TrimPrefix(entryPath(f.Name), prefix)
		var target string
		var ok bool
		if folderShape {
			normal, _, err := maspath.Validate(entryPath(f.Name))
			if err != nil {
				return report, err
			}
			target, ok = path.Join("Submods", normal), true
		} else {
			var err error
			target, ok, err = maspath.MapLegacyPath(name)
			if err != nil {
				return report, err
			}
		}
		if !ok {
			report.Unsupported = append(report.Unsupported, f.Name)
			continue
		}
		if previous, exists := targets[target]; exists {
			return report, fmt.Errorf("colliding mapped targets %q and %q", previous, f.Name)
		}
		targets[target] = f.Name
		r, err := f.Open()
		if err != nil {
			return report, err
		}
		data, err := io.ReadAll(io.LimitReader(r, int64(limits.MaxUncompressedBytes)+1))
		r.Close()
		if err != nil || uint64(len(data)) != f.UncompressedSize64 {
			return report, fmt.Errorf("cannot read ZIP entry %q: %v", f.Name, err)
		}
		h := sha256.Sum256(data)
		class := classify(target)
		report.Files = append(report.Files, File{f.Name, target, uint64(len(data)), hex.EncodeToString(h[:]), class})
		if class == "binary" {
			report.Warnings = append(report.Warnings, "binary content: "+f.Name)
		}
		if class == "script" {
			for _, reg := range parseSubmods(f.Name, data) {
				report.Submods = append(report.Submods, reg)
				if reg.DependenciesUnknown {
					report.Warnings = append(report.Warnings, "unrecognized submod dependencies: "+f.Name)
				}
				if reg.Name != "" {
					addConflict(&report, regNames, "submod_name", reg.Name, f.Name)
				}
			}
		}
		if class == "sprite_json" {
			sprite := parseSprite(f.Name, data)
			report.Sprites = append(report.Sprites, sprite)
			if sprite.Unknown {
				report.Warnings = append(report.Warnings, "unknown sprite metadata: "+f.Name)
			}
			if sprite.Identity != "" {
				addConflict(&report, spriteIDs, "sprite_identity", sprite.Identity, f.Name)
			}
			if sprite.GiftName != "" {
				addConflict(&report, gifts, "giftname", sprite.GiftName, f.Name)
				group := sprite.GiftGroup
				report.Derived = append(report.Derived, Derived{f.Name, path.Join("AvailableGift", group, sprite.GiftName+".gift")})
			}
		}
	}
	sort.Slice(report.Files, func(i, j int) bool { return report.Files[i].Target < report.Files[j].Target })
	sort.Strings(report.Unsupported)
	return report, nil
}

func detectRoot(files []*zip.File) (string, error) {
	var candidates []string
	for _, f := range files {
		parts := strings.Split(entryPath(f.Name), "/")
		for i := 0; i < len(parts)-1; i++ {
			if parts[i] == "game" || parts[i] == "Submods" || parts[i] == "mod_assets" || parts[i] == "python-packages" || parts[i] == "gui" || parts[i] == "custom_bgm" || parts[i] == "piano_songs" || parts[i] == "lib" || parts[i] == "characters" {
				candidates = append(candidates, strings.Join(parts[:i], "/"))
				break
			}
		}
	}
	if len(candidates) == 0 {
		return "", nil
	}
	unique := map[string]bool{}
	for _, c := range candidates {
		unique[c] = true
	}
	if len(unique) > 1 {
		return "", fmt.Errorf("ambiguous package roots")
	}
	sort.Slice(candidates, func(i, j int) bool { return len(candidates[i]) < len(candidates[j]) })
	if candidates[0] == "" {
		return "", nil
	}
	return candidates[0] + "/", nil
}

// detectSubmodFolder recognises the other shape a published MAS submod takes: the
// archive holds one folder of scripts meant to be dropped straight into
// `game/Submods/` (`AI_submod/monikai_actions.rpy`), with no MAS root spelling
// anywhere inside it. Such an archive maps as `Submods/<folder>/…`.
//
// The "scripts directly inside the folder" test is what keeps a GitHub source
// tree out: a zipball root (`repo-sha/`) holds README, `.github/` and a `mod/`
// directory, never scripts at its own top level.
func detectSubmodFolder(files []*zip.File) (string, bool) {
	var folder string
	for _, f := range files {
		if dirEntry(f) {
			continue
		}
		parts := strings.Split(entryPath(f.Name), "/")
		if len(parts) < 2 {
			return "", false // a loose file at the root means this is not one wrapped folder
		}
		if folder == "" {
			folder = parts[0]
		} else if parts[0] != folder {
			return "", false
		}
	}
	if folder == "" || roots[strings.ToLower(folder)] || folder == "game" || installationRoots[strings.ToLower(folder)] {
		return "", false
	}
	if looksLikeArchiveRoot(folder) {
		return "", false
	}
	for _, f := range files {
		if dirEntry(f) {
			continue
		}
		parts := strings.Split(entryPath(f.Name), "/")
		if len(parts) == 2 && isScriptName(parts[1]) {
			return folder + "/", true
		}
	}
	return "", false
}

// looksLikeArchiveRoot reports whether a folder name is the wrapper GitHub adds to
// its generated source archives (`mas-logscreen-bfbe30c`, `repo-master`). Those
// wrappers hold the repository itself, so a script sitting inside one is a source
// file, not a folder the user was told to drop into `game/Submods/`.
func looksLikeArchiveRoot(folder string) bool {
	idx := strings.LastIndex(folder, "-")
	if idx <= 0 || idx == len(folder)-1 {
		return false
	}
	suffix := strings.ToLower(folder[idx+1:])
	switch suffix {
	case "master", "main", "head", "trunk", "develop", "release":
		return true
	}
	if len(suffix) < 7 || len(suffix) > 40 {
		return false
	}
	for _, r := range suffix {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func isScriptName(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".rpy") || strings.HasSuffix(lower, ".rpym")
}

// roots and installationRoots mirror the mapping rules maspath applies; they are
// only consulted to recognise an already-valid archive, never to invent a target.
var roots = map[string]bool{"submods": true, "mod_assets": true, "python-packages": true, "gui": true, "custom_bgm": true, "piano_songs": true}
var installationRoots = map[string]bool{"lib": true, "characters": true}

func classify(target string) string {
	lower := strings.ToLower(target)
	switch {
	case strings.HasPrefix(lower, "mod_assets/monika/j/") && strings.HasSuffix(lower, ".json"):
		return "sprite_json"
	case strings.HasSuffix(lower, ".rpy"), strings.HasSuffix(lower, ".rpym"):
		return "script"
	case strings.HasSuffix(lower, ".py"), strings.HasSuffix(lower, ".pyc"):
		return "python_package"
	case strings.HasSuffix(lower, ".png"), strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"), strings.HasSuffix(lower, ".webp"), strings.HasSuffix(lower, ".ogg"), strings.HasSuffix(lower, ".mp3"):
		return "media"
	case strings.HasSuffix(lower, ".dll"), strings.HasSuffix(lower, ".exe"), strings.HasSuffix(lower, ".so"), strings.HasSuffix(lower, ".pyd"):
		return "binary"
	case strings.HasSuffix(lower, ".gift"):
		return "gift"
	default:
		return "other"
	}
}

func addConflict(report *Report, seen map[string]string, kind, value, source string) {
	if first, ok := seen[value]; ok && first != source {
		report.Conflicts = append(report.Conflicts, Conflict{kind, value, first, source})
	} else {
		seen[value] = source
	}
}
