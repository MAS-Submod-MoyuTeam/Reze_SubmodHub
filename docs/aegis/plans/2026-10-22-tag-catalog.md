# 标签目录（Tag Catalog）计划

状态：已实施并部署到测试服（2026-10-23；§8 的默认数值仍可改）

## 实施记录（2026-10-23）

- 后端与共享契约按 Task 1–4 完成：`go test ./... -count=1` 全绿，`ui/tags-api.test.ts` + `ui/settings-api.test.ts` 14 项通过。
- 前端按 Task 5–7 完成：`web/src/components/{tagSelection,TagPicker,tagFilters,TagCatalogSettings}.ts(x)` ＋ 各自测试；`npm --prefix web test` 103 项通过，`npm --prefix web run lint` 与 `npm --prefix web run build` 通过。
- 桌面回归：`clients/desktop` 175 项通过；`go -C cmd/client/SubmodHub test -tags browser ./...` 通过（该模块的 `gopkg.in/yaml.v3` 间接依赖缺失是先前就存在的 `go mod tidy` 遗留，与本次改动无关，未纳入本计划）。
- 与计划的偏差（都更保守，未放宽约束）：
  - Task 6 的「保存前提示将清理 N 个模组标签」改为固定文案「从目录里删掉的标签会同时从模组上移除」：精确计数需要在设置响应里再暴露一份模组标签统计，而服务端审计已经记录 `pruned_mod_tags`，不值得为此多一个跨模块契约。
  - Task 7 的目录筛选保留目录外历史标签并追加在主标签之后（弱化配色 + `title` 说明），而不是直接隐藏：迁移执行前它们仍必须可筛。
  - `AuthorWorkbench` 的 GitHub 导入演示改用目录首个主标签兜底；目录不可用时不再创建草稿。
- 迁移脚本已对 `100.72.137.92` 执行（2026-10-23，用户确认后）：dry run 为 37 个模组 / 24 个带标签 / 4 个 `tags` 为 jsonb `null` / 45 条标签（`dialogue` 22、`submod` 21、`dates` 1、`e2e` 1）；执行后 37 个模组全部为 `[]`、0 个带标签；`submodhub-api-1` 已重启，`GET /api/v1/mods` 确认返回 `tags: []`。`settings.tag_catalog` 仍未持久化（使用默认目录）。
- 已部署到测试服（2026-10-23，用户要求看效果）：交叉编译 `deploy/build/submodhub-linux-amd64` 后 `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build api`，并替换 `web/dist` 后重启 `submodhub-web-1`（bind mount 指向被替换的目录，必须重启才看到新文件）。回滚备份在远端 `deploy/backups/20261023-002018`（旧二进制 + 旧 dist）。
- 部署后实测：`/healthz` ok、`GET /api/v1/tags` 返回 12 个默认主标签（revision 8）、`GET /api/v1/mods?tag=工具` 200 空结果、`GET /api/v1/mods` 的 `tags` 全为 `[]`；浏览器端目录筛选区按目录顺序渲染 `#工具…#ai`，选中主标签进入「未找到匹配的模组」空状态，控制台无报错。作者选择器与设置页卡片需要登录，未在浏览器中实测。
日期：2026-10-22（rev2：加入主/子标签、必选标签、存量清空）

## 1. 目标与验收

模组标签从「自由文本」改为「从站点标签目录多选」，目录是一棵两层的 **主标签 / 子标签** 树，由管理员在系统设置页维护，作者不能创建新标签，且**每个模组至少选 1 个标签**。

已确认的语义：

- 主标签可单独选中（= 整个分类），不必选子标签。
- 选子标签时**自动带上其主标签**。
- 点击主标签筛选项时，筛选结果**包含其全部子标签**的模组。
- 存量旧标签**直接清空**，由独立小脚本对目标服务器执行；清空后已上架模组可以短期没有标签，「至少一个」只约束新建/编辑保存。

验收（用户可见）：

