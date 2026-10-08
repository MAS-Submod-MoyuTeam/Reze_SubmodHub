# GitHub Releases 源同步使用与配置指南

本文档面向模组作者与管理员，详细介绍如何在 SubmodHub 绑定与管理 GitHub Releases 作为模组内容源。

---

## 1. 核心设计与工作模式

- **外部源，权威在站内**：GitHub Releases 仅作为外部资产提供源。SubmodHub 会将 Release 资产下载到站内并完成 SHA-256 校验和静态安全扫描，写入不可变的站内归档与数据库。
- **发布归档严格不可变**：一旦版本在 SubmodHub 审核发布，该版本的二进制归档即永久锁定，即使 GitHub 上对应 Release 的资产被修改或删除，已发布内容不受任何影响。
- **版本号映射**：GitHub Release 的 `tag_name` 严格对应站内版本号（去除首尾空白，不擅自移除 `v` 前缀）。Release 的标题或正文作为初始候选版本发行说明。

---

## 2. 字段说明与配置步骤

模组作者在“新建模组草稿”或“编辑模组”弹窗中，可在“内容与版本来源”分段控件中选择 **GitHub Releases**：

| 字段名称 | 类型 | 必填 | 说明与示例 |
|---|---|---|---|
| `GitHub 组织/用户 (Owner)` | 字符串 | 是 | 仓库所属用户名或组织名，例如 `Monika-After-Story` 或 `octocat`。只允许字母、数字和连字符。 |
| `GitHub 仓库名 (Repo)` | 字符串 | 是 | 仓库名称，例如 `MonikaModDev` 或 `hello-world`。 |
| `Release 资产文件名正则 (RE2)` | 正则表达式 | 条件必填* | 匹配 Release Assets 文件名的 Go RE2 正则。必须匹配 `.zip` 文件。例如 `^MyMod[-_]v?\d+\.\d+\.\d+.*\.zip$`。 |
| `无匹配时使用 Release source code ZIP` | 布尔开关 | 条件必填* | 若 Release 未上传匹配的二进制 assets，是否允许自动使用 GitHub 自动生成的源码包 (`zipball_url`)。 |

*\* 注：必须至少配置资产文件名正则或开启源码包回退开关之一，否则配置校验不通过。*

---

## 3. 正则表达式常见示例

SubmodHub 仅允许下载 `.zip` 格式的 Release 资产文件，非 `.zip` 文件即使匹配正则也会被自动忽略。

1. **精准版本前缀匹配**：
   ```regex
   ^MyMod[-_]v?\d+\.\d+\.\d+.*\.zip$
   ```
   匹配 `MyMod-v1.0.0.zip`、`MyMod_1.2.3-release.zip` 等。

2. **匹配任意包含 mod 名字的 zip**：
   ```regex
   (?i)MyAwesomeMod.*\.zip$
   ```
   忽略大小写匹配包含 `MyAwesomeMod` 且以 `.zip` 结尾的文件。

3. **排除特定平台的包**（例如只要 Windows 版）：
   ```regex
   ^MyMod-.*-windows\.zip$
   ```

4. **多资产稳定排序规则**：
   若同一个 Release 存在多个资产文件命中正则，系统会按文件名进行稳定字母排序（Alphabetical Order），优先选择排序第一的资产，确保重复同步行为完全确定。

---

## 4. 权限与入口保护机制

1. **创建候选版本拦截**：
   - 当模组配置为 `github_releases` 模式时，本站作者工作台隐藏“+ 创建候选版本”按钮。
   - 服务端接口 `POST /api/v1/author/mods/{id}/versions` 直接拦截并返回 HTTP 409 `github_source_managed`，防止版本源状态不一致。
2. **版本号不可篡改**：
   - GitHub 托管的版本在待审/上传状态下，允许作者通过 `PATCH /api/v1/author/versions/{id}/edit` 修订发行说明与依赖关联，但禁止修改 `Version` 标签。修改标签请求会被拒绝并返回 HTTP 409 `github_source_managed`。
3. **审核与发布流**：
   - 自动同步生成的版本默认进入 `ready_for_review`（待审核）状态，复用既有审核工作台，绝不绕过安全扫描与管理员审核。
   - 若系统配置了 `SUBMODHUB_AUTO_PUBLISH=true`，则同步通过扫描的版本自动标记为已发布。

---

## 5. 故障排查与运维

### 手动同步
在作者工作台进入 GitHub 托管模组时，可点击顶部操作栏的 **立即同步 Releases** 按钮：
- 接口地址：`POST /api/v1/author/mods/{id}/github-sync`
- 同步完成后，工作台将即时更新显示同步结果统计（新增版本数、跳过数、失败原因）。

### API 速率限制（Rate Limit）
- SubmodHub 采用匿名 GitHub REST API 读取公开 Releases，并全程携带 `ETag` / `If-None-Match`。未更新时返回 HTTP 304，不消耗内容下载配额。
- 若触发 GitHub API 速率限制（HTTP 403 / 429），系统会自动退避，并在模组状态中记录 `github_last_sync_error: github api rate limit exceeded`。此错误属于非致命错误，不会导致模组下架或服务崩溃。

### 切换回 Local 源与回滚演练
- 作者或管理员可在模组编辑窗口将来源切回 **本站上传 (local)**，或调用 `PATCH /api/v1/author/mods/{id}/source` 设置 `{"source_type":"local"}`。
- 切回 Local 模式后：
  - 立即恢复本站“+ 创建候选版本”入口与上传功能。
  - 此前已通过 GitHub 同步建立的既有版本及其归档完整保留，`source_type` 依然保留历史来源标记。
  - 删除草稿模组或下架模组绝不会删除历史已发布的不可变归档。
