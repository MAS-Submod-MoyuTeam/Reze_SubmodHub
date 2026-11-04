# Mod 详情深链调起与分享链接计划

状态：已实施（2026-11-04），真机/真浏览器验收待补（见 §7）

## 1. 目标与验收

用户诉求（2026-11-04 直接要求，原文要点，四项已确认的口径）：

1. Web 端能调起 Windows / Android 客户端并直接打开某个 mod 详情页。
2. 客户端提供「分享」，分享产物是**一个可直接粘贴到浏览器的链接**。
3. 客户端检测到剪贴板里被复制了「站内链接」，就提示是否打开该站内链接。
4. 分享按钮只在 mod **详情页**，不在列表里。

已确认口径：

| 决策 | 选定 |
| --- | --- |
| 分享链接形式 | `https://rezehub.0721play.icu/mod/<mod_id>`（路径式） |
| Android 调起 | 自定义 scheme `rezehub://mod/<mod_id>`，配合 https 链接做同源跳转 |
| 剪贴板检查时机 | 启动时 + 窗口重新获得焦点时 + 应用回到前台时各查一次（不轮询） |
| 分享粒度 | 仅 mod 详情（不含 version_id） |

验收（可观察）：

1. 打开 `https://<站点>/mod/mod_xxx` 直接呈现该 mod 的详情弹窗；关闭后地址回到 `/`，浏览器前进/后退按历史工作。
2. Web 详情页有「复制分享链接」，复制出的正是上面的 URL。
3. Web 详情页有「在客户端打开」：Windows 上触发 `rezehub://mod/mod_xxx`，Android 上优先 `intent://`，失败时提示「未检测到客户端」并给出下载入口。
4. Windows 客户端安装/启动后注册 `rezehub` 协议；客户端已在运行时点链接，只唤起既有窗口并跳到该详情，不会开第二个进程。
5. Android 客户端声明 `rezehub` 深链；冷启动与已运行（singleTask）都能落到该详情。
6. 客户端详情页有「分享」，写入剪贴板的是可粘贴的站内链接。
7. 客户端启动、从浏览器切回（窗口获得焦点）、或 Android 从后台切回前台后，若剪贴板是站内 mod 链接，弹出提示可一键打开；同一条链接不重复打扰。

## 2. 现状基线

| 关注点 | 位置 | 改动前 |
| --- | --- | --- |
| Web 详情 | `web/src/App.tsx`、`web/src/context/AppContext.tsx:137` | 纯 `detailModalModId` 状态驱动的模态框，无路由、无地址同步 |
| Web 详情弹窗 | `web/src/components/ModDetailModal.tsx` | 头部只有标题与关闭按钮 |
| Web 站点托管 | `deploy/web.nginx.conf:13-15` | `try_files $uri $uri/ /index.html`，`/mod/*` 天然回落到 SPA（无需改服务器） |
| Windows 客户端 | `cmd/client/SubmodHub/main.go` | Wails v3，`application.Options` 未设 `SingleInstance`，不解析 `os.Args` |
| Windows 协议注册 | `build/config.yml`、`build/windows/nsis/wails_tools.nsh:253` | 未声明 `protocols`，宏体为空；CI 走 `wails3 task windows:build` 只产 exe，不跑 NSIS |
| Android 清单 | `build/android/app/src/main/AndroidManifest.xml` | `MainActivity` 只有 MAIN/LAUNCHER，无 VIEW/BROWSABLE，默认 launchMode |
| Android 桥 | `build/android/.../WailsBridge.java` | 有 `emitEvent(name, json)` → `nativeEmitEvent` → `app.Event.Emit`，无深链入口 |
| Go 剪贴板 | wails v3 `app.Clipboard.Text()` | 可直接用，项目内尚无调用 |
| 客户端详情 | `clients/desktop/src/App.tsx` | `selectedModDetail` 是 `ModSummary` 对象，必须先从目录里查到 |

**Change Necessity**：不改代码无法达成——四个必要环节（可寻址的 Web 详情、协议注册 + 单实例转发、Android 深链 intent、剪贴板识别）当时均不存在，任何配置或文档改动都无法产出该行为。

**Ripple Signal Triage**：命中「新对外契约（`/mod/<id>` 与 `rezehub://mod/<id>`）+ 跨模块（web / clients/desktop / Go 客户端 / Android 壳）+ 分发面（协议注册、清单）」。权威 owner：