1. 作者工作台新建/编辑模组时，标签是按主标签分组的一排 chip（多选），没有自由输入框；一个都没选时不能保存，并给出内联提示。
2. 管理员在 `系统设置` 页维护目录：增删主标签、在某个主标签下增删子标签、上下移动；保存后作者端下一次打开编辑弹窗即生效。
3. 服务端强制：目录外的标签返回 `400 invalid_tags`；一个都不选返回 `400 tags_required`；非 admin 不能改目录。
4. 默认目录（12 个主标签，均无子标签）：`工具 话题 功能 UI 音乐 背景 杂项 小游戏 窗口反应 整活 浪漫 ai`。
5. 目录顺序 = 选择器与筛选的展示顺序；主标签在其子标签之前。

## 2. 现状基线

| 关注点 | 位置 | 现状 |
| --- | --- | --- |
| 数据模型 | `internal/httpapi/server.go:84-117` | `Mod.Tags []string`（扁平），无任何约束 |
| 作者写入 | `internal/httpapi/server.go:444-460`、`961-1012` | 直接 `req.Tags` → `mod.Tags`，无白名单、无必填 |
| 公开筛选 | `internal/httpapi/server.go:1374`、`1393` | `GET /mods?tag=` 对已存值精确匹配（`slices.Contains`） |
| 站点设置 | `internal/httpapi/server.go:210-241`、`settings.go:36-189` | `SiteSettings` 只有 GitHub 代理/令牌/刷新窗口；revision 乐观锁 + CSRF + 同源 + `SettingsAuditEvent` |
| 存储 | `internal/httpapi/postgres.go:30-72` | `catalog_snapshot` 单行 jsonb；新增设置字段无需 SQL 迁移 |
| 共享 TS 契约 | `ui/settings-api.ts:36-118` | `SiteSettings` / `SiteSettingsPatch` / `updateSettings` |
| 设置页 | `web/src/components/AdminPanel.tsx:272-291` | 「系统设置」页；含 `DownloadNodeSettings` 与代理/令牌/刷新窗口卡片 |
| 作者标签输入 | `web/src/components/AuthorWorkbench.tsx:95`、`169-172`、`274`、`1556-1564` | 逗号分隔自由文本 `newTagsStr` |
| 目录筛选 | `web/src/components/CatalogView.tsx:50-53`、`214-246` | 由已发布模组 tags 聚合的扁平 chip 行 |
| 桌面客户端 | `clients/desktop/src/components/CatalogView.tsx:57-61` | 只读聚合，不写标签 |
| 文档 | `docs/frontend-contract.md:47`、`69`、`223-225` | 需同步标签契约与设置字段 |

**Change Necessity**：只改前端无法实现「用户不能创建新标签 / 至少选一个」，因为 `POST/PATCH /author/mods` 直接落库任意字符串（含空）。只改配置也不成立（当前没有标签目录这一配置项）。最小代码边界 = `SiteSettings` 增一棵有序目录树 + 写入侧归一化校验 + 一个公开只读接口 + 两处 UI + 一次性存量清空脚本。

**Ripple Signal Triage**：命中「公共契约 + 持久化 + 权限端点 + 存量数据迁移」。权威 owner = 后端 `SiteSettings.TagCatalog`（目录树）与 `normalizeModTags`（写入校验 + 父子补全）；下游消费者 = 作者工作台、设置页、Web 目录筛选；桌面端只读聚合天然受限。存量模组标签是全库清空，必须显式迁移（§9）。

## 3. 数据模型

```go
type TagGroup struct {
    Name     string   `json:"name"`               // 主标签
    Children []string `json:"children,omitempty"` // 子标签（0..N）
}

type SiteSettings struct {
    // ... 现有 GitHub 字段 ...
    // TagCatalog 是站点唯一的标签权威列表；json 不带 omitempty，nil = 未配置（用默认），
    // 空数组 = 已配置。写入侧拒绝空目录，避免「无标签可选」的死状态。
    TagCatalog []TagGroup `json:"tag_catalog"`
}
```

