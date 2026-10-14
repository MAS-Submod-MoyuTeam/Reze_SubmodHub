# External Change Recovery and Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use aegis:subagent-driven-development (recommended) or aegis:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复外部修改/删除导致的 `事务校验阻断` 与 `external_change` 流程，使用户能先安全回滚恢复，再从“已安装模组 → 修复”真正执行后端修复，而不是只修改前端状态。

**Architecture:** 保留事务层的外部漂移安全护栏，不允许自动覆盖未知内容。补齐恢复操作的状态映射、桌面绑定和 UI 引导；把已安装模组的 repair 入口接到真实的归档预览/执行链路，并由后端重新生成计划和哈希校验。所有用户可见错误统一从后端错误码/诊断派生，移除前端模拟成功分支。

**Tech Stack:** Go、React、TypeScript、Wails bindings、Vitest、Go test。

**Baseline / Authority Refs:** `docs/frontend-contract.md`（`external_change`、恢复入口与 plan blocker 契约）、`docs/operations.md`（外部漂移必须进入 `needs_manual_recovery`，禁止自动覆盖）、`internal/install/transaction.go`、`internal/install/install.go`、`cmd/client/SubmodHub/bindings.go`、`clients/desktop/src/App.tsx`、`clients/desktop/src/components/InstalledView.tsx`、`clients/desktop/src/components/PlanPreviewModal.tsx`。

**Compatibility Boundary:** 不削弱 `external_change` 的安全阻断；不自动覆盖外部新增/修改内容；保持现有 Wails 方法与 JSON 字段兼容；不覆盖用户当前未提交改动，尤其是 `clients/desktop` 和 `cmd/client/SubmodHub` 下已有修改。

**Verification:** 针对事务恢复、repair 预览/执行、阻断引导分别增加失败测试；运行 `go test ./internal/install ./cmd/client/SubmodHub` 与桌面相关 `npm test`/项目已有 Vitest 命令，并检查 `git diff` 确认没有伪造成功状态或错误提示残留。

---

## Facts, assumptions, and unknowns

- **事实：** `internal/install/transaction.go` 已识别外部哈希漂移并记录 `external_change`；`needs_manual_recovery` 可通过 `RollbackOperation` 恢复。
- **事实：** `clients/desktop/src/App.tsx:570` 的 `handleStartRepairPlan` 仅使用 `setTimeout` 把 `integrity_status` 改成 `intact`，没有调用后端。
- **事实：** `PlanPreviewModal` 展示 `事务校验阻断 [plan_blocked]`，但当前流程未把用户直接带到可用的安全恢复动作。
- **假设：** 已安装项已有 `managed_operation_id`/归档信息可用于构造真实 repair 请求；若某类历史安装缺少该信息，应显示不可自动修复并提供重新扫描/人工处理，而不是伪成功。
- **未知：** 当前 repair 后端是否应复用 `PreviewArchive`，还是需要新增明确的 `PreviewRepair`/`ApplyRepair` API；执行 agent 必须先根据 `InstalledItem` 与绑定定义确认，优先复用兼容链路，只有无法表达 repair 语义时才新增 API。

## Task 1: Reproduce and lock transaction recovery behavior

**Files:**
- Modify: `internal/install/transaction_test.go`、`internal/install/safety_regression_test.go`
- Inspect/modify only if required: `internal/install/transaction.go`、`internal/install/install.go`
- Modify: `cmd/client/SubmodHub/bindings_test.go`

**Why this task exists:** 确保文件被修改和被删除两种漂移都进入同一安全恢复路径，且错误码、路径、期望/实际哈希可供 UI 使用。

**Repair Track:** 根因是恢复/校验路径可能只验证存在文件或只在事务执行阶段保留诊断；锁定 canonical transaction owner 的行为，使 missing 与 modified 都稳定返回 `external_change` 并保持 `needs_manual_recovery`。

**Retirement Track:** 删除/修改任何只检查单一文件状态的重复分支；保留事务层唯一的哈希比较与状态迁移实现，绑定层不得自行推断或改写错误码。

**Verification:** 新增测试：事务准备后删除受管文件、修改受管文件，分别调用 rollback/recovery；断言错误码为 `external_change`、阶段为 `needs_manual_recovery`、`CanRollback` 与恢复材料状态准确，并且后续写事务仍被阻断。

- [ ] 写两个失败测试，覆盖 modified 与 deleted 外部漂移。
- [ ] 运行 `go test ./internal/install -run 'External|Recovery|Rollback' -count=1`，确认测试先失败或暴露现有差异。
- [ ] 只在必要处修正事务诊断/状态迁移，保持未知内容不被覆盖。
- [ ] 运行同一测试与 `go test ./internal/install -count=1`。

## Task 2: Make backend repair contract real

**Files:**
- Modify: `cmd/client/SubmodHub/bindings.go`
- Modify: `cmd/client/SubmodHub/bindings_test.go`
- Modify generated/checked-in bindings only if repository convention requires: `cmd/client/SubmodHub/frontend/bindings/github.com/reze/submodhub/cmd/client/*`

**Why this task exists:** 前端 repair 需要后端产生真实的、可校验的 repair plan；缺少托管操作、归档或安装实例时必须返回可识别错误，不能成功假报。

**Repair Track:** 以现有 `PreviewArchive`/`ApplyArchive` 或同等 canonical installer API 为 owner，按已安装项的真实 installation/mod/version/managed operation 信息生成 repair 计划；把 blocker、`operation_id`、`external_change` 诊断完整映射给客户端。