- 链接格式与解析 = 新增共享模块 `ui/mod-link.ts`（Web 与客户端共用），Go 侧同规则实现 `share_link.go` 只用于剪贴板/启动参数解析；
- 写剪贴板 = 新增共享模块 `ui/clipboard.ts`（三端共用，见 §3.6）；
- 详情展示 = 两端既有 `ModDetailModal`；
- 深链投递 = Windows Go（单实例 + `OnApplicationEvent`）、Android Java（intent → `emitEvent` + window 变量兜底）。

不新增后端端点、不改 `api/openapi.yaml`、不改数据库。

## 3. 设计

### 3.1 链接契约（`ui/mod-link.ts`，两端共用）

- `MOD_LINK_SCHEME = 'rezehub'`、`DEFAULT_SITE_URL = 'https://rezehub.0721play.icu'`。
- `modIDFromLink(raw): string | null`：接受
  - `rezehub://mod/<id>`（host 段就是 `mod`），
  - `<siteOrigin>/mod/<id>`，
  允许结尾 `/`、查询串、hash；id 必须匹配 `^[A-Za-z0-9_-]{1,128}$`，否则 `null`。
- `modShareURL(modID, siteUrl?)`：拼 `<siteUrl>/mod/<id>`。
- `modLinkPath(modID)`：`/mod/<id>`，Web 地址栏与「打开某详情」共用。
- `modDeepLink(modID)`：`rezehub://mod/<id>`。
- `isModLink(raw)`：`modIDFromLink(raw) !== null`。

**刻意不校验 origin**：客户端可能被指向自建/测试服务器（`VITE_API_BASE_URL`、`SUBMODHUB_API_URL`），写死 origin 会让那些实例分享出去（或从剪贴板粘回来）的链接认不出来。判别条件只保留「路径就是 `/mod/<合法 id>`」，误判成本极低。

Go 侧 `cmd/client/SubmodHub/share_link.go` 复刻同一规则（`parseModLink`、`modShareURL`、`modDeepLink`、`modProtocolCommand`），用于启动参数、剪贴板与注册表；两边规则由各自单测锁定，文案不共享，规则共享。

### 3.2 Web 详情地址（`web/src/modRoute.ts`，新增）

把地址变成「详情是否打开」的第二个表示，但把决定权与执行分开——`modRoute.ts` 只产出**动作**，`App.tsx` 只负责执行：

| 情形 | 动作 |
| --- | --- |
| 打开某详情 | `push` 一条带 `{modDetail: id}` 标记的新历史 |
| 地址已经是该详情（含结尾 `/`） | `none` |
| 关闭我们自己 push 出来的详情 | `back` |
| 关闭用户直接用分享链接落地的那条 | `replace` 成 `/` |
| 当前地址不是详情 | `none` |

两条关键判断：

- **为什么要区分「我们压的」和「用户落地的」**：分享链接直接进站时，浏览器历史里下面没有目录页，`back()` 会把用户带出站点；只有我们自己 push 过才知道「退一步是目录」。
- **为什么关闭不能 `push('/', ...)`**：那样历史里会留一条同样的详情地址，「后退」会把用户刚关掉的详情重新打开。

历史状态取 `window.history.state`（不是 `window.location`，后者没有 `state`）。`popstate` 反向驱动弹窗，同时用一个 ref 忽略「自己 `back()` 带出来的那一次」。

首屏：`modIDFromLocation(window.location)` 命中就 `setDetailModalModId`，只做一次。

### 3.3 Web 详情弹窗（`web/src/components/ModDetailModal.tsx`）

头部加两个按钮（**只在详情页，不在列表**）：

- 「分享」→ `modShareURL(id, window.location.origin)` + `copyToClipboard`；写入失败时把链接直接显示在 toast 里让用户手动复制，而不是只报「失败」。origin 取当前站点，测试/自建实例分享出去的链接必须指回它自己。
- 「在客户端打开」→ `openInClient`（见 §3.4）。

另外补了「查不到就说明」：目录加载完成仍然找不到该 mod 时，弹窗说明「这个模组不在当前目录里（可能已下架）」并给出返回目录，而不是 `return null` 留一片空白。目录仍在加载时不提前下这个结论。

复查修正（同日）：这里的「加载完成」原本用 `catalogLoading`，而「响应请求失败」和「目录里确实没有它」被混成了同一句话。现按两条原则改：①「加载完成」以**成功拿到过一次目录**为准（空目录也算），不以「目录非空」为准；②请求失败时显示「目录没能加载出来」加失败原因，不把加载故障说成该 mod 已下架。

### 3.4 Web「在客户端打开」（`web/src/clientDeepLink.ts`，新增）

