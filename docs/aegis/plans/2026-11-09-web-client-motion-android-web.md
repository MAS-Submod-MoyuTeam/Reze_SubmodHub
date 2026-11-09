# Web 与客户端：悬停/按压反馈、开合动效、固定滚动条与 Android 竖屏优化

**Goal:** 让 Web 站点与桌面/Android 客户端里所有可点击元素都有明确的指针悬停、触摸按下与键盘焦点反馈；浮层的打开与关闭都带动效；Web 的竖向滚动条常驻且尺寸固定，出现与消失都不推动页面布局；并修掉 Web 端在 Android 竖屏下的几处具体缺陷（安全区失效、短屏溢出、筛选条挤压）。

**Architecture:** 动效交给 `motion`（v12）。仓库根部的 `ui/motion-presets.ts` 只放**纯数据**——缓动曲线、时长、各语义浮层的 `initial/animate/exit` 变体；两端各有一份 `src/components/Motion.tsx` 负责把 `motion` 接进来（`LazyMotion features={domAnimation} strict` + `MotionConfig reducedMotion="user"`），并在应用根节点包一层 `MotionProvider`。退场动画由 `AnimatePresence` 负责：父级把子节点从条件里摘掉后，它继续把节点留在树上播完 `exit` 再卸载，因此**不再需要**自维护的 `usePresence` 计时器，也不再有 `data-closing` 状态位。滚动条靠 `scrollbar-gutter: stable` 常驻沟槽 + 显式 `width: 10px`，避免滚动条宽度随内容长度变化。Android 竖屏靠 `viewport-fit=cover` + `env(safe-area-inset-*)` + `100dvh` 三件套。

**Tech Stack:** React 19 + TypeScript、Vite 8、Tailwind CSS v4（`@import "tailwindcss"`，无动画插件）、`motion` 12、`node:test` + `tsx --test` + JSDOM / `renderToStaticMarkup`。

**Baseline / Authority Refs:** 用户 2026-11-09 的需求（四项）与后续「引入新依赖，避免纯手作」的指示；`docs/aegis/plans/2026-10-25-web-catalog-refresh-and-back-to-top`（悬浮控件几何基线）；`docs/frontend-contract.md`；`ui/motion-presets.ts`、`web/src/components/Motion.tsx`、`web/src/components/TagFilterDrawer.tsx`、`web/src/components/ToastContainer.tsx`、`clients/desktop/src/App.tsx`。

**Compatibility Boundary:** 不引入 `tailwindcss-animate` / `tw-animate-css`。`motion` 早已装在两端（此前未使用），本轮正式启用；按用户选择走 `LazyMotion + domAnimation` 而不是全量 `motion`，Web 产物 gzip 从 +40.6 KB 降到 +27.5 KB。`ui/` 共享层保持纯数据：它解析不到 `motion`，真要引入会在仓库根部再装一份、产生两个 motion 实例并断开 `MotionConfig`/`LazyMotion` 的 context。不改动业务逻辑、接口与数据模型。既有的可访问性契约保持不变：关闭态 `LoginModal` 仍渲染空字符串、抽屉仍有 `role="dialog"` 与 Esc 关闭、实例切换遮罩仍有 `role="status"` 与 `aria-live`、底部导航仍是 5 列。

**Change Necessity:** 手写 `@keyframes` 方案只能覆盖「常驻挂载 + 自己翻转 class」的浮层，条件渲染的弹窗（作者工作台 5 处、评审台、详情弹窗等）父组件一关就摘掉节点，退出动画没有落脚处。要让**所有**浮层都有真实的开合动画，必须引入能在卸载后保留节点的运行时；`AnimatePresence` 正是这一能力，代价是 +27.5 KB gzip（用户已确认接受）。

**TDD Route:** Mode `auto`; decision `light`; authority `auto risk decision`；纯样式与动效层，无数据/安全边界；先补可断言的契约测试（抽屉开合与卸载、Toast 收走、viewport meta），再改生产代码。样式类本身不做快照断言，避免测试变成「复述实现」。

