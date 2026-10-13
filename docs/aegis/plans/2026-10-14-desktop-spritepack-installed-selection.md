# 精灵包已安装选择回显与卸载提示实施计划

日期：2026-10-14。状态：待实施；本次仅编写计划，不修改功能代码、不提交 Git。

## 1. 用户要求与最终语义

套装勾选表示“应用后最终安装的集合”，不是本次增量下载清单。

- 当前 MAS 实例从未安装此模组：保留默认全选。
- 当前 MAS 实例已安装且选择记录完整：默认只勾选已安装集合，未安装集合不勾选。
- 已安装提示固定显示：“已选择当前安装的项目。勾选其他套装可追加安装；取消勾选已安装套装并应用后，这些套装将被卸载。”
- 尚未应用时，勾选/取消勾选均只编辑草稿，不写入或删除游戏文件。
- 点击“应用套装选择”后先预览，再确认执行。按钮不再让用户误以为每次操作都是追加安装。
- 默认选中内容来源是当前实例的安装记录，不是服务器目录、模组是否曾在其他实例安装，也不是磁盘上有无同名 JSON。

示例：原来安装 A；打开详情只选 A；增加 B 后应用得到 A+B；取消 A 后应用得到 B；全选后应用得到全部集合。

## 2. 基线与兼容边界

当前 `App.tsx` 已把 receipt 的 `sprite_set_ids`、`sprite_selection_hash` 映射到 `InstalledItem`，但仅向详情传 `isInstalled` 和版本文案。`ModDetailModal.tsx` 的 `onSpritepackSuccess` 除版本冲突外仍默认全选。`PlanInstall` 已对同一模组执行原子替换，清理新选择中没有的旧文件层，不需要新增“增量安装”引擎。

基线文件：
- `clients/desktop/src/App.tsx`
- `clients/desktop/src/types/client.ts`
- `clients/desktop/src/modDetailTracker.ts`
- `clients/desktop/src/modDetailTracker.test.ts`
- `clients/desktop/src/components/ModDetailModal.tsx`
- `clients/desktop/src/components/SpritepackSelection.tsx`
- `clients/desktop/src/components/PlanPreviewModal.tsx`
- `clients/desktop/src/spritepackUtils.ts`
- `cmd/client/SubmodHub/bindings.go`、`bindings_test.go`
- `internal/install/planner.go`

保持普通 Submod、Web 下载、版本绑定、staging 哈希验证、generation 隔离、事务回滚和外部文件漂移保护不变。仅有选择已知的托管安装才能显示“已选当前安装项目”；未托管扫描不能推断安装集合。

## 3. 数据与状态设计

详情新增受当前实例约束的输入：

```ts
interface SpriteInstallationSnapshot {
  instanceId: string;
  modId: string;
  versionId: string;
  operationId: string;
  setIds?: string[];
  selectionHash?: string;
}
```

`App` 从当前实例已加载的托管 `InstalledItem` 构造快照；不传另一实例或旧加载批次的数据。额外传安装记录加载状态（loading/ready/error），不能用列表尚为空来判断“从未安装”。首装判定仅在当前实例记录成功加载且确实不存在该模组时成立。

在 `spritepackUtils.ts` 定义纯函数 `deriveSpriteSelection`，输入已公开集合、快照及加载状态，输出：

```ts
type SelectionBaseline = {
  mode: 'first_install' | 'known_installed' | 'unknown_installed';
  initialIds: string[];
  installedIds: string[];
  unavailableInstalledIds: string[];
};
```

初始化规则：
1. 首次安装：`initialIds` 为全部公开集合 ID。
2. 已安装且 ID 与选择指纹齐全：`initialIds` 为已安装 ID 与当前公开 ID 的交集；缺失 ID 进入 `unavailableInstalledIds`。
3. 已安装但旧 receipt 没有可验证选择：`unknown_installed`，初始不勾选，不默认全选；显示“旧安装记录无法识别已安装套装，请重新选择最终保留的套装；应用将替换旧安装内容”。必须显式确认该风险后继续。
4. 安装记录加载中或失败：阻断初始化/应用，显示加载或重试，不视作首装。

相同实例、模组、版本下，使用安装快照 operationId 与选择指纹识别基线。初始化只在基线改变、用户显式重试或版本冲突刷新时发生，普通重渲染不能覆盖勾选草稿。切换实例、模组或版本时立即使旧请求与旧草稿失效；详情加载 token 必须纳入实例上下文，而不只依赖 modId。

