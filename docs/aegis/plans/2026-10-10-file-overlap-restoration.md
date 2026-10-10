# 子模组覆盖文件与卸载还原执行计划

日期：2026-10-10。状态：待执行；只完成计划，未实现或验证业务代码。

## 1. 目标与边界

处理子模组间的文件覆盖；卸载自动恢复其他仍安装模组的文件，或者被覆盖的游戏/外部原文件。支持任意卸载顺序，不复活已卸载模组。

方案：首次接管前原始快照 + 活动模组覆盖层 + 可恢复事务。禁止扫描备份目录猜恢复来源。

非目标：合并脚本、语义兼容检测、手动调整优先级、服务端重构、自动接受游戏更新。UI priority 不作为实际覆盖顺序。

执行前读适用 AGENTS.md、本文和基线，检查 git status/diff，保留用户改动。不擅自 commit、建分支、启动其他 agent，不改真实游戏目录。

## 2. 基线

- `internal/install/install.go`：Apply 备份覆盖内容；Uninstall 直接删除；previousBackup 遍历猜来源；Recover 不能完整撤销新增/删除。
- `internal/install/install_test.go`：已有要求删除原文件及漂移文件的测试，需改变预期。
- `cmd/client/SubmodHub/bindings.go`：ApplyArchive 扫描/映射目标，执行后另写收据；Uninstall 后另删收据，非统一事务。
- `cmd/client/SubmodHub/installed_archives.go`：按 ModID 替换收据，不能替代旧版本文件层清理。
- `cmd/client/SubmodHub/browser_server.go`、`browser_server_test.go`：新增接口需同步显式路由。
- `clients/desktop/src/wails.ts`、`types/client.ts`、`App.tsx`、`components/PlanPreviewModal.tsx`：接入真实后端预览。
- 状态：`<MAS>/.submodhub/state`；收据：`<MAS>/.submodhub/installed-archives.json`。
- 根与 cmd/client/SubmodHub 是两个 Go 模块。桌面已有 lint/build，无独立测试脚本，不新增前端测试框架。
- 编写时已有改动：App.tsx、types/client.ts、bindings.go、bindings_test.go、生成 models.js、Android Gradle lock；执行时重新确认。

## 3. 不变量及行为

1. 首次保存原内容或“原本不存在”；后续覆盖不重写原始快照。
2. 每个活动模组每路径最多一层；相同内容也分别记录归属，内容可按 hash 去重。
3. 最后一个活动层有效；无活动层恢复原始文件，原本不存在才删除。
4. 非顶层卸载只移除归属，不改磁盘；已卸载模组不能复活。
5. 新安装获得递增 order；更新保留原 order，更新低层不覆盖高层。更新移除路径重新计算有效层。
6. 文件、索引、收据事务一致；部分执行不是成功。
7. 外部变化、损坏/缺失备份、不可信旧记录默认阻断，不能降级删除。
8. 同实例跨对象/进程互斥，操作 ID 不覆盖不同操作。
9. 按文件归属卸载，不递归删除 SubmodDirs；只清理本事务创建且已为空的目录。
10. 全部层卸载后标记未接管，下次安装重新快照磁盘，防止沿用游戏更新前的旧快照。

original→A→B：卸载 B 得 A，再卸载 A 得 original；先卸载 A 保留 B，后卸载 B 直接得 original。

还原是字节级文件内容及必要权限，不保证整套游戏版本。游戏更新视为外部变化。执行前提示关闭游戏，文件占用安全失败。

## 4. 数据、接口及事务

新增建议文件及对应 *_test.go：

- `internal/install/manifest.go`：schema_version=2 索引、原始层、归属。
- `internal/install/blob_store.go`：SHA-256 内容存储、校验、引用检查。
- `internal/install/planner.go`：只读计划生成。
- `internal/install/transaction.go`：锁、预检、撤销、提交、恢复。
- `internal/install/migration.go`：保守迁移。

install.go 保留入口但委托唯一引擎。索引含 schema_version/generation/next_order/files/installations。路径含展示路径/key、original(exists/hash/mode)、layers(installation_id/mod_id/version_id/operation_id/order/hash/mode)。无 ModID ApplyFile 使用独立身份。显式区分预期不存在与不校验。

增量服务 API：PreviewArchive(request)、PreviewUninstall(operationID)、ExecutePlan(request)。计划含 plan_id、实例/root、generation、动作、阻断、风险和校验摘要；动作 write/delete/restore_original/restore_layer/metadata_only，含路径、当前来源、恢复来源、前后哈希/存在性。