`Mod.Tags` 保持 `[]string` 扁平存储所选名称（主标签名和/或子标签名）。因为名称全局唯一（父名不得与任何子名重复），扁平存储足以表达选择，且 `GET /mods?tag=` 的 `slices.Contains` 在「选子标签自动补父标签」的不变式下已经天然覆盖了「点主标签含子标签」的筛选语义。

## 4. 校验与归一化规则

`normalizeModTags(input []string, catalog []TagGroup) ([]string, error)`，在 `POST /author/mods` 与 `PATCH /author/mods/{id}` 落库前调用：

1. trim、去空、去重（保持首次出现顺序）。
2. 空输入 → `400 tags_required`（每个模组至少 1 个标签）。
3. 每个名称必须命中目录中的某个主标签或子标签，否则 `400 invalid_tags`（错误信息给出首个非法名称）。
4. 选中子标签时自动补入其主标签。
5. 输出顺序按目录顺序，父标签在其子标签之前。
6. 归一化后总数 > 8 → `400 too_many_tags`。

目录写入（管理员 PATCH）规则：

1. 至少 1 个主标签；主标签 ≤ 20 个；每个主标签的子标签 ≤ 6 个。
2. 名称 trim 后 1..24 字符；禁止 `,`、`#`、换行与控制字符。
3. 名称在**整个目录内全局唯一**（父名与任何子名不重复），保证扁平存储无歧义。
4. 去重后长度变化视为规范化（不报错）；出现跨层级重名 → `400 invalid_tag_catalog`。

## 5. 兼容边界

- 保留：settings revision 乐观锁、CSRF、同源校验、审计事件、`GET /mods?tag=` 契约、公开响应字段名 `tags`。
- 保留：`catalog_snapshot` 单文档存储；旧快照缺 `settings.tag_catalog` 时按默认目录生效（内存播种，首次管理员保存才落库）。
- 新增不变式：保存目录后，模组标签 ⊆ 目录。为维持它，管理员保存目录时同一次 `saveLocked` 内清理模组上已不存在的标签（见 Task 3），并在审计里记录清理数量。
- 不改变：交付/下载/审核/安装链路；标签只影响展示与筛选。
- 桌面客户端不新增网络依赖，继续从模组聚合筛选（写入端受限后聚合结果必然落在目录内）。父子在桌面端表现为扁平名称，属**刻意保留**。

## 6. TDD Route

- mode `auto`（`~/.config/aegis/config.toml`）→ decision **strict**：命中持久化、公共契约、权限端点、存量迁移四类信号。
- 后端先写失败测试（新建 `internal/httpapi/tag_catalog_test.go`，扩展 `settings_test.go`、`submissions_test.go`），再实现。
- 前端 **light**：`TagPicker`、`TagCatalogSettings`、筛选分组的组件/纯函数测试，先跑红再实现（锁定「不能输入新标签」「未选不能保存」两条验收）。
- 迁移脚本先 dry-run 统计再执行（§9）。

## 7. 任务分解

### Task 1 — 目录模型与默认播种

文件：`internal/httpapi/server.go`、`settings.go`、`postgres.go`、`tag_catalog_test.go`

- 新增 `TagGroup`、`SiteSettings.TagCatalog`、`defaultTagCatalog()`（12 个主标签，`Children` 为 nil）、`effectiveTagCatalog()`（nil → 默认副本）。
- `siteSettingsLocked()` / `siteSettingsResponse` 增 `tag_catalog`（返回生效目录，不是「是否配置」）。
- `NewPostgresStore` 加载旧快照后不写库；默认目录在内存生效。
- 测试：旧快照无 `settings.tag_catalog` → `GET /admin/settings` 返回默认 12 项；PATCH 后重启仍为保存值。

### Task 2 — 写入归一化 + 公开目录接口

文件：`internal/httpapi/server.go`、新建 `internal/httpapi/tags.go`、`tag_catalog_test.go`、`submissions_test.go`

