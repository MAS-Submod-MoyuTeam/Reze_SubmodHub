# SubmodHub 客户端自更新指南与技术文档

本文档详细说明 SubmodHub 的应用自更新机制、平台适配流程以及发布与校验规范。

---

## 1. 架构总览

SubmodHub 采用“检查/暂存/校验 + 平台隔离执行 + 安全原子回滚”的自更新设计：

1. **主 API 权威查询（GitHub 回落）**：
   先请求主 API 的 `GET /api/v1/app-update`：它由官方仓库 (`MAS-Submod-MoyuTeam/Reze_SubmodHub`) 最新稳定 Release 生成，包含版本、发行说明、逐资产 SHA-256 与交付计划（Cloudreve 节点直链或 GitHub 直链）。API 说「当前即最新」时不再采信 GitHub 的更高版本；API 不可达或返回 `503 app_release_unavailable` 时才回落为直接查询 GitHub Releases（支持代理转发）。预发布通道只走 GitHub。
2. **环境匹配与完整性校验**：
   - 根据操作系统 (`runtime.GOOS`) 与处理器架构 (`runtime.GOARCH`) 选择发布资产。
   - 优先使用描述里主 API 宣告的 SHA-256；回落到 GitHub 时下载并解析 `SHA256SUMS.txt`。
   - 严禁自动降级，仅在新版本语义化版本号大于当前版本时允许更新。
3. **隔离执行**：
   - **Windows**：主程序下载校验至隔离临时区，在目标程序旁生成固定的更新任务并启动独立 `updater.exe`，随后退出。更新器复制并校验旧程序备份，再替换目标；正常新应用完成窗口、前端和实例配置初始化后，返回绑定本次任务、随机令牌和子进程 PID 的确认。只有确认有效且 completed 阶段成功持久化后，才删除备份。
   - **Android**：下载校验 APK 至专用缓存目录，通过系统 `FileProvider` 与 `ACTION_VIEW` 唤起 Android 系统安装器，用户手动确认安装。

---

## 2. 状态机模型

前端与后端状态保持严格的一致性转换：

```text
       [idle]
         │ (CheckForAppUpdate)
         ▼
     [checking] ────── (无新版 / 错误) ──────► [idle] / [failed]
         │ (发现新版)
         ▼
    [available]
         │ (DownloadAppUpdate)
         ▼
   [downloading]
         │
         ▼
    [verifying]
         │ (校验通过)
         ▼
      [ready]
         │ (InstallAppUpdate)
         ▼
   [installing] (Windows：启动 updater 并退出)
   [awaiting_user] (Android：系统安装器已打开，等待用户确认)

安装交接失败：恢复 ready，保留已校验文件并展示错误，可重试。
下载主动取消：cancelled；请求超时或真实下载错误：failed。
```

---

## 3. 发布与资产命名契约

CI/CD 流水线在 GitHub Release 中发布以下命名规范的资产：

| 平台与架构 | 资产文件名模式 | 说明 |
|---|---|---|
| Windows x64 | `submodhub-windows-amd64.exe` | 单文件便携版客户端，文件名不含版本号 |
| Windows Arm64 | `submodhub-windows-arm64.exe` | Windows on Arm 资产命名约定（当前流水线仅构建 x64） |
| Windows 更新器 | `updater.exe` | 独立更新执行工具 |
| Android Arm64 | `submodhub-android-arm64-<version>.apk` | Android 侧载安装包 |
| 校验文件 | `SHA256SUMS.txt` | 包含所有资产的 SHA-256 哈希值 |

Windows 自动更新在原可执行文件路径替换内容，文件名保持不变。发布文件使用不含版本号的稳定名称，避免成功更新后文件名仍显示旧版本；实际版本以程序内显示为准，Release 标签标识下载版本。资产选择器仍可识别历史带版本号的 Windows 文件名。

若已使用 `submodhub-windows-amd64-0.9.2.exe` 等旧名称，请在更新完成并退出程序后，手动改为 `submodhub-windows-amd64.exe`，并同步调整已有快捷方式。存在未完成的更新或回滚时，应先完成恢复再改名，避免改变更新任务记录的目标路径。