**Retirement Track:** 删除或停止使用任何“仅返回完整/修复成功”的 mock repair 方法；不在绑定层复制事务哈希算法。

**Verification:** 增加 Go binding 测试：完整托管记录能生成 repair plan；缺少记录返回明确错误；外部漂移时 plan 保持 blocked 且错误码不被改成泛化的 `plan_blocked`。

- [ ] 先写绑定层失败测试，明确请求字段和返回字段。
- [ ] 运行 `go test ./cmd/client/SubmodHub -run 'Repair|External|Plan' -count=1`。
- [ ] 实现最小兼容 API，优先复用现有 archive/install 入口。
- [ ] 更新必要的 Wails 类型并运行 `go test ./cmd/client/SubmodHub -count=1`。

## Task 3: Replace the fake Installed → Repair flow

**Files:**
- Modify: `clients/desktop/src/App.tsx`
- Modify: `clients/desktop/src/types/client.ts`、`clients/desktop/src/wails.ts`（如存在对应类型/导出）
- Modify: `clients/desktop/src/components/InstalledView.tsx` only for labels/disabled state if needed
- Add/modify: `clients/desktop/src/components/InstalledView.test.tsx` or existing App/interaction test location

**Why this task exists:** 当前 `handleStartRepairPlan` 用 `setTimeout` 直接把状态改为 intact，导致点击“修复”无法修复真实文件，也掩盖了 backend error。

**Repair Track:** 删除模拟 toast、定时器和本地强制 `integrity_status: 'intact'`；调用真实 repair preview，显示文件变更/阻断，复用现有 `handleApplyPlan` 执行事务，成功后强制重新扫描安装清单。

**Retirement Track:** 前端本地完整性状态只作为扫描结果展示，不再作为 repair 成功来源；任何旧 mock handler、假 operation id、假 plan 都应移除或改为测试 fixture。

**Verification:** React 测试断言点击修复调用 Wails repair/preview；后端拒绝时保留错误提示且不修改状态；成功必须经过真实 apply/refresh；无 `setTimeout` 模拟成功路径。

- [ ] 写失败测试，验证 repair click 的 Wails 调用及错误不变更状态。
- [ ] 运行桌面相关单测命令（以 `clients/desktop/package.json` scripts 为准）。
- [ ] 接入真实 preview/apply，并处理缺少托管记录的明确提示。
- [ ] 运行新增测试与现有 `clients/desktop` 测试。

## Task 4: Guide users from transaction blocker to recovery first

**Files:**
- Modify: `clients/desktop/src/components/PlanPreviewModal.tsx`
- Modify: `clients/desktop/src/components/OperationsView.tsx`
- Modify: `clients/desktop/src/App.tsx`
- Modify/add: corresponding desktop component tests

**Why this task exists:** 用户看到“事务校验阻断”后应先恢复未完成事务，而不是继续尝试 repair/install；当前提示未改变且没有直达安全恢复入口。

**Repair Track:** 当 blocker/error 为 `external_change` 或 operation state 为 `needs_manual_recovery` 时，使用后端 operation detail 的 `can_rollback` 和 operation id 展示明确文案：先检查/安全回滚，再重新预览；提供“重新校验并安全回滚”按钮，调用 `RollbackOperation`，成功后刷新操作和已安装列表。

**Retirement Track:** 移除把所有错误都显示为单一“事务校验阻断”的旧 fallback；保留通用 blocker 展示，但 `external_change` 必须走专门分支，不能用普通重试替代。

**Verification:** UI 测试覆盖：external_change 显示路径/期望/当前状态和恢复 CTA；不可回滚时显示人工处理说明；回滚成功关闭阻断并刷新；回滚失败保留真实错误码。

- [ ] 写组件失败测试，锁定文案、CTA 和调用参数。
- [ ] 实现专门的 external-change recovery branch，不改变安全阻断。
- [ ] 运行组件测试与 TypeScript 检查。
- [ ] 手工检查“阻断 → 恢复 → 重新预览 → 修复”主流程的状态切换。

## Task 5: End-to-end regression and cleanup

**Files:**
- Modify/add: `cmd/client/SubmodHub/bindings_test.go`
- Modify/add: desktop tests adjacent to `App.tsx`, `PlanPreviewModal.tsx`, `InstalledView.tsx`
- Update only if behavior contract changed: `docs/frontend-contract.md`, `docs/operations.md`

**Why this task exists:** 防止后端错误码、绑定映射和 UI 提示再次漂移，覆盖用户报告的完整路径。

**Repair Track:** 编写端到端回归：安装事务被外部修改/删除 → 阻断 `external_change` → 首屏引导恢复 → 安全回滚 → 重新扫描 → 已安装模组修复真实文件。

**Retirement Track:** 搜索并移除残留的 fake repair 成功文本、旧 `plan_blocked` 泛化提示和重复 error mapping；文档只保留实际 API/状态。

**Verification:** `go test ./internal/install ./cmd/client/SubmodHub -count=1`；桌面 `npm test` 与 `npm run build`（按 package scripts 可用性执行）；`rg -n "setTimeout|修复完成|事务校验阻断" clients/desktop/src` 只允许测试 fixture/合法通用文案残留。

- [ ] 运行后端回归测试。
- [ ] 运行桌面测试、类型检查和构建。
- [ ] 执行残留搜索并删除误导性 fallback。
- [ ] 汇总 `git diff`，确认只触及本问题相关文件且未覆盖用户已有未提交改动。

