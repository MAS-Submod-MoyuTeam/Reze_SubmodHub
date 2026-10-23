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

登录仅用于作者、审核员和管理员。访客可浏览与下载。登录只走 Flarum，使用服务端代验凭据；不提供 GitHub OAuth 登录入口。角色变化后界面必须重新获取会话并即时隐藏无权限操作；服务端仍独立校验权限。

当前实施决策：登录只接 Flarum，Web 端已移除 GitHub OAuth 登录与账号绑定入口；Flarum 是唯一身份来源，界面不再提供任何「绑定第三方账号」操作（`/identity-links` 契约与 `User.linked_accounts` 字段一并删除）。Flarum 登录请求体用 `{identification,password}`；仅 Flarum 组 ID `16`、`22` 自动映射 `admin`，其他组当前为 `user`，不自动授予作者或审核员。登录必须通过 HTTPS；远端 `100.72.137.92:18082` 的 HTTP 测试地址不能提交论坛密码。Android MAS 固定根目录是 `/storage/emulated/0/MAS/`，`game/` 是其子目录；Android 11+ 侧载 APK 使用系统“所有文件访问权限”，固定路径和清单声明都不代表已授权。

### 页面功能

- **目录**：关键词、分类（`submod`/`spritepack`）、平台、标签筛选；按游标分页，滚动进入列表底部预取区即自动续页，手动「加载更多」按钮保留为无障碍与无 `IntersectionObserver` 环境的兜底；刷新目录后游标回到首页。显示已发布的最新版本与兼容范围。无结果与加载失败须有独立状态。
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
    "category": "submod", "tags": ["工具", "绘图"],
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
| `GET /tags` | 公开 | `{groups:[{name,children}],revision}`；站点标签目录（读取失败时前端回退到模组聚合），不缓存 |
| `GET /mods/{mod_id}` | 公开 | `ModDetail`，含已发布版本摘要 |
| `GET /mods/{mod_id}/versions/{version_id}` | 公开 | `ModVersion` 与扫描摘要 |
| `GET /versions/{version_id}/download` | 公开 | `{url,expires_at,sha256,size_bytes,delivery_type,node_id,allowed_download_origins,completion_token,fallback_reason?}`；普通包可为外部HTTPS直链，精灵包本地；不缓存描述 |
| `POST /versions/{version_id}/download-complete` | 持一次尝试token | `{completion_token,sha256,size_bytes}`；一小时内当前进程幂等接受客户端完成报告，指标每15秒批量保存；重启使旧token失效；版本报告去重满时429，仅影响报告；不能冒充独立交付审计 |
| `GET /app-update` | 公开 | 应用自更新描述：`{tag_name,version,name,notes,prerelease,published_at,checksum_url,release_url,snapshot_age_seconds,assets:[{name,size_bytes,sha256,delivery_type,node_id,url,expires_at,allowed_download_origins,github_url}]}`；`release_url` 是 GitHub Release 页面（说明加全部资产），即使没有任何镜像资产也会返回，供下载入口兜底；`delivery_type` 只会是 `cloudreve` 或 `github`（无 builtin 字节代理）；仅返回已读回校验的镜像直链；`snapshot_age_seconds` 是服务端快照年龄，超过 30 分钟客户端会再问一次 GitHub；元数据未就绪 `503 app_release_unavailable`，客户端据此回落 GitHub；不缓存 |
| `GET /admin/download-nodes` | 管理员 | 含固定builtin、脱敏节点、共享revision、主密钥配置状态及无外部节点回落提示；无密码/密文/内部对象 |
| `POST /admin/download-nodes` / `PUT /admin/download-nodes/{id}` | 管理员+CSRF+同源 | `{revision,node}`；类型约束能力；秘密仅写，空密码保留；共享设置revision冲突409 |
| `DELETE /admin/download-nodes/{id}` | 管理员+CSRF+同源 | `{revision}`；builtin不可删除，不删除网盘对象 |
| `POST /admin/download-nodes/{id}/test` | 管理员+CSRF+同源 | `{revision}`；认证和目录元数据；不创建临时文件，不证明写权限或大包验收 |
| `POST /admin/download-nodes/{id}/retry-mirrors` | 管理员+CSRF+同源 | `{revision}`；仅重置failed镜像，保留ready对象；节点GET以 `mirror_states`（模组归档）与 `app_asset_states`（应用自更新资产）分别返回当前revision状态数量 |
| `GET /session` | 登录可选 | `{user,roles,csrf_token}`；未登录 `user:null` |
| `POST /auth/flarum/login` | 公开 | HTTPS；`{identification,password}`；建立会话，密码不回显 |
| `POST /auth/logout` | 登录 | 结束当前会话 |
| `GET /author/mods` / `POST /author/mods` | 作者 | 我的模组；创建草稿 |
| `PATCH /author/mods/{mod_id}` | 作者 | 编辑未发布元数据、依赖 |
| `POST /author/mods/{mod_id}/versions` | 作者 | 创建候选版本及发行说明 |
| `POST /author/versions/{version_id}/archive` | 作者 | `application/zip` 上传，返回扫描任务/报告 ID |
| `GET /author/versions/{version_id}/scan` | 作者 | 完整扫描报告与当前状态 |
| `POST /author/versions/{version_id}/submit` | 作者 | `ready_for_review`；返回 Submission |
| `GET /author/submissions` | 作者 | 提交历史及审核理由 |
| `GET /review/submissions` | 管理员 | `state,page,page_size`；轻量提交摘要及 `total,page,page_size,pending_count` |
| `GET /review/submissions/{id}` | 管理员 | 元数据、ZIP 文件树、扫描报告、历史 |
| `POST /review/submissions/{id}/decision` | 审核员 | `{decision:"approve|reject",reason}`；批准即发布 |
| `POST /review/submissions/{id}/publish` | 审核员 | 仅兼容历史 `approved` 记录的补发 |
| `GET /review/audit` | 管理员 | `page,page_size`；`{items,total,page,page_size}` 审核/下架事件 |
| `POST /admin/users/{id}/roles` | 管理员 | `{roles:["author"|"reviewer"]}`；目标 ID 为 `flarum:<numeric_id>`；显式角色集，空数组撤销附加角色并记录审计；不能通过此接口授予 `admin` |
| `POST /admin/versions/{id}/unpublish` | 管理员 | `{reason}`；可恢复的下架 |
| `POST /author/github-imports` | 作者 | Release URL/asset 标识导入为草稿，并走相同扫描审核 |
| `GET /spritepacks/{mod_id}` | 公开 | 可选 `version_id`；返回 `{sets:[...], version_id}`；版本不匹配返回 409 `sprite_version_changed` |
| `GET /spritepacks/{mod_id}/preview` | 公开 | `set,item` 及可选 `version_id`；返回预览图片 PNG |
| `GET /spritepacks/{mod_id}/download` | 公开 | `sets`（逗号分隔集合 ID）及可选 `version_id`；响应头带 `X-Archive-SHA256`, `X-Version-ID` 与 `Content-Length` |

