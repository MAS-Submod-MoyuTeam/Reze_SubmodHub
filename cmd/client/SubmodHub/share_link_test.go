package main

import (
	"strings"
	"testing"
)

// 这些断言与 ui/mod-link.test.ts 是同一组用例：两端各有一份实现，
// 规则漂移就会让「客户端分享出去的链接」在自己客户端里认不出来。
func TestParseModLinkSharesRulesWithWeb(t *testing.T) {
	cases := []struct {
		raw  string
		id   string
		want bool
	}{
		{"rezehub://mod/mod_abc123", "mod_abc123", true},
		{"REZEHUB://MOD/mod_abc123", "mod_abc123", true},
		{"rezehub://mod/mod_abc123/", "mod_abc123", true},
		{"rezehub://mod/mod_abc123?from=browser#top", "mod_abc123", true},
		{"  rezehub://mod/mod_abc123  ", "mod_abc123", true},
		{"https://rezehub.0721play.icu/mod/mod_abc123", "mod_abc123", true},
		{"http://100.72.137.92:8080/mod/mod_abc123", "mod_abc123", true},
		{"https://example.com/mod/mod_abc123/?x=1", "mod_abc123", true},
		{"", "", false},
		{"   ", "", false},
		{"plain text", "", false},
		{"mod_abc123", "", false},
		{"https://rezehub.0721play.icu/", "", false},
		{"https://rezehub.0721play.icu/mods/mod_abc123", "", false},
		{"https://rezehub.0721play.icu/mod/", "", false},
		{"https://rezehub.0721play.icu/mod/mod_abc123/extra", "", false},
		{"maica://mod/mod_abc123", "", false},
		{"rezehub://user/mod_abc123", "", false},
		{"rezehub://mod/", "", false},
		{"ftp://rezehub.0721play.icu/mod/mod_abc123", "", false},
	}
	for _, c := range cases {
		id, ok := parseModLink(c.raw)
		if ok != c.want {
			t.Fatalf("parseModLink(%q) ok=%v, want %v", c.raw, ok, c.want)
		}
		if id != c.id {
			t.Fatalf("parseModLink(%q) id=%q, want %q", c.raw, id, c.id)
		}
	}
}

func TestShareURLRoundTripsThroughItsOwnParser(t *testing.T) {
	for _, id := range []string{"mod_abc123", "mod_ab-c123", "mod_ABC_123"} {
		link := modShareURL(id)
		if got, ok := parseModLink(link); !ok || got != id {
			t.Fatalf("share link %q did not round-trip: %q ok=%v", link, got, ok)
		}
		if got, ok := parseModLink("rezehub://mod/" + id); !ok || got != id {
			t.Fatalf("deep link for %q did not round-trip: %q ok=%v", id, got, ok)
		}
	}
	if got, want := modShareURL("mod_abc123"), "https://rezehub.0721play.icu/mod/mod_abc123"; got != want {
		t.Fatalf("share url = %q, want %q", got, want)
	}
}

func TestParseModLinkRejectsUnsafeIDs(t *testing.T) {
	for _, raw := range []string{
		"https://example.com/mod/mod%20abc",
		"https://example.com/mod/%E6%A8%A1%E7%BB%84abc",
		"https://example.com/mod/" + strings.Repeat("a", 129),
	} {
		if _, ok := parseModLink(raw); ok {
			t.Fatalf("parseModLink(%q) should reject", raw)
		}
	}
}

func TestFindModLinkInArgsPicksTheLink(t *testing.T) {
	// 协议调起时 exe 自己是 argv[0]，链接在它后面；其它参数可能混进来。
	if id, ok := findModLinkInArgs([]string{`C:\app\submodhub.exe`, "rezehub://mod/mod_abc123"}); !ok || id != "mod_abc123" {
		t.Fatalf("args pick = %q ok=%v", id, ok)
	}
	if _, ok := findModLinkInArgs([]string{`C:\app\submodhub.exe`}); ok {
		t.Fatal("plain launch must not produce a link")
	}
	if _, ok := findModLinkInArgs(nil); ok {
		t.Fatal("empty args must not produce a link")
	}
}

// 注册表里 shell\open\command 的形状错了只会表现成「点链接没反应」，
// 在开发机上很难复现，所以单独锁定：exe 要带引号，链接要占一个独立参数。
func TestModProtocolCommandQuotesExeAndPassesLink(t *testing.T) {
	got := modProtocolCommand(`C:\Program Files\RezeHub\submodhub.exe`)
	want := `"C:\Program Files\RezeHub\submodhub.exe" "%1"`
	if got != want {
		t.Fatalf("protocol command = %q, want %q", got, want)
	}
}
