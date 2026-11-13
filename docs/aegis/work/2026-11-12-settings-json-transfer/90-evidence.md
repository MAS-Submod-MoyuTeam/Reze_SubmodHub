# 设置导入导出（JSON）- Evidence

时间：2026-11-12。工作区 `main`（在 `944a93d` 之上，含此前未提交的 i18n 改动）。

## 本机可复现的检查

| 命令 | 结果 |
|---|---|
| `go build ./...` | exit 0 |
| `go vet ./internal/httpapi/` | exit 0 |
| `gofmt -l internal/httpapi/settings_transfer.go internal/httpapi/settings_transfer_test.go` | 无输出 |
| `go test ./... -count=1` | 全部包 ok（含 `internal/httpapi` 5.6s） |
| `go test ./internal/httpapi -run TestSettings` | ok（含新增 8 个用例） |
| `go run ./cmd/version -check` | `version metadata is consistent: 0.10.7` |

新增 `internal/httpapi/settings_transfer_test.go`（8 个顶层用例）：

1. `TestSettingsExportShapeAndPermissions`：匿名 401 / 普通用户 403 / `POST` 405 / `GET import` 405；`Content-Disposition` 文件名、`Cache-Control: no-store`；导出体内不含令牌、节点密码与 `"password"`/`"github_token"` 字段；`format`/`version`/`exported_at`、代理、窗口（`4h30m0s`）、目录顺序、节点 `credential_configured` 与空 `password`。
2. `TestSettingsImportRoundTripKeepsSecrets`：导出→导入后 `revision` +1、令牌仍可解出原值、节点密文**逐字节未变**（没有重新 seal）、节点 revision 与上次检测状态保持；再导出与首份文档（除 `exported_at`）完全一致。
3. `TestSettingsImportRestoresFreshDeploymentWithSuppliedSecrets`：把文档导入一个全新 store，补 `settings.github_token` 与该节点 `password` 后用新 master key 解出原值，代理/窗口/目录全部就位；新部署再导出与收到的配置一致。
4. `TestSettingsImportNodeListPresenceSemantics`：`download_nodes` 缺席时节点保留；显式 `[]` 清空节点（`GET /admin/download-nodes` 只剩 builtin）。
5. `TestSettingsImportPrunesTagsAndAudits`：导入收窄目录后两个模组的失效标签被清理，审计 `tags_changed=true`、`pruned_mod_tags=2`、`revision` 单调。
6. `TestSettingsImportRollsBackWhenSaveFails`：把 `DataDir` 指向一个普通文件令 `saveLocked` 失败 → 500 `storage_error`，设置、revision、审计长度、节点数量与被清理的标签全部回到导入前。
7. `TestSettingsImportRejectsInvalidDocuments`：`format`/`version` 不支持、未知字段、非法代理、非法窗口、空目录、重复节点 ID、节点类型变更、新节点缺密码、环境钉死窗口（409）——每个用例断言状态码与错误码。
8. `TestSettingsImportAuthAndCSRF`：匿名 401、普通用户 403、缺 CSRF 403 `csrf_invalid`、跨源 403 `cross_origin_forbidden`。

## 真实测试服验收（`100.72.137.92:18082`）

