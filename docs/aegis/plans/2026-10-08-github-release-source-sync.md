# GitHub Releases 源同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `aegis:subagent-driven-development` (recommended) or `aegis:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 允许作者在新建/编辑模组草稿时绑定 GitHub Releases 源，由系统按 Release tag 自动生成候选版本、按正则选择 ZIP 资产或使用 Release source code ZIP，并在后续 Release 发布时自动同步。

**Architecture:** 在 `Mod` 上增加可选的 GitHub source 配置，但继续用当前本地 `Version`、归档、扫描、审核和发布链路作为权威数据。后台同步器按固定间隔读取 GitHub Releases，使用 `(mod_id, release_id/tag)` 幂等创建版本；每次同步先下载到临时文件并完成 SHA-256/静态扫描，再进入现有审核流程，不直接绕过审核或修改已发布版本。

**Tech Stack:** Go HTTP API、PostgreSQL-backed catalog store、Docker Compose、React/TypeScript Web UI、GitHub REST API、现有 `internal/package` ZIP scanner。

**Baseline / Authority Refs:**
- `docs/aegis/specs/2026-09-25-submodhub-design.md`：`Source` 可选，GitHub 只是外部源，站内归档/数据库是权威；发布 ZIP 不可变。
- `docs/frontend-contract.md`：作者操作由服务端鉴权，GitHub 导入沿用扫描/审核路径。
- `docs/operations.md`：当前 GitHub OAuth 登录暂缓；本计划只实现 GitHub Releases 作为内容源，不启用 GitHub 登录。
- `internal/httpapi/server.go`：当前模组、版本、上传、扫描、归档和作者权限实现。
- `web/src/components/AuthorWorkbench.tsx`、`web/src/context/AppContext.tsx`：当前草稿和候选版本 UI/API 调用。

**Compatibility Boundary:**
- 未配置 GitHub 源的模组保留现有本地候选版本流程，行为和 API 不变。
- 配置 GitHub 源后，服务端拒绝 `POST /author/mods/{id}/versions`；前端隐藏/禁用“创建候选版本”，但服务端拒绝是最终边界。
- `Version.Version` 必须等于 GitHub Release 的 tag（去除空白但不擅自去掉 `v` 前缀）；Release tag 为空或重复时跳过并记录同步错误。
- 已发布版本及其归档不可被 GitHub 更新覆盖；同一 tag 只能绑定一个站内版本。
- GitHub 不替代 Flarum 登录，也不改变作者/管理员权限模型。
- 自动同步默认生成 `uploaded`/待审核版本并复用现有扫描和审核流程；不默认自动发布。自动发布若未来需要，应作为独立设置和审计任务。

**Verification:** `go test ./...`; Web `npm run lint`; Web `npm run build`; 前端 Node/TS 测试；GitHub API fixture 集成测试；Docker Compose 冒烟测试；手动验证配置源、禁用本地版本入口、同步普通 asset、source code fallback、重复同步和新 Release。

---

## 设计决策与边界

1. **源配置字段**
   - `source_type`: `local`（默认）或 `github_releases`。
   - `github_owner`, `github_repo`：规范化后的仓库坐标。
   - `github_asset_regex`：RE2 正则，匹配 Release asset 的文件名；必须匹配 `.zip` 资产才允许下载该资产。
   - `github_source_code`: 布尔值，正则未匹配时是否允许使用 GitHub Release 的 `zipball_url`（生成的 source code ZIP）。
   - `github_last_sync_at`, `github_last_sync_error`、`github_last_release_id`：同步状态，仅供作者/管理员诊断，不进入公开目录。
   - 不保存 GitHub token 到模组记录；公开 Release 使用匿名 API，未来私有仓库另行设计密钥存储。

2. **版本和同步规则**
   - Release tag 是版本号；Release 的 `name`、`body` 映射为候选版本说明，允许作者后续编辑说明但不编辑版本号。
   - 同一 GitHub release ID 优先去重，tag 作为第二重唯一键；已发布/已审核版本不能覆盖。
   - 新版本下载到临时归档，扫描成功后写入不可变归档和扫描报告；下载/解析/扫描失败只记录错误，不创建半成品版本。
   - 正则匹配多个 asset 时按排序后的 asset 名称选择并记录选择结果；没有匹配且 `github_source_code=true` 时使用 `zipball_url`；两者都没有则同步失败。
   - Release 删除或变为 draft 不删除站内历史版本；站内版本标记为 `source_missing` 需要单独迁移/展示设计，不在第一期自动下架。

3. **同步触发**
   - 提供作者/管理员手动同步接口，便于立即验证配置。
   - API 进程内 ticker 负责周期同步，间隔由 `GITHUB_SYNC_INTERVAL` 配置，默认 15 分钟；每轮限制仓库数和 Release 数，避免 API 速率耗尽。
   - 同步使用 `ETag`/`If-None-Match`，处理 304；网络错误指数退避并保留最近错误。
   - 重启后可恢复；同步任务必须可取消、不能阻塞 HTTP 请求，也不能重复下载同一 Release。

## 任务分解

