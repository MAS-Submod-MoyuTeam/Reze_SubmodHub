# PC 客户端支持精灵包部分安装实施计划

> 状态：待评审计划；本文只定义实现路径，不直接修改功能代码。

## 目标与边界

让 PC 客户端在安装 `spritepack` 时可以选择一个或多个精灵包集合（`SpriteSet`），只下载、预览和安装所选内容；默认行为保持兼容：非精灵包不变，精灵包在用户未进行选择时仍安装全部集合。选择结果必须进入下载校验、安装预览、执行事务和已安装清单，避免“界面显示选了部分、实际仍安装全部”。

不在本次范围内：改变 Web 已有的精灵包选择语义、重做精灵包扫描规则、修改普通 Submod 的下载/安装协议、增加按单个 JSON item 拆分安装（当前最小安全单元是 `SpriteSet`）。

## 当前实现与根因

- `internal/package/spritepack.go` 已有 `ScanSpriteArchive`、`SpriteSet` 和 `BuildSpriteSelection`，可以按集合生成确定性的 MAS ZIP。
- Web 已通过 `/api/v1/spritepacks/{mod_id}/download?sets=...` 下载选定集合，`ui/catalog-api.ts` 也已有校验下载逻辑。
- 桌面端 `cmd/client/SubmodHub/archive_transfer.go` 的 `StageArchiveRequest` 只有 `api_base`、`version_id`、`operation_id`，因此只能下载通用版本归档。
- 桌面端 `cmd/client/SubmodHub/bindings.go` 的 `parseArchiveFiles` 对精灵包扫描后主动把所有 `SpriteSet.ID` 传给 `BuildSpriteSelection`；这会把“默认全选”固定在后端，无法表达用户的部分选择。
- `clients/desktop/src/components/ModDetailModal.tsx` 已有精灵集合读取/选择的先例，但目录安装入口 `CatalogView.tsx` 到 `StageArchive` 的链路没有传递选择结果。
- 计划必须同时修正下载源、归档哈希、安装预览和清单元数据；只改 UI 或只改 `parseArchiveFiles` 都会造成完整包被下载或安装状态不可追溯。

## 设计决策

### 1. 选择协议

扩展桌面端请求：

```go
type StageArchiveRequest struct {
    APIBase     string   `json:"api_base"`
    VersionID   string   `json:"version_id"`
    OperationID string   `json:"operation_id"`
    Category    string   `json:"category,omitempty"`
    SpriteSets  []string `json:"sprite_sets,omitempty"`
}
```

`Category != "spritepack"` 时忽略 `SpriteSets`。精灵包且 `SpriteSets` 非空时，请求带 `sets` 参数获取选定归档；为空时请求普通版本下载并在客户端兼容地全选。服务端必须校验集合 ID、拒绝未知/重复/空选择，并返回所选 ZIP 的真实 `Content-Length` 与 SHA-256；不能复用原始完整包的描述符哈希。

选择集合按排序后的去重 ID 计算稳定指纹，例如 `sha256(join(sortedIDs, ","))`，写入本地操作/清单元数据，便于相同版本的不同子集被识别为不同安装内容。原始 `version_id` 仍是发布版本身份。

### 2. 下载与执行边界

优先让桌面端在下载阶段获取服务器生成的 selected ZIP，而不是先下载完整 ZIP 再本地裁剪：这样节省带宽并与 Web 语义一致。`StageArchive` 仍负责大小、过期、同源、重定向、哈希和临时文件保护。若浏览器/旧服务端不支持带 `sets` 的下载，只有在可证明分类为精灵包且完整包可验证时才允许旧逻辑回退到本地 `BuildSpriteSelection`；回退结果必须重新计算哈希和大小，且不能静默安装完整包。

### 3. 清单与安全性

安装 manifest/receipt 增加可选的 `sprite_set_ids` 与 `sprite_selection_hash`。旧记录缺省表示历史选择未知，卸载仍以既有文件层记录为准。更新、卸载、修复必须使用 receipt 中的实际集合；对同一 `mod_id`/版本的不同选择明确采取“在同一事务中替换该模组全部层”的策略，禁止分两次事务先卸载再安装，禁止把未选集合误认为属于当前安装。计划预览显示“已选 N 个集合/共 M 个”，并继续展示实际文件变更、覆盖、备份和空间需求。

## 必须先落实的协议约束