## Tasks

1. [x] **共享动效预设**
   - 新增 `ui/motion-presets.ts`：`EASE_OUT` / `EASE_IN` / `DURATION`，以及 `overlayVariants`、`panelVariants`、`drawerVariants`、`toastVariants`、`dropdownVariants`、`inlineVariants`，每个都是 `{ initial, animate, exit }` 且把 `transition` 烘进 `animate`/`exit`。
   - 只放数据、不 import `motion`：`ui/` 在两端各自的 `node_modules` 之外。

2. [x] **两端 motion 接入点**
   - `web/src/components/Motion.tsx` 与 `clients/desktop/src/components/Motion.tsx` 各一份：转出 `AnimatePresence` 与 `m`，并提供 `MotionProvider`（`LazyMotion features={domAnimation} strict` + `MotionConfig reducedMotion="user"`）。
   - `strict` 保证有人误用 `motion.div` 会直接报错，避免全量实现被悄悄引回来。
   - 两端 `main.tsx` 用 `MotionProvider` 包住 `App`。

3. [x] **浮层迁移到 motion（共 20 个文件）**
   - 常驻浮层：`TagFilterDrawer`（两端）、`LoginModal`、`ClientDownloadModal`、`ToastContainer`、`InstanceSwitchOverlay`、`ShareLinkPrompt`。
   - 条件渲染弹窗改为在父级包 `AnimatePresence`，让它们第一次真正拥有退出动画：`AuthorWorkbench` 5 处、`ReviewerWorkbench` 1 处、`ModDetailModal` 2 处、`DownloadNodeSettings` 1 处，以及客户端 `AdoptModal`、`AppUpdateModal`、`FileInspectModal`、`InstancesView`、`PlanPreviewModal`、`TransactionDetailModal`、`ModDetailModal`、`InstalledView`。
   - 删除 `ui/motion.css`（9 组 `@keyframes`）与两端 `usePresence.ts`；`data-closing`、`toastClosing`、`TOAST_EXIT_MS` 等自维护退场状态一并移除。

4. [x] **Toast 简化**
   - Web：`ToastContainer` 不再保留 `leaving` 副本，`AnimatePresence` 自己收走已从 context 消失的条目。
   - 客户端：`App.tsx` 的 `toastClosing` + 第二个计时器删除，只留「什么时候移除」一个计时器。
   - 保留窄屏修复：容器 `left-4 right-4 sm:left-auto sm:right-5 sm:max-w-md`，360px 下不再横向溢出。

5. [x] **Web 滚动条固定尺寸**
   - `html` 设 `scrollbar-gutter: stable`、`scrollbar-width: thin`；`::-webkit-scrollbar` 固定 `10px`，滑块用 `background-clip: content-box` 留出内边距。
   - 验证：真实浏览器里把 `body` 的 `overflow` 置 `hidden` 前后，`clientWidth` 从 1155 变 1164，而头部内容宽度两次都是 1154.55px，左边界位移 0。

6. [x] **Web Android 竖屏**
   - `index.html` viewport 加 `viewport-fit=cover`（否则 `env(safe-area-inset-*)` 恒为 0），并加 `theme-color`；不写 `user-scalable=no`。
   - 根容器 `min-h-screen min-h-[100dvh]`，`main` 底部留 `3rem + 安全区`；Header 四边让出安全区；悬浮控件与 Toast 底部偏移叠加 `env(safe-area-inset-bottom)`。
   - 目录筛选组在 `<sm` 各占整行；分页与筛选按钮 `min-h-9`；悬浮圆钮 `44×44`。
   - 新增 `web/src/viewport.test.ts` 锁住 viewport 契约（含「注释里出现该词不算」的处理）。
   - 验证：360×640 / 385×837 / 390×844 / 768×800 / 1280×800 五档均无横向溢出，无元素越界。

