# Web 目录刷新与返回顶部 - Evidence

时间：2026-10-25。工作区 `main`（在 `18b4fbd` 之上未提交）。

## 静态检查与单测（本机可复现）

| 命令 | 结果 |
|---|---|
| `cd web && npx tsc --noEmit` | exit 0 |
| `cd web && npx tsx --test "src/**/*.test.ts*"` | 122 通过 / 0 失败（此前 115） |
| `cd web && npx vite build` | exit 0，`dist/assets/index-sqrJ022X.js` 666.75 kB |

新增 `web/src/components/CatalogView.floating.test.tsx`（7 条）：刷新常驻/置灰旋转/真正回源、失败时让位给失败条、失败条与空态互斥、返回顶部的出现阈值与点击目标。

`web/src/test/appContextMock.ts`：`mods: []` 的用例不再默认带上一条 `v1` 版本——默认值让空的目录仍能渲染出一个卡片，是原先「失败态与空态同屏」的测试假象来源。

## 真实浏览器验收（生产构建 + `vite preview`，1280×1287 / 375×812）

- 顶部时无返回顶部控件；滚到 589px 出现，位于右下角 `(1817,1163)`，44×44；与下方刷新按钮垂直间距 12px，`elementFromPoint` 命中按钮自身，不遮挡卡片。
- 点击返回顶部：平滑滚回 `scrollTop 0`，控件自行收回。
- 点击刷新：0–450ms 采样内均为 `disabled`、`.animate-spin`、`title=正在刷新模组目录…`；约 4s 后恢复空闲态，卡片 18 张不变（刷新不清屏）。
- 375×812：两枚按钮在 `(300,688)` / `(300,744)`，均在视口内，`scrollWidth - clientWidth = 0`，无横向溢出。
- 失败路径（Playwright 拦截 `**/api/v1/mods**` 并 abort）：失败条可见、空态不出现、悬浮刷新隐藏、重试按钮可点；解除拦截后刷新入口回来、失败条消失、卡片恢复 18 张。

## 一处实现教训

`pageScrollPane()` 最初直接把 `document` 当作滚动容器。浏览器里 `document` 既没有 `scrollTop` 也没有 `scrollTo`（整页滚动的位置与动作都在 `documentElement` 上，事件却派发在 `document` 上），于是控件永远读到 0、点了也滚不动。单测用的假 DOM 恰好没暴露这一点，是这个缺陷被真实浏览器抓到后才修掉的；测试假 DOM 现已改成与浏览器一致（位置在 `documentElement`，事件从 `document` 派发）。

## 已知未覆盖

- 目录表头的文字「刷新」按钮与悬浮刷新同时置灰，只做了静态渲染断言，没有在真实浏览器里同时点击两者验证去重（`reloadCatalog` 的并发共享）。
- 没在移动端真机触屏上验证悬浮按钮与系统手势条的关系，只在 375×812 的视口里量了几何位置。
