# 安装计划确认后的执行进度、操作日志与快照可见性

## 目标

点击“确认执行写入”后，直到安装事务结束，桌面端必须持续显示执行进度；执行中的任务必须立即出现在本地操作日志/任务中心，并且对应快照标识在执行期间可见。成功、失败、人工恢复和回滚状态都不能丢失。

## 当前现况

- 计划预览入口在 `clients/desktop/src/components/PlanPreviewModal.tsx`，确认动作回调到 `clients/desktop/src/App.tsx` 的 `handleApplyPlan`。
- 下载/暂存阶段已有 `GetStageProgress(operationId)` 轮询，但这是确认写入之前的归档下载进度，不覆盖 `ExecutePlan` 后的原子写入事务。
- `handleApplyPlan` 当前在 `ExecutePlan({ plan_id, confirmed: true })` 上同步等待；期间先关闭计划预览，未设置写入阶段进度，也未立即刷新操作列表。
- 后端已经具备可复用的事务状态和进度数据：`OperationDetail` 包含 `state`、`phase`、`progress`、`backup_id`、时间和错误字段；`ListOperations`/`GetOperation` 已暴露给 Wails。
- `clients/desktop/src/components/OperationsView.tsx` 已能展示操作阶段、文件处理进度、百分比和 `backup_id`，因此优先补齐数据流和执行态，不重复造一套日志组件。
- 现有 `clients/desktop/src/operationsRefresh.test.ts` 已验证失败后刷新能看到 `needs_manual_recovery`，但没有覆盖“执行中立即出现、持续更新、结束后保留”的完整路径。
- 后端事务实现位于 `cmd/client/SubmodHub/bindings.go` 与 `internal/install`；不要改变既有事务状态机或快照持久化语义，除非测试证明执行开始前没有可查询记录。

## 不变约束

- `ExecutePlan` 的原子写入、恢复和回滚语义保持不变。
- 计划确认、实例切换、游戏运行校验继续有效；轮询不能把旧实例的结果写入当前实例。
- 成功操作仍应保留在本地操作日志和快照清单中；失败/人工恢复操作也必须保留。
- 轮询错误只能标记为暂时无法刷新，不能把已展示的任务从 UI 删除或误报成功。
- 不新增 mock-only 的最终状态；最终状态必须来自 `GetOperation`/`ListOperations` 的本地后端数据。

## 推荐方案

将“确认执行写入”建模为一个前端执行会话：

1. 确认后先保存 `operation_id`、目标实例和计划元数据，立即将该操作放入操作列表或触发一次 `refreshOperations`。
2. 启动固定间隔的 `GetOperation(operation_id)` 轮询；将返回的 `OperationDetail` 映射到统一的执行进度条/任务中心数据。
3. 进度条覆盖 `planned`、`prepared`、`applying`、`committing` 以及结束/错误阶段；百分比以后端 `progress.percent` 为准，未知总量时显示阶段型进度而不是伪造百分比。
4. 每次轮询同时刷新本地操作日志，或以当前操作详情合并入列表，确保执行中的任务立即出现且 `backup_id`/快照标识立即可见。
5. 收到 `committed`、`rolled_back`、`needs_manual_recovery` 或明确错误后停止轮询；保留最终记录，再执行已有的安装清单、模组列表和扫描刷新。
6. 组件卸载路径与安装路径共用这套执行会话，避免只修安装而遗漏卸载事务。

## 分工计划

### Task 1：前端执行会话与进度状态

**Files:**
- Modify: `clients/desktop/src/App.tsx`
- Modify: `clients/desktop/src/wails.ts`
- Modify: `clients/desktop/src/types/client.ts`

**Implementation:**
- 增加可清理的执行轮询句柄和当前执行会话状态，至少包含 `operation_id`、`installation_id`、`Operation`、错误信息和是否结束。
- 在 `handleApplyPlan` 调用 `ExecutePlan` 前，先按 `plan.backend_operation_id`/后端返回可用的 operation id 建立执行会话，并立即刷新操作列表。
- `ExecutePlan` 等待期间持续调用 `GetOperation(operation_id)`；每次成功响应都合并到操作列表和顶部执行进度 UI。
- 只允许当前实例、当前 operation 的响应更新界面；实例切换或组件卸载时清理 timer。
- 安装和卸载共用同一流程；不要删除现有成功后的 `scanLocalSubmods`、安装清单刷新和错误刷新。

