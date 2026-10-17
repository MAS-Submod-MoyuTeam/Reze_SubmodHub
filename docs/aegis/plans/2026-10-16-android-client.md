# Android 客户端适配计划

日期：2026-10-16。状态：M0 ~ M4 已实现且通过自动化测试，APK 已完成交叉编译（100.72.137.92），待真机侧载最终验收。

## 已确认范围

- 沿用 React + Wails v3 + Go，首版 Android 11+、arm64、侧载 APK；不以应用商店上架为目标。
- 采用用户确认的 `MANAGE_EXTERNAL_STORAGE`（所有文件访问）。manager 指本应用获得特殊授权，不是借用其他管理器权限，也不是 root。
- 用户主动进入系统设置授权；打开设置页不等于授权成功。未授权允许浏览商店，禁止扫描或管理本地游戏文件。
- 固定目标 `/storage/emulated/0/MAS/`，游戏目录为其下 `game/`；不静默切换 SAF、不自动换目录、不访问其他应用私有目录。
- 复用现有事务安装引擎；首版不提供 Android 启动游戏功能，隐藏 exe、桌面窗口及自由选目录入口。
- 不改云端数据模型、不保留无需求的旧版兼容层、不对真实 MAS 做破坏性测试。

## 基线与未知项

阅读：`AGENTS.md`、`docs/android-smoke.md`、`docs/frontend-contract.md`、`docs/aegis/plans/2026-10-12-task-atomic-recovery.md`。

事实：Wails 固定 beta.27；已有 Android Java/Gradle 工程及 Go overlay 入口；当前 Manifest 无所有文件访问声明，Gradle minSdk 为 21，应用 ID 为模板值；现有 Android Go 构建脚本只处理 Linux/macOS 宿主。

未知：当前工具链、固定版本 APK 和桥接是否运行、真机权限与目录、共享存储文件系统语义、后台/强停恢复及 API 网络连通性。历史环境记录不代替当前验证。

采用 Linux 构建环境，Windows 保留编辑与桌面回归。不得破坏 Windows 功能、安装事务或共用 API；平台行为使用构建约束隔离，不复制安装引擎。

## 文件责任图

新增文件仅为计划归属，接口尚未实现。

| 路径 | 责任 |
| --- | --- |
| `cmd/client/SubmodHub/build/android/Taskfile.yml` | Linux 构建、overlay 和 ABI |
| `cmd/client/SubmodHub/build/android/app/build.gradle` | minSdk、应用 ID、版本与签名 |
| `cmd/client/SubmodHub/build/android/app/src/main/AndroidManifest.xml` | 特殊权限、必要网络配置、清理模板权限 |
| 同工程 Java 目录下新增 `SubmodHubStorageAccess.java`，调整 `MainActivity.java` 及必要桥接文件 | 查询授权、打开设置、onResume 刷新、Go/Java 桥接 |
| `cmd/client/SubmodHub/storage_access.go` 与测试（新增） | 默认拒绝的权限守卫 |
| `cmd/client/SubmodHub/platform_android.go`、`platform_desktop.go`（新增） | 平台能力和私有配置/缓存目录 |
| `cmd/client/SubmodHub/bindings.go`、`instances.go`、`main.go` | 接入平台与守卫，隔离桌面假设 |
| `internal/install/`、`internal/maspath/` 及测试 | 路径安全、文件锁、空间和恢复的必要适配 |
| `clients/desktop/src/wails.ts`、`App.tsx`、`components/`、`index.css` | 权限引导、移动导航、响应式布局 |
| `docs/android-smoke.md` | 更新当前工具链与真机证据 |

## M0：先验证 APK 和原生桥接

1. 记录 Linux Go/Wails/JDK/SDK/NDK/Gradle 版本，核对固定 Wails 所需 NDK，不盲目升级。
2. 核查 Android overlay 和前端构建链，APK 必须打包真实客户端与正确绑定，不是模板页面。
3. 构建 arm64 调试 APK，真机验证页面加载、React → Go、Go → Java 权限查询。具体 JNI 接点以验证结果决定，不在计划中假设现成接口。
4. 检查应用私有配置/缓存目录、API 代理与测试服连通性；HTTP 测试配置和发布配置分离，不全局放宽 WebView 安全策略。

验收：可复现构建命令、APK SHA-256、设备型号/系统和桥接结果。失败先定位或评估最小 Wails 升级，不静默换框架、不投入完整 UI。

## M1：所有文件访问授权闭环

1. 先写守卫失败测试：未授权、未知、检查失败、不支持全部拒绝；设置页打开成功不能改变为 granted。
2. 声明 `MANAGE_EXTERNAL_STORAGE`，minSdk 设为 30，改稳定独立应用 ID（拟定 `com.reze.submodhub`，发布前确认），删除无需求的相机、定位等模板权限。
3. `GetAndroidStorageAccess` 实时查询 `Environment.isExternalStorageManager()`，状态为 granted/denied/unsupported/error。
4. `RequestAndroidStorageAccess` 由点击触发，打开本应用所有文件访问设置；无处理器时回退总设置页。返回值只代表页面打开，不代表授权。
5. 启动、onResume、任务入队与执行前复查。扫描、读写、删除、恢复、导出均经服务端守卫，不能仅拦 UI 或信任缓存。
6. 阶段切换与文件操作前复查；撤权停止后续写入，保留日志，不在无权时反复回滚。重新授权进入恢复流程，不自动重跑安装。实际 I/O 错误必须独立处理。

