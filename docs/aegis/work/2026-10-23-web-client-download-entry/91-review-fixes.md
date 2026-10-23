# Web 客户端下载入口 - 评审发现与修复

首轮评审（用户 2026-10-23 要求 review 当前改动）共 15 条发现，处置如下。

## 重要（已修）

| # | 发现 | 处置 |
|---|---|---|
| 1 | 重取描述后仍可能使用过期直链：重取成功但新描述回落 `github`、或找不到同名资产时，`href` 保持旧签名直链 | `resolveDownloadRoute` 对过期/不可信节点直链**直接返回 GitHub 地址**；`needsFreshLink` 只表达「值得换一份描述」，换不到就落 GitHub，过期直链不再出现在任何分支 |
| 2 | 重取时缺 `tag_name` 守卫，可能「说明是 A、装上的是 B」 | 新增 `pickSameReleaseAsset`：tag 不一致或资产缺失一律作废，调用方保留 `github_url`（与 `docs/app-update.md` 客户端契约一致） |
| 3 | 新公开字段 `release_url` 未同步契约文档 | 同步 `docs/frontend-contract.md` 字段表与 `docs/app-update.md` §5，并新增「Web 下载入口」小节 |

## 次要（已修）

| # | 发现 | 处置 |
|---|---|---|
| 4 | `allowed_download_origins` 读了不校验 | 新增 `isTrustedHostedLink`：https、无凭据、非本机/私网、白名单非空时必须命中；不满足则来源与按钮文案一起切成 GitHub |
| 5 | `formatBytes` 三份实现（`InstalledFileList` 导出、`ModDetailModal` 本地、新模块） | 收敛到 `web/src/components/formatBytes.ts`，另两处改为 import，重复断言并入 `formatBytes.test.ts` |
| 6 | 错误态文案承诺「或直接前往 GitHub Releases」但该状态渲染不出链接 | 删除该承诺 |
| 7 | 错误原文直出，非 JSON 响应会把整段 HTML 灌进弹窗 | 截断到 160 字符 |
| 8 | 重取/回落分支无测试 | 逻辑抽成纯函数并补 4 组断言（临期、白名单不命中、tag 变化、资产缺失） |
| 9 | `linkExpiringSoon` 测试名与实现相反，且未覆盖不可解析时间 | 改名并补 `'not-a-timestamp' → true` 断言 |
| 10 | 模块顶部的 `import.meta.env` polyfill 无效且让模块无法被非 ESM 目标消费 | 删除；同时把 `ui/auth-api.ts` 的裸访问改成可选链，四个文件的 polyfill 一并清掉 |
| 12 | 未跟踪的 `.tmp/gofmt/app_release.go` 是 gofmt 临时产物，`.gitignore` 只忽略 `/tmp/` | 删除临时目录，`.gitignore` 补 `/.tmp/` |

## 追加完成

| # | 项 | 处置 |
|---|---|---|
| 11 | API base 拼接重复 | 新增 `web/src/apiBase.ts`，替换 32 处内联拼接（`AdminPanel` 用别名避开同名局部变量） |
| 13 | md 宽度下 Zone 3 拥挤未验收 | 用浏览器在 375 / 640 / 768 / 1280 实测，含模拟管理员四项导航，全部无溢出、无重叠（见 `90-evidence.md`） |
| 14 | 缺工作记录 | 本目录 |
| 15 | 术语漂移（桌面端 `Cloudreve 节点 <node>` vs Web `本站节点（Cloudreve）`） | 保留 Web 文案并在 `docs/app-update.md` 说明原因：Web 不暴露内部 node id |

## 遗留
- 未连接测试实例 `100.72.137.92` 做部署后验收；`release_url` 在真实新后端上的展示仍待确认（当前部署版本早于该字段）。
