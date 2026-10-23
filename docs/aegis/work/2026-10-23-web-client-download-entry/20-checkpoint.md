# Web 客户端下载入口 - Checkpoint

## 分层
- `internal/httpapi/app_release.go`：`appReleasePageURL(owner, repo, tag)` 拼 GitHub Release 页面；`appUpdateDTO.ReleaseURL` 随描述返回。即使没有任何镜像资产，只要有 Release 元数据就有值。
- `ui/app-release-api.ts`：`GET /app-update` 的唯一读取层，逐字段结构校验，缺省值归一（`github_url` 退回 `url`）。
- `web/src/components/clientDownload.ts`：纯逻辑。资产分类（只认 `.apk` 与含 `windows` 的 `.exe`，排除独立更新器与校验文件）、按设备排序、`resolveDownloadRoute` 选路、`pickSameReleaseAsset` 跨版本守卫、`isTrustedHostedLink` origin 判定。
- `web/src/components/ClientDownloadModal.tsx`：只在取数与展示，不含判定逻辑；`ClientDownloadPanel` 可 SSR 直测。
- `web/src/apiBase.ts` / `web/src/components/formatBytes.ts`：分别收敛 API base 与字节格式化。

## 关键决策
1. **来源由「此刻真能交付的那条路」决定**。节点直链过期或不可信时，`resolveDownloadRoute` 直接返回 `github_url`，并把 `source` 标成 `github`，展示与跳转同源，杜绝「写着本站下载、点下去是 GitHub」。
2. **重取只替换同一 release 的直链**。`pickSameReleaseAsset` 在 `tag_name` 不一致或找不到同名资产时返回 `undefined`，调用方保留 GitHub 直链——与 `docs/app-update.md` 里客户端自更新的契约完全一致，避免「说明是 A、装上的是 B」。
3. **白名单空时不拦截**（与桌面端 `internal/delivery.ValidateOriginURL` 的「空即拒绝」有意不同）：浏览器跳转不携带 API 凭据、不由服务端出站，镜像已由服务端读回校验；且 `delivery_settings.go` 要求 cloudreve 节点白名单 1–16 条，空列表在生产配置下不可达，这条分支只是给历史配置的防御。
4. **`release_url` 放在描述层**，不让前端从资产列表拼：逐资产 `github_url` 只指向单个文件，拼不出 Release 页面。

## 未做 / 边界
- 不做浏览器端安装、不校验下载后的哈希（桌面端负责）；Web 只展示 SHA-256 供人工比对。
- `internal/httpapi`、桌面客户端、`internal/delivery` 未改动。
