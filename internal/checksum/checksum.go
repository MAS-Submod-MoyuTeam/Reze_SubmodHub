// Package checksum parses the SHA-256 listings published next to release
// assets. The API server and the desktop updater share this single parser so a
// checksum file cannot be read two different ways.
package checksum

import (
	"regexp"
	"strings"
)

var sha256Hex = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Parse reads a SHA256SUMS.txt body. Lines are `<hash> <filename>` or
// `<hash> *<filename>`; blank lines and `#` comments are ignored. Only
// lowercase-validated 64-character hex digests are kept, so a malformed listing
// can never be mistaken for a verified expectation.
func Parse(content string) map[string]string {
	result := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		hash := strings.ToLower(fields[0])
		name := strings.TrimPrefix(fields[1], "*")
		if !sha256Hex.MatchString(hash) || name == "" {
			continue
		}
		result[name] = hash
	}
	return result
}