### Task 1: 建立源配置领域模型和持久化兼容

**Files:**
- Modify: `internal/httpapi/server.go` (`Mod`、作者创建/更新请求、JSON 持久化)。
- Modify: `web/src/types/submodhub.ts` (`ModSummary`、源类型)。
- Modify: `ui/submission-api.ts`（创建/更新输入类型）。
- Test: `internal/httpapi/*_test.go`，新增 JSON 兼容和字段校验测试。

**Why this task exists:** 为后续同步提供稳定、可版本化的源配置契约；旧 catalog 必须能读取，未配置字段默认为 `local`。

- [x] 写失败测试：旧 Mod JSON 解码为 local；合法 GitHub 配置可保存；owner/repo、正则、源模式非法组合被拒绝；正则编译失败返回 `validation_failed`。
- [x] 实现最小字段与校验，保留现有权限字段；禁止把 source 配置混入 `Version`。
- [x] 运行 `go test ./internal/httpapi -run Source`，确认先红后绿。
- [x] 更新 TypeScript API 类型，运行 `npx --no-install tsx --tsconfig web/tsconfig.json --test ui/submission-api.test.ts`。

### Task 2: GitHub API client 和资产选择器

**Files:**
- Create: `internal/github/releases.go`（GitHub REST client、Release/Asset DTO、ETag、超时和错误分类）。
- Create: `internal/github/releases_test.go`（`httptest.Server` fixtures，不访问真实 GitHub）。
- Create: `internal/github/asset_selector.go`（正则选择与 source code fallback）。

**Why this task exists:** 将外部 API 和选择规则隔离，确保同步器可测试且不会把 GitHub JSON 细节散落在 HTTP handler 中。

- [x] 写失败测试：分页读取 releases；304 返回 not-modified；asset 正则只匹配 `.zip`；多匹配按文件名稳定排序；无 asset 且允许 source code 选 `zipball_url`；无可选来源返回明确错误；超时/非 2xx 分类。
- [x] 使用 Go `regexp.Compile`（RE2），禁止动态 shell、路径拼接或执行仓库代码。
- [x] 下载流使用大小上限 `maxArchiveSize`，边下载边写临时文件并计算 SHA-256；超过上限立即中止并清理。
- [x] 运行 `go test ./internal/github -count=1`。

### Task 3: 同步器、幂等和现有扫描审核链路接入

**Files:**
- Create: `internal/httpapi/github_sync.go`（单模组同步、批量同步、ticker 生命周期）。
- Modify: `internal/httpapi/server.go`（Store 启停、配置读取、路由注册）。
- Modify: `internal/httpapi/submissions.go` 或现有上传逻辑（复用扫描/审核创建函数，避免复制发布逻辑）。
- Test: `internal/httpapi/github_sync_test.go`。

**Why this task exists:** 将 Release 事件转成站内不可变候选版本，并保证重复轮询、失败重试和重启恢复不产生重复版本。

- [x] 写失败测试：首次同步创建 tag 对应版本并保存归档/sha256/扫描报告；重复同步不创建第二个版本；新 tag 创建第二个版本；已发布 tag 不覆盖；下载失败不留下临时文件或半成品 Version；扫描阻断进入现有阻断状态；同步状态记录错误。
- [x] 实现 `(mod_id, github_release_id)` 和 `(mod_id, version tag)` 双重幂等检查。
- [x] 版本说明使用 Release body/name，来源信息写入版本内部字段或扫描元数据；公开 API 不泄露本地临时路径。
- [x] 默认将新版本送入现有审核流程，遵守 `SUBMODHUB_AUTO_PUBLISH` 既有策略；不要让 GitHub 源绕过审核。
- [x] ticker 使用可注入 clock/interval，测试中不等待真实 15 分钟；关闭 Store 时停止 goroutine。
- [x] 运行 `go test ./internal/httpapi -run GitHubSync -count=1` 和 `go test ./...`。

### Task 4: 作者 API、手动同步和源模式权限边界

**Files:**
- Modify: `internal/httpapi/server.go`（作者源配置和同步路由）。
- Modify: `ui/submission-api.ts`（source config、sync 请求）。
- Test: `internal/httpapi/github_source_api_test.go`、`ui/submission-api.test.ts`。

**Why this task exists:** 让作者可验证配置并确保 GitHub 源模组不能从本站创建候选版本。

- [x] 新增 `PATCH /api/v1/author/mods/{id}/source`：作者/管理员可改，校验仓库和正则，保存后清空旧错误但不删除历史版本。
- [x] 新增 `POST /api/v1/author/mods/{id}/github-sync`：只允许作者/管理员，返回同步摘要（created/skipped/failed、release/tag、选中资产、sha256）。
- [x] `POST /api/v1/author/mods/{id}/versions` 在 `github_releases` 模式返回 `409 github_source_managed`；已有本地 draft 不自动删除，迁移时明确提示并禁止提交。
- [x] `PATCH /author/versions/{id}/edit` 禁止修改 GitHub 管理版本的 tag/来源字段，但允许修订说明和依赖的既有规则需明确测试。
- [x] 测试作者、管理员、普通用户三种权限以及 local 模式回归。

