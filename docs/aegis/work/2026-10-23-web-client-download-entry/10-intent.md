# Web 客户端下载入口 - Intent

## TaskIntentDraft
- Parent: 用户 2026-10-23 直接要求「站点增加客户端下载入口」，同日要求对改动做评审并修复。
- Outcome: Web 头部提供下载入口，读同一份 `GET /app-update` 描述；描述新增 `release_url`（GitHub Release 页面）；服务端交付策略不变。
- Success: `tsc --noEmit`、前端单测、Go 回归全绿；真实浏览器里入口可用、布局在 375/640/768/1280 无溢出；契约文档同步。
- TaskStartSnapshot: root J:/GithubRep/Reze_SubmodHub; main; HEAD 0a3398d；工作区含未提交的下载入口实现，评审后一次性提交为 385dd70。
- Preserve: 不改服务端镜像/交付策略，不改桌面客户端与 `internal/delivery` 的 origin 口径。

## Execution Readiness View
- Intent lock: 主 API 仍是更新检查与交付计划的唯一权威（ADR-0002）；Web 只是同一描述的另一个消费者。
- Scope fence: 不做字节中转、不做安装，只负责「把用户送到对的地址」。
- Compatibility: `release_url` 是可选字段；老服务端不返回时前端隐藏「前往 GitHub Releases」，不报错。
- Retirement: 合并 Web 内三份 `formatBytes`、三十余处内联 API base 拼接，以及四处已无作用的 `import.meta.env` polyfill。
- TDD Route: Mode auto → light；纯选路逻辑先写断言（`clientDownload.test.ts`），组件渲染用 SSR 断言。
- ArchitectureReviewRequired: yes；契约文档（`frontend-contract.md`、`app-update.md`）随字段一起改。

## ImpactStatementDraft
公开 API 增加一个可选字段；Web 增加一个入口组件与两个共享模块（读取层、选路逻辑）；格式化与 API base 各收敛到一个 owner。无迁移、无数据变更。
