# GitHub Releases 源同步使用与配置指南

本文档面向模组作者与管理员，详细介绍如何在 SubmodHub 绑定与管理 GitHub Releases 作为模组内容源。

---

## 1. 核心设计与工作模式

- **外部源，权威在站内**：GitHub Releases 仅作为外部资产提供源。SubmodHub 会将 Release 资产下载到站内并完成 SHA-256 校验和静态安全扫描，写入不可变的站内归档与数据库。
- **发布归档严格不可变**：一旦版本在 SubmodHub 审核发布，该版本的二进制归档即永久锁定，即使 GitHub 上对应 Release 的资产被修改或删除，已发布内容不受任何影响。
- **版本号映射**：GitHub Release 的 `tag_name` 严格对应站内版本号（去除首尾空白，不擅自移除 `v` 前缀）。Release 的标题或正文作为初始候选版本发行说明。

### 1.1 版本发现方式：按需抓取（默认）与仓库清单（可选）

站内**默认不再主动轮询** GitHub API。每个 `github_releases` 模组由作者在编辑窗口选择一种发现方式，两种方式最终都汇入同一条下载 → 扫描 → 审核流水线，差异只在于**站内怎么知道有新版本**。

| | 站内按需抓取（默认） | 仓库清单 `rezehub.yml`（可选） |
| --- | --- | --- |
| 作者需要额外维护文件 | 不需要 | **需要在仓库根目录维护 `rezehub.yml`，每次发版补一条记录** |
| 站内何时回源 | 有人打开该模组（工作台或详情）且距上次同步超过 `GITHUB_SYNC_TTL` 时 | 同上，但一次请求即可判定有无新版本 |
| GitHub API 配额消耗 | 每次回源 1 次条件请求（未变更时返回 304，不计配额） | **0 次**：清单走 `raw.githubusercontent.com`，不占 REST 配额，也不受 API 退避影响 |
| 更新延迟 | 最多约 `GITHUB_SYNC_TTL`（默认 30 分钟），且长时间无人访问时不会更新 | 清单一改，下一次打开页面即可看到 |

选择建议：**能稳定维护一个文件就选清单模式**；不想多维护文件就保持默认，但要接受「有人访问才会更新、且最多延迟约 30 分钟」这一代价。

#### 清单格式（`rezehub.yml`，仓库根目录）

```yaml
schema: 1
releases:
  - version: 1.2.0
    url: https://github.com/<owner>/<repo>/releases/download/v1.2.0/MyMod-1.2.0.zip
    sha256: 9f2c...（可选，64 位十六进制）
    notes: 本次更新内容（可选）
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schema` | 否 | 省略按 `1` 处理；本服务只接受 `1` |
| `releases[].version` | 是 | 站内版本号，与 `tag_name` 同等地位；同文件内不得重复 |
| `releases[].url` | 是 | 资产的绝对 https 地址，且必须以 `.zip` 结尾 |
| `releases[].sha256` | 否 | 填写后下载完会校验，不一致则该版本失败且归档被丢弃 |
| `releases[].notes` | 否 | 候选版本的发行说明 |

校验规则：未知字段、重复版本、非 https、非 `.zip`、非法 `sha256` 一律整体拒绝，并记录为 `invalid rezehub.yml manifest: ...`（**不会**被当成「没有版本」静默跳过）。单文件上限 1 MiB、最多 200 条。

#### 清单模式的同步语义

- 分支探测顺序为 `HEAD`（默认分支）→ `main` → `master`，全部 404 才判定为「文件不存在」。
- 清单摘要（digest）与上次一致时整轮直接跳过，不会下载任何归档；「立即同步 Releases」按钮会强制重读清单。
- 按清单书写顺序处理；站内已存在的 `version` 直接跳过，只下载新增条目。
- 扫描、审核、`SUBMODHUB_AUTO_PUBLISH` 自动发布的行为与 Releases API 模式完全一致。
- 清单与资产下载同样受管理员配置的 GitHub 代理约束。

