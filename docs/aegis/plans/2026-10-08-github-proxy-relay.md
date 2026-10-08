# GitHub 全链路代理与服务端下载中转实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use aegis:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原“用户角色”页扩展为管理员设置页，可配置全站 GitHub 代理；GitHub API、同步与客户端下载的 GitHub 上游请求均由服务端经代理执行。

**Architecture:** 客户端继续访问本站下载描述符与归档接口，不获取外部下载链接。服务端统一构建 GitHub 请求，将 API、分页、Release ZIP 和源码 ZIP 经代理发送；按需中转的文件先落临时文件并验证发布时 SHA256，再返回客户端。同步时保存的已检测归档保留作为版本快照与历史兼容数据。

**Tech Stack:** Go net/http、PostgreSQL catalog_snapshot、React、TypeScript、Wails 共享 UI、Docker Compose。

**Baseline / Authority Refs:** 用户本轮需求及“都走代理”补充；`docs/github-release-source.md`；`docs/operations.md`；`internal/github/releases.go`；`internal/httpapi/github_sync.go`；`internal/httpapi/server.go`；`internal/httpapi/auth.go`；`internal/httpapi/postgres.go`；`ui/catalog-api.ts`。

**Compatibility Boundary:** 保持客户端同源下载 URL、SHA256/大小校验、审核状态、GitHub tag 与版本对应关系、已发布归档不可变和现有角色授权功能。此计划不实施 Android UI，不删除已有归档，不自动重新发布历史版本。

**Verification:** Go 代理/同步/下载集成测试；Web 类型检查、构建和设置 API 测试；Playwright 设置保存及实际下载；Wails 真 bindings 安装验证；Docker 重启持久化和上线冒烟。

---

## 1. 已知事实与方案边界

- 当前 GitHub 同步先下载 ZIP、静态检测，再保存到本地卷；客户端从本站获取该归档。
- `Version` 目前存 `GitHubReleaseID`、`GitHubAssetID`，没有保存可用于下载的完整上游定位信息。
- `GET /api/v1/versions/{id}/download` 返回本站 `/api/v1/archives/{id}` 和已存 SHA256、大小；客户端下载校验依赖这些字段，保持不变。
- `AdminPanel.tsx` 当前只管理用户角色，导航名称在 `Header.tsx`；设置扩展后保留角色功能和管理员权限。
- 设置采用现有 `catalog_snapshot` 持久化方式，兼容本地 JSON store；无需额外数据库迁移表。
- API 是只读根文件系统，`/tmp` 当前 tmpfs 为 160 MiB，单 ZIP 上限 128 MiB。新增中转必须避免多个临时 ZIP 挤满该挂载。

### 代理格式假设

本计划的“GitHub 代理”是 URL 重写型代理，而非 HTTP CONNECT/SOCKS。管理员填写含唯一 `{url}` 占位符的模板：

```text
https://proxy.example/{url}
```

对 `https://api.github.com/repos/OWNER/REPO/releases?per_page=100` 生成：

```text
https://proxy.example/https://api.github.com/repos/OWNER/REPO/releases?per_page=100
```

额外支持唯一 `{url_encoded}` 占位符，用于要求查询参数编码的代理：

```text
https://proxy.example/fetch?url={url_encoded}
```

模板只能使用一种占位符且恰好出现一次。真实代理地址尚未提供；实施者不能把示例地址或本机 7890 设置成默认代理。需要 HTTP/SOCKS 时应另行修订代理类型契约，不混用以上模板。

## 2. 请求链路与发布一致性

| 场景 | 未配置代理 | 已配置代理 |
| --- | --- | --- |
| Release 列表与分页 | 服务端 → GitHub API | 服务端 → 代理 → GitHub API |
| 同步 ZIP / 源码 ZIP | 服务端 → GitHub | 服务端 → 代理 → GitHub |
| 新 GitHub 版本客户端下载 | 客户端 → 本站 → GitHub | 客户端 → 本站 → 代理 → GitHub |
| 本站上传版本与历史无定位信息版本 | 客户端 → 本站本地归档 | 客户端 → 本站本地归档 |