### 作者专属工作区分页（已实施）

“候选与发布版本”“提交历史”使用 `page,page_size`，默认 1/20、最多 100 条，响应含 `items,total,page,page_size`；空列表和越界回退规则与审核列表一致。工作区界面默认每页 10 条，可切换 20/50 条。“我的模组”改为键集游标窗口，见下条。

- `GET /author/mods` 仅返回当前作者的 `{mod,is_published,has_published_version,has_archived_version,has_pending_review,candidate_version_id}`，不内嵌版本和扫描报告。四个版本派生字段覆盖该模组的全部版本，因此“上传替换包/下架/删除草稿/提交中禁用”等判断不依赖当前窗口；`candidate_version_id` 是可复用的最新可编辑版本（draft/uploaded/rejected/scanning），避免上传时新建重复候选。`has_published_version`（存在已发布版本）与 `has_archived_version`（存在已下架版本）互相独立：一个模组可以同时有一版在线、一版已下架，任何一方为真都不允许“删除草稿模组”，只有两者都为假且未公开才是纯草稿。
- 排序使用模组自身的 `created_at` 严格创建序：新创建的在前，缺失 `created_at` 的历史记录置后，ID 倒序兜底；不再拿“最近版本时间”代理创建时间。创建模组时即写入 `created_at`；更早的数据由一次性脚本 `cmd/backfill-mod-created-at` 回填（取该模组最早的版本/提交时间，无子记录时取回填时刻），重复执行不改变结果。
- 分页为键集游标：请求 `page_size`（默认 20，范围 1–100）与可选 `cursor`，响应 `{items,total,page_size,start,cursor,next_cursor,prev_cursor}`。`cursor` 复现当前窗口（首个窗口为 null），`next_cursor` 末窗为 null，`prev_cursor` 只在首窗为 null——它为空字符串时表示上一窗就是首窗，因此“不在首窗就一定有上一窗”。`start` 只是首行下标、仅供显示，不参与定位。窗口按 `(created_at,ID)` 锚定，多人并发写入时后续窗口既不重复也不跳过数据；代价是前端只能逐窗前进/后退，不能按页码跳转（界面用 `WindowPager` 表达这种翻页，`Pagination` 只用于真页码列表）。
- `focus_mod_id` 定位本人目标模组所在窗口（非本人 ID 忽略），支持创建或从历史修订跳转；它优先于 `cursor`，同时给出时以焦点为准。响应回传该窗口自身的 `cursor`，前端采用后立即清除焦点，之后的刷新与翻页都停在同一个窗口。
- `GET /author/mods/{id}/versions` 仅返回本人模组的当前页版本，附 `scan_reports`（只包含当前页版本的报告）；版本按创建时间、ID 倒序，缺失时间置后；隐藏归档路径和内部 GitHub 下载源。
- `GET /author/submissions` 支持 `state` 筛选；返回本人当前页提交、显示名称、版本号、理由、脱敏快照和 `current_version`，用于历史扫描报告与驳回修订。审核队列与作者历史共用同一套标题/作者/版本号投影，避免两处漂移。

