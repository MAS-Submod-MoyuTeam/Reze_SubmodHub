# 任务中心与安全事务恢复实施计划

## 目标

将当前“任务与原子恢复”从前端演示能力收敛为可交付的安装事务能力：

- 安装、更新、卸载在崩溃或中断后不会留下不可解释的半完成状态。
- 默认恢复动作是安全回滚，不把回滚误称为“继续执行”。
- 外部修改、journal 损坏、回滚失败等情况进入明确的人工处理状态，不静默跳过。
- 任务中心读取真实后端 journal，而不是主要依赖前端 mock 数据。
- 保持现有 MAS 文件布局、legacy ZIP 输入、优先级覆盖和已有 Wails 方法兼容。

## 设计边界

### 事实

- `internal/install/transaction.go` 已实现实例锁、before/after hash、blob 快照、journal、失败回滚和启动恢复。
- `internal/install/install.go` 的 `Recover(id)` 当前实际执行回滚；前端按钮文案却是“恢复执行”。
- `clients/desktop/src/data/mockData.ts` 仍提供初始任务数据；后端没有完整的任务列表绑定。
- 当前事务覆盖磁盘文件、manifest 和安装 receipt，但 manifest/receipt 写入与 journal 持久化仍需加强断电一致性。

### 明确目标

- “原子”在本计划中指**事务级 all-or-nothing 可观察状态**和**崩溃后可恢复**，不声称多个普通文件具备操作系统级同时提交能力。
- 默认恢复策略是回滚；断点继续执行不属于第一阶段。
- 若磁盘状态既不匹配 before，也不匹配 after，禁止自动覆盖并标记 `needs_manual_recovery`。

### 非目标

- 不重写整个安装器或引入数据库。
- 不要求 legacy ZIP 增加 manifest。
- 不在第一阶段实现 Android SAF 的文件系统事务；Android 复用同一状态机，但平台 I/O 适配另行验证。
- 不改变现有 `Preview*`、`ExecutePlan`、`ApplyArchive`、`Uninstall` 的调用参数含义。

## 兼容性约束

- 保留 `.submodhub/state`、`manifest.json`、`blobs`、`journals` 现有布局；新增字段必须向后兼容旧 JSON。
- 已提交的旧 transaction journal 和 legacy journal 仍可读取。
- 已有 `Recover(operationID)` 方法先保留，行为明确为回滚；如新增别名，不删除旧绑定。
- 安装前仍必须执行 generation 校验、磁盘 hash 漂移校验和实例锁校验。
- 不得因为恢复功能删除用户未托管文件或覆盖外部修改。

## 状态模型

```text
planned
prepared
applying
committing
committed
rolled_back
needs_manual_recovery
```

- `planned`：计划已生成，尚未持久化完整 before-image。
- `prepared`：所有恢复材料已写入 blob/journal，可安全开始修改磁盘。
- `applying`：至少一个文件已变更，journal 记录当前进度。
- `committing`：文件、manifest、receipt 已应用，正在完成最终提交。
- `committed`：最终状态已确认，任务完成。
- `rolled_back`：已恢复到事务开始前状态。
- `needs_manual_recovery`：发现外部漂移、journal 损坏或回滚失败，必须用户处理。

## 文件责任

- `internal/install/transaction.go`：定义事务状态、journal 持久化、apply/commit/rollback/recovery 协议；继续负责实例锁和 before/after 状态判断。
- `internal/install/install.go`：暴露回滚、读取 journal、兼容 legacy journal 的服务方法；不再把回滚语义包装成“恢复执行”。
- `internal/install/transaction_test.go`：覆盖状态机、崩溃点、恢复决策和持久化失败。
- `internal/install/safety_regression_test.go`：覆盖外部漂移、路径安全、回滚幂等和文件替换安全性。
- `cmd/client/SubmodHub/bindings.go`：增加真实任务查询、任务详情和显式回滚绑定；保持现有绑定兼容。
- `cmd/client/SubmodHub/*_test.go`：覆盖 Wails service 到 installer 的任务状态和回滚契约。
- `clients/desktop/src/wails.ts`：增加后端任务 API 类型和调用封装。
- `clients/desktop/src/App.tsx`：启动时加载真实任务；执行、回滚、刷新后重新读取后端状态。
- `clients/desktop/src/components/OperationsView.tsx`：修正文案、状态标签、错误说明和人工恢复入口。
- `clients/desktop/src/data/mockData.ts`：仅保留浏览器演示 fallback；不再作为真实桌面端任务数据源。
- `docs/operations.md` 或新增客户端恢复说明：记录状态语义、恢复策略和人工恢复边界。