浏览器无法回答「客户端装了没有」：自定义 scheme 找不到处理器时既没有错误也没有回调。因此：

- `planClientLaunch(modID, ua)`（纯函数）：Android → 带 `package=com.reze.submodhub` 的 `intent://`（命中已装应用时不弹选择框）；其它平台 → `rezehub://mod/<id>`；非法 id → `invalid_mod_id`。
- `openInClient`：跳转一次后等 `timeoutMs`（默认 1200ms）复查 `document.visibilityState`——仍然可见就当没客户端，回调 `onNoClient`（App 侧提示 + 打开既有 `ClientDownloadModal`）。跳转本身抛错（个别浏览器直接拒绝未知 scheme）则立即兜底，不让用户干等。

### 3.5 Windows 客户端（Go）

- `main.go`：
  - `SingleInstance{UniqueID: "com.reze.submodhub", OnSecondInstanceLaunch: ...}`：从 `data.Args` 找出链接 → `deliverModLink`；
  - `app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, ...)`：覆盖「链接就是首个启动参数」的情况，走同一个 `deliverModLink`；
  - 启动时扫 `os.Args[1:]`，命中的 mod id 先放进 inbox（页面还不存在，事件无处可发）。
- `deep_link.go`：`DeepLinkEventName = "submodhub:deep_link"`、`modLinkInbox`（`put`/`take`）、`deliverModLink`（入 inbox + `Restore()`/`Focus()` + `EmitEvent`），以及三个绑定方法 `TakePendingModLink` / `ClipboardModLink` / `ModShareLink`。
- `protocol_windows.go`：启动时把 `HKCU\Software\Classes\rezehub` 写成 `URL Protocol` + `shell\open\command = modProtocolCommand(exe)`（HKCU 免管理员；重复写幂等，程序移动后自动指向新位置）。失败只记日志，表现为「点链接没反应」而不是起不来。`protocol_other.go` 给非 Windows 一个 no-op。
- `build/config.yml` 增加 `protocols: [{scheme: rezehub, ...}]`，`build/windows/nsis/wails_tools.nsh` 的宏体补上 `CUSTOM_PROTOCOL_ASSOCIATE/UNASSOCIATE`，让将来真跑 NSIS 时安装器写同一键并在卸载时清掉。

### 3.6 Android 客户端（Java 壳）

- `AndroidManifest.xml`：`MainActivity` 加 `launchMode="singleTask"` 与第二组 intent-filter（`VIEW`/`DEFAULT`/`BROWSABLE`，`scheme=rezehub`，`host=mod`）。
- `MainActivity`：`onCreate`（`loadApplication()` 之前）与 `onNewIntent`（含 `setIntent`）都调 `captureDeepLink(getIntent())`；`onPageFinished` 里置 `pageLoaded` 并 `flushPendingDeepLink()`。
- **Java 不解析 mod id**：只校验 scheme，把原始 URL 交出去。解析规则唯一来源是 `ui/mod-link.ts`（前端）与 `share_link.go`（Go 侧），在 Java 里再来第三份只会漂移。
- **两条通道一起走**：`onPageFinished` 那一刻无法知道 React 是否已挂载、事件监听是否已注册，所以除了 `bridge.emitEvent` 还写 `window.__submodhubDeepLink`，前端挂载后读走即清。只发事件会在冷启动时静默丢掉一次点击。

### 3.7 客户端前端（`clients/desktop/`）

- `modLink.ts`（新增）：`findCatalogMod`、`shouldPromptClipboardLink`、`resolveDeepLinkMod`、`describeLinkedMod` —— 决定「要不要打扰用户」与「跳过去有没有真实数据」的纯函数。
- `App.tsx`：
  - 深链三条来路收在一处：`TakeNativeDeepLinkURL()`（Android window 兜底）→ `TakePendingModLink()`（Go inbox）→ `Events.On(DeepLinkEventName)`（运行中被再次调起）；载荷可能是 `mod_id`（Go 已解析）或 `url`（Android 原始链接），后者用 `modIDFromLink` 解析。
  - 落地统一走 `applyDeepLinkModID`：目录里有 → 切到目录页并 `setSelectedModDetail`；目录已加载但没有 → toast 说明「已不在目录中（可能已下架）」；目录还没到 → 记 `pendingDeepLinkModID` 等目录到了再落地。**不伪造只有 id 的 `ModSummary`**：那个对象会一路流进安装链路，标题/版本/平台都是假的。
  - 复查修正（同日）：`catalogLoaded` 原本传的是 `catalogModsRef.current.length > 0`，于是「目录加载成功但恰好为空」会被当成「还没加载」，深链挂在 `pendingDeepLinkModID` 里永远没人解释；等待效应的 `catalogMods.length === 0` 早退让这个停摆无法自愈。现改为独立的 `catalogEverLoaded`（state + ref，在 `loadCatalog` 成功路径置位），空目录同样落到「已不在目录中」。并补了另一条：**目录一次都没加载成功就失败收场时不能静默挂着**，提示「目录没能加载出来」并保留该深链，刷新成功后自动打开（`deepLinkNoticeRef` 保证同一链接只提示一次）。
  - 剪贴板检查：挂载后一次 + `window` `focus` 一次 + `submodhub:app_foreground` 事件一次，调 `ClipboardModLink()`；`shouldPromptClipboardLink` 排除「同一条已提示过 / 正开着这个详情 / 上一个提示还挂着」。
  - 新增 `ShareLinkPrompt`（app 级、非模态）：不夺焦点、不拦其它操作，显示标题（查不到才退回 id）与「打开 / 忽略」。