管理员也不能通过作者接口读取其他作者的工作区。前端只在对应标签打开时加载，切换模组重置版本页，旧请求取消并忽略；同一查询的重新加载保留当前窗口内容（`refreshing`）而不回退到加载态，查询本身变化才清空旧数据；操作后刷新当前窗口，每分钟刷新可见窗口。全局上下文不再于登录或定时器中加载整个作者工作区。扫描报告仍可随单页版本/历史返回，因此单个报告很大时仍有详情接口拆分空间。本次不改变内存目录存储。

### 审核列表分页（已实施）

`GET /review/submissions` 和 `GET /review/audit` 使用页码响应 `{items,total,page,page_size}`，不使用公共目录的游标结构。`page` 默认 1；`page_size` 默认 20，范围 1–100；非法、空或重复的分页参数返回 400 `validation_failed`。提交列表另返回跨筛选的 `pending_count`（所有 `ready_for_review` 提交数）。`state` 可省略或为 `all,ready_for_review,approved,rejected,published`，未知值返回 400。

两种列表按创建/事件时间倒序、ID 倒序打破同时间并列。提交摘要包含 `id,mod_id,version_id,author_id,state,created_at,mod_title,author_name,version_str,category`；不携带版本快照、扫描报告或文件树，选中后请求详情。不存在对应模组/版本时，摘要使用 ID 作为显示值；有提交版本快照时使用快照版本号。

越界页码回到当前末页，空列表返回 `items:[],total:0,page:1`。审核结果可能改变筛选数量，前端以服务端返回的有效页为准。分页请求相互独立，不提供跨请求的历史快照；并发新增可能改变页边界。切换页码/筛选时取消并忽略旧请求，加载失败保留重试入口，审核成功后重新查询当前页与计数（同一查询的重新加载保留当前内容、只标记为 `refreshing`），失败保留理由。审核数据只在打开工作台时加载，审计只在打开对应标签时加载。

