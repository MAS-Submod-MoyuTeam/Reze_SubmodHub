# SubmodHub 前端功能与接口契约

状态：设计交接稿。本文定义应有能力和目标 API；是否已实现以代码及验证记录为准。
依据：`docs/aegis/specs/2026-09-25-submodhub-design.md`。具体 UI 视觉、布局、组件由设计稿决定。

## 1. 用户、平台与导航

| 平台 | 用户 | 必备视图/流程 |
| --- | --- | --- |
| Web | 访客 | 目录、搜索/筛选、详情、版本、下载信息 |
| Web | 作者 | 我的模组、创建/编辑草稿、ZIP 上传、扫描报告、提交记录 |
| Web | 审核员 | 待审队列、包文件树/警告、批准/驳回、审核历史 |
| Web | 管理员 | 用户角色、审核审计、服务配置状态 |
| Windows/Android 客户端 | 使用者 | Windows 目录选择 / Android 固定目录验证与授权、目录、详情、安装预览、已安装/未托管、优先级、更新/卸载/修复、操作历史与恢复 |

登录仅用于作者、审核员和管理员。访客可浏览与下载。GitHub 使用 OAuth 跳转；Flarum 使用服务端代验凭据。账号关联只能在已登录时主动发起。角色变化后界面必须重新获取会话并即时隐藏无权限操作；服务端仍独立校验权限。

当前实施决策：先接 Flarum，GitHub OAuth 暂缓。Flarum 登录请求体用 `{identification,password}`；仅 Flarum 组 ID `16`、`22` 自动映射 `admin`，其他组当前为 `user`，不自动授予作者或审核员。登录必须通过 HTTPS；远端 `100.72.137.92:18082` 的 HTTP 测试地址不能提交论坛密码。Android MAS 固定根目录是 `/storage/emulated/0/MAS/`，`game/` 是其子目录；Android 11+ 侧载 APK 使用系统“所有文件访问权限”，固定路径和清单声明都不代表已授权。

### 页面功能

- **目录**：关键词、分类（`submod`/`spritepack`）、平台、标签筛选；按游标分页；显示已发布的最新版本与兼容范围。无结果、加载失败和离线缓存须有独立状态。
- **详情/版本**：作者、简介、兼容 MAS 范围、依赖、发行说明、扫描摘要、ZIP 大小和 SHA-256。下载按钮先取得下载描述符；客户端再进入计划预览。
- **作者工作台**：新建草稿，编辑元数据与依赖，上传 ZIP，等待扫描，查看逐文件报告与阻断原因，提交审核；被驳回后复制/修订为新候选版本。显示所有版本各自的审核状态。
- **审核工作台**：查看包文件树、静态检测结果、脚本/二进制警告、重复注册名与 sprite `giftname` 冲突；写入批准/驳回理由。批准时自动发布并按作者选择更新目录最新版本。公开版本只能下架，不能修改归档字节。
- **客户端目录与授权**：Windows 显示自动探测的 MAS 安装，允许手选并管理多个实例；Android 显示固定 MAS 根目录和“所有文件访问权限”的实际状态，提供打开系统授权页的操作。用户从设置页返回、重启应用或撤销权限后刷新状态；未授权或未验证目录不得读取/写入托管文件。Android 不显示 SAF 目录选择器作为自动回退。
- **客户端安装预览**：列出依赖阻断、语义冲突、覆盖文件、外部文件备份、下载大小、剩余空间及最终生效层。用户确认后才能写入。
- **客户端已安装**：区分托管版本和未托管检测结果；未托管内容只有查看/显式收养流程，不提供直接卸载。优先级调整须先显示哪些文件会改变。
- **客户端操作与恢复**：展示下载、扫描、备份、写入、提交进度；重启后按操作 ID 恢复显示。文件哈希漂移时暂停并展示路径、预期/实测哈希，不自动覆盖。提供日志导出和备份恢复。
 
## 2. 公共数据约定

- REST 基址：`/api/v1`，JSON 采用 `snake_case`，ID 为不透明字符串，时间为 UTC RFC 3339。
- 列表：`{ "items": [...], "next_cursor": "..." }`；`next_cursor: null` 表示结束。筛选变化后丢弃旧游标。
- 错误：`{ "code": "stable_code", "message": "fallback text", "details": {} }`。前端按 `code` 本地化，`message` 仅作后备。
- 上传、提交、审核、发布等重试敏感写操作带 `Idempotency-Key` 请求头。服务端相同 key 与请求内容返回相同结果；不同内容拒绝。
- Web 会话使用安全 Cookie；修改请求附带 CSRF token。客户端令牌放入平台安全存储，不进入网页本地存储。
- 公开 `version_id`、`sha256`、`size_bytes`、ZIP 字节在发布后不可变。删除列表项意味着下架，不意味着删除历史归档。

### 核心 DTO

