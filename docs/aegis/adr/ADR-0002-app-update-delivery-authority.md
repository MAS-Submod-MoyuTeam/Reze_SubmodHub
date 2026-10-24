# ADR-0002 - 应用自更新交付权威扩展

Status: `recorded-from-work`
Date: `2026-10-23`
Amends: `ADR-0001-download-delivery-authority.md`

## Source Evidence

- `internal/httpapi/app_release.go`（发布发现、应用资产镜像 worker、`GET /api/v1/app-update`）、`internal/updater/delivery.go`（API 权威检查 + 交付下载 + 回落）、`internal/delivery/origin.go`（共享 origin 策略）、`internal/checksum`（校验文件唯一解析器）。
- 本地自动测试与静态检查；测试服部署与真机自更新尚未验收。

## Context

ADR-0001 把普通包下载从主 API 剥离到 Cloudreve 镜像与独立 relay，但显式保留了「客户端应用自更新不在此链路」：应用自更新仍由客户端直接查 GitHub Releases 并下载，在 GitHub 不可达或被限速时完全没有替代路径。应用资产与模组归档同源（同一 GitHub Release、同一 `SHA256SUMS.txt`），却有两套检查与交付逻辑。

## Decision

1. 主 API 成为客户端应用自更新的检查权威：读取官方仓库最新稳定 Release，把客户端相关资产（`.exe`/`.apk`）镜像到已启用的 Cloudreve 节点，并对外提供 `GET /api/v1/app-update` 描述（版本、说明、逐资产哈希与交付计划）。
2. 只有能从 `SHA256SUMS.txt` 取得权威哈希的资产才允许镜像；服务端上传后必须无 Cookie 读回校验 SHA-256 才能标记 `ready`。
3. 描述只宣告 Cloudreve 直链与 GitHub 直链两种交付类型；应用资产不做服务端字节代理，也不进独立 GitHub relay 节点。
4. 客户端必须校验发布哈希，与交付来源无关；先信 API 的版本判断，API 不可用或返回元数据缺失时才回落 GitHub 检查与下载。

## Alternatives Considered

- 保持「应用自更新只走 GitHub」：改动为零，但用户诉求（节点下载）无法满足，且限速场景没有出路。
- 由客户端自行决定用哪个 Cloudreve 节点：客户端无法访问节点凭据，也无法验证镜像完整性，拒绝。
- 让主 API 直接代理应用资产字节（`builtin`）：与 ADR-0001 剥离带宽的方向相反，且大文件代理成本最高，本次不做。
- 单独为应用资产建表/建队列：`catalog_snapshot` 已能承载镜像元数据，新增表只会制造第二套状态机。

## Consequences

- 新增持久化字段 `Catalog.AppAssetMirrors`（无新表、无 SQL 迁移）。
- 镜像 worker 与归档镜像共用全局并发 1 与退避策略，应用资产在不与归档争抢时推进；GitHub 刷新在后台进行，不阻塞归档交付。
- 管理端多一组「软件更新缓存」计数；`retry-mirrors` 同时重置应用资产失败任务。
- 客户端 `updater.State` 多两个字段（`delivery_source`/`delivery_node_id`），更新弹窗多一行下载源说明。

## Compatibility Boundary

- 旧客户端（只读 GitHub）继续可用：新端点与镜像行对它们是惰性数据。
- 交付来源变化不改变安装流程、事务确认、备份恢复与平台权限语义；校验仍是安装前的强制门槛。
- 预发布通道（`IncludePrerelease`）仍只走 GitHub；应用资产无 `builtin` 回落。

## Retirement Impact

- 客户端私有 origin 校验不再独立存在：`cmd/client/SubmodHub/archive_delivery_policy.go` 退化为 `internal/delivery` 的适配器，错误码统一为 `cross_origin_delivery_url_rejected` / `insecure_delivery_url_rejected`（原 `cross_origin_archive_url_rejected` 系列被替代，无兼容层）。
- `updater` 不再拥有仓库坐标与校验文件解析：坐标移到 `internal/version`，解析移到 `internal/checksum`。

