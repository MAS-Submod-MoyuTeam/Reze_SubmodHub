# 已安装模组文件清单实现计划

## 1. 目标与范围

为客户端“已安装与托管”列表增加“查看文件清单”能力：用户选择某个已安装模组后，可以查看该安装实例实际登记的文件路径、文件类型、当前生效层、哈希、是否发生外部修改，以及文件由哪个版本/安装操作产生。

本计划只覆盖“查询和展示已安装文件清单”，不改变安装、更新、卸载、优先级和收养的行为。未托管模组可以展示扫描得到的文件（若平台能可靠取得），但不能因为查看清单而自动写入或收养。

## 2. 已确认的现状

- `internal/install/manifest.go` 已持久化 `Manifest.Files`、`Manifest.Installations`、`FileRecord` 和 `LayerRecord`。
- `InstallationRecord.Paths` 已记录某次安装涉及的 canonical path，但目前没有面向客户端的文件清单查询 DTO。
- `web/src/types/submodhub.ts` 已有 `InstalledMod`，但没有文件条目类型。
- `web/src/components/ClientCompanion.tsx` 已展示托管/未托管模组，并预留了安装、更新、卸载等入口；当前数据主要来自 `AppContext` 和 mock state。
- `docs/frontend-contract.md` 要求客户端区分托管与未托管，并在文件变化、哈希漂移时提供明确状态。

## 3. 不变的兼容边界

- 继续以 manifest 为托管文件的权威来源，不直接通过目录遍历推断托管归属。
- 继续使用 canonical path 作为内部 key，返回给 UI 的路径使用 `FileRecord.DisplayPath`。
- 不泄露文件内容；本功能只返回元数据和哈希。
- 不允许查看接口修改 manifest、磁盘文件或安装状态。
- 已有安装事务、回滚、优先级和卸载接口保持兼容。
- Android 仍必须先通过 MAS 根目录和权限校验；未授权时返回明确的 `permission_lost`，不能静默读取。

## 4. 推荐方案

采用“客户端原生查询接口 + 前端按模组展开”的方案：

1. Go 安装层从 manifest 生成稳定的只读查询结果。
2. Windows/Android 客户端绑定该查询能力；查询按 `installation_id` 和 `mod_id` 过滤。
3. Web/演示客户端先使用同一 DTO 的 mock 实现，待原生绑定接入后替换数据源。
4. UI 使用抽屉或模态面板展示文件清单，默认按路径排序，并显示摘要、筛选和漂移警告。

不推荐直接让前端读取 `manifest.json`：这会绕过平台权限、破坏 Android 存储边界，并把内部 schema 暴露给 UI。

## 5. 建议 DTO

在 Go 和 TypeScript 中保持字段语义一致：

```json
{
  "installation_id": "mas-main",
  "mod_id": "mod_extra_everything",
  "version_id": "ver_ee_130",
  "version": "1.3.0",
  "title": "Extra Everything",
  "managed": true,
  "installed_at": "2026-10-10T10:00:00Z",
  "files": [
    {
      "path": "game/Submods/ExtraEverything/ee_core.rpy",
      "canonical_path": "game/submods/extraeverything/ee_core.rpy",
      "size_bytes": 1234,
      "sha256": "...",
      "active": true,
      "drifted": false,
      "owner": "mod_extra_everything",
      "version_id": "ver_ee_130",
      "operation_id": "op_123",
      "layer_order": 12,
      "original_exists": false
    }
  ],
  "summary": {
    "total_files": 1,
    "active_files": 1,
    "drifted_files": 0,
    "overridden_files": 0,
    "total_size_bytes": 1234
  }
}
```

实现时如现有平台 API 已有命名约定，优先沿用既有命名；不要把绝对路径、文件内容或备份内容加入 DTO。

## 6. 分阶段任务

### Task 1：定义查询模型和 manifest 查询函数

**文件：**
- 修改：`internal/install/manifest.go`
- 修改或新增：`internal/install/installed_files.go`
- 测试：`internal/install/manifest_test.go` 或 `internal/install/installed_files_test.go`

**步骤：**

1. 增加只读结果类型，例如 `InstalledFileList`、`InstalledFileEntry`、`InstalledFileSummary`。
2. 实现 `Manifest.ListInstalledFiles(installationID, modID string)`：
   - 先查 `Installations[installationID]`；不存在返回稳定错误。
   - 若指定 `modID`，只接受该安装记录的 `ModID` 匹配。
   - 遍历 `InstallationRecord.Paths`，通过 `Manifest.Files[key]` 取得 `FileRecord`。
   - 从 `ActiveLayer()` 计算 owner/version/operation/order。
   - 对当前磁盘文件计算哈希，仅在调用方已完成根目录权限校验后执行。
   - 当前哈希不同于 active layer hash 时标记 `drifted=true`；没有 active layer 时标记为非 active。
   - 按 `DisplayPath` 使用稳定、大小写无关的排序。
3. 对 manifest 中存在但 `Paths` 缺失的异常记录返回诊断信息，不 panic，不修改 manifest。
4. 增加测试：空安装、单文件、多个 layer、被更高优先级覆盖、外部修改、Windows canonical key、文件已被删除、排序稳定。

**验证：** `go test ./internal/install`

### Task 2：增加客户端原生查询契约