```json
{
  "mod": {
    "id": "mod_123", "title": "Example", "summary": "...",
    "author": { "id": "user_1", "display_name": "Author" },
    "category": "submod", "tags": ["dialogue"],
    "supported_platforms": ["windows", "android"],
    "mas_version_range": ">=0.12", "recommended_priority": 0,
    "latest_version_id": "ver_456"
  },
  "version": {
    "id": "ver_456", "mod_id": "mod_123", "version": "1.0.0",
    "state": "published", "size_bytes": 123456,
    "sha256": "64 lowercase hexadecimal characters",
    "release_notes": "...", "dependencies": [
      { "mod_id": "mod_other", "version_range": ">=1.2", "required": true }
    ], "scan_report_id": "scan_789"
  }
}
```

扫描报告须包含 `status`（`pending|running|ready|failed`）、`files`（`source_path,target_path,size_bytes,sha256,kind,warnings`）、`unsupported_paths`、`registrations`（含 `confidence: known|unknown`）、`sprite_identities`、`derived_gifts`、`blockers`、`warnings` 和资源统计。未知静态解析结果不得显示成“安全”。

## 3. Web API 路由

| 方法与路径 | 权限 | 请求/结果 |
| --- | --- | --- |
| `GET /mods` | 公开 | `q,category,platform,tag,cursor,limit`；分页 `ModSummary` |
| `GET /mods/{mod_id}` | 公开 | `ModDetail`，含已发布版本摘要 |
| `GET /mods/{mod_id}/versions/{version_id}` | 公开 | `ModVersion` 与扫描摘要 |
| `GET /versions/{version_id}/download` | 公开 | `{url,expires_at,sha256,size_bytes}`；URL 可为签名或代理地址 |
| `GET /session` | 登录可选 | `{user,roles,csrf_token}`；未登录 `user:null` |
| `POST /auth/flarum/login` | 公开 | HTTPS；`{identification,password}`；建立会话，密码不回显 |
| `GET /auth/github/start` / `GET /auth/github/callback` | 公开 | OAuth state + PKCE 登录/关联流程 |
| `POST /auth/logout` | 登录 | 结束当前会话 |
| `POST /identity-links/{provider}/start` | 登录 | 发起主动关联，回调后刷新会话 |
| `GET /author/mods` / `POST /author/mods` | 作者 | 我的模组；创建草稿 |
| `PATCH /author/mods/{mod_id}` | 作者 | 编辑未发布元数据、依赖 |
| `POST /author/mods/{mod_id}/versions` | 作者 | 创建候选版本及发行说明 |
| `POST /author/versions/{version_id}/archive` | 作者 | `application/zip` 上传，返回扫描任务/报告 ID |
| `GET /author/versions/{version_id}/scan` | 作者 | 完整扫描报告与当前状态 |
| `POST /author/versions/{version_id}/submit` | 作者 | `ready_for_review`；返回 Submission |
| `GET /author/submissions` | 作者 | 提交历史及审核理由 |
| `GET /review/submissions` | 审核员 | `state,cursor,limit`；待审队列 |
| `GET /review/submissions/{id}` | 审核员 | 元数据、ZIP 文件树、扫描报告、历史 |
| `POST /review/submissions/{id}/decision` | 审核员 | `{decision:"approve|reject",reason}`；批准即发布 |
| `POST /review/submissions/{id}/publish` | 审核员 | 仅兼容历史 `approved` 记录的补发 |
| `GET /review/audit` | 审核员 | 游标分页的审核/下架事件 |
| `POST /admin/users/{id}/roles` | 管理员 | `{roles:["author"|"reviewer"]}`；目标 ID 为 `flarum:<numeric_id>`；显式角色集，空数组撤销附加角色并记录审计；不能通过此接口授予 `admin` |
| `POST /admin/versions/{id}/unpublish` | 管理员 | `{reason}`；可恢复的下架 |
| `POST /author/github-imports` | 作者 | Release URL/asset 标识导入为草稿，并走相同扫描审核 |

路径是目标契约，后端实现时若有调整，须同步 OpenAPI 与本文，再交给前端。

## 4. 客户端 Go 绑定契约

下列绑定面向 Wails v3，Windows 与 Android 使用相同业务 DTO。Windows 目录选择、Android 固定根目录校验与权限查询、平台文件读写由各自适配器完成。

