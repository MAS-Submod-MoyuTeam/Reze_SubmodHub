package main

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

// 站内 mod 链接的 Go 侧规则，必须与 ui/mod-link.ts 完全一致：
// 客户端拿启动参数、拿剪贴板文本时判别的就是这同一组字符串形状。
// 只有两种链接算站内链接：
//
//   - rezehub://mod/<mod_id>      系统 / 浏览器用来调起客户端的协议链接
//   - https://<任意站点>/mod/<id> 可以粘到浏览器、也能被交回客户端的分享链接
//
// origin 刻意不校验：客户端可能指向自建/测试服务器（SUBMODHUB_API_URL），
// 把 origin 写死会让那些实例分享出来的链接在自己客户端里认不出来。
// 真正的判别条件是「路径就是 /mod/<一个合法 id>」。
const (
	modLinkScheme = "rezehub"
	modLinkHost   = "mod"
	// shareLinkSite 是分享链接的默认落点，与 web 端 modShareURL 的默认值一致。
	shareLinkSite = "https://rezehub.0721play.icu"
	modPathPrefix = "/mod/"
)

var modIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// errInvalidModID 表示调用方给的 id 形状不对，而不是「找不到该模组」。
var errInvalidModID = errors.New("invalid_mod_id")

// isModID 只校验形状，不猜服务端的生成格式（现在是 mod_ + 12 位随机串）。
func isModID(value string) bool {
	return modIDPattern.MatchString(value)
}

func normalizeModIDSegment(segment string) (string, bool) {
	id := strings.Trim(segment, "/")
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	if !isModID(id) {
		return "", false
	}
	return id, true
}

// parseModLink 从一条链接取出 mod_id；不是站内链接就返回 ok=false，不报错。
// 跳转失败、剪贴板里放着别的东西都是常态，调用方只需要「有没有 id」。
func parseModLink(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", false
	}
	switch strings.ToLower(parsed.Scheme) {
	case modLinkScheme:
		// 协议链接里 host 段承载的是「这是个 mod 链接」。
		if !strings.EqualFold(parsed.Host, modLinkHost) {
			return "", false
		}
		return normalizeModIDSegment(parsed.Path)
	case "http", "https":
		if !strings.HasPrefix(parsed.Path, modPathPrefix) {
			return "", false
		}
		return normalizeModIDSegment(strings.TrimPrefix(parsed.Path, modPathPrefix))
	default:
		return "", false
	}
}

// findModLinkInArgs 在启动参数里找第一条站内链接。
// 协议调起的链接一定在 argv 里（Windows/Linux 由系统追加，macOS 由 wails 单实例补上）。
func findModLinkInArgs(args []string) (string, bool) {
	for _, arg := range args {
		if id, ok := parseModLink(arg); ok {
			return id, true
		}
	}
	return "", false
}

// modShareURL 是写进剪贴板、可以粘到浏览器里的分享链接。
func modShareURL(modID string) string {
	return strings.TrimRight(shareLinkSite, "/") + modPathPrefix + url.PathEscape(modID)
}

// modProtocolCommand 是注册表里 `shell\open\command` 该写的值。
//
// 单独拆出来是为了能在任何平台上测试它的形状：这段字符串一旦写错（少了引号、
// 少了 %1），系统就会启动一个不带链接的客户端，或者干脆什么都不启动，而这类
// 故障在开发机上不容易复现。
func modProtocolCommand(exePath string) string {
	return `"` + exePath + `" "%1"`
}