---

## 2. 字段说明与配置步骤

模组作者在“新建模组草稿”或“编辑模组”弹窗中，可在“内容与版本来源”分段控件中选择 **GitHub Releases**：

| 字段名称 | 类型 | 必填 | 说明与示例 |
|---|---|---|---|
| `GitHub 组织/用户 (Owner)` | 字符串 | 是 | 仓库所属用户名或组织名，例如 `Monika-After-Story` 或 `octocat`。只允许字母、数字和连字符。 |
| `GitHub 仓库名 (Repo)` | 字符串 | 是 | 仓库名称，例如 `MonikaModDev` 或 `hello-world`。 |
| `版本发现方式` | 二选一 | 是 | **站内按需抓取（默认）** 或 **仓库清单 `rezehub.yml`**，取舍见 [1.1](#11-版本发现方式按需抓取默认与仓库清单可选)。 |
| `Release 资产文件名正则 (RE2)` | 正则表达式 | 条件必填* | 匹配 Release Assets 文件名的 Go RE2 正则。必须匹配 `.zip` 文件。例如 `^MyMod[-_]v?\d+\.\d+\.\d+.*\.zip$`。**仅按需抓取模式使用**；清单模式读取清单里写明的 `url`，忽略此字段。 |
| `无匹配时使用 Release source code ZIP` | 布尔开关 | 条件必填* | 若 Release 未上传匹配的二进制 assets，是否允许自动使用 GitHub 自动生成的源码包 (`zipball_url`)。**仅按需抓取模式使用**。 |

*\* 注：在按需抓取模式下，必须至少配置资产文件名正则或开启源码包回退开关之一，否则配置校验不通过；清单模式下两者都可留空。*

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
- 这是**强制同步**：按需抓取模式会跳过 ETag 条件请求并重新对齐 `releases/latest`；清单模式会忽略清单摘要缓存重读文件。
- 同步完成后，工作台将即时更新显示同步结果统计（新增版本数、跳过数、失败原因）。

### 按需抓取的触发时机与新鲜度
- 触发点：`GET /api/v1/mods/{id}`（查看模组详情）、作者工作台列表加载（每次最多刷新 3 个过期模组）。
- 门控：距 `github_last_sync_at` 超过 `GITHUB_SYNC_TTL`（默认 `30m`）才回源；同一模组同时只允许一个同步在跑（单飞）；处于速率限制退避期时一律不回源。
- `GITHUB_SYNC_TTL=0` 表示关闭按需抓取，只有手动同步会回源。请求结果（版本数等）全部走异步刷新，不阻塞页面响应。
- 如仍需要旧的后台轮询，显式设置 `GITHUB_SYNC_INTERVAL`（例如 `15m`）；默认 `0` 表示不轮询。

### 分页与 ETag 缓存策略
- **分页拉取（Pagination）**：单次请求默认拉取每页最多 100 条（`per_page=100`）。若版本数量超过 100 条，系统会自动解析 GitHub RFC 5988 `Link` 分页头（跟随 `rel="next"`），支持拉取多页版本（设置安全保护上限 20 页 / 最多 2000 条 Releases），确保全部历史版本均能完整进入同步流程。
- **ETag 无条件保存**：首页响应返回的 `ETag` 在收到成功响应（HTTP 200）后无条件保存；即使仓库暂无 Release、列表为空或全部版本均已被过滤，也会完整保存 `newETag` 并在后续请求中持续发送 `If-None-Match`。未变更时返回 HTTP 304，完全不消耗内容配额。
- **304 不再额外请求 `releases/latest`**：列表返回 304 时直接认定无变更。此前每次同步都会再发一次无条件的 `releases/latest`，这是匿名配额（60 次/小时/IP）被打满的主因。手动同步仍会重新对齐 `latest` 标记。

### API 速率限制与自动退避（Rate Limit Backoff）
- **先配 `GITHUB_TOKEN`**：未配置令牌时所有请求共用匿名配额（60 次/小时/IP），托管模组一多就会撞限；配置后为 5000 次/小时。令牌只发给 API 主机，不会随资产下载外泄。
- **自动解析重置时间**：当触发 GitHub API 速率限制（HTTP 403 / 429）时，系统自动解析响应头中的 `X-Ratelimit-Reset`（Unix 时间戳）或 `Retry-After`（秒数/标准时间格式）。若未提供具体头部，系统采用默认 15 分钟退避间隔。
- **保护性退避锁定**：退避期内，模组与后台全局同步器记录 `github_backoff_until` 截止时间。在截止时间到来前，系统定时轮询与手动同步将自动跳过外部网络请求，并在模组状态记录 `github_last_sync_error: github api rate limit backoff active until <UTC时间> (remaining: <剩余时间>)`，彻底防止短时间内连续空耗 IP 配额。清单模式不受该退避影响（不使用 REST API）。
- **自动恢复**：退避时间过后，下一次同步请求恢复正常执行，成功后自动清除退避状态。

### 切换回 Local 源与回滚演练
- 作者或管理员可在模组编辑窗口将来源切回 **本站上传 (local)**，或调用 `PATCH /api/v1/author/mods/{id}/source` 设置 `{"source_type":"local"}`。
- 切回 Local 模式后：
  - 立即恢复本站“+ 创建候选版本”入口与上传功能。
  - 此前已通过 GitHub 同步建立的既有版本及其归档完整保留，`source_type` 依然保留历史来源标记。
  - 删除草稿模组或下架模组绝不会删除历史已发布的不可变归档。

---

## 5. GitHub 全链路代理与服务端按需中转

SubmodHub 支持管理员在系统设置中配置全局 GitHub 代理。HTTP 代理可填写 `host:port`（例如 `100.106.239.85:7890`）或 `http://host:port`，HTTPS GitHub 请求通过 HTTP CONNECT 隧道传输；原有 `https://proxy.example/{url}` URL 重写模板仍受支持：

1. **代理覆盖范围**：
   - GitHub API 请求（仓库信息、Releases 列表、Link 分页）；
   - Release Assets 资产 ZIP 及源码 Source Code ZIP 同步下载；
   - 客户端模组下载时服务端的按需中转拉取（含 CDN 302 重定向）。

2. **代理服务要求**：
   - 代理服务必须同时支持 API 请求转发（保留 Accept/ETag/Link 头）与二进制文件流式下载。
   - 配置代理后，所有 GitHub 请求均严格走代理，代理失败时**不会静默回退至直连**，确保网络策略一致。

3. **发布一致性与下载交付**：
   - 发布哈希、大小及状态仍由主API决定；普通包当前latest后台复制到各启用Cloudreve，首次ready前独立读回验SHA-256。
   - 客户端先取下载描述，优先Cloudreve签名直链，其次授权GitHub节点，最终内置回落；各外部origin必须由API声明并受客户端校验，客户端最终哈希/大小失败不得安装。
   - GitHub转发和内置GitHub回落采用流式传输，不在每次客户端下载前落盘或重新扫描；已知大小不符在响应前拒绝，客户端必须在完整接收后校验发布SHA-256，不能把HTTP200当完整性证明。
   - 此部分替代原代理计划的强制同源下载约束。原主API GitHub出站代理仍服务同步与内置回落，独立节点可另配代理。

4. **历史与精灵包边界**：
   - 不自动搬运全部GitHub历史；站内已发布普通包可补Cloudreve，原始本地归档和旧镜像保留。
   - 精灵包整包、预览和按套选取继续由主服务器处理，不进入Cloudreve镜像调度。
   - 配置、独立认证探针及真实验收要求见[下载交付运维](download-delivery.md)。
