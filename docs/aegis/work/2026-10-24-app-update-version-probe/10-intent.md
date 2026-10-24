# 应用自更新 VERSION 探测 - Intent

## TaskIntentDraft
- Parent: 用户 2026-10-24 直接要求：「仅对后端路径：额外加直接请求 github 源的 VERSION 文件，既可以绕过 API 限流，又可以较快的检查更新，还是推荐尽可能被动更新，即有人检查 github 有更新时进行检查，缓存 1 分钟。」
- Outcome: 后端在「有人检查更新」时直读仓库根 `VERSION`（`raw.githubusercontent.com`，不占 REST 配额），发现更高版本就把权威 Release 刷新提前；探测结果缓存 1 分钟；探测失败静默回落。公开 JSON 契约、客户端与 `internal/updater` 均不变。
- Success: `go build ./...`、`go vet ./...`、`go test ./...` 全绿；新增用例覆盖「探测更高→刷新」「相等→不刷新」「1 分钟复用」「失败回落」「失败不缩短重试窗口」「Token 不发往 raw 主机」；`docs/app-update.md`、`docs/download-delivery.md`、ADR-0002 同步。
- TaskStartSnapshot: root `J:/GithubRep/Reze_SubmodHub`；branch `main`；HEAD `300e9b5 chore(version): 版本号升到 0.9.13`（2026-10-24 11:43 +0800）；工作区干净。
- Preserve: 不改 `internal/updater` 与任何客户端代码；不改 `/api/v1/app-update` 的 JSON 字段；不改 `snapshot_age_seconds` 语义；不改镜像/对账/Cloudreve 交付策略。

## Execution Readiness View
- Intent lock: 主 API 仍是更新检查与交付计划的唯一权威（ADR-0002）。`VERSION` 只是「可能有新版本」的廉价信号，不得成为描述内容的来源。
- Scope fence: 只动 `internal/github`（raw 文件读取器）与 `internal/httpapi`（探测 + 刷新节奏门）。不新增端点、不新增错误码、不动前端。
- Compatibility: 无契约变化。探测失败时对外行为与改造前逐字节一致（同样的 10 分钟刷新、2 分钟重试、503 路径）。
- Retirement: 删掉 `appReleaseStale()`，把刷新节奏收进 `refreshDueLocked()`；同时去掉 `checkedAt = now - (10min - 2min)` 这个「用时间倒退表达退避」的写法，改由 `lastErr` 表达。`manifestURL` 与 `rawFileURL` 的重复地址拼接合并为一处。
- TDD Route: strict。先写失败的 `internal/github/version_file_test.go` 与 `internal/httpapi` 探测用例，再实现。
- ArchitectureReviewRequired: yes；ADR-0002 追加 Amendment 2026-10-24，两份交付文档同步。

## ImpactStatementDraft
后端新增一个只读探测器与一个 1 分钟缓存；刷新节奏规则从「两处硬编码时间比较」收敛为一个方法。无 API 变更、无迁移、无数据变更、无客户端影响。