- 上游 ZIP 先下载到临时文件，校验大小与发布时 SHA256 完全一致，再向客户端输出。不得把未经验证的字节直接流给客户端；因此首次响应可能需要等待完整上游下载。
- 下载时不重新扫描或改写发布记录；已经扫描过的相同哈希文件才允许返回。
- GitHub 同 tag 下替换资产、源码 ZIP 变化或代理返回 HTML，都不能替换本站已发布版本。哈希或大小不一致返回 `502 upstream_archive_changed`。
- 新 GitHub 版本上游失败返回明确错误，不静默回退到直连或本地快照；历史版本缺少定位信息是唯一保留的本地兼容分支。
- 有代理时所有 GitHub 请求都走代理，包含分页和 GitHub CDN 重定向；不得把分页 `Link` 当作已代理 URL再次拼接。
- GET 下载支持取消与超时，临时文件必须清理。HEAD 返回已发布的元数据，不触发上游下载；本期不支持 Range 中转，GET 忽略 Range 并返回完整 200，不错误返回伪 206。
- 精灵包整包下载可走中转；按套/多套重新打包仍使用已检测的本地归档，本期不改变分套打包逻辑。

## 3. 数据与接口契约

### 管理员设置

在 `Catalog` 增加 `Settings` 和专用 `SettingsAudit`（不要塞进角色审计）。设置结构：

```go
type SiteSettings struct {
    GitHubProxyTemplate string `json:"github_proxy_template"`
    Revision uint64 `json:"revision"`
}
```

旧快照缺字段时自然得到空代理，保持直连。空字符串表示禁用代理。PATCH 替换模板并递增 revision，写入操作者、时间和修改前后模板的审计事件。保存失败回滚内存设置与审计，不能出现重启后配置丢失但界面宣称成功。

| 接口 | 权限 | 请求/结果 |
| --- | --- | --- |
| `GET /api/v1/admin/settings` | admin | 返回设置及 revision |
| `PATCH /api/v1/admin/settings` | admin + CSRF + 同源校验 | `{ "github_proxy_template": "...", "revision": 0 }`；返回新设置 |
| `POST /api/v1/admin/settings/github-proxy/test` | admin + CSRF + 同源校验 | `{ "github_proxy_template": "..." }`；测试未保存模板 |

revision 不匹配返回 `409 settings_conflict`，要求重新读取；模板不合法返回 `400 invalid_github_proxy`。测试结果分为 `api`、`asset` 两项，分别包含 `ok`、`elapsed_ms`、`error_code`；两个都成功才整体成功。测试失败不保存设置。测试仅使用服务端固定的公开仓库与 ZIP 目标，禁止客户端提交任意测试 URL。

测试连接只证明当时对应 API 和文件可访问，不保证后续不会限流、超时或受代理供应商限制。测试响应不回显完整上游正文，不含 cookies、内部路径或敏感请求头。

### 版本源定位

新增仅服务端使用的来源记录，记录 owner、repo、release ID、asset ID、选中文件名及原始 GitHub download URL。定位记录绑定到版本，模组以后修改 repo 也不能改变已有版本的来源。

客户端目录、下载描述符、作者工作台及审核快照不得泄露代理模板和内部定位 URL。需要明确构造公共 DTO 或复制后清空内部字段；不能因为给 `Version` 加 JSON 字段就直接返回内部来源。

本期不批量反推历史 URL，不强行重新下载历史版本。新同步版本必须记录来源，旧版本继续走本地归档。

## 4. 文件所有权