当前存储以进程内目录为查询源；本次限制响应大小、摘要构造与前端渲染，不改变目录整体载入方式。筛选、总数和排序仍在内存执行，后续存储规模增长时应在存储层承接查询。

路径是目标契约，后端实现时若有调整，须同步 OpenAPI 与本文，再交给前端。

## 4. 客户端 Go 绑定契约

下列绑定面向 Wails v3，Windows 与 Android 使用相同业务 DTO。Windows 目录选择、Android 固定根目录校验与权限查询、平台文件读写由各自适配器完成。

| 绑定调用 | 输入 | 输出 |
| --- | --- | --- |
| `ListInstallations` | 无 | `Installation[]`，含 `id,label,platform,path_hint,permission_state,mas_version` |
| `GetAndroidStorageAccess` | 无 | `{state:"granted|denied|unsupported",root:"/storage/emulated/0/MAS/",game_path:"/storage/emulated/0/MAS/game"}`；每次调用查询系统授权，不使用缓存判断 |
| `RequestAndroidStorageAccess` | 无 | 打开本应用“所有文件访问权限”系统设置页；返回 `{opened:true}` 只表示设置页已打开，不表示已授权 |
| `DiscoverInstallations` / `SelectInstallation` | 平台选择结果 | Windows 为验证后的选择结果；Android 只验证固定 MAS 根目录，未授权返回 `permission_lost`，无效目录返回 `invalid_mas_root` |
| `RefreshCatalog` / `GetMod` | 筛选/ID | 与 Web 公共 DTO 一致 |
| `DownloadVersion` | `version_id` | `operation_id`；校验下载大小与哈希 |
| `PreviewInstall` / `PreviewUpdate` / `PreviewUninstall` | 安装实例、版本 | `Plan`；无文件写入 |
| GetPriorityOverview | 安装实例 | PriorityOverview：只读权威模组列表、优先级、生效/覆盖/总文件数统计及全部多模组共享冲突路径与当前赢家 |
| PreviewPriority | 实例、mod_id -> priority | PlanResult：只读预览受影响的覆盖路径、赢家切换、同哈希归属说明与阻断项；不写盘 |
| ExecutePlan / ApplyPlan | plan_id | operation_id,status：事务应用优先级与文件写盘，原子同步更新 manifest 与 installed-archives |
| `ListInstalled` | 安装实例 | 托管版本、未托管检测结果、更新状态 |
| `ListInstalledModFiles` | `installation_id, mod_id` [, `cursor, limit`] | `InstalledFileList`：只读文件清单、哈希、生效状态、外部漂移标志与统计摘要；不读取文件内容，不修改状态 |
| `ListOperations` / `GetOperation` | 实例/操作 ID | 阶段、逐文件进度、阻断信息与恢复选项 |
| `RecoverOperation` / `RestoreBackup` | 实例、操作/备份 ID | `operation_id,status` |
| `ExportLogs` | 可选操作 ID | 本地导出文件位置 |

`Plan` 至少包含 `plan_id,kind,installation_id,mod_id,version_id,expires_at,dependency_blockers,semantic_blockers,changes,backups_required,bytes_required,warnings`。对于 `spritepack`，包含 `sprite_set_ids,sprite_selection_hash,selected_sprite_set_count` 以及变更上下文 `sprite_selection_context`。每条 `change` 含 `target_path,action,previous_owner,next_owner,previous_hash,next_hash,reason`。只在阻断项为空、权限有效且 MAS 未运行时允许确认。

