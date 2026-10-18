# 手机端 UI 适配实施计划

> 2026-10-17 初稿，2026-10-18 补充解锁后的真机证据；交接给其他 AI 实现。本次只编写计划，不修改业务代码。

## 2026-10-18 真机补充（优先阅读）

已在用户解锁后进入应用，查看五个 tab、已安装精灵包详情和商店搜索键盘。设备型号 `2510DRK44C`，Android 16；应用 versionName 1.0 / versionCode 1，targetSdk 35，lastUpdateTime 为 2026-10-17 20:47:45。尚未证明此 APK 与当前 checkout 完全一致。物理截图为 1156×2510，CSS viewport 尚未读取。

证据保存在 `docs/aegis/work/2026-10-18-mobile-ui-adaptation/screenshots/`。截图只证明对应状态，不能替代 DOM 几何测量或全部功能测试。以下结论覆盖初稿中“尚未进入应用”的历史限制：

| 编号/优先级 | 已观察现象与复现 | 证据 | 实施调整 |
| --- | --- | --- | --- |
| M01 / P0 | 启动后以及五个 tab 顶部，系统时间/连接/电量图标叠在 SubmodHub 品牌和实例选择器上，内容未避让状态栏 | installed.png、operations.png、priority.png | Task 1 必须优先排查原生 edge-to-edge 与 WindowInsets；顶部安全区不再只是潜在风险。不能硬编码状态栏高度或仅在某页加 margin。 |
| M02 / P0 | 已安装→已托管模组，表头“文件与占用”“完整性”等被压成逐字竖排，版本/优先级挤压，右侧“操作”列在当前画面完全不可见 | installed.png | Task 3 改手机卡片列为首批修复；对照源码第七列操作补齐所有原有动作。还需用触摸横滑/DOM 测量确认溢出边界，不将截图单独描述为已完成点击测试。 |
| M03 / P0 | 任务页日志表格只完整显示前两列及部分状态，committed 徽标被右边界切断，后续进度/快照/时间/恢复管理列不可见 | operations.png | 将 Task 5 的任务日志表格提到 P0，紧随 Task 3。手机改卡片或详情展开，恢复与管理不依赖滚到最右侧。当前是 committed 记录，没有触发恢复。 |
| M04 / P1 | 商店目标平台筛选和“匹配当前 MAS”竞争宽度，匹配说明折为多行；筛选头占据较大高度 | 真机观察，未保留含键盘截图 | Task 4 将平台与匹配复选独立分组/分行，减轻固定头部高度，确保短屏正文有滚动空间。 |
| M05 / P1 | 优先级工具栏“撤销重置”“生成预览”“应用并写入磁盘”挤成两行；单条模组名称明显省略，版本、优先级输入和箭头同排紧密 | priority.png | Task 5 分离元信息与数值/调整操作，按钮区域按内容分行；已有上移/下移保留，不另造拖拽。 |

**本次未观察到故障的范围**：实例页当前有效目录卡片可读；精灵包详情在当前竖屏下关闭、卸载、下载、未变化禁用按钮可见，正文有内部滚动。因此 Task 2 仍需短屏/长文案回归，不能写成该详情状态已经按钮溢出。PlanPreview 尚未打开，不宣称确认按钮已真机复现。

**键盘观察**：点击商店搜索后键盘正常出现，输入框仍可见；此时底部导航与分页不在画面可见区域。尚未测 visualViewport 与原生 IME inset，不能确定是覆盖还是 resize，也不能据此认定必须把导航浮在键盘上。Task 1/4 要明确键盘期间的产品规则：输入可用、结果可滚动、关闭键盘后导航/分页完整恢复。键盘包含用户剪贴板候选，未将该截图写入仓库。

**修订执行顺序**：Task 0 补齐测量 → Task 1（状态栏/布局壳）→ Task 3（已安装卡片）→ Task 5 中任务日志卡片 → Task 2（关键弹窗）→ Task 4 → Task 5 其余 → Task 6。没有点击安装、卸载、修复、优先级应用或回滚，也没有改变权限/手机全局设置。

**实现 AI 的明确新增验收**：上述 M01–M03 必须逐项提供同设备前后截图；顶栏全部文字和交互避开系统栏；已安装动作完整可达；任务状态完整可读、恢复入口在正确状态可达。不能仅以页面无横向滚动条作为通过依据。

## 一、目标与范围

优先消除关键按钮溢出、遮挡、无法点击，其次修复排版与触摸体验。保留现有深色风格，不做整站视觉重设计。