| 文件 | 责任 |
| --- | --- |
| 新增 `internal/github/proxy.go`、`proxy_test.go` | 模板校验、原始 URL 重写、GitHub 主机规则、重定向规则 |
| 修改 `internal/github/releases.go`、相关测试 | API、分页、下载统一使用上述请求层，原始 URL 与代理 URL分离 |
| 新增 `internal/httpapi/settings.go`、`settings_test.go` | 管理员设置 API、审计、revision、持久化、连接测试 |
| 修改 `internal/httpapi/server.go` | 注册设置路由和归档中转分支，增加设置/定位数据结构；不继续堆放请求层逻辑 |
| 修改 `internal/httpapi/github_sync.go`、相关测试 | 同步开始时快照代理配置，记录每个新版本来源 |
| 新增 `internal/httpapi/github_relay.go`、`github_relay_test.go` | 按需拉取、已发布哈希验证、取消/超时/错误处理 |
| 新增 `ui/settings-api.ts`、`settings-api.test.ts` | 设置读写与测试接口客户端 |
| 修改 `web/src/components/AdminPanel.tsx`、`Header.tsx` | 页面/导航改名“设置”，保留角色卡片，新增 GitHub 代理卡片 |
| 修改 `docs/operations.md`、`docs/github-release-source.md` | 配置示例、全链路代理、按需中转与故障说明 |
| 修改 `deploy/compose.yaml` | 根据临时文件并发模型扩大 tmpfs，而非移除只读保护 |

## 5. 原子实施任务

### Task 1：统一代理请求层

**价值：** 所有 GitHub 出站请求遵守同一配置，分页与重定向不会绕过代理。

- [x] 先编写 `proxy_test.go`：空设置直连；两种模板正确保留/编码 URL；多占位符、缺占位符、userinfo、fragment、非 HTTPS、非允许 GitHub 原始主机拒绝。
- [x] 建立本地 fake GitHub + fake proxy 集成测试，断言 Release 首页、分页、下载及 CDN 重定向全部由代理处理；配置代理后直接 GitHub handler 请求计数必须为 0。
- [x] 运行 `go test ./internal/github -count=1`，确认失败原因是缺失代理行为。
- [x] 实现模板解析与统一请求执行入口；保留原始 URL用于分页/定位/重定向解析，不对已重写 URL重复重写。
- [x] 请求代理不携带本站 cookie、Authorization、CSRF。ETag、API Accept、限流响应头继续传递与解析。
- [x] 允许原始上游主机仅包括 `api.github.com`、`github.com`、`codeload.github.com`、`release-assets.githubusercontent.com`、`objects.githubusercontent.com`。代理目的主机及重定向目的解析时拒绝回环、私网、链路本地、组播地址，并在连接时再次校验 DNS 结果，防止公开下载接口成为内网请求入口。测试通过注入本地测试 transport，不弱化生产规则。
- [x] 限制重定向次数 10、单次下载 5 分钟、128 MiB。代理返回限流仍使用现有退避；代理超时不切换直连。
- [x] 运行 GitHub 包全部测试并提交该独立变更。

**Repair Track：** 统一修改 GitHub 出站请求权威入口，修复独立 API/分页/下载请求可能使用不同代理的边界。

**Retirement Track：** 退役生产主路径里直接调用独立 `httpClient.Do` 的散落实现；保留测试注入 client/baseURL。只有未配置代理时统一入口才允许直连。

### Task 2：持久化管理员设置与权限接口

**价值：** 管理员可动态调整代理，重启不丢失；普通用户不能修改站点出站配置。

- [x] 先写 settings 集成测试：匿名 401、非 admin 403、缺/错 CSRF 403、跨源 403、合法保存/清空、revision 冲突 409、非法模板 400、未知字段拒绝、持久化失败回滚。
- [x] 写重启测试：保存后重新加载 Store，模板/revision/审计均保留；旧快照缺 Settings 可以启动且保持直连。PostgreSQL 实例可用时对真实 catalog_snapshot 重复该验证。
- [x] 运行 `go test ./internal/httpapi -run Settings -count=1`，确认红灯。
- [x] 实现 Settings 结构、路由、设置 handler 与独立审计；沿用角色 API 的鉴权和 CSRF 规则。
- [x] GitHub 请求开始时在锁内复制设置，随后释放锁；网络请求不持有 Store 锁，也不原地修改共享 http.Client。新设置对下一次同步/下载生效，正在执行的操作使用原配置快照。
- [x] 清除与旧出站路径相关的内存/模组限流退避状态，使下一次手动重试可用新代理；保留 ETag，新代理设置本身不重复创建历史版本。
- [x] 实现连接测试，API 请求固定公开仓库的 Releases，资产测试通过同仓库 Release 选择 ZIP，以有界方式读取文件响应并识别 ZIP 签名/HTML 错页；源码 ZIP 代理支持在集成测试覆盖。
- [x] 运行 settings、auth、GitHub 同步相关测试，确认角色授权与既有安全边界保持。
- [x] 提交此任务及接口契约文档。

