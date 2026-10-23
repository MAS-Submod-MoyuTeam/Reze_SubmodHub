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

## 边界说明
- 浏览器验收用的是**已部署旧后端**（无 `release_url`、资产走节点直链），所以「快照过期告警」「白名单不命中回落 GitHub」「tag 变化放弃重取」这三条路径由单测覆盖，未在真实后端触发。
- 管理员登录态下的导航宽度是用克隆真实导航项模拟的，不是真实登录会话。
