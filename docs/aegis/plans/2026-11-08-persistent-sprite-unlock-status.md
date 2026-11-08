# 本机精灵包礼物状态与删除确认实施计划

**Goal:** 在“已安装精灵包”中对每个已安装 JSON 项提示存档是否确认已赠送/解锁，并以应用内确认弹窗替代浏览器原生确认。

**Architecture:** Go `DesktopService` 在当前精灵包扫描中只读定位当前 MAS persistent 存档，以受限的 pickle 协议解析器抽取 MAS 的已解锁/可赠送映射，再通过 sprite type、sprite ID 与 giftname 关联扫描结果。缺失、不可读、结构不支持或两张 map 相互矛盾时不附带状态，UI 因而不显示提示。前端现有 `InstalledView` 负责状态徽标与自有删除确认对话框。

**Tech Stack:** Go 标准库（zlib 与有界输入读取）+ `github.com/nlpodyssey/gopickle`（协议 2 解析、严格 GLOBAL allowlist 与被动 reducer），React 19/TypeScript、现有 Wails bindings 与测试工具。

**Baseline / Authority Refs:** 用户确认的设计（2026-11-08）；`docs/aegis/specs/2026-09-25-submodhub-design.md`；`docs/frontend-contract.md`；`cmd/client/SubmodHub/spritepacks.go`；`clients/desktop/src/components/InstalledView.tsx`；`clients/desktop/src/wails.ts`。

**Compatibility Boundary:** 不修改 MAS 存档；保留现有 sprite JSON 扫描、礼物创建、文件备份/删除行为。Windows 默认 `%APPDATA%/RenPy/Monika After Story/persistent`；Android 默认 MAS 根目录的 `saves/persistent`。未知状态不展示状态徽标。删除的确认与取消行为保留，执行路径不变。

**Change Necessity:** 无代码方案无法把 Ren'Py persistent 状态与已安装的 sprite JSON 关联，也无法替换 `window.confirm`；最小改动位于 Go 扫描及解析、Wails 数据模型、`InstalledView`。

**TDD Route:** Mode `auto`; decision `strict`; authority `auto risk decision`; persistence/security-sensitive parser and producer-consumer UI contract; tests fail before production edits. Verify parser boundaries, scan mapping, component states and delete-dialog cancellation/confirmation.

## Tasks

1. [x] **安全解析 persistent 并映射扫描结果**
   - 新增受限、资源有界的 zlib + Ren’Py pickle 解析 owner；严格限制自定义 GLOBAL，reducer 只返回被动 Go 数据结构，不执行 Python 代码或任意自定义构造器；提取 `_mas_sprites_json_gifted_sprites` 与 `_mas_filereacts_sprite_gifts`，严格解析 `(type, sprite ID)`。
   - 在 spritepack 扫描时增加可选解锁状态，只对唯一、明确的存档状态赋值；缺文件/解析错误/缺键/冲突一律不附状态。
   - Go 单测覆盖有效压缩 fixture、已解锁/未赠送键、冲突、损坏/超界与不支持 opcode；扫描集成测试确认 identity 关联。
   - 验证：`go test ./...`、`go vet ./...`；真实本机存档读回 8 个 unlocked、137 个 pending identity。

2. [x] **已安装精灵包提示与自有删除确认**
   - Wails/TypeScript Spritepack 数据模型增加可选三态字段；卡片仅在确定时显示“已赠送（已解锁）”或“未赠送”。
   - 将 `window.confirm` 替换为应用内 accessible alertdialog，含文件影响/备份说明、取消、确认与进行中状态。
   - 前端测试覆盖两种徽标、未知状态隐藏、弹窗取消不调用删除、确认调用一次。
   - 验证：新增 TSX 交互测试 2/2 通过，全部桌面 Node 测试 144/144 通过，typecheck 通过。

3. [x] **端到端回归与构建验证**
   - Wails TypeScript bindings 已重新生成；`npm run lint`、`npm run build` 与 `git diff --check` 通过。
   - Windows `%APPDATA%` 路径和 Android `MAS/saves/persistent` 路径均有单元覆盖；未在 Android 真机执行验证。

## Verification Results

- Go 全模块：`go test ./...` 与 `go vet ./...` 均退出码 0，且包含本机 MAS persistent 读回用例。
- 前端：全部 Node 测试 144/144；新增 InstalledView TSX 用例 2/2；TypeScript 检查通过。
- 构建：`npm run build` 成功；Vite 报告 bundle 超过 500 kB 的优化提示。
- 静态检查：`git diff --check` 通过；InstalledView 中不再引用 `window.confirm`。
- 平台边界：Android 路径逻辑由测试覆盖，但 Android 真机读文件权限与 MAS 实际目录尚未验收。

**Risks / Stop:** Ren'Py pickle opcode 或对象状态变化时安全失败并隐藏徽标，不降级执行存档代码；多实例共用系统 Ren'Py 用户存档属于当前 MAS 常见布局，Android 只读固定 MAS saves 路径。不得将解析失败映射为“未赠送”。

## 复审后续修复（2026-11-08）

1. **礼物解锁文件：缓存报告仍会下发**
   - `SpriteIndexVersion` 提为 3（`packagezip.SpriteIndexVersion`），扫描与刷新守卫共用同一常量，旧缓存报告会被重扫而不是原样下发。
   - `BuildSpriteSelection` 自身再过滤一次 `characters/*.gift`：选定套装下载路径不会重扫，这是 token 到达磁盘前的最后一道拦截。
   - 回归：`TestScanSpriteArchiveStampsCurrentIndexVersion`、`TestBuildSpriteSelectionDropsGiftTokensFromStaleReport`。

2. **礼物名比较改为大小写不敏感**
   - 同一个 token 既出现在 JSON 字段里，也以文件名形式出现；作者只改大小写时不应丢徽标。真正不同的礼物名仍然不借状态。
   - 回归：`TestSpriteGiftStatus` 增加大小写与“不同礼物名”两组断言。

3. **删除确认对话框的键盘与失败反馈**
   - Esc 关闭、打开时聚焦“取消”、点遮罩关闭；删除进行中不允许关闭。
   - `onDeleteSpritepack` 不再吞掉错误而是向上抛，失败时对话框保持打开并就地显示原因——失败 toast 的层级在对话框之下，用户看不见。
   - 回归：InstalledView 的 Esc 关闭与失败保留原因两条 TSX 用例。

4. **可诊断性**
   - `readMASPersistent` 失败原因写入日志，而不是完全静默；界面仍然不显示徽标。
   - 预览里被忽略礼物的文案改为“N 个 .gift 礼物解锁文件已忽略”：列出的是归档路径，`gifts/x.gift` 是同一 token 的旧写法，原文案“characters 目录下的”与实际列出的路径不符。

**平台边界：** `spriteSavePath()` 只覆盖 Windows `%APPDATA%\RenPy\Monika After Story\persistent` 与 Android `saves/persistent`；其余平台返回空路径，表现为不出徽标。