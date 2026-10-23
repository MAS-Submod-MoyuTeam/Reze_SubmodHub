# 应用自更新纳入 Cloudreve 节点交付计划

状态：已实施（2026-10-23；本地自动测试与静态检查全绿，未对测试服部署或真机验收）

## 1. 目标与验收

用户诉求：客户端「内置更新下载」也要支持 Cloudreve 节点下载，不再只能走 GitHub 直连。

已确认的两条边界（对话内确认）：

1. 资产来源：主 API 用现有 GitHub 客户端读取应用仓库最新 Release，把自更新资产镜像到已启用的 Cloudreve 节点，并对外暴露一条「应用更新描述」接口。
2. 检查权威：主 API 是更新检查权威。客户端先问主 API 要版本/说明/资产交付计划，GitHub 直连保留为回落。

验收（用户可见）：

1. `GET /api/v1/app-update` 返回最新稳定版 `tag_name/version/notes` 与逐资产交付计划 `{name,size_bytes,sha256,delivery_type,node_id,url,expires_at,allowed_download_origins,github_url}`，`Cache-Control: no-store`。
2. 有已验证镜像时该资产 `delivery_type = "cloudreve"` 且 `url` 为签名直链；否则 `delivery_type = "github"`、`url = github_url`，客户端行为与今天一致。
3. 客户端自更新在 API 可达时以 API 返回版本为准：即使 GitHub 已有更高版本，只要 API 说「当前就是最新」就不提示更新。
4. 客户端下载优先用描述里的 Cloudreve 直链；失败/过期时重新取一次描述并重试一次，仍失败才回落 GitHub 直连；无论走哪条路都必须通过发布哈希校验。
5. 更新弹窗显示下载源（Cloudreve 节点名 / GitHub Releases）。
6. 管理端节点卡片新增「软件更新缓存」计数，可与「镜像缓存」分开看，失败任务同样被「重试失败镜像」覆盖。

## 2. 现状基线

| 关注点 | 位置 | 改造前 |
| --- | --- | --- |
| 更新检查 | `internal/updater/release.go:78-193` | 只读 GitHub Releases，按 `IncludePrerelease` 过滤 |
| 下载 | `internal/updater/release.go:196-384` | 主资产/`updater.exe` 都走 `StageManager.DownloadArchive`（GitHub 客户端 + 代理） |
| 哈希权威 | `internal/updater/verify.go` | 从 `SHA256SUMS.txt` 解析；`ParseChecksums` 是唯一解析器 |
| 镜像 worker | `internal/httpapi/archive_mirrors.go` | 只管站内普通包；全局并发 1、15 秒 tick、8 次退避、ready 前无 Cookie 读回校验 |
| 节点状态 | `internal/httpapi/delivery_settings.go` | `mirror_states` 只统计归档镜像 |
| 交付描述 | `internal/httpapi/delivery.go` | `resolveDelivery` 只处理版本归档；应用自更新明确排除 |
| 客户端 origin 策略 | `cmd/client/SubmodHub/archive_delivery_policy.go` | 客户端私有实现，无法在服务端之外的模块复用 |
| 仓库坐标 | `internal/updater/types.go` | `DefaultRepoOwner/Name` 只服务 updater，`httpapi` 不能反向依赖 |

**Change Necessity**：只改客户端无法实现「由节点交付」——节点镜像需要服务端上传、读回校验与签名解析；只改服务端也无法生效——客户端仍会自行从 GitHub 选版本、下载。最小代码边界 = 服务端新增应用资产镜像 + 一条公开描述接口，客户端把「检查/下载」改为「先问 API、失败回落 GitHub」，并把 origin 策略下沉为共享包。

**Ripple Signal Triage**：命中「公共契约（新端点）+ 持久化（新增镜像行）+ 跨模块（HTTP API ↔ 桌面客户端）+ 既有 ADR 边界修订」。权威 owner：版本/哈希 = GitHub Release 的 `SHA256SUMS.txt`；交付计划 = 主 API；下载策略 = `internal/delivery`。下游消费者 = 桌面自更新（Windows/Android）、管理端节点卡片。