**精灵包选择最终状态语义**：客户端的套装勾选表示“应用后最终安装的集合”，不是本次增量下载清单。若已安装 A，追加 B 须保持 A 勾选并勾选 B（提交 A+B）；若仅勾选 B，则应用后 A 将被卸载；若取消勾选全部套装，操作路由至“卸载此精灵包”。首次安装默认全选；已有可验证安装默认仅勾选已安装集合；未知旧记录默认零选且须确认替换风险。若存在移除已安装套装、版本缺失集合或未知旧记录替换，预览弹窗要求用户显式勾选“我确认应用后将卸载未保留的已安装套装”方可执行写入。下载 ZIP 行为独立于安装状态，不支持零集合下载。

操作状态为 `planned -> downloading -> scanning -> backed_up -> writing -> committed`；失败时为 `blocked|recoverable|rolling_back|rolled_back`。前端必须能在重启后通过 `operation_id` 重连状态。进度事件可优化体验，但持久化的 `GetOperation` 是权威来源。

## 5. 状态机与错误展示

候选版本：`draft -> uploaded -> scanning -> ready_for_review -> published`。批准直接进入 `published`；历史 `approved` 记录仍可补发。扫描失败回到可修改草稿并附原因；审核驳回为 `rejected`，作者从该候选修订后重新提交。下架为独立公开可见性状态，不回写 ZIP。

| 错误码 | 前端动作 |
| --- | --- |
| `unauthenticated`, `forbidden` | 提示登录或权限不足，刷新角色 |
| `validation_failed`, `invalid_archive`, `unsupported_path`, `scan_limit_exceeded` | 定位表单字段或 ZIP 扫描报告 |
| `invalid_transition`, `idempotency_conflict` | 刷新提交状态，避免重复提交 |
| `dependency_missing`, `version_incompatible`, `semantic_conflict` | 阻断安装，展示受影响模组/文件 |
| `sprite_version_changed` | 精灵包已发布版本变更或下架，阻断旧集合选择并引导重新加载集合清单 |
| `invalid_selection` | 精灵包集合选择无效（空选择、重复或未知集合 ID），要求重新选择 |
| `permission_lost`, `invalid_mas_root` | Android 前者打开系统“所有文件访问权限”页并在返回后刷新，后者报告固定 MAS 根目录无效；Windows 可重新选择目录 |
| `not_found`, `manifest_corrupt` | 提示模组未安装或 manifest 损坏，引导刷新状态或重新扫描，不伪装成空文件 |
| `game_running`, `insufficient_space` | 停止写入，说明可恢复条件 |
| `external_change` | 展示路径及预期/当前哈希，禁止自动覆盖 |
| `operation_recoverable`, `backup_missing` | 进入恢复流程或报告无法自动恢复的原因 |
| `offline` | 请求无法到达服务器：目录显示独立的“加载失败”状态并提供重新加载入口，不读取本地目录快照；下载同样不保存归档，安装仅限已验证的本地 ZIP |
| `download_hash_mismatch`, `download_size_mismatch`, `download_expired`, `download_too_large`, `crypto_unavailable` | 下载失败时不保存归档；可重试获取新描述符，安装仅限已验证的本地 ZIP |

页面/客户端至少提供这些可设计状态：加载中、加载失败、空目录、无搜索结果、未登录、权限不足、上传中、扫描中、扫描警告、扫描阻断、审核中、驳回、下架、未授权目录、权限撤销、游戏运行中、外部文件冲突、依赖缺失、操作可恢复、回滚完成。错误状态的操作入口应对应上表，不使用模糊的“重试”覆盖所有情况。

## 6. 验收旅程与交付边界

1. 访客搜索模组，查看兼容性和版本，获取带 SHA-256 的下载描述符。
2. 作者登录、建草稿、上传旧式 ZIP、查看扫描报告、提交；审核员批准并发布；公开详情显示不可变版本。
3. Windows 用户选择 MAS 目录；Android 用户在系统设置授予“所有文件访问权限”并验证固定 MAS 根目录。双方预览覆盖和依赖、安装、调整优先级、更新、卸载，并在中断后恢复。Android 须用真实设备验证授权、拒绝、撤销与重启后的状态。
4. 手工修改已安装文件后再次操作，客户端以 `external_change` 暂停，不覆盖用户文件。