**文件：**
- 修改：`internal/install/install.go` 或现有客户端 API 所在文件
- 修改：`web/src/types/submodhub.ts`
- 修改：`docs/frontend-contract.md`
- 测试：对应 Go API 测试和 TypeScript 类型/映射测试

**步骤：**

1. 暴露只读方法，例如 `ListInstalledModFiles(installationID, modID)`，内部调用 Task 1 的 manifest 查询函数。
2. 在入口处统一检查：实例存在、MAS 根目录有效、Windows 目录可访问、Android 权限仍有效。
3. 返回结构化错误：`invalid_mas_root`、`permission_lost`、`not_found`、`manifest_corrupt`；不要把底层绝对路径错误直接展示给用户。
4. 在 TypeScript 增加 `InstalledFileEntry`、`InstalledFileList` 和 `InstalledFileSummary`。
5. 在前端契约文档补充查询方法的输入、输出、错误和只读约束。

**验证：**

- `go test ./internal/install ./internal/maspath`
- `npm --prefix web test -- --run`
- 检查 Android 未授权、Windows 无效目录和正常查询三条路径。

### Task 3：接入 AppContext 数据流

**文件：**
- 修改：`web/src/context/AppContext.tsx`
- 修改：`web/src/data/mockData.ts`
- 测试：新增 `web/src/context/installedFiles.test.ts` 或在现有 context 测试中覆盖

**步骤：**

1. 在 context 暴露 `getInstalledModFiles(modId: string): Promise<InstalledFileList>` 或等价同步 mock 接口。
2. 真实客户端路径调用原生绑定；浏览器/演示路径使用 mock 数据，但 mock 字段必须完全符合 DTO。
3. 以 `activeInstallationId + modId` 做缓存键；安装、更新、卸载、优先级调整和切换实例后清理对应缓存。
4. 查询失败时保留错误码，不用空数组伪装成“没有文件”。
5. 对旧数据缺少文件清单字段时显示“需要刷新/重新扫描”，不要破坏已有已安装列表。

**验证：**

- 已安装模组切换实例后不会显示上一个实例的文件。
- 查询失败显示错误状态并可重试。
- 更新/卸载后重新查询得到最新清单。

### Task 4：实现文件清单 UI

**文件：**
- 修改：`web/src/components/ClientCompanion.tsx`
- 建议新增：`web/src/components/InstalledFileList.tsx`
- 测试：`web/src/components/InstalledFileList.test.tsx`

**步骤：**

1. 在每个托管模组增加“文件清单”按钮；未托管模组显示“查看检测文件”或保持当前仅查看/收养边界。
2. 使用抽屉/模态面板展示：版本、安装时间、文件总数、总大小、漂移数、被覆盖数。
3. 文件表格至少展示：路径、类型/扩展名、大小、短哈希、当前生效状态、来源版本。
4. 增加路径搜索和状态筛选：全部、生效、被覆盖、外部修改、文件缺失。
5. 对长路径使用可展开或 title，不截断真实复制内容；哈希提供复制按钮。
6. `drifted` 或缺失文件使用明确警告，并链接到现有修复/恢复流程；查看清单本身不触发覆盖。
7. 加载、空清单、权限丢失、manifest 损坏和离线缓存分别展示，不统一成空状态。

**验证：** `npm --prefix web test -- --run`，并手工验证桌面宽度、窄屏、长路径和 1000+ 文件分页/虚拟化策略。

### Task 5：性能、分页与验收

**文件：**
- 修改：Task 1/2 中的查询 DTO（若需要分页）
- 修改：`docs/frontend-contract.md`
- 测试：Go 集成测试、前端组件测试

**步骤：**

1. 先确认典型模组文件数；若超过 500 条，接口增加 `cursor`、`limit`，默认 100，最大 500。
2. 确保排序字段稳定，分页不会因 map 遍历顺序导致重复或遗漏。
3. 为包含 1000 个文件的 manifest 增加性能测试，确认查询不会读取文件内容。
4. 增加端到端验收：安装后查看、更新后查看、优先级覆盖、手动改文件、删除文件、卸载后再次查看。

## 7. 明确非目标

- 不在本任务中实现文件内容预览、编辑、下载、恢复或批量导出。
- 不扫描整个 MAS 目录来替代 manifest；未托管扫描属于独立能力。
- 不改变安装包扫描报告中的 `ScanReport.files`，它描述的是归档内容，不等同于已安装磁盘文件。
- 不允许用户从文件清单直接删除单个文件；删除必须走卸载/修复事务。

## 8. 风险与回滚

- 旧 manifest 可能没有完整 `Paths`：以“清单不完整”状态展示，不猜测归属。
- 文件哈希逐个读取可能较慢：先分页，再考虑后台计算；不得为了速度跳过漂移检测。
- Android 授权可能在查询期间撤销：任何读操作都返回 `permission_lost`，前端引导重新授权。
- 若原生绑定尚未具备查询方法，先合入 Go 查询层和 mock UI；不要提交读取本地 manifest 的临时实现。

## 9. 完成标准

- 托管模组可以按实例和模组准确列出其 manifest 登记的文件。
- 文件路径、active layer、owner、版本、哈希和漂移状态与磁盘/manifest 一致。
- 被覆盖文件和外部修改可区分，未托管模组不会出现直接卸载入口。
- Windows/Android 权限边界保持有效，查询失败有稳定错误状态。
- `go test ./...` 和 `npm --prefix web test -- --run` 通过；新增测试覆盖正常、异常和兼容场景。
