# 模组优先级文案与排序修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use aegis:executing-plans to implement this plan task-by-task. 使用复选框记录进度；不自动提交或创建分支。

**Goal:** 导航更名为「模组优先级」，清理全项目旧覆盖术语，模组列表与路径参与模组均按优先级降序，同优先级后安装者在上。

**Architecture:** 保留 Manifest 升序存储及末项赢家规则，前端只排序展示副本；草稿排序与已应用路径关系分开。

**Tech Stack:** React、TypeScript、Node test/tsx、Go、Wails、Vite。

**Baseline / Authority Refs:** 用户要求；internal/install/manifest.go 的 compareLayers/ActiveLayer；internal/install/planner.go 的 Order；internal/install/priority_overview.go；既有 desktop-file-priority 计划。

**Compatibility Boundary:** 不改 Manifest schema、Wails API、JSON 字段、内部 Layer 命名；升级保留 Order；不改脚本加载顺序；路径条目仍按规范化路径字典序排列。

**Verification:** 排序回归、Go 覆盖回归、双前端 lint/build、全仓文案扫描、原生界面验证。

## 调查证据

- `clients/desktop/src/components/PriorityLayersView.tsx:178` 优先级降序后返回 `a.order - b.order`，旧安装者错误在前。`internal/install/priority_overview.go:88` 已按 Order 降序，前端破坏正确结果。
- `internal/install/manifest.go:176` 按 Priority、Order、ModID、InstallationID 升序，ActiveLayer 取末项。后安装者已正确赢得覆盖，不需要修改磁盘决策。
- `internal/install/priority_overview.go:135` 原序复制 Layers；`PriorityLayersView.tsx:924` 直接 map，路径参与模组低至高显示，与说明相反。
- Mods 全平局兜底为 ModID 升序，覆盖决策末项为较大的 ModID/InstallationID。展示统一使用覆盖比较器逆序，验证路径首项与 ActiveOwner 一致。
- filteredPaths 仅搜索；路径名称按 key 字典序没有上述反向问题。修复路径内部模组顺序，不擅自按赢家优先级重排路径条目。
- planner.go 新安装递增 Order，升级保留原值；不用 App 临时生成的 installed_at 替代安装序号。

## Task 1：排序失败回归

**Files:** 修改 `clients/desktop/src/priorityLayers.test.ts`；新增 `internal/install/priority_overview_test.go`；参考 `internal/install/priority_test.go`。

**Why / Impact:** 固定两处顺序与真实赢家，防止只修文案或影响覆盖行为。

**Repair Track:** Order 为持久化安装顺序权威。

**Retirement Track:** Task 2 删除局部比较器和路径原序直出，保留后端存储契约。

- [x] 前端用例 A(priority=50,order=1)、B(50,2)、C(80,0)，期望 C、B、A；另覆盖负数优先级、空数组、不修改原数组、重复排序稳定。
- [x] 全平局分别覆盖 ModID、InstallationID 兜底及 Unicode ID，期望与 Go compareLayers 逆序一致。
- [x] 相同 hash 共享路径与不同 hash 冲突路径均断言排序首项等于 ActiveOwner。
- [x] Go 用 RecordLayer 构造上述记录，验证后安装者胜出、Overview 原 Layers 仍为低至高、全平局赢家一致。
- [x] desktop 运行 `npx tsx --test src/priorityLayers.test.ts`，确认新增比较器测试先失败；根目录运行 `go test ./internal/install -run 'Priority|Overview' -count=1` 验证既有决策。

## Task 2：统一展示比较器

**Files:** 修改 `clients/desktop/src/priorityLayers.ts`、`clients/desktop/src/components/PriorityLayersView.tsx`，测试同 Task 1。

**Repair Track:** 优先级、安装序号及平局兜底统一为高至低展示。

**Retirement Track:** 删除组件局部 order 升序比较和路径直接 map，不 reverse 后端数组。

- [x] 导出以下比较器，字符串按 Go UTF-8 字节序而非 localeCompare：

```ts
interface PriorityDisplayEntry {
  priority: number;
  order: number;
  mod_id: string;
  installation_id: string;
}

function compareGoStringsDescending(first: string, second: string): number {
  const encoder = new TextEncoder();
  const firstBytes = encoder.encode(first);
  const secondBytes = encoder.encode(second);
  for (let index = 0; index < Math.min(firstBytes.length, secondBytes.length); index++) {
    if (firstBytes[index] !== secondBytes[index]) return secondBytes[index] - firstBytes[index];
  }
  return secondBytes.length - firstBytes.length;
}

export function comparePriorityDisplay(first: PriorityDisplayEntry, second: PriorityDisplayEntry): number {
  return second.priority - first.priority || second.order - first.order ||
    compareGoStringsDescending(first.mod_id, second.mod_id) ||
    compareGoStringsDescending(first.installation_id, second.installation_id);
}
```