- `normalizeModTags` 按 §4 实现，接在 `authorMods`（POST）与 `authorModResource`（PATCH）落库前；失败不写入草稿、不产生审计。
- 新增 `GET /api/v1/tags` → `{"groups":[{name,children}],"revision":N}`，`RLock` 读取，仅 GET，公开。
- 测试：空标签 400 `tags_required`；目录外 400 `invalid_tags`；选子标签自动补父且顺序按目录；重复/空白归一化；超过 8 个 400 `too_many_tags`；`GET /tags` 公开可读并随目录 PATCH 变化。

### Task 3 — 管理员目录 PATCH、清理与审计

文件：`internal/httpapi/settings.go`、`tag_catalog_test.go`、`settings_test.go`

- PATCH payload 增 `TagCatalog *[]TagGroup`；按 §4 校验；纳入现有「至少一个字段」检查。
- 保存时在同一次 `saveLocked` 内扫描 `Mods`，移除目录外的标签，累计清理数量；`SettingsAuditEvent` 增 `TagsChanged bool` 与 `PrunedModTags int`；失败时目录、revision、被清理的模组标签一并回滚（沿用现有 `prev` 快照并额外快照被改动的模组标签）。
- 测试：增删/排序落库；子标签随主标签删除；目录外标签被清理且审计计数正确；保存失败完整回滚；revision 冲突 409；空目录/超长/跨层级重名/非法字符 400；非 admin 403。

### Task 4 — 共享 TS 契约

文件：`ui/settings-api.ts`、`ui/settings-api.test.ts`、新建 `ui/tags-api.ts`、`ui/tags-api.test.ts`

- `SiteSettings` 增 `tag_catalog: TagGroup[]`；`SiteSettingsPatch` 增 `tag_catalog?: TagGroup[]`；导出 `TagGroup`。
- `fetchTagCatalog(base)` 读 `GET /tags` → `{groups, revision}`；错误经 `handleResponse` 抛 `code: message`。
- 测试：类型往返、CSRF 头、revision 传递、错误码抛出、空 groups。

### Task 5 — 作者端分组 chip 多选 + 必选校验

文件：新建 `web/src/components/TagPicker.tsx` + `TagPicker.test.tsx`、`web/src/components/AuthorWorkbench.tsx`、`web/src/components/useAuthorWorkspace.ts`

- `TagPicker`：props `{groups, value, max=8, onChange, disabled}`；每组一行：主标签 chip + 子标签 chip；点主标签 = 选中/清空整个分组；点子标签 = 切换并自动补/保留主标签；达上限时未选项禁用并显示 `已选 8/8`。无自由输入。
- `AuthorWorkbench`：删除 `newTagsStr` 与其逗号解析（`95`、`169-172`、`274`、`1556-1564`），改为 `newTags: string[]`；打开新建/编辑弹窗时拉取 `/api/v1/tags`，失败时禁用选择器并提示「标签目录读取失败，请稍后重试」。
- 保存前本地校验：`newTags.length === 0` 时禁用保存按钮并显示「至少选择一个标签」。
- GitHub 导入演示路径（`399` 行）改为取目录首个主标签；目录为空时该路径提示错误。
- 测试：分组渲染、父子联动（选子补父、点父清组）、上限禁用、空选择时保存禁用、目录失败态、提交体只含目录内名称。

### Task 6 — 设置页目录卡片

文件：新建 `web/src/components/TagCatalogSettings.tsx` + 测试、`web/src/components/AdminPanel.tsx`

- 卡片：「新增主标签」输入 + 添加；每个主标签一行，行内是子标签 chip 列表 + 「添加子标签」输入 + 删除；行级「上移 / 下移 / 删除」；显示 `主标签 n/20`、每组 `子标签 n/6`。
- 与保存态比较后启用「保存目录 / 恢复」；保存走 `updateSettings({tag_catalog}, revision, csrf)`，409 沿用「设置已被其他管理员更新，请重新加载」。
- 前端预校验与 §4 一致（空名、超长、全局重名、`,#`），失败内联报错不改状态。
- 测试：增删主/子标签、排序、保存载荷、上限禁用、重名校验、冲突提示、失败回滚。