7. [x] **悬停/按压/焦点清扫（两端）**
   - 用字符级 JSX 扫描器（不用正则，`onClick={() => …}` 里的 `>` 会截断标签）遍历全部标签，逐条补 `hover:` / `active:` / `focus-visible:`。
   - 统一按压反馈：`active:brightness-95` 作为通用项（白底与深底都可见），底色为浅色时改用 `active:bg-neutral-*`；悬浮圆钮用 `active:scale-95`。
   - 焦点环：Web `focus-visible:outline-emerald-600`，客户端 `focus-visible:outline-emerald-400`。
   - 底部导航与侧栏补 `aria-current="page"`。

8. [x] **客户端弹窗安全区与滚动链**
   - 8 处 `fixed inset-0` 遮罩补 `pt/pb-[calc(…+env(safe-area-inset-*))]`，桌面浏览器里 `env()` 为 0，无副作用。
   - 弹窗正文补 `overscroll-y-contain`（用 Tailwind 内置类，不再自造 `.overscroll-contain-y`），避免 Android 上「拖弹窗把背景滚走」。

## Verification Results

- Web：`tsc --noEmit` 退出码 0；全部 Node 测试 **195/195** 通过。
- 客户端：`tsc --noEmit` 退出码 0；全部 Node 测试 **294/294** 通过。
- 构建：两端 `vite build` 成功。Web `233.89 kB gzip`（基线 203.5，+30.4），客户端 `231.35 kB gzip`。产物 CSS 里 `sh-*` 与 `overscroll-contain-y` 计数均为 0，`scrollbar-gutter:stable` 与 `overscroll-behavior-y:contain` 均在位。
- 真实浏览器（Playwright，preview 产物，**可见标签页**）：
  - 抽屉进入：遮罩 `opacity 0 → 1`、面板 `translateX(42.56px) → none`。
  - 抽屉退场：点关闭后节点仍在树上，面板滑出到 `translateX(127px)`、遮罩淡到 `0.58`，约 500ms 后卸载。
  - 居中弹窗进入 `scale 0.9994 → none`、退场 `scale 0.9907 / y 1.86px` 后卸载。
  - `prefers-reduced-motion: reduce`：面板 `transform` 全程 `none`（跳过位移），只保留遮罩淡入。
  - 滚动条常驻：开关滚动条前后头部内容左边界位移 0。

## Notes / 踩过的坑

- **jsdom 没有 WAAPI**：`Element.animate` 与 `getAnimations` 都不存在，`AnimatePresence` 的退场在单测里永远不会自然结束。依赖 motion 的测试文件统一设 `MotionGlobalConfig.skipAnimations = true`（从 `motion/react` 导入），让动画立即完成——这样测的是「AnimatePresence 有没有正确拖住并释放节点」，而不是动画观感。
- **`m.div` 会吞掉 ref 转发**：`ModDetailModal` 原本把「是否挂载」的 ref 挂在遮罩上，迁移后该 ref 拿不到真实节点，`isMountedRef` 恒为 false，导致请求失败后按钮停在禁用态。修法是把 ref 移到内层普通 `div`（`className="contents"`）上，让 motion 只管动画。
- **变体的位移单位必须一致**：`initial: { x: '100%' }` 配 `animate: { x: 0 }` 时，motion 无法在百分比与像素之间插值，会直接放弃动画、把元素留在初始帧（表现为「抽屉打不开」）。`animate` 也必须写 `'0%'`。
- **测试里的 `components/*` 替身会连 `Motion` 一起替换**：客户端 5 个 `App.*.test.tsx` 用 esbuild 把 `/components/` 下的模块换成空实现，导致 `AnimatePresence`/`m` 变成未导出符号。在 `onResolve` 回调里放行 `/Motion$`（Go 正则不支持负向先行断言，只能在回调里判断）。
- **后台标签页会冻结 WAAPI 时间轴**：Playwright 的标签页处于 `document.hidden` 时，rAF 与 WAAPI 都不推进，元素会停在初始帧。这曾被误判成代码 bug；结论是**必须在 `visibilityState === 'visible'` 的标签页里验证动画**。
