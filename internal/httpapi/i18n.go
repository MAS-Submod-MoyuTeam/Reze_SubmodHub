package httpapi

import (
	"net/http"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// The hub is bilingual: Simplified Chinese is the language the catalog is
// authored in and therefore the fallback for every localized field, English is
// the only other supported language for now. The registry is deliberately tiny
// — a client either gets one of these two or the default one, so no reader has
// to reason about partially translated locales.
var SupportedLanguages = []string{"zh", "en"}

// DefaultLanguage is both the authoring language and the fallback: a mod or tag
// with no English text still has to render for an English client.
const DefaultLanguage = "zh"

// LocalizedText is one piece of user-visible text per supported language,
// persisted as a plain JSON object: {"zh": "...", "en": "..."}. A missing or
// empty entry means "not translated", never "empty string" — normalize removes
// those, so For can treat "" and absent identically.
type LocalizedText map[string]string

// isSupportedLanguage reports whether lang names a language the hub stores.
func isSupportedLanguage(lang string) bool {
	return slices.Contains(SupportedLanguages, lang)
}

// For resolves the text for one reader: the requested language when it has a
// value, otherwise the default language, otherwise the first non-empty entry in
// registry order. Empty only when every entry is empty.
func (t LocalizedText) For(lang string) string {
	if lang != "" {
		if text := strings.TrimSpace(t[lang]); text != "" {
			return text
		}
	}
	if text := strings.TrimSpace(t[DefaultLanguage]); text != "" {
		return text
	}
	for _, supported := range SupportedLanguages {
		if text := strings.TrimSpace(t[supported]); text != "" {
			return text
		}
	}
	return ""
}

// Empty reports whether the value carries no text at all.
func (t LocalizedText) Empty() bool {
	for _, text := range t {
		if strings.TrimSpace(text) != "" {
			return false
		}
	}
	return true
}

// clone returns an independent copy, so a stored value cannot be mutated through
// a map handed to a response handler.
func (t LocalizedText) clone() LocalizedText {
	if t == nil {
		return nil
	}
	out := make(LocalizedText, len(t))
	for lang, text := range t {
		out[lang] = text
	}
	return out
}

// normalizeLocalizedText validates one author-supplied value: every key has to
// be a supported language (an unknown key would be stored and then silently
// never rendered, which is worse than a 400), values are trimmed and empties are
// dropped. A nil or empty result is valid — not every field is bilingual.
func normalizeLocalizedText(code, field string, input LocalizedText) (LocalizedText, error) {
	if len(input) == 0 {
		return nil, nil
	}
	out := make(LocalizedText, len(input))
	for lang, raw := range input {
		key := strings.ToLower(strings.TrimSpace(lang))
		text := strings.TrimSpace(raw)
		// A blank entry is "not written in this language", the same as a missing
		// key. Drop it before judging the key: refusing `{" ": "…"}` would reject
		// an empty textarea for a language nobody typed in.
		if key == "" || text == "" {
			continue
		}
		if key != lang {
			return nil, violation(code, "%s 的语言标识 %q 无效（支持 %s）", field, lang, strings.Join(SupportedLanguages, "/"))
		}
		if !isSupportedLanguage(key) {
			return nil, violation(code, "%s 的语言 %q 不受支持（支持 %s）", field, lang, strings.Join(SupportedLanguages, "/"))
		}
		out[key] = text
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// normalizeLocalizedRunes is normalizeLocalizedText plus a per-language length
// budget: the limit applies to every entry, not to the value as a whole, so a
// translation cannot be squeezed in by keeping the other language short.
func normalizeLocalizedRunes(code, field string, input LocalizedText, limit int) (LocalizedText, error) {
	out, err := normalizeLocalizedText(code, field, input)
	if err != nil {
		return nil, err
	}
	for _, lang := range SupportedLanguages {
		text, ok := out[lang]
		if !ok {
			continue
		}
		if utf8.RuneCountInString(text) > limit {
			return nil, violation(code, "%s（%s）最多 %d 个字符", field, lang, limit)
		}
		for _, r := range text {
			if unicode.IsControl(r) {
				return nil, violation(code, "%s 不能包含换行等控制字符", field)
			}
		}
	}
	return out, nil
}

// hasUnknownLanguage reports whether the value carries any key outside the
// supported set, which is what turns a stored read into a data problem.
func (t LocalizedText) hasUnknownLanguage() bool {
	for lang := range t {
		if !isSupportedLanguage(lang) {
			return true
		}
	}
	return false
}

// searchText joins every language entry so a text search matches a mod whether
// the reader typed the Chinese summary or the English one.
func (t LocalizedText) searchText() string {
	parts := make([]string, 0, len(t))
	for _, lang := range SupportedLanguages {
		if text := strings.TrimSpace(t[lang]); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, " ")
}

// parseAcceptLanguage maps an incoming language preference to a supported
// language. It accepts the shapes a browser actually sends — "en", "en-US",
// "zh-Hans-CN", "fr, en;q=0.9" — and returns DefaultLanguage when nothing
// matches, so a resolution never fails and never invents a locale.
func parseAcceptLanguage(raw string) string {
	for _, part := range strings.Split(raw, ",") {
		// The q-value only orders the entries; the first entry that resolves
		// already wins, which matches how a single-value ?lang= behaves.
		tag := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		if tag == "" || tag == "*" {
			continue
		}
		base := strings.ToLower(strings.SplitN(tag, "-", 2)[0])
		if isSupportedLanguage(base) {
			return base
		}
	}
	return DefaultLanguage
}

// resolveLanguage resolves the reader's language for one request: an explicit
// ?lang= wins over Accept-Language, and anything unrecognized falls back to the
// default. The return value is always a supported language.
func resolveLanguage(r *http.Request) string {
	if raw := strings.TrimSpace(r.URL.Query().Get("lang")); raw != "" {
		return parseAcceptLanguage(raw)
	}
	return parseAcceptLanguage(r.Header.Get("Accept-Language"))
}