- `ModDetailModal.tsx`：头部加「分享」，调 `ModShareLink(id)` 拿链接再 `copyToClipboard`。链接由 Go 生成，前端不自己拼字符串，两端不会各写一种链接。
- `clipboard.ts`（新增）：转出共享的 `ui/clipboard.ts`；`TransactionDetailModal` 原有的同功能函数改为引用它。
- `wails.ts`：新增 `TakePendingModLink` / `ClipboardModLink` / `ModShareLink` / `DeepLinkEventName` / `AppForegroundEventName` / `TakeNativeDeepLinkURL` / `isBrowserMode`；`browser_server.go` 补三个 dispatch case（浏览器调试模式下深链恒空、不读宿主剪贴板）。

### 3.8 共享剪贴板（`ui/clipboard.ts`，新增）

Web 站点、Wails 桌面端、Android WebView 三处都要写剪贴板，都统一到这里。三种环境都可能缺异步 API：

1. 旧内核 WebView 没有 `navigator.clipboard`；
2. 站点走 http 局域网地址时不是安全上下文，同样没有；
3. **API 在但调用被拒绝**（`Document is not focused`、权限策略）——这一种最容易被漏掉，因为它不改变「API 存在」的判断。

所以策略是「先试新 API，**任何失败都退回 textarea + execCommand**」，返回布尔值让调用方决定是否把链接直接显示给人看。真实浏览器里实测过第 3 条：修复前只会在 toast 里报「复制失败」，修复后链接本身会显示出来。

## 4. TDD Route

- 模式 `auto`；决定 **strict**（新对外契约 + 生产者/消费者跨模块），范围限定在规则层：`ui/mod-link.ts`、`ui/clipboard.ts`、`web/src/clientDeepLink.ts`、`web/src/modRoute.ts`、`cmd/client/SubmodHub/share_link.go`——先写失败测试再实现。
- UI 接线（按钮、提示、事件订阅）为 **light**：`tsc --noEmit` + 目标组件的 jsdom/静态渲染断言（按钮存在、失败文案、查不到时说明）。
- 真机/真浏览器验收（Windows 协议弹窗、Android intent、真剪贴板读）不在本轮自动验证范围，交付时明确标注（见 §7）。

## 5. 任务（均已完成）

1. **共享链接规则**：`ui/mod-link.ts` + `ui/mod-link.test.ts`。
2. **共享剪贴板**：`ui/clipboard.ts` + `ui/clipboard.test.ts`。
3. **Go 侧规则与协议注册**：`share_link.go` + `share_link_test.go`（含 `modProtocolCommand` 形状）；`protocol_windows.go` / `protocol_other.go`；`build/config.yml` 与 NSIS 宏。
4. **Windows 单实例与启动参数**：`main.go` + `deep_link.go`。
5. **Android 深链**：清单 + `MainActivity`（含 window 兜底通道）。
6. **Web 可寻址详情**：`modRoute.ts` + `App.tsx`；`ModDetailModal` 两按钮；`clientDeepLink.ts`。
7. **客户端前端**：`modLink.ts`、`ShareLinkPrompt`、`ModDetailModal` 分享按钮、`clipboard.ts`、`wails.ts` / `browser_server.go` 桥接、生成绑定更新。
8. **验证与文档**：本文件、`docs/aegis/INDEX.md`、`docs/frontend-contract.md`。

## 6. 验证