- 当前精灵包公共端点以最新发布版本为准。扩展清单、图片和下载端点支持 `version_id`，集合清单返回实际 `version_id`；桌面端冻结该版本再下载，服务端校验版本归属。版本替换/删除时返回 `sprite_version_changed` 并要求重新加载选择，不得把旧集合选择应用到新发布版本。
- `StageArchiveRequest` 还须增加 `mod_id`，统一使用 `sprite_set_ids` 作为选择字段（上方示意的 `SpriteSets`/`sprite_sets` 在实施时替换成 `SpriteSetIDs`/`sprite_set_ids`），避免跨层命名不一致。
- 原始 ZIP 重打包后目录前缀消失，集合 ID 可能改变。staging 内部保存源版本、原集合 ID、后端认定的归档模式和哈希，预览从该条目读取；不能信任前端提交的“已裁剪”标志。标准化子包不再走精灵集合扫描/重打包。
- selected 下载目前没有描述符过期字段。第一期直接校验响应 Content-Length、X-Archive-SHA256 以及新增的源版本/选择元数据；沿用本地 staging 到期时间，不要求不存在的远端过期字段。
- 第一期不实现旧服务端本地裁剪回退：缺少版本/选择协议时明确提示服务端不支持部分安装。完整包路径保持兼容；前述回退设想不属于本期任务。
- 同版本改选采用一次事务替换旧模组层，计划覆盖新旧路径并集。新版本集合 ID 不再存在时要求重新选择；不能自动全选。修复仅使用可验证的本地文件层/缓存；源版本已删除且本地材料不足时报告无法修复。
- 精灵集合索引加载失败时禁止继续“部分安装”；用户可以明确选择独立的全量安装入口，而非静默降级。

## 实施任务

### Task 1：建立桌面端选择数据模型与 API 客户端

**Files:**
- Modify: `clients/desktop/src/types/client.ts`
- Modify: `clients/desktop/src/wails.ts`
- Modify: `cmd/client/SubmodHub/archive_transfer.go`
- Modify: `cmd/client/SubmodHub/frontend/bindings/github.com/reze/submodhub/cmd/client/models.ts`
- Modify: Wails 绑定生成入口及对应绑定测试（不要手工维护生成文件后脱离生成流程）

**Why:** 让选择结果成为安装请求的一等数据，而不是 UI 临时状态。

**Steps:**
- [ ] 为 `Plan`、安装请求和安装结果增加 `sprite_set_ids?: string[]`、`sprite_selection_hash?: string`、`selected_sprite_set_count?: number`，非精灵包保持缺省。
- [ ] 扩展 `StageArchiveRequest` 与 TypeScript wrapper，严格复制选择数组，调用前排序/去重并拒绝空字符串。
- [ ] 为请求序列化增加测试：普通 Submod 不带选择；精灵包传入两个集合；重复/空 ID 在客户端被拒绝或规范化。
- [ ] 重新生成/核对 Wails bindings，并运行 `go -C cmd/client/SubmodHub test -tags browser ./...` 与桌面 TypeScript 检查。

**Verification:** 请求 JSON 中精灵包包含 `category` 和稳定的 `sprite_sets`；旧调用点编译通过且行为不变。

### Task 2：打通 selected ZIP 下载、校验与 staging

**Files:**
- Modify: `cmd/client/SubmodHub/archive_transfer.go`
- Modify: `cmd/client/SubmodHub/bindings.go`
- Modify: `cmd/client/SubmodHub/browser_server.go`
- Modify: `cmd/client/SubmodHub/archive_transfer_test.go`
- Modify: `internal/httpapi/spritepacks.go` 及其测试（仅补齐客户端需要的响应/错误契约）

**Why:** 根治当前“PC 永远下载完整包”的问题，同时保留完整包兼容路径。

**Steps:**
- [ ] 在 `Stage` 构造下载 URL：精灵包有选择时使用 `/spritepacks/{mod}/download?sets=...`；为此请求补充 `mod_id` 字段或从版本详情安全解析，不能把用户输入拼接到未校验路径。
- [ ] 将响应视为已选归档：校验状态码、过期时间、最大尺寸、Content-Length、流式 SHA-256 与最终字节数；将服务器返回的 selected hash/size 记录到 `StagedArchiveInfo`。
- [ ] 删除 `parseArchiveFiles` 中无条件收集全部 `SpriteSet.ID` 的隐式默认行为；根据 staging 的后端归档模式处理：标准化子包直接调用普通 Scan，原始完整包保持全量转换；不能用原集合 ID 二次裁剪标准化子包。
- [ ] 对服务器返回完整包但请求带选择的情况增加保护：扫描集合并本地重建 selected ZIP，或直接失败为 `sprite_selection_not_applied`，不可安装未裁剪归档。
- [ ] 测试成功的单集合/多集合下载、未知集合、集合为空、哈希不匹配、尺寸不匹配、下载取消、旧完整包和 selected ZIP 的最终文件集合。

**Verification:** 选一个集合时 staging 文件不包含其它集合；`PreviewArchive` 的文件数量、字节数和哈希均对应 selected ZIP。

### Task 3：接入 PC 目录安装 UI 与预览确认

**Files:**
- Modify: `clients/desktop/src/components/CatalogView.tsx`
- Modify: `clients/desktop/src/components/ModDetailModal.tsx`（抽取或复用已有集合选择状态）
- Modify: `clients/desktop/src/App.tsx`
- Modify: `clients/desktop/src/components/PlanPreviewModal.tsx`
- Add/Modify: `clients/desktop/src/components/SpritepackSelection.tsx` 及组件测试

**Why:** 用户需要在点击安装前看到并确认实际选择，且目录卡片安装与详情页安装不能产生两套语义。