- 目标是 Android Wails 客户端。实际前端在 `clients/desktop/`，`cmd/client/SubmodHub/frontend/vite.config.ts` 将它作为构建 root；不要误改 `web/` 管理网站或旧 frontend 页面。
- 保持安装、卸载、修复、回滚、风险确认、权限、套装选择等现有业务语义，不改后端协议和数据库。
- 项目处于快速迭代阶段，直接修正原组件并移除冲突布局，不保留旧布局兼容分支。
- 不清除真机应用数据，不擅自执行真实 MAS 文件写入，不改变用户手机的全局密度、字体、方向和导航设置。

## 二、证据与限制

### 已确认事实

- ADB 已连接 `100.100.193.117:5555`，设备安装了 `com.reze.submodhub`。
- 物理尺寸 1156×2510、density 480；系统配置出现宽度 385dp。CSS viewport 仍需 WebView 内实际测量，不能直接使用物理像素。
- 初稿时设备锁屏，2026-10-18 已解锁并补充页面证据，详见文首。下方源码风险表仍须与真机补充对照阅读；未进入的弹窗不能当作已复现。
- Manifest 已有 `adjustResize`；不能未测量便再次补偿键盘高度。

### 源码定位的优先问题

| 优先级 | 文件/锚点 | 风险与处理方向 |
| --- | --- | --- |
| P0 | `clients/desktop/src/components/PlanPreviewModal.tsx`：Footer Actions | 状态说明与两按钮同排，按钮组不换行，确认文案长。手机改为说明与操作分区，按钮换行/纵排。 |
| P0 | `clients/desktop/src/components/InstalledView.tsx`：managed 子页 | 多列表格外层 overflow-hidden，末列动作有裁切风险。手机改卡片，不靠横滑才能找到操作。 |
| P0 | `clients/desktop/src/App.tsx:1103`、`:1164`、`components/MobileNavBar.tsx` | h-screen、main pb-16，与导航 h-14 加 safe-area 的占位不统一。统一高度和占位所有权。 |
| P1 | `clients/desktop/src/components/TitleBar.tsx` | 固定 h-10，多个区域竞争宽度，下拉 w-80。移动顶栏重排，下拉受 viewport 约束。 |
| P1 | `PlanPreviewModal.tsx`、`ModDetailModal.tsx`、`AdoptModal.tsx`、`FileInspectModal.tsx` | 分散的 85vh/90vh、高度收缩和嵌套滚动规则。统一弹窗可用高度、正文滚动和操作区可达规则。 |
| P1 | `CatalogView.tsx`、`PriorityLayersView.tsx`、`OperationsView.tsx`、`InstancesView.tsx` | 紧密工具栏、长路径和状态/按钮同排。逐页按可用宽度重排。 |

上述组件路径均位于 `clients/desktop/src/components/`。实现前补测 APK 是否对应当前源码、型号、Android/WebView 版本、innerWidth/innerHeight、visualViewport、DPR、系统字体缩放、系统 inset 与 CSS env 实际值。

## 三、推荐方案

采用“共享业务状态 + 移动端结构重排 + 少量统一布局规则”。不另建完整手机 App，避免业务分叉；不靠全局 overflow-x-hidden、缩小字号、zoom 或 scale 掩盖溢出。

延续现有 md 断点，同时验证 767/768px 和横屏短高度。布局按可用空间适配，isAndroid 只用于平台能力。桌面表格与手机卡片可以共存，但共用 handler，不重复请求，不产生重复 id 或隐藏可聚焦控件。

## 四、分阶段执行任务

### Task 0：建立问题基线

阅读 `docs/android-smoke.md`、`docs/frontend-contract.md`、对应组件与测试，检查子目录 AGENTS.md。

在 `docs/aegis/work/2026-10-17-mobile-ui-adaptation/` 记录问题清单：页面、状态、viewport、步骤、预期/实际、严重度、关联组件、脱敏截图。不要提交锁屏或其他应用截图。

```powershell
adb connect 100.100.193.117
adb -s 100.100.193.117:5555 shell wm size
adb -s 100.100.193.117:5555 shell wm density
adb -s 100.100.193.117:5555 shell getprop ro.product.model
adb -s 100.100.193.117:5555 shell getprop ro.build.version.release
adb -s 100.100.193.117:5555 shell dumpsys package com.reze.submodhub
adb -s 100.100.193.117:5555 shell monkey -p com.reze.submodhub -c android.intent.category.LAUNCHER 1
```

锁屏时请用户解锁。浏览器检查优先 Playwright MCP；若工具不可用，使用本地 Playwright。WebView 不可调试时，Vite + 测试桥接 fixture 测几何，真实 APK 测系统栏/IME；不能互相替代。fixture 只进入测试，不新增 production 假成功回退。