版本更新后，不猜测套装改名关系，只取稳定 ID 交集。缺失的已安装 ID 显示“以下已安装套装在当前版本不可用，应用后将移除旧安装内容”，列出 ID；服务器新集合不自动勾选。若没有任何交集，默认零选择并等待用户决定，不能自动全选。

## 4. 交互与确认设计

### 4.1 套装列表

- 已安装项目展示“已安装”徽标；取消勾选时展示“应用后将卸载”。徽标由基线决定，不随草稿选择改变。
- 未安装且新勾选项目展示“待安装”。
- 展示实时摘要：“保留 N 个 / 新增 M 个 / 卸载 K 个”。缺失公开 ID 的旧集合纳入移除提示；未知旧记录不显示虚假的精确卸载数量。
- 全选、取消全选复用同一状态更新；取消全选不立即卸载。
- 下载已选 ZIP 与安装变更分开：下载操作不能更改安装快照，也不确认卸载。

### 4.2 零选择与无变化

- 首次安装零选择：继续阻断，提示“请至少选择一个套装”。
- 已安装、选择记录已知且全部取消：按钮显示“卸载此精灵包”，复用现有 `handleStartUninstallPlan` / `PreviewUninstall`，不得向 selected ZIP 下载端点提交空集合。
- 未知旧记录零选择：可以显式“卸载此精灵包”，使用既有托管 operation ID 卸载，不伪装为选择重建。
- 同版本且集合选择无变化：禁用应用并提示“套装选择未变化”；版本变化即使集合 ID 一致仍允许更新。下载按钮不受无变化限制。

### 4.3 预览

计划预览显示最终选择和移除摘要。存在旧集合取消、版本缺失旧集合或未知旧记录替换时，增加独立确认：“我确认应用后将卸载未保留的已安装套装”。该确认不代替已有覆盖确认。

集合层文案解释：卸载表示移除本模组拥有的相关文件层；共享文件可能仍被其他选中集合或模组使用，物理文件是否删除/恢复以真实后端计划为准。不能把“集合数量”当成 REMOVE 文件数量。

## 5. 原子实施任务

### Task 1：选择基线与差异纯函数

**修改：** `clients/desktop/src/spritepackUtils.ts`。
**测试：** `clients/desktop/src/spritepackSelection.test.ts`。

- [ ] 先新增失败测试：首装全选；已安装 A 默认只选 A；新增 B 得 A+B；取消 A 识别移除；全选得全集；旧选择缺失；未知旧记录；安装状态加载失败。
- [ ] 实现 `deriveSpriteSelection` 与差异函数，采用去重有序 ID；差异以安装基线和最终草稿计算，不从 UI 文案反推。
- [ ] 验证重复 ID、空 ID、版本变更、未公开旧 ID；默认状态绝不将未知旧记录推断为全量安装。

验证：`npx --no-install tsx --tsconfig clients/desktop/tsconfig.json --test clients/desktop/src/spritepackSelection.test.ts`。

### Task 2：实例隔离的安装快照与异步初始化

**修改：** `clients/desktop/src/App.tsx`、`clients/desktop/src/components/ModDetailModal.tsx`、`clients/desktop/src/modDetailTracker.ts`。
**测试：** `clients/desktop/src/modDetailTracker.test.ts`。

- [ ] 将当前实例安装记录与加载状态传入详情，增加 instanceId、快照身份和记录有效性的检查。
- [ ] 把默认全选初始化替换为 Task 1 的基线策略；版本冲突刷新按新清单重新建立基线，提示重新检查，不保留过期选择。
- [ ] token 扩展到实例上下文，保护成功、失败、进度及 finally；不同实例但相同模组的迟到响应也应丢弃。
- [ ] 安装完成后重新读取当前实例 receipt，更新快照；操作失败或回滚不把草稿写成已安装状态。
- [ ] 添加实际加载函数延迟测试：实例 I 的 A 请求迟到不能覆盖实例 II 的 A；重试不能串实例；基线刷新不能在普通重渲染时丢掉用户草稿。

验证：`npx --no-install tsx --tsconfig clients/desktop/tsconfig.json --test clients/desktop/src/modDetailTracker.test.ts`；再运行桌面 lint。

### Task 3：已安装回显、差异提示与零选择路由