**Verification:**
- 新增前端纯逻辑测试，验证执行中操作立即出现、进度按后端响应递增、终态停止轮询、旧实例响应被丢弃。
- 运行 `npm test`（若脚本不存在，使用仓库现有的 Node test 命令）和 `npm run lint`，工作目录为 `clients/desktop`。

### Task 2：执行中进度条与快照/日志可见性

**Files:**
- Modify: `clients/desktop/src/components/OperationsView.tsx`
- Modify: `clients/desktop/src/App.tsx` 或新增同目录下的执行进度组件
- Test: `clients/desktop/src/operationsRefresh.test.ts` 或新增对应纯逻辑测试

**Implementation:**
- 在确认预览关闭后显示非阻塞的“正在执行安装/卸载”进度条，内容包括阶段说明、文件数、百分比和当前文件；不要依赖预览弹窗继续存在。
- 对 `planned`/`prepared` 等暂无文件进度的阶段显示确定性阶段文案；对 `applying`/`committing` 显示后端进度；终态显示成功、失败或需人工恢复。
- 操作列表在执行开始时立即有一行记录；行内显示 `operation_id`、当前状态、进度和 `backup_id`。快照清单若已有独立入口，复用现有 operation/backup 数据刷新机制；若没有独立 API，不新增虚假快照记录，只展示后端返回的快照标识并在结束后刷新清单。
- 执行失败时不清空操作会话，保留日志详情、错误和恢复入口。

**Verification:**
- 测试执行中的 `prepared`、`applying`、`committing`、`committed`、`needs_manual_recovery` 映射。
- 手工验收：确认写入后立即能在任务中心/本地操作日志看到任务；写入多个文件时进度条持续变化；成功后任务和快照仍可查询。

### Task 3：后端契约与持久化核验

**Files:**
- Inspect/Modify only if required: `cmd/client/SubmodHub/bindings.go`
- Inspect/Modify only if required: `internal/install/install.go`, `internal/install/transaction.go` 及相关 manifest/journal 文件
- Test: `cmd/client/SubmodHub/*_test.go`, `internal/install/*_test.go`

**Implementation:**
- 先用现有测试确认 `ExecutePlan` 开始执行前 journal/operation 是否已持久化，且 `GetOperation` 能在执行期间读到 `planned`/`prepared`/`applying` 状态。
- 若执行中的 journal 不可见，只做最小后端修复：在开始写入前持久化 operation 与快照元数据，之后每个事务阶段更新 journal；不得把快照推迟到成功后才创建。
- 保证异常路径仍保留 `needs_manual_recovery`、错误字段和 `backup_id`，并保证重启恢复逻辑继续工作。

**Verification:**
- 增加 Go 测试验证：执行中可读取 operation；快照/备份标识在执行期间存在；提交成功、写入失败和人工恢复三条路径都保留日志与快照。
- 运行 `go test ./internal/install ./cmd/client/SubmodHub`。

### Task 4：端到端回归与兼容检查

**Files:**
- Modify only tests/docs as needed.

**Verification:**
- 前端：`cd clients/desktop; npm run lint`，再运行该项目现有测试命令。
- Go：`go test ./internal/install ./cmd/client/SubmodHub`。
- 若定向测试通过，再运行 `go test ./...`。
- 使用现有浏览器/Wails 测试路径验证：安装计划预览 → 确认执行写入 → 执行中进度 → 成功/失败终态 → 操作日志与快照清单仍可见。

## 风险与回滚

- 风险：`ExecutePlan` 是同步 Wails 调用，若绑定层阻塞同一线程导致 `GetOperation` 轮询无法执行，需要把执行调用放入前端异步任务并确认 Wails runtime 可并发调用；不改变后端写入锁。
- 风险：后端返回的 operation id 与计划 id 不同。必须优先使用后端返回/计划中真实 operation id，不能自行生成第二个日志 id。
- 风险：实例切换造成迟到响应覆盖当前列表。所有响应必须带实例与请求代次校验。
- 回滚面：若 UI 轮询出现问题，可回退到旧的同步确认流程；后端 journal/快照持久化改动必须保持向后兼容旧 journal。

## 完成标准

- 用户确认后无需重新打开操作中心即可看到该任务。
- 从执行开始到安装结束，页面有持续更新的进度条或阶段进度。
- 操作日志和快照标识在执行期间可查，成功、失败、人工恢复后仍保留。
- 安装与卸载均覆盖，实例切换和错误恢复测试通过。