| 断言 | 命令 | 结果 |
| --- | --- | --- |
| 链接规则 | `cd web && npx tsx --test ../ui/mod-link.test.ts` | 7/7 通过 |
| 剪贴板三态 | `cd web && npx tsx --test ../ui/clipboard.test.ts` | 4/4 通过 |
| Web 规则层与渲染 | `cd web && npx tsx --test "src/**/*.test.ts*"` | 180/180 通过 |
| 客户端规则层与渲染 | `cd clients/desktop && npx tsx --test "src/**/*.test.ts*"` | 277/279 通过；2 条失败在 `CatalogView.scroll.test.tsx`，已用 `git worktree` 在改动前的 HEAD 复现，属既有失败 |
| 类型 | `cd web && npx tsc --noEmit`；`cd clients/desktop && npx tsc --noEmit`；`cd cmd/client/SubmodHub/frontend && npx tsc --noEmit` | 全通过 |
| Go 客户端 | `cd cmd/client/SubmodHub && go test -tags production -count=1 .`、`go vet -tags production .` | 通过 |
| Go 全量 | `go test ./...` | 通过（`TestUninstallBlocksOnDriftedFile` 有一次 TempDir 清理 flaky，单跑复现通过） |
| 绑定生成 | `wails3 generate bindings -f '-tags production' -clean=true -ts` | 三个新方法已出现在 `desktopservice.ts` |
| 构建 | `cd web && npx vite build`；`cd cmd/client/SubmodHub/frontend && npx vite build --mode production` | 均成功 |

真实浏览器（Playwright + 本地 `vite preview`）已验收：

- 直接访问 `/mod/<已下架 id>` → 呈现「这个模组不在当前目录里 / 返回目录」，点「返回目录」地址回到 `/`；
- 从目录点「详情」→ 地址变为 `/mod/mod_xxx`、`history.state.modDetail` 就位、头部出现「分享」与「在客户端打开」；
- 关闭详情 → 地址回到 `/` 且历史长度不增（`back` 生效）；
- 浏览器后退/前进 → 详情随之关闭/重新打开；
- 「分享」在剪贴板被拒时把链接显示出来（见 §3.8）。

## 7. 风险与保留

- **未做真机验收**：Windows 协议弹窗与单实例转交、Android intent 冷启动/`singleTask`、真剪贴板读取都只在代码与单测层面验证。发布前需要在 Windows 安装包与 Android 真机上各跑一遍。
- Android 清单与 `build/windows/nsis/wails_tools.nsh` 是 Wails 生成的模板产物：`wails3 task common:update:build-assets` 会覆盖它们，重跑生成后必须把 `launchMode` + intent-filter 与 `CUSTOM_PROTOCOL_ASSOCIATE/UNASSOCIATE` 宏体补回来。两处文件里都留了注释提醒。
- Windows 自定义协议在 Chrome/Edge 会弹一次确认框；未安装客户端时 `location.href` 静默失败，只能靠「超时 + 页面仍可见」兜底，这是浏览器能力边界而非取舍。
- Android 10+ 只有前台应用才能读剪贴板，因此提示只在「启动 + 回到前台」发生，这是系统约束。

### 复查修正（同日）：Android 切回前台查不到剪贴板

真机路径上「在浏览器复制链接 → 切回客户端」是手机端最主流的用法，但原来两个触发点都不够可靠：WebView 被切到后台再切回来时，`focus` 与 `visibilitychange` 是否触发取决于 WebView 有没有被 pause、焦点有没有真的交给别的窗口，不同 ROM/WebView 版本表现不一致，不能当作确定的触发点。这一次与其猜 JS 事件会不会来，不如由原生层直接告知。

- Android `MainActivity` 在 `onResume` 调 `notifyAppForeground()`，发 `submodhub:app_foreground`；只在 `pageLoaded` 之后发（更早没有接收方，首屏本来就会查一次，不必缓存）。
- 前端在同一个 effect 里订阅该事件，与 `focus` 并存：桌面端收不到这个事件，监听挂着无害，不需要按平台分支。
- 事件名是跨语言字符串契约，拼错不会有任何编译或测试报错，只会安静失效。为此新增 `deepLinkEvents.test.ts`，直接读 Go 与 Java 源码比对 `DeepLinkEventName` / `AppForegroundEventName`，并断言 `onResume` 里确实调了发送方法（只定义常量不发也没用）。已用「改坏一个字母」的方式确认该测试会失败。
- 自定义 scheme 落地跨平台差异（Windows argv、macOS AppleEvent、Android intent）由 wails 单实例机制与各自壳层分别覆盖；本轮只保证 Windows 与 Android。macOS/Linux 未声明 scheme，`registerModProtocol` 在那两个平台是 no-op。