**修改：** `clients/desktop/src/components/SpritepackSelection.tsx`、`ModDetailModal.tsx`、`clients/desktop/src/App.tsx`。
**新增测试：** `clients/desktop/src/components/SpritepackSelection.test.tsx`、`ModDetailModal.test.tsx`，使用项目已有 DOM 测试环境，不新增测试框架。

- [ ] 展示用户要求的固定提示、已安装徽标、取消后的卸载徽标、保留/新增/卸载摘要。
- [ ] 操作命名区分首次“安装所选套装”和已有安装“应用套装选择”，全部取消路由到已有卸载预览。
- [ ] 记录加载失败与旧选择未知提供明确阻断/风险确认；下载行为与安装状态完全独立。
- [ ] 挂载真实组件测试：A 已安装默认 A；勾 B 后 payload 为 A+B；取消 A 后 payload 为 B；全选 payload 为全集；零选择触发 uninstall 回调且不调用 StageArchive。
- [ ] 测试只操作草稿不会删除文件、关闭再打开恢复安装基线、实例切换不会继承前一个实例的选择。

验证：`npx --no-install tsx --tsconfig clients/desktop/tsconfig.json --test clients/desktop/src/components/SpritepackSelection.test.tsx clients/desktop/src/components/ModDetailModal.test.tsx`。

### Task 4：预览卸载确认与真实事务回归

**修改：** `clients/desktop/src/types/client.ts`、`clients/desktop/src/planPreview.ts`、`clients/desktop/src/components/PlanPreviewModal.tsx`。
**测试：** `clients/desktop/src/planPreview.test.ts`、新增 `clients/desktop/src/components/PlanPreviewModal.test.tsx`、`cmd/client/SubmodHub/bindings_test.go`。

- [ ] 为 Plan 增加仅展示用途的变更上下文（基线/最终 ID、移除 ID、未知旧选择警告）；保存预览时的快照，不读取执行时可变的勾选状态。
- [ ] 真实文件动作仍完全采用后端 Plan；前端差异不授权删除。存在移除风险必须额外确认，纯新增不用卸载确认；关闭/切换计划重置所有确认。
- [ ] 针对同版本验证安装 A → 应用 A+B → 应用 B → 全选 → 全部取消卸载。每次检查磁盘、manifest、receipt 的最终集合与文件层一致。
- [ ] 验证共享资源、底层原件恢复、外部修改阻断、事务失败回滚；未选集合不会错误删除其他模组层。

验证：`go -C cmd/client/SubmodHub test -tags browser ./...`；运行 planPreview 与组件测试。

### Task 5：文档与最终验收

**修改：** `docs/frontend-contract.md`、本计划追加验证证据。

- [ ] 文档明确选择是最终状态，不是自动追加；纠正“只勾新增项目即可追加”的歧义。
- [ ] `npm --prefix clients/desktop run lint`。
- [ ] `npm --prefix clients/desktop run build`。
- [ ] `go test ./internal/install ./internal/httpapi`。
- [ ] `go -C cmd/client/SubmodHub test -tags browser ./...`。
- [ ] `git diff --check`。
- [ ] 真实 Wails 或 browser-mode 手工验证首装全选、已安装回显、追加、减选、全选、清空卸载、实例切换、版本缺失集合和旧 receipt；记录实际命令与结果，不用单元测试代称真实端到端验证。

## 6. 修复与退役轨道

修复：选择默认值由当前实例安装快照与清单共同决定，移除“所有非冲突成功加载都全选”的根因；保留首次安装全选。

退役：删除详情里重复或无条件的全选初始化，只保留统一基线函数；保留显式全选操作、已有 selected ZIP 和原子替换引擎；不增加第二套增量安装协议。不手工改生成绑定，不为 UI 文案无故修改后端安装语义。

## 7. 验收标准

1. 从未安装时默认全选；已有可追溯安装时仅选已安装集合。
2. 详情明确提示“已选择当前安装的项目”，取消勾选后清楚说明应用将卸载。
3. A → A+B → B → 全部 → 空集合卸载均符合最终选择，且必须预览确认才能落盘。
4. 加载中的空列表、旧选择未知和另一实例的安装记录不误判为首次安装。
5. 版本更新缺失旧集合被明确提示，不自动加入新的未安装集合。
6. 真实组件与迟到请求测试通过；原有 Submod、事务恢复、共享层和漂移保护无回归。