旧 ApplyArchive/Uninstall 安全适配，需要确认则报错，不绕过。plan_stale 重新预览。错误码至少 external_change、missing_blob、corrupt_blob、migration_required、operation_id_conflict、instance_busy、invalid_path、recovery_required。

收据保留兼容投影但加入同一事务。核心不 import main；服务转换为核心记录或传固定允许的收据投影，不开放任意路径写入。

路径：Windows key 忽略大小写并统一分隔符，其他平台不盲目转小写。拒绝绝对路径、盘符/UNC、越界、ADS、重复规范化目标、符号链接/reparse point 逃逸、写状态目录；校验操作 ID；只处理普通文件，执行前复查父目录。

事务协议：获取实例内/跨进程锁；先处理未完成事务；全量预检路径、generation、实际哈希/存在性、blob、空间与权限；保存所有新内容、原始快照及 before-image；持久化 prepared 日志和旧/新索引/收据；唯一临时文件安全替换；提交索引/收据；committed 持久化后才返回成功。

未 committed 回滚文件/索引/收据；新增回滚为缺失，删除恢复原内容。恢复幂等；当前内容既非 before 又非 after 时阻断，保留证据。禁止吞掉日志错误；Windows 替换失败不能先永久删目标；多文件 rename 不视为天然原子。

外部修改/删除默认阻断整个操作；明确继续时先保存当前内容或缺失状态到独立救援记录，不混入原始层。游戏更新同样处理。首发不强求自动 GC，任何清理不得删原始层/活动层/事务/救援审计引用的 blob。

## 5. 原子任务

每任务先加失败测试并记录失败，再最小实现、验证、检查 diff、更新 checkpoint。类型签名在 T1 明确后统一使用。

### T1 索引与内容存储

新增 manifest.go/blob_store.go 及测试，修改 install.go。测试原快照不被覆盖、缺失与零字节区分、同 hash 双归属、重复路径/越界/状态目录拒绝、缺失/损坏 blob。

根目录：`go test ./internal/install -run 'Test(Manifest|Blob|CanonicalPath)' -count=1`，确认命中新测试并 PASS。

### T2 计划器

新增 planner.go/planner_test.go。表驱动 original→A→B→C 全六种卸载排列，每步断言内容和归属；测试非顶层 metadata_only、末层恢复/删除、相同内容、A 更新不覆盖 B、更新移除路径、实例隔离。覆盖外部/管理文件均返回可见风险。

验证：`go test ./internal/install -run TestPlan -count=1`。

### T3 事务和恢复

新增 transaction.go/transaction_test.go；修改 Apply/Recover/Uninstall。注入故障于 prepared 后、每文件后、索引后、收据后、committed 前，验证完整回滚、新增删除、删除恢复、记录一致、幂等、占用文件安全失败。

补测多对象/进程竞争、重复 ID、重复卸载不二次删除、预览后漂移、救援后继续、缺备份不删除。替换 TestUninstallDeletesPreviousFileInsteadOfRestoringBackup 为恢复原文件，TestUninstallDeletesDriftedFile 为阻断漂移。

退役 previousBackup 及直接删除卸载；RestoreBackup 如保留只做精确适配。验证 `go test ./internal/install -count=1`；支持时 `go test -race ./internal/install -count=1`，限制须记录。

### T4 旧数据迁移

新增 migration.go/migration_test.go。只迁移可信日志/收据、明确顺序、完整备份、可验证顶层；可用后续覆盖前备份重建下层。缺 hash/原备份或顺序歧义返回 migration_required，不把当前顶层当原文件，不把卸载日志当活动安装。迁移前备份旧状态，失败不改游戏，重复幂等；未管理游戏文件首次覆盖直接快照。

测试完整链、缺原备份、相同时间、混入卸载、重复迁移。验证 `go test ./internal/install -run TestMigration -count=1`。

### T5 服务与路由

修改 bindings.go、installed_archives.go、browser_server.go 及测试。提取共享扫描/路径映射供 Preview/Execute；更新替换活动层；收据纳入事务；启动/SetMASRoot 恢复后才继续；新 API 同步 browser/native。

测试 A/B 安装后重启、卸载 A 保留 B、卸载 B 恢复游戏原文件、收据失败回滚、切实例拒绝旧 plan、无 ModID ApplyFile。cmd/client/SubmodHub 下 `go test ./... -count=1`。

### T6 客户端真实预览

修改 wails.ts、types/client.ts、App.tsx、PlanPreviewModal.tsx；按本地 Taskfile/README 流程生成 frontend/bindings，不手写生成文件，记录实际命令。