## 实施阶段

### 阶段 0：建立基线与失败测试

1. 在 `internal/install/transaction_test.go` 增加状态枚举/状态转换测试，验证非法转换被拒绝。
2. 增加事务阶段故障注入测试：journal 写入后、文件写入后、manifest 写入后、receipt 写入后、commit 标记前。
3. 增加重启模型测试：新 `Installer` 调用 `RecoverPending()` 后，磁盘、manifest、receipt 必须回到一致状态。
4. 增加外部漂移测试：磁盘同时不匹配 before/after 时，结果必须是 `needs_manual_recovery`，且不得覆盖文件。
5. 运行 `go test ./internal/install ./cmd/client/SubmodHub`，确认新增测试失败源于缺失能力而非环境问题。

验收：测试能稳定复现缺口；现有事务测试不被删除或弱化。

### 阶段 1：收紧事务 journal 与持久化

1. 在 `internal/install/transaction.go` 集中定义状态常量，禁止散落字符串。
2. 在 journal 增加 `CurrentStep`、`TotalSteps`、`LastPath`、`ErrorCode`、`ErrorMessage`；旧 journal 缺失字段时采用默认值。
3. 修改第一个文件前持久化 `prepared`；每项文件操作前记为 `applying`，成功后更新进度。
4. manifest 和 receipt 使用“临时文件写入、关闭/flush、原子替换”的 helper，失败时保留原文件。
5. journal 保存使用同一持久化 helper，并尽可能 flush 文件和父目录；平台不支持目录 flush 时保留兼容 fallback。
6. 状态写入失败必须返回错误并保留可诊断 journal，不得静默成功。
7. `recoverPendingLocked()` 对 JSON 损坏、缺失 blob、路径非法、回滚失败返回明确 `needs_manual_recovery`，不静默跳过。

验收：关键断点重启后结果一致；旧 journal 仍可读取。

### 阶段 2：实现明确的回滚与恢复决策

1. 保留 `Installer.Recover(id)`，将文档、错误码和返回状态明确为“回滚指定未完成事务”。
2. 增加恢复决策函数，按 journal phase 和磁盘 before/after 状态选择提交完成、回滚或人工处理。
3. 回滚前对所有目标文件做完整 preflight；任一文件外部漂移时，不得只回滚部分文件。
4. 回滚保持幂等；回滚中断后可再次安全回滚。
5. 回滚成功后原子恢复 manifest、receipt，并把 journal 标记为 `rolled_back`。
6. 回滚失败时保留原始错误和失败路径，journal 进入 `needs_manual_recovery`，不得伪造 `rolled_back`。
7. 不实现旧事务断点续做；重试时重新生成 plan，并重新校验 generation/hash。

验收：覆盖正常失败、重复回滚、回滚中断、外部修改和缺失 blob；不自动覆盖用户新修改文件。

### 阶段 3：接通真实任务中心 API

1. 在 `cmd/client/SubmodHub/bindings.go` 增加 `ListOperations`，读取当前 instance 的 transaction journal 和兼容 legacy journal。
2. 增加 `GetOperation(operationID)`，返回状态、阶段、进度、错误、文件数量、备份/回滚可用性和时间戳。
3. 增加显式 `RollbackOperation(operationID)`；现有 `Recover` 作为兼容入口转发到同一逻辑。
4. 按 `updated_at` 排序；时间相同时按 `operation_id` 排序。
5. 校验 operation ID 和状态；查询只能读取当前 instance，路径始终限制为安全相对路径。
6. 在 `cmd/client/SubmodHub/bindings_test.go` 覆盖提交、失败回滚、人工恢复和重启后查询一致性。

