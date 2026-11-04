//go:build windows

package main

import (
	"log"
	"os"

	"golang.org/x/sys/windows/registry"
)

// ensureModProtocolRegistration 让 `rezehub://mod/<id>` 能被系统交给本程序。
//
// 写在 HKCU 下而不是 HKLM：HKCU 不需要管理员权限，用户级安装、绿色版解压即用
// 都能生效；重复执行是幂等的（后写的值覆盖先写的值），所以每次启动都写一遍，
// 程序被移动或改名后协议会自动指向新位置。
//
// NSIS 安装包也会写同一个键（build/config.yml 的 protocols），两处写的是同一份
// 声明：安装器保证卸载时清理，这里的启动自愈保证开发/绿色版也能用。
func ensureModProtocolRegistration(exePath string) error {
	if exePath == "" {
		exePath, _ = os.Executable()
	}
	if exePath == "" {
		return nil
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+modLinkScheme, registry.ALL_ACCESS)
	if err != nil {
		return err
	}
	defer key.Close()

	// 这几个值就是 Windows 判定「这是一个 URL 协议处理器」的全部要求。
	values := []struct{ name, value string }{
		{"", "URL:" + modLinkScheme + " Protocol"},
		{"URL Protocol", ""},
	}
	for _, v := range values {
		if err := key.SetStringValue(v.name, v.value); err != nil {
			return err
		}
	}
	commandKey, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+modLinkScheme+`\shell\open\command`, registry.ALL_ACCESS)
	if err != nil {
		return err
	}
	defer commandKey.Close()
	// %1 会被系统替换成完整链接；引号保证带空格的安装路径也能启动。
	return commandKey.SetStringValue("", modProtocolCommand(exePath))
}

// registerModProtocol 是启动路径上的调用点：协议注册失败不能拖垮启动，
// 用户手动打开链接时会表现为「没有反应」，而不是程序起不来。
func registerModProtocol() {
	if err := ensureModProtocolRegistration(""); err != nil {
		log.Printf("Mod link protocol registration: %v", err)
	}
}
