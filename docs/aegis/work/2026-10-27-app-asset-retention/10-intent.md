# 节点只保留软件本体最新版 - Intent

## TaskIntentDraft
- Parent: 用户 2026-10-27 直接要求：「在 cloudreve 上的镜像源，如果是软件本体，只保留最新版。」
- Outcome: Cloudreve 节点上只保留当前发布版本的应用安装包（RezeHub 客户端 `.exe`/`.apk` 与 `updater.exe`）。当前版本在某节点的全部可镜像资产 `ready` 之后，worker 回收该节点上其余以 `app-` 开头、带安装包后缀的对象：旧版本安装包、读回失败留下的 `<name>-<nonce>` 残留与坏字节对象。模组归档镜像与原始归档不受影响。
- Success: `go build ./...`、`go vet ./...`、`go test ./...` 全绿；新增用例覆盖「只删旧版本与他源 app 对象」「当前版本未齐不删」「列出失败不删」「节流」与「按 ID 删除并复核」；`docs/download-delivery.md`、`docs/app-update.md`、ADR-0002 同步。
- TaskStartSnapshot: root `J:/GithubRep/Reze_SubmodHub`；branch `main`；HEAD `f983415 feat(client): 事务进行时禁止启动游戏并将启动入口置灰`；工作区另有与本任务无关的未提交改动（`internal/install/compiled_cache.go`、桌面端 UI 等），本次不改动它们。
- Preserve: 不改编排好的镜像状态机（pending/uploading/ready/failed）、不改编描述 `/api/v1/app-update` 的 JSON 字段、不改客户端与 `internal/updater`、不改归档镜像的「不自动删除」边界。

## Execution Readiness View
- Intent lock: 描述只宣告当前版本的直链，因此旧安装包在节点上没有读取路径；回收不得牺牲可下载性——旧版本要留到新版本每个资产都能下载为止。
- Scope fence: 只动 `internal/cloudreve`（删除原语）与 `internal/httpapi`（保留策略 + worker 挂钩）。不新增端点、不新增持久化字段、不动前端与管理页文案。
- Compatibility: 无契约变化。回收失败只记脱敏日志并在下一个窗口重试；镜像状态、描述内容、失败退避都与改造前一致。
- Retirement: `internal/cloudreve` 不再有两份「删除并复核」实现——探针的 `DeleteCreatedObject` 改为复用新的 `RemoveObjects`。
- TDD Route: light（先写 `internal/cloudreve/remove_test.go` 与 `internal/httpapi/app_asset_retention_test.go`，再实现）。
- ArchitectureReviewRequired: yes；ADR-0002 追加 Amendment 2026-10-27，因为 ADR-0001 的「旧镜像不自动删除」需要一条按资产类型区分的例外。

## ImpactStatementDraft
后端多一条按节点节流的目录巡检与删除路径；无 API 变更、无迁移、无数据变更、无客户端影响。节点目录在稳定状态下的写入量从「每次发布新增 3 个安装包」变为「每次发布替换 3 个安装包」。
