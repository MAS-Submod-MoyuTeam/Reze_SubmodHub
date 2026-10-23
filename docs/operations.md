# SubmodHub Docker 运行

下载交付节点、Cloudreve 凭据主密钥、独立探针与备份要求见 [下载交付运维](download-delivery.md)。

## 本地

```powershell
Copy-Item deploy/.env.example deploy/.env
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
Invoke-WebRequest http://100.72.137.92:18082/healthz
```

当前 Compose 把 API 绑定到 `100.72.137.92:18082`，仅适用于该 Tailnet 地址。其他主机应先修改 `deploy/compose.yaml` 的绑定地址。服务端使用 PostgreSQL 存目录和版本元数据，归档写入 `deploy/data` 目录。MinIO 适配尚未实现。上传默认关闭，直到身份认证实现并配置。部署前将 `deploy/data` 创建并授予容器 UID 65532 写入权限。

Flarum 配置沿用 MAS_UniSync 的论坛地址，`ADMIN_FLARUM_GROUP_IDS=16,22`；其他 Flarum 组暂不自动授予作者或审核员权限。Web 端不提供 GitHub OAuth 登录入口，只有 Flarum 一种登录方式。生产登录必须使用 HTTPS；公开入口已启用 HTTPS，直接访问 Tailnet HTTP 源站时仍依赖前后端的临时不安全认证开关，且不可用于公网。不要将 MAS_UniSync 的会话密钥复制到本项目。

## 远端部署

### 自动发布

在 `deploy/.env` 中设置 `SUBMODHUB_AUTO_PUBLISH=true`，所有作者提交的子模组、精灵包，以及 GitHub Releases 同步通过扫描的新版本，会跳过人工审核并直接发布。默认值为 `false`，仍需管理员审核。手动上传的草稿仍需作者执行提交操作；该开关不自动批准此前已进入审核队列的版本。ZIP 上传、静态检测和阻断检查仍然执行。

修改后运行 `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d api`，重建 API 容器使环境变量生效；无需重建镜像。

公开入口为 `https://rezehub.0721play.icu`，由 1Panel OpenResty 反向代理至测试服务器的 `100.72.137.92:18083`。HTTPS 入口不需要 `VITE_ALLOW_INSECURE_AUTH`；该开关仅保留给直接通过 HTTP 测试源站的场景，不要用于公开构建。

部署目录：`/home/sirp/submodhub`。默认 API 端口：`18082`。部署前保存远端目录快照和 Compose 状态；更新只重建 `api`，不删除数据卷。

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build api
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
curl https://rezehub.0721play.icu/healthz
```

回滚：恢复上一版源码/Compose 文件后重新执行同一 `up -d --build api` 命令；`deploy/data` 保留。

### 从本机更新测试服

测试服 `/home/sirp/submodhub` 不是 git 工作区，产物是直接上传的。`api` 镜像只把 `deploy/build/submodhub-linux-amd64` 复制进 `scratch`，`web` 容器用 nginx 挂载 `web/dist`，所以「更新」= 上传二进制 + 上传前端产物 + 重建 `api`。

```powershell
# 1. 本机构建。先改版本再构建，前端会把版本号打进包
go run ./cmd/version -set 0.9.12
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
go build -trimpath -ldflags '-s -w' -o deploy/build/submodhub-linux-amd64 ./cmd/server
cd web; npm run build; cd ..

