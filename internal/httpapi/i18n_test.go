package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Resolution walks requested language -> zh -> the first non-empty entry, so a
// half-translated catalog never renders blank.
func TestLocalizedTextResolution(t *testing.T) {
	full := LocalizedText{"zh": "中文", "en": "English"}
	if got := full.For("en"); got != "English" {
		t.Fatalf("en = %q", got)
	}
	if got := full.For("zh"); got != "中文" {
		t.Fatalf("zh = %q", got)
	}
	// A language the field does not translate falls back to zh, not to "".
	if got := full.For("ja"); got != "中文" {
		t.Fatalf("unsupported request = %q, want the zh fallback", got)
	}
	zhOnly := LocalizedText{"zh": "只有中文"}
	if got := zhOnly.For("en"); got != "只有中文" {
		t.Fatalf("empty en must fall back to zh, got %q", got)
	}
	// With no zh at all, the registry order decides deterministically.
	enOnly := LocalizedText{"en": "English only"}
	if got := enOnly.For("zh"); got != "English only" {
		t.Fatalf("missing zh must fall back to the first non-empty entry, got %q", got)
	}
	if got := LocalizedText(nil).For("en"); got != "" {
		t.Fatalf("nil value = %q", got)
	}
	if got := (LocalizedText{"zh": "   "}).For("en"); got != "" {
		t.Fatalf("blank-only value = %q", got)
	}
}

// Writes are normalized: trimmed, empty entries dropped, unknown keys rejected.
func TestNormalizeLocalizedText(t *testing.T) {
	got, err := normalizeLocalizedText("invalid_language", "摘要", LocalizedText{"zh": "  摘要  ", "en": "", " ": "x"})
	if err != nil {
		t.Fatalf("blank keys must be tolerated, got %v", err)
	}
	if len(got) != 1 || got["zh"] != "摘要" {
		t.Fatalf("normalized = %+v", got)
	}

	var v *tagViolation
	_, err = normalizeLocalizedText("invalid_language", "摘要", LocalizedText{"ja": "要約"})
	if err == nil || !strings.Contains(err.Error(), "ja") {
		t.Fatalf("unknown language must be rejected, got %v", err)
	}
	if !errors.As(err, &v) || v.code != "invalid_language" {
		t.Fatalf("error code = %#v", err)
	}
	// Case variants are a data-entry mistake, not an alias: reject instead of
	// silently normalizing, so the client sees the key it should have sent.
	if _, err := normalizeLocalizedText("invalid_language", "摘要", LocalizedText{"EN": "English"}); err == nil {
		t.Fatal("expected a non-canonical key to be rejected")
	}
	if got, err := normalizeLocalizedText("invalid_language", "摘要", nil); err != nil || got != nil {
		t.Fatalf("nil input = %+v, %v", got, err)
	}
}

// parseAcceptLanguage accepts what browsers actually send and never invents a
// locale it does not support.
func TestParseAcceptLanguage(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{"", "zh"},
		{"en", "en"},
		{"en-US", "en"},
		{"zh-CN", "zh"},
		{"zh-Hans-CN", "zh"},
		{"fr, en;q=0.9", "en"},
		{"fr-FR,de;q=0.8", "zh"},
		{"*", "zh"},
		{"EN", "en"},
	} {
		if got := parseAcceptLanguage(tc.raw); got != tc.want {
			t.Fatalf("parseAcceptLanguage(%q) = %q, want %q", tc.raw, got, tc.want)
		}
	}
}

// ?lang= wins over Accept-Language, and the resolved value is always one of the
// supported languages.
func TestResolveLanguage(t *testing.T) {
	cases := []struct {
		name   string
		target string
		header string
		want   string
	}{
		{"no hint", "/api/v1/mods", "", "zh"},
		{"query", "/api/v1/mods?lang=en", "", "en"},
		{"header", "/api/v1/mods", "en-US,en;q=0.9", "en"},
		{"query beats header", "/api/v1/mods?lang=zh", "en-US,en;q=0.9", "zh"},
		{"unknown query", "/api/v1/mods?lang=ja", "en", "zh"},
		{"blank query falls through", "/api/v1/mods?lang=", "en", "en"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, tc.target, nil)
			if tc.header != "" {
				r.Header.Set("Accept-Language", tc.header)
			}
			if got := resolveLanguage(r); got != tc.want {
				t.Fatalf("resolveLanguage = %q, want %q", got, tc.want)
			}
		})
	}
}

// The persisted shape is a plain object, and an untranslated field is omitted
// instead of being stored as "".
func TestLocalizedTextJSONShape(t *testing.T) {
	encoded, err := json.Marshal(Mod{
		ID:          "mod_1",
		Title:       "Rain",
		Summary:     LocalizedText{"zh": "雨", "en": "Rain"},
		Description: LocalizedText{"zh": "说明"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	summary, ok := decoded["summary"].(map[string]any)
	if !ok {
		t.Fatalf("summary is not an object: %s", encoded)
	}
	if summary["zh"] != "雨" || summary["en"] != "Rain" {
		t.Fatalf("summary = %+v", summary)
	}
	description, ok := decoded["description"].(map[string]any)
	if !ok || description["zh"] != "说明" {
		t.Fatalf("description = %+v", decoded["description"])
	}
	if _, present := description["en"]; present {
		t.Fatalf("an empty translation must not be persisted: %+v", description)
	}
	// Title stays a plain string: it is the mod's identity, not localized text.
	if title, ok := decoded["title"].(string); !ok || title != "Rain" {
		t.Fatalf("title = %+v, want a plain string", decoded["title"])
	}

	// A mod without any text omits both fields rather than emitting nulls.
	encoded, err = json.Marshal(Mod{ID: "mod_2", Title: "Bare"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"summary"`) || strings.Contains(string(encoded), `"description"`) {
		t.Fatalf("empty localized fields must be omitted: %s", encoded)
	}
}
