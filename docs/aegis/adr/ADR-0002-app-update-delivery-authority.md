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

## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
