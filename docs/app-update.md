# SubmodHub 客户端自更新指南与技术文档

本文档详细说明 SubmodHub 的应用自更新机制、平台适配流程以及发布与校验规范。

---

## 1. 架构总览

SubmodHub 采用“检查/暂存/校验 + 平台隔离执行 + 安全原子回滚”的自更新设计：

1. **主 API 权威查询（GitHub 回落）**：
   先请求主 API 的 `GET /api/v1/app-update`：它由官方仓库 (`MAS-Submod-MoyuTeam/Reze_SubmodHub`) 最新稳定 Release 生成，包含版本、发行说明、逐资产 SHA-256 与交付计划（Cloudreve 节点直链或 GitHub 直链）。API 说「当前即最新」时不再采信 GitHub 的更高版本；API 不可达、返回 `503 app_release_unavailable`，或快照年龄超过 30 分钟且 GitHub 看到了更高版本时，才回落为直接查询 GitHub Releases（支持代理转发）。预发布通道只走 GitHub。
2. **环境匹配与完整性校验**：
   - 根据操作系统 (`runtime.GOOS`) 与处理器架构 (`runtime.GOARCH`) 选择发布资产。
   - 优先使用描述里主 API 宣告的 SHA-256；回落到 GitHub 时下载并解析 `SHA256SUMS.txt`。
   - `SHA256SUMS.txt` 按严格格式解析：只接受「64 位小写十六进制 + 空白 + 文件名」，其余行忽略。因此格式异常表现为「校验文件里找不到该资产」，而不是哈希不匹配。
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
| `snapshot_age_seconds` | 主 API 最近一次成功读取 GitHub 距今的秒数；越大说明它越可能已经看不到新版本 |

描述本身另有一个 `release_url`：GitHub Release 页面（说明与全部资产）。它**不依赖镜像是否就绪**，只要有 Release 元数据就返回，因此下载入口在没有任何可镜像资产时仍能给出稳定去处；逐资产的 `github_url` 只指向单个文件，拼不出这个页面。

**快照年龄**：主 API 每 10 分钟刷新一次 Release 快照，读取失败时沿用上一份并提前下一次重试。因此描述里的 `snapshot_age_seconds` 超过 30 分钟时，客户端不再把它当作权威：会额外查一次 GitHub，若 GitHub 观察到更高版本就按 GitHub 走，否则仍用主 API 的答案（GitHub 被墙时可用的正是这条路）。字段缺省（老服务端）按「新鲜」处理。

**版本探测**：除了 Release API，主 API 还会直接读仓库根目录的 `VERSION`（`raw.githubusercontent.com`，不占 REST 配额）。它是**触发信号，不是数据来源**：探测值高于当前快照的 `tag_name`、**且该版本对应的 tag 已存在**时，才把权威 Release 刷新提前到本次请求，资产、哈希与说明仍然全部来自 Release 快照；探测值不高于快照、tag 尚未创建、或探测本身失败（404/5xx/超时）时完全静默，刷新节奏不变。tag 判据不可省：发布流程是先 bump `VERSION`、构建完成后才建 tag，因此「`VERSION` 领先于 tag」是构建期的常态，只看版本号会让整段构建时间每分钟打一次 REST；而 tag 查询同样走 raw 主机，零配额。探测随「有人来检查更新」而发生，结果缓存 1 分钟，突发流量只产生一次 raw 请求，且请求不带 API Token。`snapshot_age_seconds` 仍只表示最近一次成功读取 Release 的时间，探测不会刷新它。上游 CDN 对 raw 文件自带 5 分钟缓存，所以 1 分钟窗口观察到的值最多可能落后约 5 分钟——它的价值在「比 10 分钟快、且零配额」，不在秒级精确。

**状态自愈**：镜像记录若因重启、节点变动或完成落盘失败停在 `uploading`，对账会在下一次巡检时把它归位 `pending` 重新排队——该状态不可能是并发上传，因为对账始终发生在投递 worker 认领任务之前。

**平台覆盖**：应用更新只面向 Windows（`.exe`）与 Android（`.apk`）客户端；Linux 仅用于交叉编译，不产生发行资产，因此服务端只枚举这两类后缀。

**客户端**：只有同时满足「描述哈希非空」「`delivery_type=cloudreve`」「链接未过期」时才会用节点直链下载；直链请求不带任何 API 凭据、不走环境代理、逐跳校验 origin。任何失败都会重取一次描述再试一次，仍失败才切到 `github_url`；两条路径都必须通过 `sha256` 校验，安装前的门槛不因交付来源而放宽。重取只用于替换同一个 release 的直链：描述里的 `tag_name` 与本次批准的版本不一致时放弃重试并直接回落 GitHub，避免用旧版本的说明装上新版本的包。弹窗会显示实际下载源（`Cloudreve 节点 <node>` 或 `GitHub Releases`）。

**Web 下载入口**：站点头部的「下载客户端」与客户端自更新读同一份描述（`ui/app-release-api.ts` 负责读取与结构校验，`web/src/components/clientDownload.ts` 负责选路）。规则：
- 安装列表只收 `.apk` 与含 `windows` 的 `.exe`，独立更新器与校验文件不进列表；按浏览设备排序，但另一平台仍然可见。
- 来源由「此刻真能交付的那条路」决定，不是由描述里写了什么决定：节点直链必须 https、不带凭据、非本机/私网地址，白名单非空时还必须命中；任一不满足就整条走 `github_url`，按钮文案与「来源」跟着一起变，避免写着本站下载却跳 GitHub。
- 白名单为空时不做假设，这一点与桌面端「白名单为空即拒绝」不同，是有意为之：浏览器跳转不携带 API 凭据也不由服务端出站，镜像在上传后已由服务端读回校验，把「节点没配白名单」当可疑会让整站下载静默退回 GitHub。
- 直链临期时先重取一次描述，重取只允许替换同一 `tag_name` 的直链（与客户端同一条契约），换不到或 tag 已变就使用 `github_url`；过期直链在任何分支都不会被交给用户。
- `snapshot_age_seconds` 超过 30 分钟时显示告警，并引导前往 `release_url`。
- 文案只说「本站节点（Cloudreve）」与「GitHub Releases」，不显示节点 ID。节点名是桌面端诊断场景才需要的内部信息，Web 面向访客时按交付方式命名即可。

**不变的部分**：安装交接、事务确认、备份与回滚、平台权限语义、暂存目录布局都不感知交付来源。无权威哈希的资产不会被镜像，也不会因为节点存在就跳过校验。