- [x] sortedMods 排序副本，比较前将两项 priority 替换为 `draftPriorities[item.mod_id] ?? item.priority`，再调用比较器。
- [x] 路径使用 `[...(pe.layers ?? [])].sort(comparePriorityDisplay).map(...)`；key 使用 installation_id，名称回退 ModID、InstallationID。
- [x] 草稿编辑只更新左侧，右侧保留已应用排序；应用成功并重读后统一，不破坏 generation、过期预览和实例切换保护。
- [x] desktop 运行 `npx tsx --test src/priorityLayers.test.ts src/planPreview.test.ts src/installedFiles.test.ts`，全部通过。

## Task 3：文案统一与旧术语清理

**Files:** `clients/desktop/src/components/Sidebar.tsx`、`clients/desktop/src/components/PriorityLayersView.tsx`、`clients/desktop/src/components/InstalledView.tsx`、`clients/desktop/src/components/AdoptModal.tsx`、`clients/desktop/src/priorityLayers.ts`、`clients/desktop/index.html`、`cmd/client/SubmodHub/frontend/index.html`、`cmd/client/SubmodHub/bindings.go`、`web/src/data/mockData.ts`、`docs/aegis/plans/2026-10-11-desktop-file-priority.md`。

**Why / Impact:** 导航、页面、状态、安装表、操作标题、元数据、文档采用同一术语。

**Repair Track:** 用户可见覆盖概念统一为模组优先级。

**Retirement Track:** 删除旧中文术语及 Priority Layers、Layer 数值标签、顶层与堆栈隐喻；保留技术标识 LayerRecord/layers/restores_layer/组件文件名及 Lucide 图标。

- [x] 导航与标题为「模组优先级」；左侧为「当前模组优先级（由高至低生效）」；路径详情为「参与模组（由高至低生效）」；数量为「N 个模组参与覆盖」。
- [x] 数字为「优先级 N」，安装表列名为「优先级」，收养标签为「初始优先级」；移除未经实际验证的 Layer 0~100 暗示，不新增数值限制。
- [x] 页面说明为「管理 MAS 同名文件的覆盖优先级。数值越大越优先生效；同优先级时后安装的模组优先生效。未生效文件会保留，卸载或调整优先级后可恢复。」加载、错误、toast、操作标题同步。
- [x] 工具默认原因改为「优先级生效模组切换」；检查还原摘要等隐含层概念；双 HTML metadata 同步。
- [x] 旧计划统一术语；web mock 中的桌前渲染描述改为「桌前物件显示顺序」，避免误称文件优先级。
- [x] 根目录扫描旧中文术语，确认零匹配；扫描技术与文案区分完成，保留底层技术标识。

## Task 4：验证与交接

- [x] 根目录 `go test ./internal/install -count=1` 与 `cmd/client/SubmodHub` 内 `go test . -count=1` 通过，覆盖安装、预览、应用、还原与重启。
- [x] desktop 运行三份 TS 测试（22 项通过）及 `npm run lint`、`npm run build` 成功；Wails frontend 同样运行 lint/build 成功。
- [x] Go 修改执行 `gofmt -w cmd/client/SubmodHub/bindings.go internal/install/priority_overview_test.go`；根目录 `git diff --check` 0 异常通过。
- [ ] 原生界面先装 A 再装 B，均优先级 50，包含共享和冲突路径；两处 B 在上，冲突路径磁盘内容属于 B。（无桌面会话，待人工复核）
- [ ] A 草稿改 60：左侧 A 在上，应用前右侧 B 仍在上；预览应用重读后右侧 A 在上；改回 50 后 B 在上；重启保持顺序，升级 A 不改变 Order。（无桌面会话，待人工复核）
- [ ] 验证路径名称字典序、搜索后参与模组顺序、空实例、各入口与错误文案。（无桌面会话，待人工复核）

## 风险与边界

- TS number 对极大 int64 Order 精度是既有绑定限制，本计划不迁移类型。
- 不新增拖拽、不迁移持久化、不改变其他列表排序模式与共享路径分类。
- 业务代码与回归用例全部实施并通过自动化测试，不自动创建 Git 提交。
