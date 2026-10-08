# SubmodHub Docker 运行

## 本地

```powershell
Copy-Item deploy/.env.example deploy/.env
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
Invoke-WebRequest http://100.72.137.92:18082/healthz
```

当前 Compose 把 API 绑定到 `100.72.137.92:18082`，仅适用于该 Tailnet 地址。其他主机应先修改 `deploy/compose.yaml` 的绑定地址。服务端使用 PostgreSQL 存目录和版本元数据，归档写入 `deploy/data` 目录。MinIO 适配尚未实现。上传默认关闭，直到身份认证实现并配置。部署前将 `deploy/data` 创建并授予容器 UID 65532 写入权限。

Flarum 配置沿用 MAS_UniSync 的论坛地址，`ADMIN_FLARUM_GROUP_IDS=16,22`；其他 Flarum 组暂不自动授予作者或审核员权限。GitHub 登录暂缓。生产登录必须使用 HTTPS；当前 Tailnet HTTP 测试站通过前后端的临时不安全认证开关进行功能测试，不应用于生产或公开网络。不要将 MAS_UniSync 的会话密钥复制到本项目。

## 远端部署

测试站使用 HTTP 时，前端构建需临时设置 `VITE_ALLOW_INSECURE_AUTH=true`，否则浏览器会在发出登录请求前报 `https_required`。此开关只用于测试站构建，不要写入全局环境或生产构建配置。例如在 PowerShell 中执行 `$env:VITE_ALLOW_INSECURE_AUTH='true'; npm run build`，随后上传 `web/dist`。服务端仍需在测试环境配置 `SUBMODHUB_ALLOW_INSECURE_AUTH=true`。

部署目录：`/home/sirp/submodhub`。默认 API 端口：`18082`。部署前保存远端目录快照和 Compose 状态；更新只重建 `api`，不删除数据卷。

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build api
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
curl http://100.72.137.92:18082/healthz
```

回滚：恢复上一版源码/Compose 文件后重新执行同一 `up -d --build api` 命令；`deploy/data` 保留。

## 2026-10-04 远端阻断

`submodhub-postgres-1` 的 `initdb` 曾卡在不可中断磁盘等待，观测到 `blk_mq_get_tag`。随后初始化自行恢复，PostgreSQL 健康检查通过。此前卡住的后备 API 容器也延迟启动；已将其停止，使用 Compose 启动新版 `submodhub-api-1`。没有删除数据库卷或重启 Docker 守护进程。由于块设备等待持续约十余分钟，主机管理员仍需排查 `/mnt/storage` 的 I/O；在排查前不要执行大范围重建或清理。

2026-10-04 当前烟雾测试：`/healthz` 200，`/api/v1/mods` 200 且为空，未知下载 404，未配置认证的上传 503；`catalog_snapshot` 有一条记录。数据库重启持久化、真实发布/下载、其他容器的前后状态对比尚未验证。公开归档必须是 `published` 才能下载。

## GitHub Releases 源自动同步运维

### 配置与轮询机制
- 环境变量 `GITHUB_SYNC_INTERVAL`：配置自动轮询间隔，默认 `15m`。设置为 `0` 可禁用后台自动轮询任务，但依然保留作者与管理员的手动同步入口。
- 解析安全：若配置格式不合法（非有效 Go Duration），服务会自动记录警告日志并回退到 `15m` 安全默认值，不中断服务启动。
- API 速率与 ETag：针对公开 GitHub 仓库采用匿名 API 请求，客户端自动携带 `ETag` / `If-None-Match` 请求头。当 Release 未发生变动时返回 HTTP 304 Not Modified，极大节省 GitHub API 速率配额。

### 幂等与容灾恢复
- 严格幂等：同步器遵循 `(mod_id, release_id)` 与 `(mod_id, version_tag)` 双重去重。多次轮询或重复执行不会生成重复版本，已发布/已上架的权威归档严格不可变，绝不被外部 Release 覆盖。
- 事务性归档创建：Release 资产下载先写入临时文件，只有通过完整的 SHA-256 校验与静态包结构扫描后，才会正式写入持久化不可变归档与扫描报告。下载失败或扫描出错时，临时文件立即销毁，不残留半成品版本。
- 容器重启与持久化：PostgreSQL 数据库卷 (`postgres-data`) 与归档存储卷 (`deploy/data`) 独立持久化。API 容器重启后自动从上次状态继续轮询，不破坏历史数据。

### 可观测性与健康诊断
- `/healthz` 接口提供扩展诊断字段 `github_sync`，包含：
  - `interval`：当前运行的同步轮询间隔
  - `total_managed_mods`：受 GitHub Releases 管理的模组数量
  - `last_sync_at`：最近一次执行同步的时间戳
  - `last_sync_error`：最近一次同步发生的非致命错误描述（如 GitHub API 限流）
- 故障隔离与退避：外部 GitHub API 网络波动或限流错误仅记录至诊断字段与对应模组的 `github_last_sync_error`，绝不会将 API 容器或数据库判定为不健康状态。当遭遇 HTTP 403/429 速率限制时，系统自动提取 `X-Ratelimit-Reset` 与 `Retry-After` 进入自动退避期，退避期内自动暂停向 GitHub 轮询以保护 IP 配额。
