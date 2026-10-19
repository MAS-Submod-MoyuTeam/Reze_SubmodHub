# 应用自更新系统计划

状态：待用户确认平台范围与安全策略
日期：2026-10-19

## 1. 目标

应用启动或用户手动检查更新时，从官方 GitHub Releases 获取对应平台的新版本，完成下载、完整性校验、安装替换，并在失败时保留或恢复当前版本。

当前项目已有 `internal/github` 的 Release API、资产下载与代理处理能力，以及 Wails v3 的 Windows/Android 客户端边界。本计划只增加应用自身更新能力，不改变 MAS 子模组安装流程。

## 2. 推荐架构

采用“主程序 + 独立更新器 + 平台适配”的结构。主程序不直接覆盖自身：

```text
主程序
  -> 请求官方 Releases API
  -> 选择当前平台/架构资产
  -> 下载到临时目录
  -> 校验 SHA-256 / 签名
  -> 写入更新任务
  -> 启动 updater
  -> 主程序退出

updater
  -> 等待主程序退出
  -> 备份当前程序
  -> 替换程序文件
  -> 校验新文件
  -> 启动新版本
  -> 失败时恢复备份
```

GitHub Releases 是官方发布源。服务端数据库、MAS 安装包和应用自更新资产保持职责分离。

## 3. 阶段 0：确定发布契约

- 统一 Release tag 规则，例如 `v1.2.3`。
- 定义资产命名规则：
  - `submodhub-windows-amd64.exe`
  - `submodhub-windows-arm64.exe`
  - `submodhub-android.apk`
- 编译时注入 `version`、`commit`、`build time`。
- Release 提供资产大小和 SHA-256，正式发布增加签名文件。
- 更新器只信任配置的官方仓库，不使用 Release 描述中的任意下载地址。
- 默认只检查稳定版；测试版需要显式开启。
- 不允许自动降级。

## 4. 阶段 1：更新检查与下载

建议新增：

```text
internal/updater/
  types.go
  release.go
  asset.go
  verify.go
  staging.go
```

职责：

- 获取最新稳定 Release。
- 根据 `GOOS`、`GOARCH` 和当前安装方式选择资产。
- 使用语义化版本比较当前版本与远端版本。
- 支持超时、取消、代理和网络错误。
- 下载到临时目录，禁止直接写入应用目录。
- 校验下载大小和 SHA-256。
- 预留 Ed25519 签名校验接口；正式渠道建议强制签名。
- 发布一个与平台无关的更新状态和错误模型。

## 5. 阶段 2：Windows 更新执行器

建议新增：

```text
internal/updater/windows/
  updater.go
  transaction.go
```

流程：

1. 生成更新任务文件，记录当前程序路径、版本、新版本路径、SHA-256、备份路径和目标进程 PID。
2. 启动独立 updater 进程。
3. 主程序退出。
4. updater 等待原进程结束。
5. 将当前 `.exe` 移动到备份位置。
6. 将新 `.exe` 替换到原路径。
7. 再次校验新文件。
8. 启动新版本并传递更新结果。
9. 如果替换或启动失败，恢复备份。

必须处理：

- 安装目录无写权限时返回明确错误，不静默提权。
- 只读目录、MSIX 或其他打包环境不能假设可以直接替换。
- updater 不依赖主程序的 Go 运行时。
- 更新任务格式需要版本号；未知或不兼容任务必须安全失败。
- 旧版本在新版本启动失败时仍可恢复运行。

## 6. 阶段 3：Android 更新执行器

Android 不直接覆盖正在运行的 APK，改用系统安装器：

1. 下载并校验 APK。
2. 保存到应用私有缓存或安全可访问的位置。
3. 通过 Android 原生桥启动 `PackageInstaller` 或 ACTION_VIEW 安装流程。
4. 用户确认系统安装。
5. 监听安装结果。
6. 安装失败或取消时保留旧版本可运行。

Wails Android 原生桥增加：

```text
CheckAppUpdateInstallSupport
InstallDownloadedApk
GetLastInstallResult
OpenAppUpdateSettings
```

禁止：

- 直接覆盖当前 APK。
- 使用 MAS 文件访问权限替代 APK 安装权限。
- 绕过用户确认进行静默安装。
- 将 APK 放入 MAS 游戏目录。

## 7. 阶段 4：客户端绑定与状态

在 `cmd/client/SubmodHub` 增加：

```text
CheckForAppUpdate
DownloadAppUpdate
CancelAppUpdate
InstallAppUpdate
GetAppUpdateStatus
RestartAfterUpdate
```

统一状态：

```text
idle
checking
available
downloading
verifying
ready
installing
awaiting_user
completed
failed
rolled_back
cancelled
```

需要覆盖：

- 当前版本与最新版本展示。
- Release notes。
- 下载进度。
- 校验失败、网络失败和无写权限错误。
- Windows 回滚结果。
- Android 等待系统安装确认。
- “稍后提醒”和手动检查。
- 首版不强制更新，用户确认后才安装。

## 8. 阶段 5：发布流水线

新增或更新：

```text
.github/workflows/release.yml
internal/updater/*_test.go
docs/app-update.md
```

发布流水线负责：

- 构建 Windows amd64/arm64。
- 构建 Android APK。
- 生成 SHA-256 文件。
- 可选或强制生成签名文件。
- 注入版本、提交号和构建时间。
- 校验 Release 资产命名和完整性。

## 9. 测试与验收

### Windows

- 无更新时返回稳定状态。
- 新版本可以被发现、下载和安装。
- 下载中断后可重试。
- SHA-256 错误时拒绝安装。
- 主程序退出后替换成功。
- 新程序无法启动时自动回滚。
- 安装目录无写权限时旧版本不受影响。
- 当前版本高于 Release 时不降级。
- 旧 updater 遇到未知任务字段时安全失败。

### Android

- APK 下载和 SHA-256 校验成功。
- 系统安装器能够启动。
- 用户取消安装时状态正确。
- 安装成功后能确认新版本。
- 签名不一致时拒绝安装。
- 安装失败时旧版本仍可运行。
- Android 11+ 真实设备完成验证。

## 10. 首版明确不做

- 后台静默更新。
- 自动替换用户数据或配置文件。
- 更新过程中修改 MAS 游戏目录。
- 从 GitHub Release 资产以外的地址下载。
- 自动切换测试版/开发版渠道。
- 复杂的多级 updater 自更新链路。
- 绕过 Android 系统安装确认。

## 11. 关键决策

推荐：

- GitHub Releases 作为官方发布源。
- SHA-256 必须校验，正式渠道使用 Ed25519 签名。
- Windows 使用独立 updater 进程、备份和回滚。
- Android 使用系统 APK 安装流程。
- 主程序只负责检查、下载、验证和发起更新。
- 更新失败不能影响当前已安装版本。

## 12. 待确认事项

首版平台范围需要确认：

1. Windows + Android，同时实现，符合当前项目双平台发布目标。
2. 先实现 Windows，Android 后续接入。
3. 只实现 Windows 绿色版，不考虑 MSIX/安装器环境。

该选择会改变更新执行器、发布流水线和验收范围。默认按第 1 项规划，但在用户确认前不进入代码实现。