## 3. 服务端设计

### 3.1 数据模型（无新表）

```go
// Catalog 新增一段，沿用 catalog.json / catalog_snapshot 单行 jsonb
AppAssetMirrors []AppAssetMirror `json:"app_asset_mirrors,omitempty"`

type AppAssetMirror struct {
	NodeID       string
	NodeRevision uint64
	Tag          string
	AssetName    string
	SHA256       string
	SizeBytes    int64
	ObjectName   string
	FileID       string
	State        string // pending/uploading/ready/failed
	Attempts     int
	RetryAt      time.Time
	ErrorCode    string
}
```

主键语义 = `(node_id, node_revision, tag, asset_name)`；不引入 SQL 迁移。

### 3.2 发布发现与镜像

- `internal/version` 新增 `RepoOwner/RepoName`，`updater.DefaultRepoOwner/Name` 改为别名，`httpapi` 只依赖 `internal/version`。
- `internal/checksum.Parse` 成为 `SHA256SUMS.txt` 唯一解析器（带 64 位 hex 校验），`updater.ParseChecksums` 委托它。
- 应用发布缓存：GitHub Release 列表 + 校验映射，`refreshing` 单飞；成功 10 分钟、失败 2 分钟后重取。worker 只触发后台刷新（`kickAppReleaseRefresh`），绝不阻塞归档镜像。
- 可镜像资产 = `.exe`/`.apk`、大小 ≤128 MiB、且 `SHA256SUMS.txt` 给出哈希。无哈希资产一律不镜像（服务端无法自证），客户端继续走 GitHub。
- 镜像行按「当前 tag × 启用 Cloudreve 节点 × 候选资产」对账；旧 tag 或已删除节点的行回收，云端对象不删除。
- 上传复用归档镜像的同一 worker（全局并发 1）：先 GitHub 下载到临时文件并核对发布哈希，再 `Upload`、`Download`、无 Cookie 读回校验，通过才 `ready`；失败指数退避、最多 8 次，校验失败换新对象名。

### 3.3 公开描述 `GET /api/v1/app-update`

```
{
  "tag_name": "v0.9.12", "version": "0.9.12", "name": "...", "notes": "...",
  "prerelease": false, "published_at": "...", "checksum_url": "https://github.com/.../SHA256SUMS.txt",
  "assets": [{ "name": "submodhub-windows-amd64.exe", "size_bytes": 123, "sha256": "...",
               "delivery_type": "cloudreve", "node_id": "cloud-a", "url": "https://...sign=...",
               "expires_at": "...", "allowed_download_origins": ["https://..."],
               "github_url": "https://github.com/..." }]
}
```

- 只用已 `ready` 且 `sha256/size` 与描述一致的镜像；链有效期沿用 `minTime(expiry-15s, now+5m)`。
- 无可用镜像 → 该资产回落 `github`，不返回 `builtin`（本范围不做字节代理）。
- 元数据未就绪 → `503 app_release_unavailable`，客户端回落 GitHub。
- `github_relay` 节点不参与应用资产交付。

## 4. 客户端设计

- `updater.Config.APIBaseURL` + `Service.SetAPIBaseURL`（原子值，`DesktopService.SetAPIURL` 同步转发；`SUBMODHUB_API_URL` 决定初值）。
- `CheckForUpdate`：`IncludePrerelease` 或未配置 API → 直接 GitHub；否则先 `checkViaAPI`，成功即返回（`nil` = 无新版，不再问 GitHub），失败才回落 `checkViaGitHub`。
- `AssetInfo.Delivery = {Type,URL,NodeID,ExpiresAt,AllowedOrigins,ExpectedSHA256}`；`ExpectedSHA256` 直接来自描述，因此 Cloudreve 路径不需要再拉 `SHA256SUMS.txt`。
- `downloadAsset`：Cloudreve 直链 → 失败（含过期）重取一次描述再试 → 仍失败用 `BrowserDownloadURL` 走 GitHub；每次改动都通过 `delivery.ValidateOriginURL` + `delivery.NewOriginClient`（无 Cookie、无环境代理、逐跳校验）。
- `State` 增 `delivery_source`/`delivery_node_id`，且只由主资产写入（`updater.exe` 不再覆盖）。
- `internal/delivery` 成为 origin 策略唯一 owner；`cmd/client/SubmodHub/archive_delivery_policy.go` 退化为薄适配器（归档链路继续调用它，行为不变，错误码统一为 `cross_origin_delivery_url_rejected` / `insecure_delivery_url_rejected`）。

