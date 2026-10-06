package packagezip

import (
	"regexp"
	"strings"
)

var registrationPattern = regexp.MustCompile(`(?m)^[ \t]*(?:[A-Za-z_]\w*[ \t]*=[ \t]*)?(?:store\.mas_submod_utils\.)?Submod[ \t]*\(`)
var literalFieldPattern = regexp.MustCompile(`(?:^|,)\s*(author|name|version)\s*=\s*(["'])([^"'\r\n]{0,256})["']`)
var dependenciesPattern = regexp.MustCompile(`\bdependencies\s*=\s*`)
var literalDependencyPattern = regexp.MustCompile(`^\s*(["'])([^"'\r\n]+)["']\s*:\s*\(\s*(None|["'][^"'\r\n]*["'])\s*,\s*(None|["'][^"'\r\n]*["'])\s*\)\s*$`)
var tripleStringPattern = regexp.MustCompile(`(?s)""".*?"""|'''.*?'''`)

func parseSubmods(source string, data []byte) []Registration {
	if len(data) > 2<<20 {
		return []Registration{{Source: source, Unknown: true}}
	}
	var out []Registration
	code := tripleStringPattern.ReplaceAllStringFunc(string(data), func(value string) string {
		return strings.Map(func(char rune) rune {
			if char == '\n' {
				return char
			}
			return ' '
		}, value)
	})
	for _, location := range registrationPattern.FindAllStringIndex(code, 128) {
		reg := Registration{Source: source}
		fields, ok := balancedContent(code, location[1]-1, '(', ')')
		if !ok {
			continue
		}
		for _, field := range literalFieldPattern.FindAllStringSubmatch(fields, -1) {
			if field[1] == "author" {
				reg.Author = field[3]
			} else if field[1] == "name" {
				reg.Name = field[3]
			} else {
				reg.Version = field[3]
			}
		}
		if location := dependenciesPattern.FindStringIndex(fields); location != nil {
			start := location[1]
			for start < len(fields) && (fields[start] == ' ' || fields[start] == '\n' || fields[start] == '\t') {
				start++
			}
			if start >= len(fields) || fields[start] != '{' {
				reg.DependenciesUnknown = true
			} else if body, complete := balancedContent(fields, start, '{', '}'); complete {
				for _, item := range splitTopLevel(body, ',') {
					// A tuple contains a comma; splitTopLevel keeps it intact.
					if strings.TrimSpace(item) == "" {
						continue
					}
					match := literalDependencyPattern.FindStringSubmatch(item)
					if match == nil {
						reg.DependenciesUnknown = true
						continue
					}
					reg.Dependencies = append(reg.Dependencies, SubmodDependency{Name: match[2], Minimum: dependencyBound(match[3]), Maximum: dependencyBound(match[4])})
				}
			} else {
				reg.DependenciesUnknown = true
			}
		}
		reg.Unknown = reg.Name == ""
		out = append(out, reg)
	}
	return out
}

func dependencyBound(value string) string {
	if value == "None" {
		return ""
	}
	return value[1 : len(value)-1]
}

func balancedContent(source string, start int, open, close byte) (string, bool) {
	if start >= len(source) || source[start] != open {
		return "", false
	}
	depth, quote, escaped := 0, byte(0), false
	for i := start; i < len(source); i++ {
		c := source[i]
		if quote != 0 {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == quote {
				quote = 0
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
		} else if c == open {
			depth++
		} else if c == close {
			depth--
			if depth == 0 {
				return source[start+1 : i], true
			}
		}
	}
	return "", false
}

func splitTopLevel(source string, separator byte) []string {
	var parts []string
	start, depth, quote := 0, 0, byte(0)
	for i := 0; i < len(source); i++ {
		switch source[i] {
		case '\'', '"':
			if quote == 0 {
				quote = source[i]
			} else if quote == source[i] {
				quote = 0
			}
		case '(', '{', '[':
			if quote == 0 {
				depth++
			}
		case ')', '}', ']':
			if quote == 0 {
				depth--
			}
		default:
			if source[i] == separator && quote == 0 && depth == 0 {
				parts = append(parts, source[start:i])
				start = i + 1
			}
		}
	}
	return append(parts, source[start:])
}