本文是前端设计输入，不是 UI 实现或已通过的发布验收。前端设计稿应覆盖 Web 与双平台客户端的全部视图和上述关键状态。

## 6. GitHub Releases 源模式契约扩展

### 模组源配置与同步状态字段
在模组元数据对象（`ModSummary`）中，扩展以下源管理字段：
- `source_type`: `local`（默认，站内创建候选版本）或 `github_releases`（由外部 Release 自动同步）。
- `github_owner`: GitHub 组织或用户坐标。
- `github_repo`: GitHub 仓库名称。
- `github_asset_regex`: RE2 正则表达式，匹配 Release 资产中的 `.zip` 文件名。清单模式下不参与匹配。
- `github_source_code`: 布尔值，当 Release 未提供匹配的资产文件时，是否允许自动使用 Release 源码包 (`zipball_url`)。清单模式下不生效。
- `github_manifest`: 布尔值，`true` 表示版本发现走仓库根目录的 `rezehub.yml`（不调用 REST API、零配额消耗，但作者需自行维护该文件）；`false`/省略表示站内按需抓取 Releases。
- `github_manifest_digest`: 最近一次成功读取的清单摘要，用于判断清单是否变化（仅服务端使用，公开目录自动脱敏）。
- `github_last_sync_at`: 最近一次同步时间（仅作者工作台与管理端可见，公开目录自动脱敏）。
- `github_last_sync_error`: 最近一次同步非致命错误描述（仅作者工作台与管理端可见）。
- `github_last_release_id`: 最近处理的 GitHub Release ID（仅作者工作台与管理端可见）。

### 接口定义
- `PATCH /api/v1/author/mods/{id}/source`：更新模组的源配置。鉴权要求作者或管理员。校验 owner/repo 格式及 asset regex 语法，保存后清空上次同步错误。接受 `github_manifest`（清单模式，此时 `github_asset_regex` 可留空）；切换 owner/repo/清单模式会清空 ETag 与清单摘要。
- `POST /api/v1/author/mods/{id}/github-sync`：手动触发立即同步（强制回源，忽略 ETag 与清单摘要缓存）。返回 `{ mod_id, synced_at, created, skipped, failed, items: [...] }` 汇总。

### 版本发现方式（前端必读）
`GET /api/v1/mods/{id}` 与作者工作台列表加载会在胶水层按 `GITHUB_SYNC_MAX_AGE`（默认 60 分钟）异步触发一次回源（每页最多 3 个模组、同一模组单飞），页面响应不被阻塞；后台巡检每分钟把过期模组补一遍。

作者在“编辑模组”的 GitHub 分段中必须能选择两种发现方式，并**如实展示代价**：
- **站内按需抓取（默认）**：无需任何额外文件；更新最多延迟约 `GITHUB_SYNC_MAX_AGE`，有人打开该模组时立即补抓，无人访问时由后台巡检兜底。
- **仓库清单 `rezehub.yml`（可选）**：作者需在仓库根目录维护该文件、每次发版补一条记录；换取零 REST 配额与打开页面即最新。

### 源策略（公开）
`GET /api/v1/source-policy` 返回当前生效的刷新窗口，供作者端文案引用**实际值**而不是硬编码默认值：

```json
{ "github_sync_max_age": "1h0m0s", "github_sync_max_age_seconds": 3600, "github_sync_max_age_configured": true }
```

无需鉴权（窗口本身可从外部观测，且不含任何凭据）。`configured=false` 表示自动刷新已关闭，前端必须渲染为「已关闭自动刷新」而不是「0 分钟」。

### 标签目录（公开 + 作者端）
标签只能从站点目录里多选，作者不能创建新标签，且**每个模组至少一个标签**。