显示路径/来源/恢复来源，不明原来源标“游戏/外部原文件”；汇总恢复原文件、恢复模组、仅移归属、删除新增。阻断禁执行、覆盖明确确认、漂移默认取消、继续先救援、过期重新预览不沿用确认；committed 后刷新列表。

clients/desktop 下 `npm run lint`、`npm run build`，退出码 0。人工验证确认/取消/阻断/刷新/重启；不新增测试框架。

### T7 综合验收及文档

修改 cmd/client/SubmodHub/README.md，说明规则、快照范围、漂移、迁移限制、救援位置、旧客户端限制。临时 MAS 加 A/B/C 压缩包测试六种卸载排列、game/lib/characters、最终原文件哈希。

禁止默认运行 mas_integration：real_mas_integration_test.go 有真实默认路径，须用户明确同意并指定一次性实例才用。

根 `go test ./... -count=1`；客户端模块 `go test ./... -count=1`；桌面 lint/build；`git diff --check`。无关失败记录，不越界修复。

## 6. 风险与 checkpoint

峰值空间包含 blob/before-image/临时文件，不足预检失败。Windows 锁/替换以测试为准。丢失原文件无法凭空还原。schema=2 接管后旧客户端不安全，回退前导出/恢复，不删新状态。新测试及适配通过后删除旧扫描和非事务收据分支，不保留危险 fallback。

初始：已读基线并写计划，T1–T7 未完成，未跑实现测试。下一步检查 diff、记录基线测试、开始 T1。依赖 T1→T2→T3→T4/T5→T6→T7。

每阶段在此追加状态、文件、命令/退出码、证据、阻碍、下一步；恢复前核对实际 diff。完成须所有不变量及验收有实际证据，未验证明确报告。

## 7. 给执行 agent 的指令

按本计划实现覆盖层及卸载自动还原，必须恢复游戏原文件，任意卸载顺序不复活已卸载模组。先保护已有改动，再按 T1–T7 执行；阻断漂移和不可信旧记录，保证文件/索引/收据事务一致。不擅自 commit 或操作真实游戏。每阶段记录 checkpoint 与验证，交付代码、回归测试、真实预览及报告。

## 8. 执行验证记录 (Execution Checkpoints T1–T7)

### T1 索引与内容存储
- **状态**：已完成
- **涉及文件**：`internal/install/manifest.go`, `internal/install/manifest_test.go`, `internal/install/blob_store.go`, `internal/install/blob_store_test.go`
- **执行命令与结果**：`go test ./internal/install -run 'Test(Manifest|Blob|CanonicalPath)' -count=1`（退出码 0，PASS）
- **验证证据**：
  - 原快照首次写入后，后续任何叠加层无法修改 Original 快照内容。
  - 区分原本不存在 (`exists: false, hash: ""`) 与 0 字节文件 (`exists: true, hash: e3b0c44...`)。
  - 相同哈希多模组各自归属独立层记录。
  - 规范化路径拒绝 `..` 越界、绝对路径、盘符、UNC、ADS `:` 及状态目录逃逸；Windows 平台 key 小写化不敏感匹配。
  - 缺失 blob 与内容损坏 blob 校验拦截。

### T2 计划器
- **状态**：已完成
- **涉及文件**：`internal/install/planner.go`, `internal/install/planner_test.go`
- **执行命令与结果**：`go test ./internal/install -run TestPlan -count=1`（退出码 0，PASS）
- **验证证据**：
  - original→A→B→C 全部 6 种卸载排列表驱动测试（CBA, BCA, ABC, CAB, ACB, BAC），每步断言内容及归属。
  - 非顶层卸载仅移归属并返回 `metadata_only`，不触碰磁盘，已卸载模组不复活。
  - 末层卸载自动恢复游戏原文件；新文件末层卸载执行 `delete`。
  - 低层模组更新不覆盖高层生效模组；更新移除路径重算有效层。
  - 外部漂移安全拦截并返回 `external_change`；覆盖外部文件返回 `overwriting_external_file` 可见风险。

