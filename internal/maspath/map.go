package maspath

import (
	"fmt"
	"path"
	"strings"
	"unicode"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

var roots = map[string]bool{"Submods": true, "mod_assets": true, "python-packages": true, "gui": true, "custom_bgm": true, "piano_songs": true}
var devices = map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true}

// Validate returns the NFC path and its Windows-insensitive collision key.
func Validate(name string) (string, string, error) {
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") || !norm.NFC.IsNormalString(name) && strings.ContainsRune(name, '\x00') {
		return "", "", fmt.Errorf("invalid ZIP path %q", name)
	}
	for _, segment := range strings.Split(name, "/") {
		if segment == "" || segment == "." || segment == ".." || strings.TrimRight(segment, " .") != segment {
			return "", "", fmt.Errorf("invalid ZIP path %q", name)
		}
		for _, r := range segment {
			if unicode.IsControl(r) || strings.ContainsRune(`:<>"|?*`, r) {
				return "", "", fmt.Errorf("invalid ZIP path %q", name)
			}
		}
		stem := strings.ToUpper(strings.SplitN(segment, ".", 2)[0])
		if devices[stem] || len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9' {
			return "", "", fmt.Errorf("device path %q", name)
		}
	}
	normal := norm.NFC.String(name)
	return normal, cases.Fold().String(normal), nil
}

// MapLegacyPath maps one validated ZIP file relative to its detected package root.
func MapLegacyPath(name string) (string, bool, error) {
	normal, _, err := Validate(name)
	if err != nil { return "", false, err }
	parts := strings.Split(normal, "/")
	if parts[0] == "game" {
		if len(parts) < 3 { return "", false, nil }
		parts = parts[1:]
	}
	if roots[parts[0]] && len(parts) > 1 { return path.Join(parts...), true, nil }
	if len(parts) == 1 && (strings.HasSuffix(strings.ToLower(parts[0]), ".rpy") || strings.HasSuffix(strings.ToLower(parts[0]), ".rpym")) {
		return path.Join("Submods/UnGroupScripts", parts[0]), true, nil
	}
	return "", false, nil
}
