package main

import (
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// masRunFile 是 MAS 自己在 splash 阶段写下的版本标记，位于 `game/` 下。
// 内容来自 MAS 的 `Monika After Story/game/splash.rpy`：
//
//	with open(basedir + "/game/masrun", "w") as versfile:
//	    versfile.write(config.name + "|" + config.version + "\n")
//
// 即 `名称|版本` 单行，每次启动都会重写，Windows 下经 Python 文本模式落成 CRLF。
// 它只在 MAS 至少运行过一次之后才存在，因此缺失不能当作目录异常。
const masRunFile = "masrun"

// masRunReadLimit 只是防御异常文件；真实内容不到 50 字节。
const masRunReadLimit = 512

// masVersionPattern 覆盖 `0.12.15`、`0.12.15-2`、`0.13.0.post1` 这类写法，
// 同时把夹着空格的说明文字（例如只有名称的那一行）判为无效。
var masVersionPattern = regexp.MustCompile(`^[0-9][0-9A-Za-z._+-]{0,39}$`)

// readMASVersion 读取 game/ 下的 masrun 并返回其中的 MAS 版本。
// 文件缺失、不是普通文件、不可读或内容不认识时返回空串，由调用方显示“未检测”。
func readMASVersion(gameDir string) string {
	path := filepath.Join(gameDir, masRunFile)
	// 只接受普通文件：目录或设备之类的同名对象没有版本可读，
	// 而打开管道会一直卡在 UI 调用链上的 ListMASInstances 里。
	if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
		return ""
	}

	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer func() { _ = file.Close() }()

	data, err := io.ReadAll(io.LimitReader(file, masRunReadLimit))
	if err != nil {
		return ""
	}
	return parseMASRunVersion(string(data))
}

// parseMASRunVersion 解析 masrun 的内容。MAS 写的是单行 `名称|版本`；
// 这里同时兼容只写版本、带 UTF-8 BOM 以及 CRLF 行尾的变体。
func parseMASRunVersion(raw string) string {
	line := strings.TrimSpace(strings.TrimPrefix(raw, "\ufeff"))
	if index := strings.IndexAny(line, "\r\n"); index >= 0 {
		line = line[:index]
	}
	// 名称本身可能含分隔符，版本永远在最后一个 `|` 之后。
	if index := strings.LastIndex(line, "|"); index >= 0 {
		line = line[index+1:]
	}

	version := strings.TrimSpace(line)
	if !masVersionPattern.MatchString(version) {
		return ""
	}
	return version
}