### T3 事务和恢复
- **状态**：已完成
- **涉及文件**：`internal/install/transaction.go`, `internal/install/transaction_test.go`, `internal/install/install.go`, `internal/install/install_test.go`
- **执行命令与结果**：`go test ./internal/install -count=1`（退出码 0，PASS）；`go test -race ./internal/install -count=1`（记录限制：Windows 环境缺少 gcc/cgo 编译器）
- **验证证据**：
  - 故障注入测试于 `after_prepared`、`after_file_1`、`after_manifest`、`before_committed`，验证自动完整回滚；新增文件清理，修改文件从 before-image 还原。
  - 实例进程锁排他性验证（并发尝试返回 `instance_busy`）。
  - 重复操作 ID 冲突拦截（`operation_id_conflict`）。
  - 退役旧版 `previousBackup` 扫描机制；替换旧测试预期为恢复原文件 (`TestUninstallRestoresPreviousFileInsteadOfDeleting`) 与阻断漂移 (`TestUninstallBlocksOnDriftedFile`)。

### T4 旧数据迁移
- **状态**：已完成
- **涉及文件**：`internal/install/migration.go`, `internal/install/migration_test.go`
- **执行命令与结果**：`go test ./internal/install -run TestMigration -count=1`（退出码 0，PASS）
- **验证证据**：
  - 完整迁移链测试：利用后续覆盖前备份重构下层与顶层内容并转入 Blob 存储。
  - 备份文件缺失或被篡改安全返回 `migration_required`，不盲目将顶层判定为原文件。
  - 相同时间戳产生顺序歧义时返回 `migration_required`。
  - 重复执行迁移幂等安全。

### T5 服务与路由
- **状态**：已完成
- **涉及文件**：`cmd/client/SubmodHub/bindings.go`, `cmd/client/SubmodHub/bindings_test.go`, `cmd/client/SubmodHub/installed_archives.go`, `cmd/client/SubmodHub/browser_server.go`, `cmd/client/SubmodHub/browser_server_test.go`
- **执行命令与结果**：`cd cmd/client/SubmodHub; go test ./... -count=1; cd ../../..`（退出码 0，PASS）
- **验证证据**：
  - 提取共享扫描与路径映射，增量服务新增 `PreviewArchive`、`PreviewUninstall`、`ExecutePlan`。
  - 收据读写纳入事务范围，失败触发回滚。
  - 启动与 `SetMASRoot` 优先执行未完成事务恢复（`RecoverPending`）。
  - 切换实例使陈旧计划立即失效（返回 `plan_stale`）。
  - 浏览器 HTTP 路由同步新增对应端点并完成集成测试。

### T6 客户端真实预览
- **状态**：已完成
- **涉及文件**：`cmd/client/SubmodHub/frontend/bindings/*`, `clients/desktop/src/wails.ts`, `clients/desktop/src/types/client.ts`, `clients/desktop/src/components/PlanPreviewModal.tsx`, `clients/desktop/src/App.tsx`
- **执行命令与结果**：
  - `cd cmd/client/SubmodHub; wails3 generate bindings; cd ../../..`（退出码 0，自动生成 20 Methods, 16 Models）
  - `cd clients/desktop; npm run lint; npm run build; cd ../..`（退出码 0，PASS）
- **验证证据**：
  - 接入真实后端预览，展示路径、当前来源与目标来源，未识别原来源明确标识为“游戏/外部原文件”。
  - 界面汇总卡片展示：恢复原文件、恢复活动模组、仅移归属、删除新增、新建写入。
  - 存在阻断项时确认按钮禁用；覆盖已有文件要求用户显式勾选确认；5 分钟过期倒计时后禁用确认防止计划陈旧；事务提交后自动刷新安装列表。

### T7 综合验收及文档
- **状态**：已完成
- **涉及文件**：`cmd/client/SubmodHub/README.md`, `cmd/client/SubmodHub/bindings_test.go`, `docs/aegis/plans/2026-10-10-file-overlap-restoration.md`
- **执行命令与结果**：
  - 根模块全量测试：`go test ./... -count=1`（退出码 0，PASS）
  - 客户端模块全量测试：`cd cmd/client/SubmodHub; go test ./... -count=1; cd ../../..`（退出码 0，PASS）
  - 桌面前端检查与构建：`cd clients/desktop; npm run lint; npm run build; cd ../..`（退出码 0，PASS）
  - 代码差异与排版检查：`git diff --check`（退出码 0，无任何空白或换行告警）
  - 端到端六种卸载排列测试：`TestDesktopServiceEndToEndAllSixPermutationsWithGameLibCharacters` 覆盖 `game/`、`lib/`、`characters/` 目录，验证所有卸载顺序均不复活已卸载模组，最终原文件哈希值 100% 字节精确匹配。
  - 安全边界验证：未运行真实目录集成测试（`real_mas_integration_test.go` 保留跳过），未修改真实游戏目录，未执行擅自提交。