验收：桌面端无需 mock 即可展示已提交、已回滚和待人工处理任务。

### 阶段 4：修正桌面端交互与文案

1. 在 `clients/desktop/src/wails.ts` 增加 `ListOperations`、`GetOperation`、`RollbackOperation` 封装和类型。
2. 在 `clients/desktop/src/App.tsx` 启动时加载真实任务，操作完成、失败或回滚后刷新列表。
3. 在 `clients/desktop/src/components/OperationsView.tsx` 将“恢复执行 (Recover)”改为“安全回滚”；仅在后端允许时显示按钮。
4. `needs_manual_recovery` 显示警告、冲突路径及 expected/actual hash，并提示用户备份和手动处理。
5. 读取旧 `recoverable` 时映射为待回滚；新数据只使用统一状态模型。
6. 日志弹窗显示后端阶段和错误，不伪造固定时间戳或逐行日志。
7. `clients/desktop/src/data/mockData.ts` 仅作为浏览器演示 fallback，桌面模式优先真实 API。

验收：失败任务显示“安全回滚”，回滚完成状态为 `rolled_back`；漂移任务不显示“继续执行”。

### 阶段 5：文档、回归和交付检查

1. 更新 `docs/operations.md`，说明状态、自动恢复规则、人工处理条件和不支持的跨文件同时提交保证。
2. 更新 `docs/aegis/INDEX.md`，添加本计划链接。
3. 运行 `go test ./internal/install ./cmd/client/SubmodHub`。
4. 运行 `go test ./...`。
5. 运行桌面端 `npm run build`；项目有 typecheck 时一并运行。
6. 手工验证：预览安装 → 执行 → 注入故障 → 重启 → 查看任务 → 安全回滚 → 再次安装。
7. 检查 diff：保留 legacy journal 读取、ZIP 兼容边界和对未托管用户文件的保护。

## 错误码建议

```text
transaction_invalid_state
transaction_journal_corrupt
transaction_missing_blob
transaction_recovery_required
transaction_manual_recovery
transaction_rollback_failed
external_change
plan_stale
instance_busy
```

错误响应包含 operation ID；涉及文件时包含安全相对路径；涉及 hash 时包含 expected/actual，但不返回文件内容。

## 风险与回滚面

- **journal 格式升级**：只增加可选字段；旧 phase 按旧语义映射；事务完成前不原地重写旧 journal。
- **manifest/receipt 写入失败**：保留 journal 状态，启动恢复不得假设提交成功。
- **用户文件被修改**：before/after 双不匹配时进入人工处理，不覆盖文件。
- **旧前端依赖 mock**：保留浏览器模式 fallback，桌面模式优先真实 API。
- **Android SAF 差异**：状态机契约可复用；平台适配须单独证明 rename/flush/部分成功行为，不复用 Windows 原子性宣传。

## 旧逻辑的保留与退休

- 保留 `TxJournal`、blob store、实例锁、before/after hash、legacy journal 读取和 `Recover(operationID)` 兼容入口。
- 收紧 `recoverPendingLocked()`：坏 journal 不再静默忽略；回滚统一 preflight；manifest/receipt 使用安全写入 helper。
- 退休前端“恢复执行”回滚文案、固定日志示例、桌面端 mock 任务作为真实数据源的行为。
- 暂不实现断点续做、跨文件系统事务和 Android SAF 底层原子替换。

## 完成标准

- 所有事务阶段和恢复决策都有自动化测试。
- 关键持久化点中断后，重启结果可预测。
- 外部漂移、journal 损坏、缺失 blob 和回滚失败不会静默成功。
- 后端任务列表来自真实 journal，桌面 UI 不以 mock 作为生产状态。
- UI 动作、后端方法和实际回滚行为语义一致。
- `go test ./...` 与桌面端构建通过，或明确记录无关既有失败。