### Task 7 — 目录筛选按主/子分组

文件：`web/src/components/CatalogView.tsx`（+ 现有测试）

- 筛选区：第一行主标签 chip + 「全部」；选中某主标签时其子标签 chip 以第二行展示（缩进/次级样式），选中子标签则精确筛选该子标签；未选主标签时只展示主标签行。
- 筛选逻辑保持 `mod.tags.includes(selected)`：因为子标签一定伴随父标签落库，点主标签即命中其全部子标签的模组（§3 不变式）。
- 顺序以 `GET /api/v1/tags` 为准；读取失败回退到现有聚合逻辑，不新增错误横幅。
- 测试：主标签筛选命中子标签模组、子标签精确筛选、目录顺序、读取失败回退。

### Task 8 — 存量标签清空脚本与文档

文件：新建 `tmp/migrations/2026-10-22-clear-mod-tags.sql`（一次性，不进长期代码路径）、`docs/frontend-contract.md`、`docs/aegis/INDEX.md`

- 脚本对目标服务器 `100.72.137.92` 的 PostgreSQL 执行，把 `catalog_snapshot` 内全部模组的 `tags` 置为 `[]`；先跑统计查询确认影响行数，再执行，执行后需重启 `submodhub-api` 容器（内存目录缓存）。
- 脚本**不**写入 `settings.tag_catalog`：默认目录由服务端在内存播种，避免脚本与后端默认值两份真相。
- 文档：记录 `GET /api/v1/tags`、`PATCH /admin/settings` 的 `tag_catalog`、错误码 `invalid_tags` / `tags_required` / `too_many_tags` / `invalid_tag_catalog`，以及「作者不能创建标签、目录删除会清理模组标签、存量模组可暂时为空」的语义。

## 8. 默认数值（可改）

| 项 | 默认值 |
| --- | --- |
| 每模组标签上限（父+子，归一化后） | 8 |
| 主标签数量 | 1..20 |
| 每主标签子标签数 | 0..6 |
| 单个名称长度 | 1..24 字符 |
| 存量旧标签 | 脚本全量清空 |

## 9. 验证

- 后端：`go test ./internal/httpapi -count=1`；`go test ./... -count=1`。
- 共享契约：`cd web; npx tsx --test ../ui/settings-api.test.ts ../ui/tags-api.test.ts`。
- Web：`npm --prefix web test`、`npm --prefix web run lint`。
- 桌面回归：`go -C cmd/client/SubmodHub test -tags browser -count=1 ./...`。
- 迁移：先 `SELECT ...` 统计带标签的模组数量，执行后复核 `tags` 全为空数组，再重启 API 容器确认目录默认值生效。
- 手工：设置页加主/子标签 → 作者端分组可见；选子标签自动带父；未选标签无法保存；提交目录外标签 400；删除主标签后模组上的该标签消失且审计计数正确。

## 10. 风险与退役

- 风险：`internal/httpapi/submissions_test.go` 现有用例使用 `dialogue` / `updated` 标签、且首次创建不带标签的场景，Task 2/3 中改为目录内标签 —— 这是**有意的契约收紧**，不是掩盖回归。
- 风险：管理员误删主标签会连带清理已上架模组的标签；审计记录清理数量，界面在保存前给出「将清理 N 个模组标签」的确认提示（Task 6）。
- 风险：标签目录变更后作者端缓存过期。缓解：每次打开编辑弹窗拉 `/tags`，不做长缓存。
- 退役清单：`newTagsStr` 文本输入与逗号解析；`AuthorWorkbench.tsx:399` 的硬编码标签；`web/src/data/mockData.ts` 与 `clients/desktop/src/data/mockData.ts` 的自由标签改为默认目录词（仅 dev 假数据，不改断言）。
- 刻意保留：桌面端从模组聚合标签的扁平筛选（父子仅在选择器与 Web 筛选区体现），因为写入端已受限且客户端无须新增网络依赖。