完成条件：每项 P0 有实际截图/测量，不能进入的状态明确标为未验证。

### Task 1：应用壳、导航、安全区（P0）

修改 `clients/desktop/index.html`、`src/index.css`、`src/App.tsx`、`src/components/MobileNavBar.tsx`。

1. 先测 main、导航、最后卡片、toast 和进度区的矩形及遮挡，覆盖权限横幅出现状态。
2. 根布局保留 100vh fallback，支持时使用 100dvh；清理 body/App 不一致的高度约束，在 flex 收缩链补必要的 min-h-0/min-w-0。
3. 推荐导航改为应用壳正常流 shrink-0 区块，main 分配剩余高度，删除 pb-16；安全区由导航消费一次。若证据要求保留 fixed，则一个共享高度变量同时驱动导航和内容占位，不保留两套魔法数。
4. 每页明确主要纵向滚动主体；避免高大的非滚动 header 挤掉正文。toast 限宽、换行、不挡关键按钮。
5. 验证原生宿主是否已消费 inset，避免重复顶部/底部 padding。只有证实宿主 inset 缺失才修改 `cmd/client/SubmodHub/build/android/app/src/main/java/com/wails/app/MainActivity.java` 或宿主布局。

验收：滚到底最后按钮完整可见，导航五项都可点击，无双重留白；权限与下载横幅同时存在仍能滚动。保留 MobileNavBar.test.tsx 的目的地和徽标契约。移除旧占位，不叠加补丁。

### Task 2：关键弹窗与按钮（P0）

修改 PlanPreviewModal、ModDetailModal、AdoptModal、FileInspectModal；审查 InstancesView 的新增实例弹窗。

1. 先写小 viewport + 长阻断说明的布局失败测试，再修复。已有 node 测试继续守住 disabled 条件。
2. dialog 使用受可用视口约束的 flex column，正文 min-h-0 overflow-y-auto，正常高度下头尾不被正文挤走；手机缩小外边距。
3. PlanPreview 说明独立行；按钮手机两列等宽，320px 或长文案时纵排；允许文字换行，主要触控区至少 44 CSS px。关闭和取消始终可达。
4. 检查、依赖、备份与风险勾选位于可滚动正文；保留 ApplyPlan guard、过期判定、覆盖/卸载确认。
5. 详情的下载、安装、卸载、套装动作分行；长标题/作者/版本不能挤走关闭按钮。保留 CancelStage 及现有回调时序。
6. 短横屏/键盘使头尾总高度超限时，允许整个 dialog 内部滚动至操作区，不能裁切 footer；测量证明 dvh/adjustResize 不足后才增加 visualViewport 补偿并清理监听。
7. 可抽最小共享布局外壳，不进行业务重构；检查 focus 进入/恢复、Tab 不落入背景、原生 Back 行为。

验收：覆盖长阻断、覆盖/卸载确认、过期、下载中、多套装、空选择、清单失败；enabled 主按钮实际命中正确测试回调一次，disabled 原因可读。清理冲突 vh 规则，不复制多套高度 hook。

### Task 3：已安装与文件信息（P0）

修改 InstalledView、FileInspectModal、SpritepackSelection；延续对应现有测试。

- managed 窄屏改卡片：名称/作者、已装/最新版本、状态、动作分区；保留当前实际提供的详情、更新/修复、检查、卸载与禁用原因。
- 文本 flex 子项 min-w-0；长路径允许 anywhere 换行并提供完整值访问；重要错误不能只依赖 hover title。
- 高频操作直接展示；更多菜单必须视口内定位、可关闭、可键盘操作，不能将所有功能藏起来。
- 精灵包选择与批量操作窄屏分行，批量操作条不能压住最后一项。
- 文件/变更表格允许自身局部横滚并给提示，但主操作不放在横向区域末端；路径优先折行。

验收：200 字符无空格路径、长标题/版本、多徽标、长错误 fixture；点击各动作验证对象 id 和回调；桌面保留原表格与动作。移除被手机卡片替代的裁切布局，不增加业务分支。

### Task 4：顶栏、商店、横幅（P1）

修改 TitleBar、CatalogView、StorageAccessBanner、ExecutionProgressBar。

- 手机顶栏保留品牌和必要实例入口，次要版本/网络信息转移到第二行或实例页；权限异常与运行锁定不能隐藏。
- 下拉从固定 w-80 改为类似 width:min(20rem,calc(100vw - 1.5rem)) 的约束，同时校验锚点不越界；长实例名提供详情访问。
- 搜索手机整行，排序/筛选独立行换行；选项标签可局部横滚，清除/重置操作直接可达。
- 商店卡片状态与动作分行，分页可换行；覆盖 loading、空态、离线、错误。
- 授权/取消操作独立区域，不被长横幅挤出，触控区域至少 44px；不通过放大所有图标达到目标。