## 5. 测试

服务端（`internal/httpapi/app_release_test.go`）：描述签发（Cloudreve 命中 + GitHub 回落 + 5 分钟上限 + 非自更新资产被过滤 + 校验 URL）、元数据缺失 503、候选筛选（无哈希/压缩包排除）、对账/claim/finish 状态机与旧 tag 回收、发布哈希与实下载不一致时不上传且失败计数、worker 一次只推进一个资产、`retry-mirrors` 同时重置应用资产。`internal/checksum` 校验非法 digest 不采纳。

客户端（`internal/updater/delivery_test.go`）：API 权威（GitHub 更高版本也不采信）、Cloudreve 直链下载并校验、直链失败回落 GitHub（重取一次）、过期直链不发起请求、API 不可用回落 GitHub、`SetAPIBaseURL` 生效。

前端：`AppUpdateModal` 下载源文案；`web` 节点卡片新增计数不破坏既有 103 项测试。

## 6. 文档

- 本计划 + `ADR-0002`（应用自更新交付权威扩展），并在 ADR-0001 标注边界由 ADR-0002 扩展。
- `docs/download-delivery.md`：首段不再排除应用自更新，新增「应用自更新资产」小节与计数说明。
- `docs/app-update.md`：架构总览改为「主 API 权威 + GitHub 回落」，新增交付计划与回退语义。

## 7. 验证记录（2026-10-23）

- 变更包：`go test ./internal/checksum/ ./internal/delivery/ ./internal/httpapi/ ./internal/updater/ ./internal/version/ -count=1` 中 checksum/delivery/updater/version 全绿；httpapi 偶尔整包失败，失败项全部是 `testing.go:1464 TempDir RemoveAll cleanup: ... The directory is not empty`，单跑必过（见下条）。
- 环境噪声已归因：`internal/install`、`internal/httpapi` 的同类清理失败在**未改动的 HEAD worktree**（`git worktree add --detach tmp\base-check HEAD`）上同样复现（例如 `TestDecideRecoveryRechecksDiskAfterManualResolution`、`TestPlanAllSixUninstallPermutations`），3 次连续运行 2 次失败；与本次改动无关，属 Windows + J: 盘 `t.TempDir` 清理竞态。
- `go test ./... -count=1`（`cmd/client/SubmodHub`）全绿（含 `archive_transfer` 与 `app_update` 系列）；`go vet` 无告警。
- `npx tsc --noEmit`（`clients/desktop`）通过；`npx tsx --test "src/**/*.test.tsx"` 70 项通过；`web`：`npx tsc --noEmit` 通过、`npm test` 103 项通过。
- 未做：测试服部署、真实 Cloudreve 大包上传/读回、真机自更新（Windows 替换、Android 安装）。

## 8. 已知边界与后续

- 应用资产不做服务端字节代理（无 `builtin` 回落），也不进 `github_relay`。
- `IncludePrerelease=true` 时仍走 GitHub（预发布不镜像）。
- 镜像行不删除云端旧对象；发布换代后旧文件需人工清理。
- 真实验收需在测试服配好 Cloudreve 节点后观察一次完整发布：`app_asset_states` 出现 `ready` 且 `GET /api/v1/app-update` 返回 `delivery_type=cloudreve`，再用旧客户端实测更新。
