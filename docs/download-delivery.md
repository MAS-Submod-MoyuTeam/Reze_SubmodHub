# 下载交付节点运维

主 API 保存发布状态、节点配置与镜像状态。Cloudreve 只交付已读回校验的镜像；独立 GitHub 节点仅转发票据声明的 GitHub 归档。精灵包始终本地，客户端应用自更新不在此链路。原始归档与旧镜像不自动删除。

## 主密钥与节点配置

配置 `SUBMODHUB_DELIVERY_MASTER_KEY` 为随机32字节的标准 Base64 编码。密钥只放部署环境，与数据库备份一起安全备份；源码和镜像不放真实秘密。空值禁止保存新密码，非空无效值阻止启动。更换密钥前必须停写、备份并显式重加密；直接换环境变量会使现有凭据无法解密。

离线轮换命令：停止API并备份后，设置旧 `SUBMODHUB_DELIVERY_MASTER_KEY`、新 `SUBMODHUB_DELIVERY_NEW_MASTER_KEY`、`SUBMODHUB_DATA_DIR`，PostgreSQL另设同一 `POSTGRES_DSN`，执行 `go run ./cmd/delivery-rekey -confirm-offline-backup`。全量解密及重加密成功才提交一次快照；任一损坏凭据或保存失败均回滚。成功后部署环境改为新主密钥，再启动API。不要在API运行期间另进程写快照。

管理员在设置页添加 Cloudreve 节点：网页登录凭据、`https://.../api/v3`、项目专用目录（如 `/SubmodHub`，连接测试和首次上传时发现目录不存在会自动创建）、实际上传/下载从机 HTTPS origin（含自定义端口）。WebDAV 凭据不能替代网页登录密码。密码留空保留旧值；删除节点只删配置/凭据，不删网盘对象。默认连接测试验证认证与目录元数据，允许创建缺失的配置目录，不创建测试归档；仅Cloudreve明确返回目录不存在时才创建，认证、权限、网络错误不会触发创建。创建后重新读取确认，并容忍并发请求已先创建成功。测试仍不证明大包上传或客户端可达。

镜像 worker 全局并发1，每15秒扫描发布目录，只补当前 GitHub latest 和已发布站内普通包，每个启用 Cloudreve 独立补齐。状态 pending/uploading/ready/failed 持久化，启动恢复 uploading，失败指数退避、最多8次。ready 前独立无Cookie读回验 SHA-256。支持 v3 local/remote 策略，其他策略返回不支持。源归档保留。设置页显示当前节点revision的镜像状态数量，失败任务可点击“重试失败镜像”，仅重置failed任务，保留ready对象。客户端过期/暂态失败最多重取一次描述，通过 `?delivery=builtin` 明确请求内置回落，从零下载；哈希错误不重试安装。

镜像调度遇启动对账、claim或完成保存失败时记录脱敏日志，并按tick重试；完成保存失败会重新恢复uploading并对账。读回哈希失败后保留坏云端对象，持久化新的含发布哈希和随机后缀的对象名，下次重传。镜像元数据仅保留现存节点的当前候选集合（GitHub当前latest、站内已发布普通包），下架、删除节点及不再为latest的GitHub记录会回收；云端文件不删除。

Cloudreve描述解析单次最多3秒、全部节点共用4秒预算；按节点revision和fileID缓存有效签名（到期前30秒停止复用），失败退避30秒。同节点有未完成解析时新请求直接尝试后续路径，不在提供方互斥队列等待。签名缓存最多1024条。

## 独立 GitHub 转发节点

无需数据库、主 API 文件卷或 Cloudreve 密码：

```bash
export DOWNLOAD_NODE_ID=relay-east
export DOWNLOAD_NODE_KEY='<at-least-32-random-bytes>'
docker compose -f deploy/download-node.compose.yaml up -d --build
```

授权密钥须与 Web 中该节点一致。`DOWNLOAD_NODE_CONCURRENCY` 默认8、范围1..32；`DOWNLOAD_NODE_GITHUB_PROXY` 可单独配置出站代理。节点仅绑定本机端口，按 `deploy/download-node.nginx.conf` 配置真实 HTTPS 域名及证书后在 Web 启用。不自动部署或申请证书。

票据2分钟有效，禁止访问日志记录查询串或错误日志记录完整请求行。节点64KiB应用缓冲、不落盘、不解压、不扫描。客户端验发布哈希，服务端不在转发前缓存整包。关闭反向代理缓冲。

## 新进程独立 Cloudreve 探针

设置进程环境 `CLOUDREVE_API_URL`、`CLOUDREVE_USERNAME`、`CLOUDREVE_PASSWORD`、`CLOUDREVE_DIRECTORY` 和空格分隔的 `CLOUDREVE_DOWNLOAD_ORIGINS`。勿将真实值放仓库、报告或共享终端记录。

```bash
# 默认认证和目录元数据，不创建文件。
go run ./cmd/cloudreve-probe
# 显式创建唯一临时ZIP、无Cookie读回验SHA-256、删除且确认消失。
go run ./cmd/cloudreve-probe -create-temporary-file -payload-bytes 35
go run ./cmd/cloudreve-probe -create-temporary-file -payload-bytes 134086656
```

完整探针会消耗空间及上下行带宽，只清理自己创建的对象；遇验证码/MFA由管理员处理，不绕过。输出不含密码、Cookie、对象ID或完整签名URL。未知/无期限/临近过期签名不进入直链调度。v3 `sign` 格式依据 Cloudreve 3.8.3 `pkg/auth/{auth,hmac}.go`，解析提供方Unix到期秒数并减安全裕量；它不等于客户端持有提供方私钥。

浏览器直链需要提供方允许CORS。浏览器无法可靠逐跳审查跨域302，因此拒绝外部重定向；Windows/Android依配置origin逐跳验证。外部请求不带API凭据。Range不作为续传承诺，下载从零写入新临时文件。

## 备份与验收

JSON / PostgreSQL `catalog_snapshot` 增加字段，无新表迁移。备份元数据、归档目录、主密钥。新增节点不搬全部GitHub历史，镜像失败不撤销发布。

指标分别为 `download_attempts`（描述签发尝试）、`client_reported_downloads`（校验后幂等客户端报告完成）、原 `downloads_count`（内置服务端传输，无法覆盖直链）。不能相加当人数或独立交付审计。完成回执仅是客户端报告。

描述GET不写快照、不分配持久尝试记录或全局名额；使用进程级随机HMAC密钥签发一小时token。尝试和完成增量在内存按mod聚合，每15秒批量保存一次，保存失败保留增量重试。进程异常退出可丢失尚未flush的指标；重启使旧回执失效，但不影响归档下载。已接受token的去重信息仅存内存、按版本最多2048个未过期token；达到上限只拒绝该版本新的完成报告，不影响描述和其他版本。指标为尽力统计，不是财务级计量。

节点连接测试对管理员配置的精确HTTPS origin使用环境 `HTTPS_PROXY`/`NO_PROXY` 策略，允许显式节点解析到私网，保留标准TLS校验且禁止跳转。GitHub专用URL重写代理仅用于GitHub源，不套用到节点health请求。

自动测试和构建未覆盖真实上线验收：仍需网页登录凭据下大包/重登/清理、Windows/Android外部下载/取消/安装、PostgreSQL恢复、多节点启动、主API网络无归档字节转发，以及1/4/8并发、32/128MiB的CPU/RSS/吞吐。64KiB缓冲不能推断真实RSS。此次未连接或更新远程服务器。
