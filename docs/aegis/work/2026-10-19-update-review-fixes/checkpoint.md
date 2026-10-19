# 自动更新审查修复

2026-10-19；需求：修复 P1-1/2/3、P2-1/2/3。

TaskStartSnapshot：main，HEAD 8045cfd72358da037c29408f77d167c8064fe960。现有未提交自更新实现及其他 UI 改动属于用户工作，保留，不重置、不提交。

Change Necessity: code-change。生产者/消费者路径、事务提交和并发状态契约有缺陷，仅文档或按钮防抖不足以修复。ArchitectureReviewRequired: yes（任务确认与恢复持久化边界）；在现有更新器职责内修复，不增加服务或发布系统。

Baseline：用户六项审查要求；根 AGENTS.md；现有更新计划（参考背景，当前用户修复授权优先）；internal/updater、Windows updater、客户端桥和 AppUpdateModal。

PatchShape：修复源头契约。CanonicalOwner：Service 拥有状态及认领；Windows 事务拥有备份/任务/提交；客户端正常初始化完成后确认；Android cache-path 与生产目录一致。Ripple：前端状态和客户端绑定同步。Minimality：沿用现有组件，移除预初始化快速健康成功分支。

验证：下载代理/重定向/超时/取消，安装并发认领与失败重试，Windows helper 真实进程确认/无确认、init 断点恢复和互斥；客户端 Go 测试、前端构建。Android 真机与完整 WebView 启动若不可用，明确验证缺口。

分工：下载服务与测试 agent 659cbf4d；Windows 事务及 startup 公共协议 agent 9ad3c3c1；主代理负责 Android 路径、客户端安装绑定、前端即时禁用、启动确认接线和集成验证。写入边界不重叠。

状态：代码修复和本地验证完成，平台验收 needs-verification。

最终实现：
- Android 使用统一的 submodhub_updates 缓存目录契约，XML cache-path 回归测试；安装 URI 增加 ClipData 读取授权载体。
- Service 原子认领安装，失败恢复 ready；前端同步 ref 防重复请求并显示 installing/awaiting_user，保留失败重试。Windows helper 启动失败也安全退役未执行任务以允许重试。
- 下载三类资产复用 GitHub 客户端代理/重定向，30分钟有界超时；主动/父取消为 cancelled，deadline 为 failed；取消不能被错误或 ready 覆盖。
- Windows 不再使用预初始化 health-check；正常 React 挂载与实例配置读取、服务初始化成功后才写 task/token/pid 确认；持久化 completed 后清备份。
- 固定目标旁任务文件；动作意图落盘、复制+SHA校验备份、完整进程路径核验、目标跨进程锁；自动启动恢复和独立 --recover --target 入口。覆盖 init、launch PID0、rolled_back 缺入口，提前退出即时回滚并尝试重启旧版。

新鲜验证：
- 最终 go test -count=1 ./internal/updater/... ./internal/github/... ./cmd/updater：全部通过（Windows 11.648s，CLI 4.927s），含新增无效 PE 新程序无法创建进程时恢复并重启旧程序的真实 helper 测试。
- 最终客户端 go test -count=1 .：通过（4.828s）；Windows 原生客户端 build 通过。
- 前端 npm run lint、桌面 Vite build 和实际 Wails 嵌入前端 build：通过。安装状态/重试 UI 测试 2/2 通过。
- 真实 native 启动尝试：WebView2 controller 8000ffff 退出，无 ACK；实际 updater 事务使用该失败客户端后进入 rolled_back，恢复旧文件SHA、启动旧测试进程且保留备份，验证脚本通过。
- git -c core.whitespace=cr-at-eol diff --check 通过；普通 diff --check 将既存 CRLF 作为尾随空白报告。

失败尝试与纠正：客户端附加网络测试最初错误模拟 HTTPS CONNECT，改为 Android 配置边界测试；真实下载代理与并发安装由 Service 测试覆盖。并行写入期间一次客户端编译撞到未写完函数，收敛到代理停止写入后最终全绿。

未覆盖：Windows 完整正常 WebView 启动确认（当前宿主 controller 创建失败）；Android Java/资源编译因本机未配置 SDK 无法执行，adb 无连接设备，未取得真机安装/读取APK证据。文档给出独立恢复命令。信心 B；不作发布验收通过声明。

独立复查发现的 launch PID0永久拒绝恢复与提前退出未自动回滚均已修复并补测；未引入外部服务或兼容分支。无提交：本次修复叠加用户已有未提交且未跟踪的实现，保留其工作区集成选择。下一步价值最高的验证是在具备可用 WebView 的桌面和 Android 真机执行平台验收。