### Task 3：客户端下载按需中转

**价值：** 客户端始终只连接本站，GitHub 与代理配置不下发；收到的文件与已发布检测结果一致。

- [x] 先写 relay 测试：已发布 GitHub 版本经 fake proxy 下载成功；本地版本不请求 GitHub；历史无来源版本走本地；未发布/下架版本 404。
- [x] 增加错误测试：上游 404、429、HTML 响应、超限、大小不符、哈希改变、超时、客户端取消、临时文件创建失败均不返回成功 ZIP，且临时文件清理。
- [x] 增加契约测试：下载描述符只返回本站 URL、SHA256 和大小；作者/公共响应不得包含内部定位/代理模板；HEAD 不下载；GET 在发送响应前再次检查版本仍可下载，避免等待期间删除/下架仍被分发。
- [x] 运行 `go test ./internal/httpapi -run 'GitHubRelay|GitHubSync|Download' -count=1`，确认新场景红灯。
- [x] 新同步版本保存不可变来源快照；归档接口识别来源，调用 relay 拉取临时 ZIP，比较已发布 hash/size，通过后发送。GitHub 整包与本站归档共用公共接口，不新增可输入任意 URL 的中转接口。
- [x] 实现错误码：上游不可达 `502 github_upstream_failed`、超时 `504 github_upstream_timeout`、内容变化 `502 upstream_archive_changed`、限流 `503 github_upstream_rate_limited`（含有界 Retry-After）、本地容量/并发不足 `503 relay_busy`。
- [x] 用全局 semaphore 限制同步和 relay 的临时下载合计为 2，并保证取消等待可退出。将 tmpfs 提升至 320 MiB，覆盖 2×128 MiB 与余量；每条下载完成后及时清理，不长时间持有临时文件。
- [x] 配置更新不改变正在下载的请求快照；哈希不一致不得覆盖原 ArchivePath、SHA256 或 ScanReport。
- [x] 为 Web/Wails 客户端错误映射补充清晰提示，原有大小/哈希校验继续执行。
- [x] 运行 `go test ./internal/httpapi ./internal/github -count=1` 与 `ui/catalog-api.test.ts`；确认重复同步、自动发布、版本生命周期和精灵包分项下载回归通过。
- [x] 提交中转实现和容量配置。

**Repair Track：** 下载交付由 `github_relay.go` 负责外部来源，`downloadArchive` 仅做已发布授权及分发选择，保持 descriptor 稳定。

**Retirement Track：** 新 GitHub 版本退役“客户端下载直接读取本地归档”的主路径；已有归档保留用于静态检测快照、历史无来源版本以及精灵包分套打包。不得删除数据，不增加隐藏直连/本地故障回退。

### Task 4：设置页 UI 与客户端集成

**价值：** 管理员能够填入、测试、保存与清空代理，继续管理用户角色。

