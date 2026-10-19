# 更新审查后续修复

TaskStartSnapshot: main / 8045cfd；工作区已有大量未提交更新功能与 UI 改动，保留，不提交。复用现有更新计划作为背景，当前用户四项要求为验收依据。

Change Necessity: code-change。原生安装结果没有消费路径，平台专属 syscall 无构建边界，权限提示误用用户确认字段，且启动缺少检查调用。ArchitectureReviewRequired: no（修复现有平台桥/状态服务/前端接线，不新增架构所有者）。

Boundary: Android Java 产生安装结果；客户端绑定串行核对与安装认领；Service 拥有安装状态；权限查询只由平台桥提供，增加 requires_install_permission，与 requires_user_action 分离。Windows 专属实现/测试/入口补 build tags；公共任务协议保持跨平台。前端补等待状态同步及启动后台检查。

PatchShape: owner-level repair。Ripple: Java→Go→React 安装恢复及权限字段；Windows 平台入口→跨平台公共协议。Minimality: sufficient repair，复用已有 GetLastInstallResult / CanRequestPackageInstalls，不新建服务。保留系统安装确认和暂存校验语义，取消不能误判成功，轮询不能重复启动安装。Owner-fit: 原生桥/绑定/Service 局部职责补全，App 仅接线。

TDD Route: auto / light；原生生命周期受设备环境限制，采用针对性回归与构建验证，不声称严格 RED/GREEN。测试覆盖取消/失败/成功/仍等待、重复重试、授权切换和前端状态。Android 真机验收独立记录缺口。

分工: agent 0410cc28 Windows 目录与 CLI；agent 09532760 前端文件；主代理 Java、客户端 Go 和共享 State。无交叉写入。

验收: 取消安装返回 ready 并保留 APK，可再次启动；等待期间不释放认领；授权用户不展示授权提示，返回设置后刷新；后台检查可发现版本且不强制打开弹窗；Linux root build/test compile 不引用 Windows syscall。

状态: 代码修复完成；平台验收 needs-verification，信心 B。

最终差异：原生 ACTION_INSTALL_PACKAGE + EXTRA_RETURN_RESULT，UI 线程 startActivityForResult，不带 NEW_TASK；MainActivity 转发结果与 pause/resume。未返回结果时旧应用恢复前台记 returned，不将其视为成功。GetStatus 串行消费原生结果，Service ApplyInstallResult 处理明确终态，保留 APK 并释放认领；未知/尚未结束结果保持等待。所有接口统一补实际安装权限快照。Windows 客户端安装调用拆到 windows 文件，其他桌面平台明确不支持，公共存储保留 !android。

前端：awaiting_user 轮询，focus/visibility/重开弹窗刷新，启动正常初始化后仅 idle 背景检查，StrictMode 去重；generation 防迟到响应覆盖用户动作。独立复查发现检查完成后同代旧 checking 轮询覆盖 available，已用完成时失效 generation 修复并补 deferred 回归。

新鲜验证：
- Windows 原生根 go test -count=1 ./... 全通过；更新器、CLI及所有原有包覆盖。
- GOOS=linux GOARCH=amd64 go build -buildvcs=false ./... 通过；go test -exec='C:\Windows\System32\cmd.exe /c exit 0' ./... 通过（仅 Linux 测试编译，不实际执行）。使用临时 GOCACHE。
- 客户端最终 go test -count=1 . 通过（4.696s）；go build -buildvcs=false -o NUL . 通过。
- 最终前端 node --import tsx --test src/App.update.test.tsx src/components/AppUpdateModal.test.tsx：12/12；npm run lint 和 npm run build 通过，只有 >500kB chunk 警告。
- git -c core.whitespace=cr-at-eol diff --check 通过。

未覆盖：本机 Android SDK 只有 android-36，项目 compileSdk35；设置进程级 ANDROID_HOME 后 Gradle :app:compileDebugJavaWithJavac --offline --no-daemon 在依赖检查阶段报告缺 android-35，未执行 Java 编译。adb devices 无设备；WSL 无 Linux 发行版。因此 Android 原生真机取消/失败/重新安装、授权往返，以及 Linux 实际测试运行仍需验收。不更改项目 SDK 以掩盖环境缺口。

回归失败解释：初版前端一项测试将启动及后续所有状态请求固定为同一旧 idle promise，导致误报下载被覆盖；修正为只延迟启动请求后通过。独立复查另发现真实 checking 同代竞态并已修复，最终12项全绿。前端子代理在报告前失败，由主代理接管检查、修改与最终验证。

Retirement: 权限提示不再消费 requires_user_action；该字段保留为用户确认语义。Windows syscall 与消费者退出公共编译面，任务序列化保留跨平台。无数据迁移、无旧兼容所有者、无提交；保留用户现有未提交工作。
恢复后复验（17:52后）：HEAD 仍为 8045cfd，diff whitespace检查通过。一轮 Windows TestInstallerHelperStartFailureCanRetry 的断言执行后在 testing.TempDir RemoveAll 清理时报 directory is not empty；未修改业务逻辑。该测试随后 -count=10 连续通过，完整 updater/Windows/CLI 再跑全部通过（2.221s/8.325s/2.087s）。将其保留为 Windows 临时目录清理偶发风险，不声称消除了该环境波动。