# 2. 上传。远端惯例是保留 submodhub-linux-amd64.pre-<改动名>，前端目录整体换名切换
ssh sirphomesv "cd /home/sirp/submodhub/deploy/build && cp -p submodhub-linux-amd64 submodhub-linux-amd64.pre-<改动名> && mkdir -p /home/sirp/submodhub/web/dist.new"
scp deploy/build/submodhub-linux-amd64 sirphomesv:/home/sirp/submodhub/deploy/build/
scp -r web/dist/* sirphomesv:/home/sirp/submodhub/web/dist.new/
ssh sirphomesv "cd /home/sirp/submodhub/web && find dist.new -type d -exec chmod 755 {} + && find dist.new -type f -exec chmod 644 {} + && mv dist dist.pre-<日期> && mv dist.new dist"

# 3. 重建 api、重启 web（web 只换了挂载内容，重启是为了丢句柄缓存）
ssh sirphomesv "cd /home/sirp/submodhub && docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build api && docker restart submodhub-web-1"
```

`scp -r` 从 Windows 传上去的目录权限不规范（`drwx---rwx`），必须先 `chmod` 再切换，否则 nginx worker 读不到资源。

验收（端口绑在 tailnet 地址上，`127.0.0.1` 连不通）：

```bash
curl -s http://100.72.137.92:18082/healthz                        # version 应为新版本
curl -s http://100.72.137.92:18082/api/v1/app-update | grep -o '"release_url":"[^"]*"'
curl -s http://100.72.137.92:18083/ | grep -o 'assets/index-[^"]*' # 与本地 dist 哈希一致
```

前端 bundle 哈希一致是「前端确实换了」最省事的证据，`release_url` 出现则证明 `api` 二进制被替换。`VERSION` 只影响服务端 `/api/v1/version`、`/healthz` 与前端构建产物；桌面与 Android 客户端由 CI 在推送 `main` 后构建并发布 Release。

## 2026-10-04 远端阻断

`submodhub-postgres-1` 的 `initdb` 曾卡在不可中断磁盘等待，观测到 `blk_mq_get_tag`。随后初始化自行恢复，PostgreSQL 健康检查通过。此前卡住的后备 API 容器也延迟启动；已将其停止，使用 Compose 启动新版 `submodhub-api-1`。没有删除数据库卷或重启 Docker 守护进程。由于块设备等待持续约十余分钟，主机管理员仍需排查 `/mnt/storage` 的 I/O；在排查前不要执行大范围重建或清理。

2026-10-04 当前烟雾测试：`/healthz` 200，`/api/v1/mods` 200 且为空，未知下载 404，未配置认证的上传 503；`catalog_snapshot` 有一条记录。数据库重启持久化、真实发布/下载、其他容器的前后状态对比尚未验证。公开归档必须是 `published` 才能下载。

## GitHub Releases 源自动同步运维

### 检查更新窗口
- 唯一配置项是**检查更新窗口**：距某模组上次检查超过该时间，就算过期。默认 `60m`（1 小时），可在管理端「系统设置 → GitHub 源检查更新窗口」修改，保存后立即生效，无需重启。
- 过期模组有两条回源路径，共用同一个窗口和同一个判定函数：有人打开该模组时立即补抓；长时间无人访问时由后台巡检（每分钟扫一次，只挑过期模组）兜底。
- 环境变量 `GITHUB_SYNC_MAX_AGE` 仅用于覆盖设置页的值（例如固定部署策略）；留空则由设置页决定。设为 `0` 关闭自动刷新，只保留作者与管理员的手动同步入口。
- 解析安全：若配置格式不合法（非有效 Go Duration），服务会记录警告日志并沿用已配置的窗口，不中断服务启动。
- API 速率与 ETag：针对公开 GitHub 仓库采用匿名 API 请求，客户端自动携带 `ETag` / `If-None-Match` 请求头。当 Release 未发生变动时返回 HTTP 304 Not Modified，极大节省 GitHub API 速率配额。

### 幂等与容灾恢复
- 严格幂等：同步器遵循 `(mod_id, release_id)` 与 `(mod_id, version_tag)` 双重去重。多次轮询或重复执行不会生成重复版本，已发布/已上架的权威归档严格不可变，绝不被外部 Release 覆盖。
- 事务性归档创建：Release 资产下载先写入临时文件，只有通过完整的 SHA-256 校验与静态包结构扫描后，才会正式写入持久化不可变归档与扫描报告。下载失败或扫描出错时，临时文件立即销毁，不残留半成品版本。
- 容器重启与持久化：PostgreSQL 数据库卷 (`postgres-data`) 与归档存储卷 (`deploy/data`) 独立持久化。API 容器重启后自动从上次状态继续轮询，不破坏历史数据。

### 可观测性与健康诊断
- `/healthz` 接口提供扩展诊断字段 `github_sync`，包含：
  - `max_age`：当前生效的检查更新窗口（`disabled` 表示已关闭自动刷新）
  - `stale_mods`：此刻已经过期、等待回源的模组数量
  - `total_managed_mods`：受 GitHub Releases 管理的模组数量
  - `last_sync_at`：最近一次执行同步的时间戳
  - `last_sync_error`：最近一次同步发生的非致命错误描述（如 GitHub API 限流）
- 故障隔离与退避：外部 GitHub API 网络波动或限流错误仅记录至诊断字段与对应模组的 `github_last_sync_error`，绝不会将 API 容器或数据库判定为不健康状态。当遭遇 HTTP 403/429 速率限制时，系统自动提取 `X-Ratelimit-Reset` 与 `Retry-After` 进入自动退避期，退避期内自动暂停向 GitHub 轮询以保护 IP 配额。

## 管理员设置与 GitHub 代理

管理员可在前端导航“设置”页面动态配置 GitHub 全链路代理：

- **HTTP 代理**：填写 `host:port` 或 `http://host:port`，例如 `100.106.239.85:7890`。HTTPS GitHub 请求通过 HTTP CONNECT 隧道传输；代理地址可为 Tailnet 私网地址，但只由管理员配置。
- **URL 重写代理**：必须且仅包含单一 `{url}` 或 `{url_encoded}` 占位符。
  - 例如：`https://gh-proxy.com/{url}` 或 `https://proxy.example/fetch?url={url_encoded}`
  - 必须使用 `https://` 协议，不得包含凭证或锚点。留空并保存表示清空并恢复直连。
- **持久化机制**：设置保存在 PostgreSQL `catalog_snapshot`（或本地 JSON 快照）中，API 重启不丢失。
- **容量与并发**：API 容器 `/tmp` tmpfs 挂载大小为 320 MiB，系统通过全局信号量限制同时进行的临时下载（同步与中转下载合计并发上限为 2），单个下载上限为 128 MiB 与 5 分钟超时，防止耗尽容器 tmpfs。
- **排障错误码**：
  - `502 github_upstream_failed`：代理服务器不可达或 GitHub 报告 404/网络错误。
  - `504 github_upstream_timeout`：代理或上游下载超时。
  - `502 upstream_archive_changed`：上游 ZIP 哈希或大小与发布时快照不符。
  - `503 github_upstream_rate_limited`：上游触发频率限制（含 `Retry-After`）。
  - `503 relay_busy`：服务端并发下载中转槽位占满，需稍后重试。

## 客户端任务中心与安装事务恢复

### 事务阶段模型
SubmodHub 安装引擎使用统一的 journal 状态机保障多文件写入的 ACID 一致性：
- `planned`：已生成计划，尚未锁定与修改磁盘。
- `prepared`：实例锁已获取，已为所有受影响文件在 blob store 创建快照备份。
- `applying`：正在向 MAS 目录逐项写入文件或执行删除；包含 `current_step`、`total_steps` 与 `last_path` 进度。
- `committing`：所有文件写入已完成，正在更新 manifest 与 receipt。
- `committed`：事务成功提交，终态。
- `rolled_back`：未完成操作已完全回滚至修改前状态，终态。
- `needs_manual_recovery`：保护性暂停，需要人工处理。

### 崩溃与重启自动恢复规则
- 默认恢复动作为**安全回滚（Rollback）**，不执行断点续做。
- 当客户端重启或尝试开启新安装事务时，底层 `Installer` 会在实例锁保护下扫描 `journals/` 目录中的未终结事务：
  - 若事务处于 `planned`、`prepared`、`applying` 或未完成的 `committing` 阶段，自动触发安全回滚。
  - 回滚执行严格前置校验（Preflight）：验证所有涉及文件的当前磁盘状态是否匹配事务中的 before 或 after 镜像。
  - 回滚成功后，磁盘文件、manifest 与 receipt 恢复为操作发生前的状态，journal 标记为 `rolled_back`。

### 人工干预条件（`needs_manual_recovery`）
若满足以下任一情况，系统严禁自动覆盖用户文件，立即转入 `needs_manual_recovery` 并阻断新事务：
1. **外部漂移（External Drift）**：目标文件在中断期间被外部文本编辑器或第三方工具篡改，哈希既不匹配 before 也不匹配 after。
2. **Journal 损坏**：journal 文件被外部截断或非合法 JSON。
3. **Blob 丢失**：blob 存储池缺失回滚所需的原始快照数据。
4. **回滚执行失败**：磁盘只读、受进程独占锁死或权限拒绝。

此时任务中心会展示冲突文件路径、期望哈希与实测哈希，用户需先备份相关文件，解决外部冲突后，方可由客户端或命令行执行安全重试。

### 事务原子性与语义边界
- **可观察原子性**：本项目中的“原子”指事务级 all-or-nothing 可观察状态和崩溃后可恢复，不声称普通文件系统具备跨文件同时提交的底层操作系统语义。
- **重试机制**：由于外部环境与 generation 可能已变更，重试失败操作时必须重新生成最新 Plan，不依赖旧事务断点。

## 模组 created_at 回填（一次性）

作者工作台的“我的模组”按模组自身的 `created_at` 排严格创建序，并用键集游标分页，所以早期快照里的模组必须先补齐这个字段。

```bash
# 先停 API 或先完成新版部署，再执行一次；旧二进制保存快照时会丢弃该字段
POSTGRES_DSN=... SUBMODHUB_DATA_DIR=... go run ./cmd/backfill-mod-created-at
```

- 只补 `created_at` 为空的模组：取该模组最早的版本或提交时间，无子记录时取回填时刻。
- 重复执行不改变已有值，幂等；输出本次补齐的条数。
- 回填与新 API 之间没有兼容层：不要在新版 API 上线前回填，旧进程下一次保存快照会把 `created_at` 覆盖掉。