- [x] 先写 `ui/settings-api.test.ts`：GET/保存/清空/测试请求、CSRF、revision、错误码与类型校验。运行 `cd web; npx tsx --test ../ui/settings-api.test.ts` 确认红灯。
- [x] 实现 settings API helper；base URL 使用现有 Web/PC API base 计算方式，不硬编码服务器地址。
- [x] `Header.tsx` 与 `AdminPanel.tsx` 将显示名称改为“设置”，保持内部 `admin` tab key，保留用户角色卡片原行为。
- [x] 新增 GitHub 代理卡片：模板输入框、浅灰示例、全链路说明、“测试连接”“保存修改”“清空并禁用”按钮。输入可空，只有保存成功才能提示生效；未保存测试不改变配置。
- [x] 显示 API 与 ZIP 两项测试结果、loading、保存失败与冲突提示；初始读取失败可以重试，保存时避免重复点击。输入改变后清除旧测试结果，避免把旧配置结果当作新配置成功。
- [x] `npm run lint`、`npm run build`、settings API 测试通过；Wails 共用 UI 构建通过。
- [ ] Playwright 实测：管理员打开设置、填模板、测试、保存、刷新回读、清空；非 admin 看不到设置入口且接口禁止访问；用户角色授权仍能保存。
- [ ] Playwright 下载 GitHub 模组，验证网络只连接本站；代理端日志确认 API、ZIP 请求经过代理，浏览器不出现代理地址或 GitHub下载跳转。
- [ ] Wails 真 bindings 下载并在测试 MAS 根目录验证安装，客户端成功进行 SHA256 校验；不得启动临时预览服务后遗留进程。
- [x] 提交 UI 和验证记录。

### Task 5：部署与闭环验证

- [x] 更新 operations/github-release-source 文档，说明代理必须同时支持 API 和下载，配置失败无直连回退、上游同 tag 变更会阻断、历史版本兼容和精灵包分套边界。
- [ ] 部署前保留远端 API 二进制/Compose/Web 的定点回滚副本，记录现有容器状态。保留数据库与 deploy/data。
- [ ] 用真实管理员提供的代理测试 API、Release ZIP、源码 ZIP，再同步一个测试 GitHub 模组。实际代理暂未提供时标记真实代理验证未完成，不用 fake proxy 结果代替。
- [ ] 上传通过测试的 Web 构建与 API 二进制，只重建必要容器；核实 tmpfs、健康检查和设置持久化。
- [ ] 下载同一已发布版本并比对 SHA256；测试失效代理得到可理解错误、清空后恢复直连。重启 API 后再次验证配置与下载。
- [ ] 给出证据：请求链路、各场景测试结果、构建状态、Web/Wails 验证范围和未完成项。

## 6. 风险、回滚与完成判据

- URL 重写代理不一定支持 GitHub API、分页、ETag、限流头或源码 ZIP，实际服务必须验证。代理能改善连通性，不能保证 GitHub 永不失败。
- 每次客户端下载重新拉取上游会增加延迟和流量，并受 GitHub删除/改包影响；本方案选择发布一致性，失败时明确报错。
- 临时容量、并发和匿名下载请求负载必须按上述限制实施；不增加无限等待队列。
- 保存代理后无需重启；服务端重启应保留设置。服务器级网络代理不做默认/永久配置。
- 回滚应用与 Compose 后新增 JSON 字段可被旧代码忽略；旧版下载继续用原本保留的本地归档。回滚前备份 catalog_snapshot，避免旧版保存时丢失新增设置/定位字段。不得删除卷或覆盖归档。
- 完成要求：全链路代理测试证明直连计数为 0；客户端只用本站下载 URL；发布 hash 与下载 hash 一致；设置权限与重启持久化通过；Web UI 全流程通过；Wails 实测或明确报告未验证；部署健康。

## 7. 计划自查

- [x] 包含用户补充“GitHub API 也全部走代理”，涵盖分页、下载、重定向。
- [x] 区分事实与代理类型假设，未把示例代理写成真实部署值。
- [x] 保持发布快照、SHA256、检测与客户端接口，不自动采信外部新内容。
- [x] 包含设置页改名、角色功能保留、权限、保存、测试与清空。
- [x] 指明新旧下载路径、历史兼容边界、精灵包分项边界与回滚。
- [x] 本轮只生成计划，没有修改运行代码或服务器配置。