部署：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags '-s -w'` → 上传 → `cp -p submodhub-linux-amd64 submodhub-linux-amd64.pre-settings-transfer-20261112` → `docker compose up -d --build api`。上传前后 md5 一致（`2f2d263568fb940d0813d7a5f9846922`）。

验收方法：为避免动到真实管理员会话，往 `auth_sessions` 插了一条一次性 admin 会话（`flarum:test-verify`），确认后用 `DELETE` 清除；`catalog_snapshot` 在验收前整份导出为 `catalog-snapshot.pre-settings-transfer-verify2.json`，验收完成后用 `convert_from(pg_read_binary_file(...),'UTF8')::jsonb` 原样写回并重启 API 复原（`settings.revision` 回到 10，38 个模组、12 个标签组、`/api/v1/mods` 与 `/api/v1/tags` 正常）。

结果：

| 检查 | 结果 |
|---|---|
| `GET /api/v1/admin/settings/export`（admin） | 200，`format=submodhub-settings`、`version=1`、12 个标签组、节点 `cloudreve-dcc` |
| 导出体内是否含 `github_token` / `password` / `credential_ciphertext` | 均未出现 |
| 原样 `POST .../import` | 200，`revision` 10 → 11 |
| 再导出对比 | 窗口、标签目录、节点顺序完全一致 |
| 导入后节点 | `cloudreve-dcc` 仍 `credential_configured=true`，节点 revision 保持 7、`status=available`、`last_checked_at` 未变；`archive_mirrors` 20 条全部仍绑定 revision 7（未被判定为需要重新上传） |
| 非法 `format` | 400 `unsupported_settings_document` |
| 非法 `github_sync_max_age` | 400 `invalid_github_sync_max_age` |
| 缺 CSRF | 403 `csrf_invalid` |
| 跨源 | 403 `cross_origin_forbidden` |
| 匿名 export / import | 401 / 401 |

**第一次验收暴露的真实缺陷**：首版把节点的 `Revision` 无条件设为 `settings.revision + 1`，于是「原样导入一份未改动的文档」会把节点 revision 7 抬到 11，而 `archive_mirrors` / `app_asset_mirrors` 全部按 `NodeRevision` 绑定（`archive_mirrors.go:80/87`、`app_asset_retention.go:83`），下一次巡检会把 20 个已就绪镜像判成过期并重传；同时节点 `status` 从 `available` 掉回 `untested`。修复为「配置未变且未提供新密码时保留旧 revision 与上次检测结果」，并补了断言。这也是本切片唯一一处由真实验收（而非单测）发现的缺陷。

## 前端按钮（管理页「备份与迁移」卡片）

补齐管理页入口，改动：`ui/settings-api.ts`（`exportSettings` / `importSettings` 与传输文档类型）、`ui/settings-transfer.ts`（选文件后的本地解析与确认条概览）、`web/src/components/SettingsTransferCard.tsx`（卡片）、`web/src/components/AdminPanel.tsx`（接线与导入后刷新）、`web/src/components/DownloadNodeSettings.tsx`（新增 `reloadSignal`，导入后重读节点列表）、`web/src/i18n/messages/{zh,en}-author.ts`（`settingsTransfer.*` 21 个键）。

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx tsx --test ../ui/settings-transfer.test.ts` | 7 pass |
| `npx tsx --test ../ui/settings-api.test.ts` | 13 pass（新增 4 个 export/import 用例） |
| `npx tsx --test src/components/SettingsTransferCard.test.tsx` | 7 pass（jsdom 真实点击） |
| `npx tsx --test 'src/**/*.test.ts*'` | 224 pass |
| `npx tsx --test ../ui/*.test.ts` | 117 pass |
| `npx tsx --test src/i18n/wiring.test.ts` | 6 pass（含「无孤儿键」「无中文 UI 字面量」） |
| `npm run build` | 成功，`dist/assets/index-CRZSD_EP.js`（上传到测试服后页面引用的哈希一致） |

卡片级测试覆盖的接线错误（单测全绿也抓不到的那类）：导出按钮确实发 `GET /admin/settings/export` 并把 `Content-Disposition` 文件名交给保存；选中文件只弹确认条、不发请求；确认后才 `POST`，且带 `X-CSRF-Token` 与逐字节相同的文档；坏文件（非 JSON / 别的 JSON / 版本不认识）在本地就被挡住且零请求；`credential_required` 写进卡片、`settings_conflict` 走冲突回调而不是显示成普通失败；文档带令牌时确认条点明会替换令牌。

真实测试服浏览器验收（`http://100.72.137.92:18083/` → 设置页，Playwright）：

| 检查 | 结果 |
|---|---|
| 页面出现「备份与迁移」卡片，`rev` 与设置 revision 一致 | 通过（截图为证） |
| 点「导出为 JSON」 | 网络面板记为 `GET /api/v1/admin/settings/export → 200`，浏览器收到保存动作 |
| 选入一份 3 标签组 / 1 节点的文档 | 确认条显示「3 个主标签 / 1 个子标签」「1 个节点」、代理 `100.106.239.85:7890`、窗口「默认（1 小时）」 |
| 点「替换当前配置」 | `revision` 10 → 11；`GET /admin/settings` 的标签组变为文档里的 3 个，代理与窗口与文档一致 |
| 切换英文 | 卡片全部文案为英文，无缺键回退痕迹 |
| 文件输入用 `hidden` 而非 `sr-only` 后 | 点按钮仍能唤起文件选择器（Playwright 收到 `filechooser` 事件）；卡片内同名控件从 2 个降到 1 个，读屏不再看到重复的「选择 JSON 文件…」 |
| 导入后恢复 | `catalog_snapshot` 整份写回导入前快照并 `restart api`，`revision` 回到 10、12 个标签组、38 个模组，`cloudreve-dcc` 回到 `available` / rev 7 |

## 已知未覆盖

- 未在 staging 上验证「跨部署迁移」的完整链路（缺凭据的节点在新部署导入应报 400 `credential_required`，该分支只在单测与前端错误码映射中覆盖）。
- 真实服上未构造「写盘失败」场景（`storage_error` 回滚只在单测里用不可写路径覆盖）。
- 桌面/Android 客户端不涉及本端点，未验证。