## Baseline Sync

- Needed: needed
- Target: docs/download-delivery.md, docs/app-update.md, docs/frontend-contract.md
- Action: update baseline
- Reason: 交付契约与运维文档已同步；实现不等于真实上线验收。

## Evidence References

- docs/aegis/plans/2026-10-23-app-update-cloudreve-delivery.md
- docs/download-delivery.md
- docs/app-update.md
- docs/aegis/adr/ADR-0001-download-delivery-authority.md

## Amendment 2026-10-23 — 权威边界收紧

代码审查后补充四条约束，仍在本 ADR 的决策范围内，不改变方向：

- **权威有时效**：描述新增 `snapshot_age_seconds`。超过 30 分钟后客户端再问一次 GitHub；GitHub 有更高版本才采信，GitHub 不可达时保留主 API 的答案。主 API 仍是默认权威，但不再能靠一份陈旧快照长期压住新版本。
- **镜像状态可自愈**：对账把残留的 `uploading` 归位 `pending`。对账发生在投递 worker 认领任务之前，因此该状态不可能是并发上传，只可能是重启、节点变更或完成落盘失败留下的。
- **刷新不换 release**：重取描述时校验 `tag_name`，与本次批准版本不一致就放弃重试并回落 GitHub，避免把新版本的哈希/直链套在旧版本的暂存结果上。
- **回落即清源**：GitHub 回落成功时清空 `error`、`delivery_source`、`delivery_node_id`，状态不再同时表达「有新版本」和上一次 API 失败。

`github_url` 仍然始终返回：这是为了让「API 可达但节点不可用」的客户端还能下载，属于对「隐藏 GitHub 地址」目标的**有意例外**，后续重构不应把它当泄漏删除。

## Amendment 2026-10-24 — VERSION 只作触发信号

在「主 API 是检查权威」的前提下，补一条降级路径：主 API 会直读仓库根 `VERSION`（`raw.githubusercontent.com`，不在 REST 限流范围内），用于更快发现新版本。边界如下：

- **只触发，不供数据**：`VERSION` 高于当前快照 `tag_name`、且该版本对应的 tag 已存在时，唯一效果是把权威 Release 刷新提前到本次请求。资产、哈希、说明仍全部来自 Release 快照；`VERSION` 永远不能成为描述内容的来源。
- **tag 已存在才花配额**：发布流程先 bump `VERSION`、构建完成后才建 tag，所以「`VERSION` 领先于 tag」是构建期的常态而非边缘。只看版本号会把整段构建时间变成每分钟一次 REST 刷新；因此探测在花 REST 前先用同一 raw 主机确认该 tag 存在（零配额）。tag 不存在 ⇒ Release 一定不存在 ⇒ 不刷新。
- **同一 VERSION 值只付一次**：tag 已存在但 Release 仍不可用（草稿、预发布、发布调用在途）时，raw 无法区分「还没到」与「永远不到」。该状态按值封顶为一次 REST，而不是每个探测窗口一次；代价是新版本最多晚一个 10 分钟窗口被发现。
- **被动**：只在有人请求 `/api/v1/app-update` 且权威刷新尚未到期时探测。投递 worker 的 10 分钟节奏不因它加快，也不会为探测单独唤醒。
- **缓存 1 分钟**：窗口内复用同一结论，突发流量只产生一次 raw 请求；失败同样占用窗口，避免每个到达的客户端都重试。
- **失败静默**：404/5xx/超时一律回落到原有 10 分钟刷新与 2 分钟重试，不改变描述可用性，也不新增错误码。
- **不污染年龄**：`snapshot_age_seconds` 仍只表示最近一次成功读取 Release 距今，探测不刷新它。
- **不越权取凭据**：raw 主机不是 API 主机，探测沿用既有的「仅对 API 主机附带 Token」规则。

上游 CDN 对 raw 文件自带 `max-age=300`，因此 1 分钟窗口观察到的值最多可能落后约 5 分钟。这是上游属性：本决策不为此加 `no-cache` 去对抗 CDN，探测的价值在「比 10 分钟快且零配额」。

## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
