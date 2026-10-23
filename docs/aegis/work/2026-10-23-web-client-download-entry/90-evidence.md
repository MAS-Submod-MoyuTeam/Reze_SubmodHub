# Web 客户端下载入口 - Evidence

抓取时间：2026-10-23。工作区 `main`，本记录对应提交 `385dd70` 及其后续评审修复。

## 静态检查与测试（本机，可复现）

| 命令 | 结果 |
|---|---|
| `cd web && npx tsc --noEmit` | exit 0 |
| `cd web && npm test` | 124 条通过 / 0 失败 |
| `cd web && npx tsx --test "../ui/*.test.ts"` | 59 条通过 / 0 失败 |
| `go build ./...` | exit 0 |
| `go test ./internal/httpapi/ ./internal/delivery/` | ok / ok |
| `gofmt -l internal/httpapi/app_release.go internal/httpapi/app_release_test.go` | 无输出 |

新增或改写的用例集中在：`ui/app-release-api.test.ts`（5）、`web/src/components/clientDownload.test.ts`（12）、`web/src/components/ClientDownloadModal.test.tsx`（8）、`web/src/components/formatBytes.test.ts`（2）。

## 真实运行验收（vite dev + 浏览器）

`npx vite --port 5199`，`/api` 代理指向已部署后端；实测后端返回的是 `v0.9.10`，两个资产都走 Cloudreve 节点：

- 弹窗正文：`下载 RezeHub 客户端 v0.9.10`，两张卡片均为 `来源：本站节点（Cloudreve）`、`从本站下载` + `GitHub 直链`，大小显示 `12.6 MB` / `26.3 MB`，SHA-256 短哈希正常。
- 三个外链（GitHub 直链 ×2 + SHA256SUMS.txt）都指向 `github.com/MAS-Submod-MoyuTeam/Reze_SubmodHub/releases/download/v0.9.10/...`。
- 已部署后端尚未返回 `release_url`，弹窗因此不显示「前往 GitHub Releases」且不报错——`release_url` 的可选性在真实环境里被验证了一次。
- `Escape` 关闭弹窗生效。

布局度量（`documentElement.scrollWidth - clientWidth` 全程为 0，无横向溢出）：

| 视口 | Header | Zone 3 | 弹窗 |
|---|---|---|---|
| 1280×900 | 单行 56px | 981–1241（人格标签 + 下载客户端 + 登录） | 512×465，在视口内 |
| 768×800 | 单行 56px，导航可见 | 469–729；导航右边界 332，无重叠 | 512×465 |
| 768×800（模拟管理员四导航项） | 单行 56px | 导航 198–410，Zone 1 右界 140、Zone 3 左界 469，无重叠 | — |
| 640×900 | 单行 56px，导航隐藏、人格标签可见 | 341–601 | — |
| 375×812 | 单行 56px | 221–344（短标签「下载」+ 登录） | 336×524，无横向溢出，滚动区无溢出 |

375 宽下目录筛选区三行分别折为 54 / 46 / 51px，`min-w-0 flex-wrap` 生效，整页无横向滚动。

## 测试服部署（0.9.12，2026-10-23 19:2x）

按 `docs/operations.md`「从本机更新测试服」执行：本机 `GOOS=linux` 交叉编译 `deploy/build/submodhub-linux-amd64`、`npm run build` 出 `web/dist`，上传到 `100.72.137.92:/home/sirp/submodhub`（旧二进制留 `submodhub-linux-amd64.pre-web-client-download`，旧前端留 `dist.pre-web-client-download-20261023`），再 `up -d --build api` 并重启 `web`。

部署后实测：

| 检查 | 结果 |
|---|---|
| `GET /healthz` | `status ok`，`version 0.9.12` |
| `GET /api/v1/version` | `0.9.12`，`go1.26.10`，`linux/amd64` |
| `GET /api/v1/app-update` | `release_url = https://github.com/MAS-Submod-MoyuTeam/Reze_SubmodHub/releases/tag/v0.9.10`；三个资产 `delivery_type cloudreve`，`allowed_download_origins` 为 `https://disk.monika.love`、`https://disk.edgemonix.top:29991` |
| `GET :18083` | 引用 `assets/index-CNFM59Nu.js`、`assets/index-Dy7FsJm9.css`，与本机 `dist` 哈希一致 |
| 公开入口 `https://rezehub.0721play.icu` | 顶部品牌显示 `v0.9.12`；下载弹窗显示 `v0.9.10`、两张卡片「来源：本站节点（Cloudreve）」、4 条外链（含 `releases/tag/v0.9.10`）、按钮「从本站下载」 |

`release_url` 至此在真实部署上首次可见（此前部署的后端早于该字段）。客户端版本仍是 `0.9.10`：`v0.9.12` 的 Windows/Android 产物由 CI 在推送 `main` 后构建并发布 Release，本次未推送远端。

## 边界说明
- 「快照过期告警」「白名单不命中回落 GitHub」「tag 变化放弃重取」三条路径仍只有单测覆盖：测试服的节点直链未过期、白名单命中，真实触发不了。
- 管理员登录态下的导航宽度是用克隆真实导航项模拟的，不是真实登录会话。