| 绑定调用 | 输入 | 输出 |
| --- | --- | --- |
| `ListInstallations` | 无 | `Installation[]`，含 `id,label,platform,path_hint,permission_state,mas_version` |
| `GetAndroidStorageAccess` | 无 | `{state:"granted|denied|unsupported",root:"/storage/emulated/0/MAS/",game_path:"/storage/emulated/0/MAS/game"}`；每次调用查询系统授权，不使用缓存判断 |
| `RequestAndroidStorageAccess` | 无 | 打开本应用“所有文件访问权限”系统设置页；返回 `{opened:true}` 只表示设置页已打开，不表示已授权 |
| `DiscoverInstallations` / `SelectInstallation` | 平台选择结果 | Windows 为验证后的选择结果；Android 只验证固定 MAS 根目录，未授权返回 `permission_lost`，无效目录返回 `invalid_mas_root` |
| `RefreshCatalog` / `GetMod` | 筛选/ID | 与 Web 公共 DTO 一致，附缓存时间/离线状态 |
| `DownloadVersion` | `version_id` | `operation_id`；校验下载大小与哈希 |
| `PreviewInstall` / `PreviewUpdate` / `PreviewUninstall` | 安装实例、版本 | `Plan`；无文件写入 |
| `PreviewPriority` | 实例、`mod_id -> priority` | 改变生效层的路径与潜在冲突 |
| `ApplyPlan` | `plan_id` | `operation_id,status` |
| `ListInstalled` | 安装实例 | 托管版本、未托管检测结果、更新状态 |
| `ListOperations` / `GetOperation` | 实例/操作 ID | 阶段、逐文件进度、阻断信息与恢复选项 |
| `RecoverOperation` / `RestoreBackup` | 实例、操作/备份 ID | `operation_id,status` |
| `ExportLogs` | 可选操作 ID | 本地导出文件位置 |

`Plan` 至少包含 `plan_id,kind,installation_id,mod_id,version_id,expires_at,dependency_blockers,semantic_blockers,changes,backups_required,bytes_required,warnings`。每条 `change` 含 `target_path,action,previous_owner,next_owner,previous_hash,next_hash,reason`。只在阻断项为空、权限有效且 MAS 未运行时允许确认。

操作状态为 `planned -> downloading -> scanning -> backed_up -> writing -> committed`；失败时为 `blocked|recoverable|rolling_back|rolled_back`。前端必须能在重启后通过 `operation_id` 重连状态。进度事件可优化体验，但持久化的 `GetOperation` 是权威来源。

## 5. 状态机与错误展示

候选版本：`draft -> uploaded -> scanning -> ready_for_review -> published`。批准直接进入 `published`；历史 `approved` 记录仍可补发。扫描失败回到可修改草稿并附原因；审核驳回为 `rejected`，作者从该候选修订后重新提交。下架为独立公开可见性状态，不回写 ZIP。

| 错误码 | 前端动作 |
| --- | --- |
| `unauthenticated`, `forbidden` | 提示登录或权限不足，刷新角色 |
| `validation_failed`, `invalid_archive`, `unsupported_path`, `scan_limit_exceeded` | 定位表单字段或 ZIP 扫描报告 |
| `invalid_transition`, `idempotency_conflict` | 刷新提交状态，避免重复提交 |
| `dependency_missing`, `version_incompatible`, `semantic_conflict` | 阻断安装，展示受影响模组/文件 |
| `permission_lost`, `invalid_mas_root` | Android 前者打开系统“所有文件访问权限”页并在返回后刷新，后者报告固定 MAS 根目录无效；Windows 可重新选择目录 |
| `game_running`, `insufficient_space` | 停止写入，说明可恢复条件 |
| `external_change` | 展示路径及预期/当前哈希，禁止自动覆盖 |
| `operation_recoverable`, `backup_missing` | 进入恢复流程或报告无法自动恢复的原因 |
| `offline`, `download_hash_mismatch`, `download_size_mismatch`, `download_expired`, `download_too_large`, `crypto_unavailable` | 下载失败时不保存归档；可重试获取新描述符，安装仅限已验证的本地 ZIP |

页面/客户端至少提供这些可设计状态：加载中、空目录、无搜索结果、离线缓存、未登录、权限不足、上传中、扫描中、扫描警告、扫描阻断、审核中、驳回、下架、未授权目录、权限撤销、游戏运行中、外部文件冲突、依赖缺失、操作可恢复、回滚完成。错误状态的操作入口应对应上表，不使用模糊的“重试”覆盖所有情况。

## 6. 验收旅程与交付边界

1. 访客搜索模组，查看兼容性和版本，获取带 SHA-256 的下载描述符。
2. 作者登录、建草稿、上传旧式 ZIP、查看扫描报告、提交；审核员批准并发布；公开详情显示不可变版本。
3. Windows 用户选择 MAS 目录；Android 用户在系统设置授予“所有文件访问权限”并验证固定 MAS 根目录。双方预览覆盖和依赖、安装、调整优先级、更新、卸载，并在中断后恢复。Android 须用真实设备验证授权、拒绝、撤销与重启后的状态。
4. 手工修改已安装文件后再次操作，客户端以 `external_change` 暂停，不覆盖用户文件。

本文是前端设计输入，不是 UI 实现或已通过的发布验收。前端设计稿应覆盖 Web 与双平台客户端的全部视图和上述关键状态。