---

## 4. 安全防护与异常恢复

1. **备份与动作断点**：
   替换前复制旧程序到 `.old` 并校验其 SHA-256；备份、替换、启动、回滚均持久化动作意图。恢复同时检查磁盘状态，包括备份完成但阶段尚未写入的断点。
2. **正常启动确认**：
   不再使用进入 `main()` 即成功的 `--health-check`。前端正常挂载、实例配置读取成功后，通过 Go 绑定发出任务确认；进入 `ready` 或启动进程成功均不代表更新事务已提交。确认默认等待 90 秒。未确认时保留任务和旧程序备份，运行中的新程序不会被盲目覆盖。
3. **恢复入口**：
   任务固定保存为 `<目标 EXE>.update-task.json`，日志为 `<目标 EXE>.updater.log`。正常启动会发现遗留任务并交给独立更新器恢复；需替换当前映像时，当前进程先退出，由更新器等待其结束后恢复。若目标已损坏或缺失，可手动运行暂存或发布包中的更新器：

   ```powershell
   & "C:\path\to\updater.exe" --recover --target "C:\path\to\SubmodHub.exe"
   ```

   `updater.exe --recover` 或无参数运行会扫描更新器所在目录及当前工作目录中的固定任务文件；目标在其他目录时使用 `--target`。恢复不会覆盖仍运行的目标应用。不要手动删除任务或 `.old`，以免丢失恢复信息。
4. **权限与互斥**：
   目标目录无法写入时返回错误，不提权。服务原子认领安装操作，Windows 另有跨进程目标锁；重复点击不会启动并行替换。
5. **Android 权限与缓存**：
   APK 放在 `getCacheDir()/submodhub_updates/<version>/`；FileProvider 暴露同一缓存子目录，安装 Intent 携带 URI 读取授权。APK 安装权限与 MAS 文件访问权限分别处理。
6. **下载传输**：
   主 API 宣告 Cloudreve 直链时优先从节点取包，失败或链接过期会重取一次描述并重试一次，仍失败才用 GitHub 直链；回落 GitHub 时主程序、更新器和 SHA256SUMS 都使用 GitHub 客户端的配置代理与重定向处理。整体下载与校验默认限制为 30 分钟，支持主动取消。

---

## 5. 交付来源与回退

**服务端**：主 API 把应用仓库最新稳定 Release 的安装资产（`.exe`/`.apk`，≤128 MiB，且 `SHA256SUMS.txt` 已给出哈希）镜像到已启用的 Cloudreve 节点；上传后无 Cookie 读回校验 SHA-256 通过才标记 `ready`。`GET /api/v1/app-update` 对每个资产返回：

| 字段 | 说明 |
|---|---|
| `delivery_type` | `cloudreve`（节点直链）或 `github`（回落直链） |
| `url` | 该交付类型的下载地址；`cloudreve` 为签名直链 |
| `node_id` / `expires_at` | 节点标识与直链有效期（取“到期减15秒”与“5分钟”较小值） |
| `allowed_download_origins` | 允许直链使用的 HTTPS origin 白名单 |
| `sha256` / `size_bytes` | 权威发布哈希与大小 |
| `github_url` | 始终返回的 GitHub 直链，用于回落 |

**客户端**：只有同时满足「描述哈希非空」「`delivery_type=cloudreve`」「链接未过期」时才会用节点直链下载；直链请求不带任何 API 凭据、不走环境代理、逐跳校验 origin。任何失败都会重取一次描述再试一次，仍失败才切到 `github_url`；两条路径都必须通过 `sha256` 校验，安装前的门槛不因交付来源而放宽。弹窗会显示实际下载源（`Cloudreve 节点 <node>` 或 `GitHub Releases`）。

**不变的部分**：安装交接、事务确认、备份与回滚、平台权限语义、暂存目录布局都不感知交付来源。无权威哈希的资产不会被镜像，也不会因为节点存在就跳过校验。
