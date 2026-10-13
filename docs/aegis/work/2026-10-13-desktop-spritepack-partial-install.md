# PC 客户端支持精灵包部分安装实施总结

## 概述

已完整落地 `docs/aegis/plans/2026-10-13-desktop-spritepack-partial-install.md` 计划。PC 客户端在安装 `spritepack` 时支持选择一个或多个精灵集合（`SpriteSet`），只下载、校验、预览和安装所选内容；未选择或非精灵包时保持向后兼容的全量/既有流程。

## 关键改动

1. **HTTP API 与协议强化 (`internal/httpapi/spritepacks.go`)**：
   - 精灵包集合清单端点返回当前 `version_id`，且支持校验请求中的 `version_id` 参数；若版本不匹配返回 `409 Conflict (sprite_version_changed)`。
   - 精灵包下载端点 `/api/v1/spritepacks/{mod_id}/download` 增加严格的 `sets` 校验（拒绝未知、空或重复集合 ID），响应头带上 `X-Archive-SHA256`、`X-Version-ID` 与 `Content-Length`。

2. **下载校验与暂存 (`cmd/client/SubmodHub/archive_transfer.go`)**：
   - `StageArchiveRequest` 扩展 `ModID`、`Category`、`SpriteSetIDs` 与 `SpriteSelectionHash` 字段。
   - 对 `Category == "spritepack"` 且指定选择集的请求，直接流式下载 selected ZIP，校验 Content-Length、X-Archive-SHA256 与所选集合排序指纹，登记为标准化子包 `IsSelectedSpritepack`。

3. **规划引擎与归档模式处理 (`cmd/client/SubmodHub/bindings.go`)**：
   - `parseArchiveFiles` 移除无条件全选硬编码，区分标准化子包与原始包。标准化子包直接走普通 `packagezip.Scan`，避免重复裁剪或集合 ID 混淆。
   - `PreviewArchive` 与 `ExecutePlan` 完整透传 `SpriteSetIDs`、`SpriteSelectionHash`、`SelectedSpriteSetCount` 至安装计划单据、安装记录及事务日记中。

4. **安装记录与 Manifest (`internal/install/manifest.go`, `planner.go`, `transaction.go`)**：
   - `InstallationRecord`、`InstallOperation`、`Plan` 与 `TxJournal` 记录 `SpriteSetIDs`、`SpriteSelectionHash` 与 `SelectedSpriteSetCount`。
   - 读取旧 Manifest 时，缺省字段保持为空/未知，不隐式推断为全量安装。
   - 跨集合更新、并集追加与集合删减复用原子层事务：自动计算新旧文件差集，旧选择独有文件安全清理，重叠文件与底层原文件正常还原或覆盖。

5. **桌面端前端 UI 与交互 (`clients/desktop`)**：
   - 新增 `SpritepackSelection.tsx` 组件，提供套装选择、全选/全不选、缩略图展示以及零选择阻断提示。
   - `ModDetailModal.tsx` 集成套装选择组件，默认多选全部套装、单选唯一套装，底部提供“安装已选套装 (N)”与“下载已选 ZIP”操作。
   - `CatalogView.tsx` 针对精灵包的卡片安装引导至详情选择流程，杜绝静默全量安装。
   - `PlanPreviewModal.tsx` 新增精灵包部分安装摘要模块，展示所选套装数、集合 ID 清单、选择指纹与变更文件数。

## 验证与测试

已完成全套单元测试与集成测试验证：
- `go test ./...`：全部通过
- `go -C cmd/client/SubmodHub test -tags browser ./...`：全部通过
- `npm --prefix clients/desktop run lint`：TypeScript 类型检查 0 错误
- `npm --prefix clients/desktop run build`：生产环境构建通过
- `npx tsx --tsconfig clients/desktop/tsconfig.json --test clients/desktop/src/*.test.ts`：55/55 测试通过
- `npx tsx --tsconfig web/tsconfig.json --test ui/*.test.ts`：37/37 测试通过
- 端到端场景测试覆盖：单集合安装、并集追加、同版本改选/删减集合、外部变更漂移阻断（`external_change`）以及卸载清理。
