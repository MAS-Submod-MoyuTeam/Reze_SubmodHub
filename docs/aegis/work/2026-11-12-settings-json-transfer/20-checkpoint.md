# 设置导入导出（JSON）- Checkpoint

## 设计选择（及被否掉的替代方案）

**1. 导出不含凭据，但导入接受凭据字段**
- 选了：`GET` 导出永不含 `github_token` / 节点 `password`；导入文档里这两个字段可选，缺省即「保持现有」。
- 否掉「导出含密文」：密文绑定 `SUBMODHUB_DELIVERY_MASTER_KEY` 与 AEAD 的 associated data（节点 ID / `submodhub/delivery/v1/...`），换部署就解不开，等于带着无法使用的字节。
- 否掉「导出含明文密码」：违反现有 `GET /admin/settings`、`GET /admin/download-nodes` 的口径，且导出文件本来就要被随手复制。
- 结果：同一部署「导出→导入」零操作可还原；跨部署迁移时由操作员补 `password`，由目标部署自己的 master key 重新加密。

**2. 文档格式自带 `format` + `version`**
- 选了：`{"format":"submodhub-settings","version":1}`，不匹配返回 400 `unsupported_settings_document`。
- 否掉按字段猜形状：导入是整份覆盖，猜错等于清空配置，必须显式拒绝。

**3. `download_nodes` 用「字段缺席」表示不动**
- 选了：指针字段 —— 缺席/`null` = 节点列表不动，`[]` = 删掉全部节点。
- 理由：导入一个只含 `settings` 的手写文档时，没人希望顺手清空节点；反过来显式给空数组是明确意图。
- 其余字段是整份语义：缺席即置空/恢复默认，并在契约文档里写明（`tag_catalog` 仍必须非空）。

**4. 复用既有校验与清理逻辑，不新写一套**
- 代理：`github.ValidateProxyTemplate`
- 窗口：`normalizeGitHubSyncMaxAge` + `resolveGitHubSyncMaxAge`
- 标签目录：`normalizeTagCatalog` / `writeTagError`
- 节点：`deliveryNodeInput.node()`（与 `POST/PUT /admin/download-nodes` 同一套形状与约束）
- 标签清理：把 `PATCH` 里那段内联循环抽成 `Store.pruneModTagsForCatalogLocked`，两处共用。抽取后 `PATCH` 的 `prunedMods` 改成 `len(prunedTags)`，行为不变（单测覆盖）。

**5. 一次写入 + 整份回滚**
- 选了：所有校验在第一次变更前完成；`saveLocked` 失败时恢复 `Settings`、`DeliveryNodes`、`GitHubSyncMaxAge`、审计长度与被清理的模组标签。
- 环境钉死窗口（`GITHUB_SYNC_MAX_AGE`）时直接 409 `github_sync_max_age_env_override`，不静默丢弃文档里的值。

**6. 凭据只在一切形状检查通过后才加密**
- 第一版把「解析节点」和「加密密码」放在同一循环里，`duplicate_download_node` 用例暴露出：先 seal 再撞重复 ID 会白白消耗一次加密与随机数。改为两段式（先全量解析校验，再统一 seal），失败路径不再有半成品。

## 明确不做

- 前端按钮/文件选择器（本切片只做服务端；`ui/settings-api.ts` 未改）。→ 后续切片已补齐，见 `90-evidence.md`「前端按钮」一节。
- 模组、版本、投稿、角色授予、审计历史的导出（不属于「设置项」）。
- 文档版本迁移：`version` 不等直接拒绝。
