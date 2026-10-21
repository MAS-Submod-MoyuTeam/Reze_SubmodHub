# 版本号系统

SubmodHub 目前处于 `0.9.x` 快速迭代阶段。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH`。

## 单一来源

仓库根目录的 [`VERSION`](../VERSION) 文件是唯一权威来源，当前为：

```text
0.9.0
```

其他位置由脚本同步或读取，不要单独手改：

| 位置 | 用途 | 同步方式 |
| --- | --- | --- |
| `internal/version/version.go` | Go 二进制内嵌版本（API 服务端、健康检查） | `cmd/version -set` |
| `cmd/client/SubmodHub/build/config.yml` | Wails 应用元数据 | `cmd/version -set` |
| `cmd/client/SubmodHub/build/windows/info.json` | Windows 可执行文件版本资源 | `cmd/version -set` |
| `cmd/client/SubmodHub/build/windows/nsis/wails_tools.nsh` | NSIS 安装包版本 | `cmd/version -set` |
| `cmd/client/SubmodHub/build/{darwin,ios}/Info*.plist` | macOS / iOS 包版本 | `cmd/version -set` |
| `cmd/client/SubmodHub/build/android/app/build.gradle` | Android `versionName` / `versionCode` | 构建时读取 `VERSION`（或 `SUBMODHUB_VERSION`） |
| `clients/desktop`、`web` 前端 | 界面左下角 / 标题后的 `vX.Y.Z` | Vite 构建时读取 `VERSION` |

Android 的 `versionCode` 由版本号推导：`MAJOR * 10000 + MINOR * 100 + PATCH`（因此各段必须 ≤ 99；计算时会忽略 `+build.5` 这类构建元数据和 `-beta.1` 这类预发布后缀）。

## 命令

```bash
# 查看当前版本
go run ./cmd/version

# 查看构建元数据（JSON）
go run ./cmd/version -json

# 校验 VERSION 与所有派生文件是否一致（CI 会执行）
go run ./cmd/version -check

# 升级版本：同时更新 VERSION 和所有派生文件
go run ./cmd/version -set 0.9.1
```

升级版本的推荐流程：

1. `go run ./cmd/version -set 0.9.1`
2. 提交改动并推送到 `main`。
3. CI 构建 Windows / Android 客户端；若 `v0.9.1` 还没有对应的 GitHub Release，则自动创建并附加构建产物。

## 版本号出现的位置

- **API**：`GET /api/v1/version` 返回版本号，以及可选的 `commit` / `build_time`，并附带 `go_version`、`platform`；`GET /healthz` 也会带上 `version`。
- **桌面 / Android 客户端**：桌面端标题栏与侧边栏、Android 端标题栏显示 `vX.Y.Z`。
- **Web 控制台**：顶部导航品牌名旁显示 `vX.Y.Z`。
- **Windows**：`SubmodHub.exe` 的文件属性使用 `build/windows/info.json` 中的版本。
- **Android**：APK 的 `versionName` 为版本号，`versionCode` 由版本号推导，可在系统应用信息中看到。

## GitHub Actions

工作流：[`.github/workflows/build-clients.yml`](../.github/workflows/build-clients.yml)

- 触发条件：推送到 `main`、手动 `workflow_dispatch`。
- 任务顺序：解析版本并校验元数据 → 构建 Windows 客户端 → 构建 Android 客户端 → 发布检查。
- **无论 Release 是否已存在**，两个客户端产物都会上传为本次 workflow run 的 artifact（保留 30 天）。
- 发布任务会检查 `vX.Y.Z` Release：
  - 不存在 → 以当前提交创建 Release，并附加 `submodhub-windows-amd64.exe` 和 `submodhub-android-arm64-X.Y.Z.apk`；
  - 已存在 → 不改动 Release，只保留 workflow artifact。
- Release 正文的「更新内容」自动取自两次版本之间的提交标题：
  - 上一版本由 `git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude <当前 tag> HEAD^` 解析，区间为 `<上一 tag>..HEAD`；
  - 每个非 merge 提交取标题（`%s`）作为一条列表项，`chore(version)` 提交被过滤（与 Release 标题重复）；
  - 尚无更早版本标签时，回退为最近 20 条提交；
  - 因此提交标题按 Conventional Commits 写清楚即可直接成为发布说明，无需手写 changelog。
- 同一分支的构建串行执行，避免两个运行同时创建同一个 Release。

产物命名：

```text
submodhub-windows-amd64.exe            # 独立可执行文件，文件名不含版本号，下载后直接运行
submodhub-android-arm64-<version>.apk   # arm64 真机安装包
```

## Android 签名 Secrets

Android 客户端必须使用**固定 keystore** 签名。否则每次 CI 运行都会生成新的 debug keystore，导致后续版本无法覆盖安装（用户只能卸载旧版，可能丢失本地数据）。

在仓库 `Settings → Secrets and variables → Actions` 中添加：

| Secret | 说明 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | release keystore 文件的 Base64（单行） |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 签名 key 的 alias |
| `ANDROID_KEY_PASSWORD` | 签名 key 的密码 |

生成 Base64：

```bash
# Linux
base64 -w0 release.keystore
# macOS
base64 -i release.keystore | tr -d '\n'
```

工作流在构建前将 keystore 解码到 `$RUNNER_TEMP`，用 `keytool` 校验密码与 alias；构建后用 `apksigner` 检查签名并拒绝 debug 签名；任务结束时删除临时 keystore。**缺少任一 Secret 时 Android 任务会直接失败**，避免发布无法升级的 APK。

本地构建未设置 `ANDROID_KEYSTORE_FILE` 时仍会退回 debug 签名，仅供测试，不要用于分发。

## 常见问题

- **CI 报 `version metadata is out of sync`**：说明有人只改了 `VERSION` 或某个派生文件。运行 `go run ./cmd/version -set <VERSION 中的版本>` 后重新提交。
- **只想构建、不想发 Release**：Release 只在 `main` 分支且该版本尚无 Release 时创建；日常向 `main` 推送若版本未变化，只会产生 artifact。
- **Android CI 报缺少签名 Secrets**：按上一节配置 4 个 Secrets；本地测试可继续使用 debug 签名。