### Task 5: 发布页源配置 UI 和本地候选版本入口切换

**Files:**
- Modify: `web/src/components/AuthorWorkbench.tsx`（编辑模组弹窗源设置、同步按钮、状态）。
- Modify: `web/src/context/AppContext.tsx`（源配置和同步状态更新）。
- Modify: `web/src/types/submodhub.ts`、`ui/submission-api.ts`。
- Test: `web/src/components/AuthorWorkbench.test.tsx` 或现有组件测试，补充纯函数测试到 `web/src/components/sourceConfig.test.ts`。

**Why this task exists:** 让作者能在创建草稿时选择 GitHub 源，并在源模式下清楚看到版本由 Releases 管理。

- [x] 源选择使用分段控件：`本站上传` / `GitHub Releases`；默认本站上传。
- [x] GitHub 模式字段：owner、repo、资产文件名正则、`无匹配时使用 Release source code ZIP` 开关；展示正则示例，如 `^MyMod[-_]v?\\d+\\.\\d+\\.\\d+.*\\.zip$`。
- [x] 保存时调用 source API；创建 GitHub 源草稿后不显示“创建候选版本”；显示“立即同步 Releases”和最近同步状态。
- [x] 本地模式保持现有上传/候选版本 UI，不改变已有详情图、作者显示名和标签行为。
- [x] 处理 loading、无权限、GitHub 限流、无匹配文件、扫描失败等状态；不显示假版本或假下载链接。
- [x] 运行 Web lint/build 和前端测试；Playwright 验证两种模式切换和按钮隐藏。

### Task 6: 自动同步运维配置、可观测性与 Docker 部署

**Files:**
- Modify: `deploy/compose.yaml`、`deploy/.env.example`（`GITHUB_SYNC_INTERVAL`、每轮上限、超时）。
- Modify: `docs/operations.md`（匿名 API 限流、轮询、失败恢复、手动同步）。
- Modify: `docs/frontend-contract.md`（源字段和错误码）。
- Test: `deploy` smoke script or documented commands。

**Why this task exists:** 自动同步必须可控、可诊断，且重启/网络故障不能破坏已有归档。

- [x] 配置默认 15m，支持 `0` 禁用 ticker 但保留手动同步；配置解析失败时拒绝启动或回退安全默认并记录日志。
- [x] 日志包含 mod ID、repo、release ID/tag、选择结果、状态和耗时，不记录 token 或完整下载 URL 查询参数。
- [x] 增加健康/指标信息：最近成功同步时间、最近错误、活跃任务数；不把 GitHub API 故障报告成数据库故障。
- [x] Docker Compose 重启 API 后确认 ticker 恢复；保留 PostgreSQL 数据卷和历史归档。

### Task 7: 端到端验收、文档和回滚演练

**Files:**
- Create/Modify: `docs/github-release-source.md`（作者配置说明、正则示例、source code 行为、限制）。
- Test: GitHub fixture E2E、Web Playwright smoke、API integration。

**Why this task exists:** 覆盖用户主流程并验证外部依赖失败时的安全边界。

- [x] 使用 fixture 仓库模拟：v1.0.0 有匹配 asset、v1.1.0 只有 source code、v1.2.0 有多个匹配 asset、重复轮询、HTTP 429、损坏 ZIP。
- [x] 验证创建 GitHub 源草稿后本站“创建候选版本”不可用且 API 返回 `github_source_managed`。
- [x] 验证同步版本号严格等于 release tag，ZIP 经过扫描后进入审核，审核/发布后归档不可变。
- [x] 验证 local 模组上传候选版本流程完全回归。
- [x] 验证删除/下架 GitHub 源模组不删除已发布归档；清除源配置后可恢复本站候选版本创建（已有 GitHub 版本仍标记来源）。
- [x] 运行 `go test ./...`、Web lint/build、前端测试、Docker Compose smoke，并记录外部 GitHub 不可用时的手动复现步骤。

## 风险、回滚和未决边界

- **GitHub API 限流：** 匿名请求有低额度；默认使用 ETag、轮询上限和退避。私有仓库/token 不在本期实现。
- **Release 资产可变：** 已同步版本保存站内 SHA-256 和不可变归档；同 tag 后续资产变化只记录差异，不覆盖已发布版本，必要时创建人工处理的修订候选。
- **自动发布策略：** 本计划不改变现有审核门槛；`SUBMODHUB_AUTO_PUBLISH` 是否允许自动源同步发布必须由管理员配置和审计，若现有语义不安全则保持审核队列。
- **source code ZIP：** GitHub 提供的 `zipball_url` 可能不是项目作者上传的 Release asset，扫描报告必须明确标注 `source_code_fallback`，作者需知晓其目录结构可能与发布资产不同。
- **正则误匹配：** 只匹配 asset 文件名且要求 `.zip`；没有匹配时不猜测其他文件，不下载 exe/tar.gz。
- **回滚：** 禁用 `GITHUB_SYNC_INTERVAL` 并将模组源切回 local；不删除已生成的版本/归档；保留同步审计和错误状态。