**Steps:**
- [ ] 对 `category === "spritepack"` 的安装动作先加载集合清单；单集合默认选中，多集合默认全部选中，并允许全选/全不选/逐集合勾选。
- [ ] 每个集合展示名称、item 数量、可用预览图和加载/失败状态；没有选择时禁用继续安装并说明至少选择一个集合。
- [ ] 将选中的有序 ID 传给 `StageArchive` 和后续 `PreviewArchive`/执行上下文；普通 Submod 继续直接进入原流程。
- [ ] 在 `PlanPreviewModal` 显示选择摘要、selected ZIP 大小、预计文件数和集合 ID；关闭或切换实例时清除旧选择，避免串用。
- [ ] 测试单集合默认、多集合只选一个、切换/取消、下载失败、重新打开详情恢复正确集合，不触发重复 staging。

**Verification:** 从目录卡片和详情页分别安装时，最终传入的 `sprite_set_ids` 与预览摘要一致；普通 Submod 快捷安装无回归。

### Task 4：manifest、更新/卸载/修复与操作审计

**Files:**
- Modify: `internal/install/manifest.go`
- Modify: `internal/install/planner.go`、`internal/install/install.go`、事务/收据相关文件
- Modify: `cmd/client/SubmodHub/bindings.go` 的 DTO 映射与 `clients/desktop/src/types/client.ts`
- Add/Modify: `internal/install/*_test.go`、`cmd/client/SubmodHub/*_test.go`
- Modify: `docs/frontend-contract.md`

**Why:** 部分安装必须可被准确更新、卸载和恢复，否则会留下未被记录的文件。

**Steps:**
- [ ] 在安装记录写入规范化的集合 ID、选择指纹、实际 archive hash/size；旧 manifest 读取时将缺省选择标记为未知，不根据缺省字段推断全量安装。
- [ ] 更新/修复以记录的 selected ZIP 和文件层为准；重新选择时生成明确计划，删除旧选择独有文件并保留其它层/原文件。
- [ ] 卸载只移除当前 receipt 拥有的文件；若文件被其它层覆盖，沿用现有恢复逻辑；漂移仍返回 `external_change`，禁止强制覆盖。
- [ ] 操作历史、重启恢复和进度条展示 selected archive 信息；错误详情包含版本、选择指纹和失败阶段，不记录完整归档内容。
- [ ] 添加迁移测试、部分选择安装/卸载/更新/恢复测试、同版本不同选择测试和旧完整安装回归测试。

**Verification:** 中断后重启可恢复同一选择；卸载部分安装不会删除未选择集合或其它模组文件；旧 receipt 可以继续卸载。

### Task 5：端到端验收与发布检查

**Files:**
- Modify: `docs/aegis/plans/2026-10-13-desktop-spritepack-partial-install.md`，补充验证记录
- Optional: `docs/frontend-contract.md`、`clients/desktop/README.md`

**Checks:**
- [ ] `go test ./...`
- [ ] `go -C cmd/client/SubmodHub test -tags browser ./...`（独立 Go module，根目录测试不会覆盖它）
- [ ] `npm --prefix clients/desktop run lint` 和 `npm --prefix clients/desktop run build`
- [ ] `npx --no-install tsx --tsconfig web/tsconfig.json --test ui/*.test.ts web/src/**/*.test.ts web/src/**/*.test.tsx`（按实际 glob 可执行性调整）
- [ ] `git diff --check`
- [ ] 使用包含至少两个 `SpriteSet` 的 fixture：选择一个集合并确认 selected ZIP、预览文件、安装清单、卸载结果；再选择全部集合确认与旧行为一致。
- [ ] 模拟下载中断、服务器返回错误集合、哈希错误、MAS 运行中、外部文件变化，确认不写入或可恢复。
- [ ] 使用 Playwright/Wails 手工验证目录安装入口、详情入口、预览摘要、操作历史和重启恢复。

## 兼容性、风险与回滚

- **兼容性：** API 的完整版本下载、普通 Submod、旧 manifest 和 Web 选择下载保持可用；新字段均可选。服务端应兼容不带 `sets` 的旧客户端请求。
- **安全：** 所有集合 ID必须与服务端扫描报告比对；selected ZIP 重新计算哈希；复用现有路径校验、大小限制、过期、同源和外部变更保护。
- **风险：** 同一精灵资源可能被多个集合共享，`BuildSpriteSelection` 的去重结果必须作为真实文件边界；更新/卸载不能按集合名称猜路径，应使用 manifest 文件层。
- **回滚：** 若服务端 selected 下载不可用，可暂时隐藏 PC 的部分选择入口并恢复“空选择=全量安装”；不得回滚到“用户选择部分但静默安装全部”。已有完整安装记录不受影响。

## 完成标准

1. PC 选择一个精灵集合后，网络请求、staging、安装预览、实际文件和 manifest 全部只包含该集合可达文件。
2. PC 选择多个集合时安装集合并集；重复资源只写入一次，哈希和字节数稳定。
3. 更新、卸载、修复、事务恢复和外部变更保护对部分安装成立。
4. 非精灵包和旧完整精灵包安装路径的现有测试全部通过。
5. 计划中的端到端 fixture 和异常场景均有可重复验证记录。