验收：真机覆盖拒绝、取消、授权返回、重启、撤权与操作中撤权；一次性共享目录验证创建、读取、替换、列举、删除，拒绝时确认无写入。

## M2：路径、实例和平台行为

1. 先测试固定根、game 缺失、绝对路径注入、越界及符号链接逃逸，再实现。
2. 仅展示固定实例与目录有效性，隐藏添加多实例与自由选目录。缺失时提示用户准备游戏，不创建假安装。
3. 配置/下载缓存放应用私有目录；清单/恢复日志沿用引擎布局且受权限保护，权限丢失不能误判为空白安装。
4. 验证 `disk_other.go`、`lock_other.go`、`process_other.go` 的 Android 编译和语义，必要时最小化平台隔离。
5. 游戏运行状态不能可靠检测时显示未知，并要求写入前关闭游戏并确认；不伪报未运行。Android 不调用 exe/桌面对话框/窗口控制，Windows 保留原行为。

验收：越界全部拒绝、无效目录不能安装、桌面测试不回归。

## M3：安装与生命周期安全

1. 一次性 MAS fixture 跑通下载、校验、预览、执行、扫描、文件检查、优先级、修复、卸载。
2. 验证 A/B 覆盖同文件、先卸载非顶层、卸载顶层和恢复原文件，核对字节、清单、日志。
3. 覆盖空间不足、坏包、断网、重复点击、取消、锁和日志写失败，不假定共享存储等于桌面文件系统。
4. 首版不承诺后台持续下载/安装。验证切后台不重复执行、强停重启按日志恢复，不依赖生命周期回调必定执行。
5. 撤权后重新授权先识别未完成事务，再按现有恢复模型处理，不因授权自动覆盖/清理。前台服务与后台任务若实证必需，另行设计。

验收：真机一次性测试树通过主流程与故障注入，不对真实 MAS 强停或破坏性测试。

## M4：手机界面

1. 先补权限与平台能力组件测试，沿用业务状态与调用层，不分叉安装逻辑。
2. 紧凑标题栏、底部导航或抽屉替代固定侧栏；保留商店、已安装、任务、设置入口。
3. 弹窗、预览和文件检查适配窄屏滚动，处理返回键、软键盘、安全区域、横竖屏，桌面布局保留。
4. 未授权、目录无效、权限撤回、事务待恢复分别提示；未授权仍可浏览远端内容。
5. 在 360/390/430 CSS 像素及桌面宽度检查溢出、触控、进度、错误及确认操作。

验收：Playwright 验证布局和模拟权限；系统授权、原生桥接及返回键仍以真机为准。

## M5：回归和交付

1. 更新烟测文档，记录当前结果而非历史结论。
2. 正式独立应用 ID、稳定 release 签名和递增版本；正式 APK 禁止 debug 签名回退，密钥不入库、不输出日志。
3. 验证首次安装、覆盖升级、授权重启、未授权浏览和完整模组主流程，同时执行 Windows 回归。
4. 交付 APK、SHA-256、工具链、支持范围、授权说明与已知限制，不以模拟器通过替代真机通过。

验收：M0–M5 证据齐全才声明完成；无设备可推进构建/自动化，但真机关卡保持未通过。

## 验证入口与实施纪律

每个切片遵循失败测试 → 最小实现 → 针对性通过 → 回归。下列命令尚未执行，预期零失败/构建退出码 0：

```powershell
# 仓库根目录
go test ./internal/install/... ./internal/maspath/... ./internal/package/...
cd clients/desktop
npx tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"
npm run lint
npm run build
cd ../../cmd/client/SubmodHub
go test ./...
```

Linux 客户端模块目录：先核实任务入口，再执行 `wails3 task android:build ARCH=arm64`。实际命令与产物路径记录到证据；宿主测试不能替代 Android 构建或设备测试。

证据包括设备列表、安装输出、限定范围 logcat、APK 哈希及文件断言，不记录令牌或真实用户文件内容。

## 停止点和回退

- 按 M0 → M1 → M2 → M3 → M4 → M5 推进，每阶段回报变更、验证和未通过项。
- M0 阻塞停止完整 UI 投入；授权守卫不可靠或数据恢复不一致禁止发布。
- 仅写一次性测试树，真实 MAS 只读探测也需确认。批准计划不等于批准破坏性测试、远程部署或签名密钥操作。
- 失败保留日志/恢复材料；代码回退不等于磁盘文件恢复。
- 保留桌面能力与共用引擎，Android 隐藏失效桌面入口，不恢复历史 SAF 路线。