验收：搜索键盘打开、长输入、清空、分类、翻页、权限横幅与进度同时出现；授权入口只验证设置正常打开，不随意改变权限。

### Task 5：优先级、任务、实例（P1）

修改 PriorityLayersView、OperationsView、InstancesView。

- 标题说明与刷新/保存工具栏手机纵排，预览/保存等操作分区。
- 优先级信息卡片/可展开详情；保留非拖拽调整方式，如上移/下移，不能仅依赖 hover 或 drag。
- 任务阶段、id、时间、长错误和恢复入口分区，恢复仍遵守原确认与禁用规则。
- 实例长路径和诊断可读；Android 仍为固定实例，不能意外开放桌面添加、浏览或启动 exe 能力。
- 桌面新增实例弹窗也检查窄窗口、键盘、长路径输入不挤走浏览按钮。

验收：loading/empty/error、多任务、未授权、无效目录、运行中状态。只进入预览，不在用户真实 MAS 上执行写入。

### Task 6：验证与交付

已有测试（仓库根目录 PowerShell，依赖未安装时先按 lockfile 安装）：

```powershell
$testFiles = @(Get-ChildItem clients/desktop/src -Recurse -File | Where-Object { $_.Name -match '\.test\.tsx?$' } | ForEach-Object { $_.FullName })
& ./clients/desktop/node_modules/.bin/tsx.cmd --test @testFiles
npm --prefix clients/desktop run lint
npm --prefix clients/desktop run build
```

预期全部退出 0；无关失败单独报告，不擅自修复或算通过。本计划阶段未运行应用测试。

检查既有 Playwright 配置；没有则在 clients/desktop 添加最小 dev-only Playwright 配置、test:mobile script 和 e2e/mobile-layout.spec.ts。测试使用真实组件与固定桥接 fixture，不另造 CSS 演示页。jsdom/renderToStaticMarkup 无法证明布局正确。

必须包含以下断言：

1. root 和主要滚动容器 scrollWidth <= clientWidth + 1，并检查是否通过外层裁切隐藏问题。
2. 按钮滚动到达后 rect 在可用 viewport 内，Playwright click({trial:true}) 通过；真实 fixture 点击触发一次正确回调。
3. hit test/elementsFromPoint 证明按钮未被 nav、toast、sticky 或遮罩挡住，不能只断言 visible。
4. 正文到底末项可见；长弹窗可触达取消/执行、关闭/安装/下载。
5. 权限、确认、disabled、CancelStage 与套装业务测试不退化；覆盖长文本、空态、错误、离线及叠加横幅。

布局矩阵（CSS px）：320×568、360×640、约385×837、390×844、430×932、844×390、767×800、768×800、1280×800。补测文本放大150%/200%并记录方式，不能用 deviceScaleFactor 冒充字体缩放。

真机：遵循 build-android.bat 和 docs/android-smoke.md 的构建流程；安装测试包前征得用户同意，不清数据。验证五个 tab、详情、计划预览、文件检查、授权横幅、搜索键盘、长内容弹窗。真实 APK 才能验系统栏与 IME。手势/三键导航仅在可用测试设备验证，未测明确报告。

交付：修改清单、脱敏 before/after、命令及退出码、APK 来源/版本/校验和、真机已测与未测项。锁屏、旧 APK、缺 fixture 或未进入状态不得写成真机通过。

## 五、执行约束与完成门槛

执行顺序以文首 2026-10-18 修订为准，每轮先失败证据、最小修复、针对验证，再桌面回归。不升级 React/Tailwind、不换 UI 框架、不全局 !important、不改品牌或后端。视觉美化可后置，关键操作不可达、误触、风险不可读、末项不可滚达或业务 guard 退化均阻断交付。未经用户要求不创建分支、不 commit。

## 六、给实现 AI 的提示词

请按本计划修复 Android 客户端手机适配，先复现，按 P0→P1 实施。真实前端在 clients/desktop，不要误改 web/。优先保证预览确认按钮、已安装动作、导航安全区可达。保留安装事务、权限、风险确认和套装语义，不靠裁切、缩小字体、隐藏按钮解决问题。可 adb 连接100.100.193.117:5555；锁屏请用户解锁，不绕过认证、不清数据、不擅自写真实 MAS 文件。使用真实布局测试与真机证据，交付时明确已验证项与剩余风险。
