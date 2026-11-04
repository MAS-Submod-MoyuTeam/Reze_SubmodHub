//go:build !windows

package main

// 非 Windows 平台没有 HKCU 注册表这一套：macOS 靠 Info.plist、Linux 靠
// xdg desktop entry，Android 靠 AndroidManifest 的 intent-filter。
// 这几处都由各自的分发产物声明，这里保持 no-op，让启动路径只有一条。
func registerModProtocol() {}