- `GET /api/v1/tags` 返回 `{ "groups": [{ "name": "工具", "children": ["绘图"] }, { "name": "音乐" }], "revision": 3 }`；无需鉴权。
- 目录最多两层：主标签 + 子标签；名称在整份目录内**全局唯一**，因为模组只存扁平名称。
- 主标签可单独选中；选子标签时服务端自动补上其主标签。因此 `GET /mods?tag=<主标签>` 会命中所有带该主标签子标签的模组，`tag=<子标签>` 精确匹配。
- 顺序即展示顺序：作者选择器与目录筛选都按目录顺序渲染，主标签在其子标签之前。
- 约束：每个模组最多 8 个名称（含自动补入的主标签）；目录 1..20 个主标签、每个主标签 0..6 个子标签、单个名称 1..24 字符且不含 `,` `#` 与控制字符。
- 错误码：`400 tags_required`（一个都没选）、`400 invalid_tags`（目录外名称）、`400 too_many_tags`（超过 8 个）、`400 invalid_tag_catalog`（管理员目录不合法）。
- 管理员删掉某个标签并保存目录时，服务端在同一事务里把该标签从模组上移除（审计事件带 `tags_changed` 与 `pruned_mod_tags`）。因此存量模组可能暂时没有标签，作者/管理员下次保存该模组时必须补选。

### 管理端 GitHub API 令牌
`GET /api/v1/admin/settings` 返回 `github_proxy_template`、`github_token_configured`、`github_token_encrypted`、`github_token_hint`（末四位）、`github_sync_max_age`（当前生效的检查更新窗口）、`tag_catalog`（当前生效的标签目录）、`master_key_configured`、`revision`，**永不回显令牌本身**。`PATCH` 可带 `github_sync_max_age`（Go duration；空串恢复默认 60 分钟，`0` 关闭自动刷新）。

`PATCH /api/v1/admin/settings` 接受 `{ github_proxy_template?, github_token?, github_sync_max_age?, tag_catalog?, revision }`：
- `tag_catalog` 整份替换标签目录，格式同 `GET /api/v1/tags` 的 `groups`；服务端 trim、去重并按规则校验（空目录、超长、跨层级重名、`,#`、控制字符均返回 400 `invalid_tag_catalog`），保存后同步清理模组上已不存在的标签。
- `github_sync_max_age` 为 Go duration；空串恢复默认 60 分钟，`0` 关闭自动刷新。
- 若部署设置了非空 `GITHUB_SYNC_MAX_AGE`，响应额外包含 `github_sync_max_age_locked: true`；管理页应禁用窗口编辑。直接 PATCH 该字段返回 409 `github_sync_max_age_env_override`，其他设置仍可修改。
- 字段可省略，但至少要提供一个，否则 400；省略的字段保持原值。
- `github_token: ""`（或纯空白）表示清除已存令牌；非空则必须是可打印 ASCII、无空格换行、≤255 字符，否则 400 `invalid_github_token`。
- 保存成功后 `revision` 递增；只有修改代理或令牌时才清空全局与各模组的限流退避（配额桶已换）。
- 前端必须区分展示「已加密存储」与「明文存储」，后者要提示配置 `SUBMODHUB_DELIVERY_MASTER_KEY`。

两种模式的扫描、审核、自动发布流程完全一致，前端其余交互不变。

### 权限与防护规则
- 当模组配置为 `github_releases` 时：
  - 调用 `POST /api/v1/author/mods/{id}/versions` 会被服务端拦截并拒绝，返回 HTTP 409 `github_source_managed`。前端界面相应隐藏“+ 创建候选版本”按钮，改为主显示“立即同步 Releases”及同步状态。
  - 调用 `PATCH /api/v1/author/versions/{id}/edit` 时，禁止修改版本 tag (`Version`)，尝试修改返回 HTTP 409 `github_source_managed`；但依然允许修订说明与依赖。
  - 对 `local` 模组调用 `POST /api/v1/author/mods/{id}/github-sync` 返回 HTTP 400 `not_github_source`。
