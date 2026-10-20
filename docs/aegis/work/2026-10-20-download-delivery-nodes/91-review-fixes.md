# 下载交付审查修复记录（2026-10-20）

此记录覆盖首轮实现之后的用户审查修复。首轮“本地实现已验证”只代表当时已有测试覆盖，不代表无性能、并发或恢复缺陷；公开描述落盘、Cloudreve同步长等待、worker瞬时保存失败退出等当时未覆盖。本轮已增加针对触发链的回归测试。

## 实现与边界

1. 公开描述签发不再修改Catalog或调用saveLocked。移除Catalog.DownloadAttempts，改用进程级HMAC token。尝试及完成计数在内存按mod聚合、15秒一次批量保存，失败还原并重试。无全局10000配额；去重上限只作用于单版本完成报告，不影响下载描述。旧快照的download_attempts字段不再使用，无兼容运行分支。
2. Cloudreve解析单次3秒、总预算4秒；有效签名有界缓存1024条，按node/revision/fileID；节点失败30秒退避，同节点已有解析立即回落。API会话及local分片互斥等待均可取消。上传HTTP总timeout保留5分钟，公开解析由短context约束。
3. worker启动对账、claim及完成保存失败均记录脱敏日志并继续tick重试。完成保存失败下一轮恢复uploading，不依赖进程重启。
4. 原对象名已经含SHA256，但同名同大小不证明内容正确。独立读回校验失败后持久化带随机后缀的新对象名，下次上传避开坏对象；不删除云端已有对象。
5. 镜像元数据按当前可服务候选集合回收：现存节点、当前GitHub latest、已发布站内普通包；下架、节点删除及旧latest派生记录不再永久累积。云端历史文件与本地归档保留。
6. relay BaseURL仅接受HTTPS origin。连接测试使用精确配置origin限定的环境代理传输，允许管理员明确配置的私网节点，标准TLS验证且不跟随redirect。GitHub专用URL重写模板不用于节点health。
7. 哨兵错误替代文本比较；内部凭据及票据失败收敛为external_unavailable；主密钥读取与轮换同锁；更新/删除/轮换清理解析缓存。origin在保存边界trim/filter，避免textarea键入换行被提前吞掉；无主密钥仍允许保留旧凭据的普通字段编辑；浏览器补172.16/12、100.64/10等私网拒绝。Nginx归档路由补X-Forwarded-For及X-Real-IP。
8. permission-recovery及本任务生成JSON草稿加入ignore，不删除ACL恢复备份；最终实现与验证文档继续保留。未提交Git；已有用户改动及Android Gradle缓存改动未重置。

移除全局尝试容量后，不存在“容量已满仍先解析Cloudreve”的路径；签发仍在解析后复查发布状态，防止解析期间下架后返回可用描述。

## 已执行验证

- 根 `go test ./...`：通过，包含新增公开描述10010次签发/不可写存储、批量计数失败恢复/幂等/重启失效、Cloudreve互斥取消、解析争用/缓存/失败退避、坏镜像换名、旧元数据回收，以及真实启动worker后恢复存储的测试。
- `go vet ./...`：通过。
- 定向恢复与争用测试 `-count=3`：通过。
- 共用Windows/Android下载器 `go test .`：通过。
- 共享UI 26项测试、Web 55项测试、TypeScript lint与Vite生产构建：通过。既有Vite native-config和大chunk警告保留。
- `git -c core.whitespace=cr-at-eol diff --check`：通过；保留旧Go源码换行，避免整文件格式噪声。
- `go test -race`：未能执行。默认CGO关闭；临时CGO_ENABLED=1后缺少gcc，构建失败。不能将普通go test代替race结论。

## 未覆盖与取舍

HMAC密钥、去重和未flush指标为进程内状态：重启旧回执失效，异常退出可能丢失最近15秒指标；多API实例如需共享完成报告需另行提供共享密钥/去重存储或粘性路由。本次统计明确为尽力客户端报告，不是审计计费。真实Cloudreve、Windows/Android设备、Docker/PostgreSQL恢复和实际网络压力验收仍未进行。本轮未重跑完整浏览器交互，UI证据为类型/共享契约测试及现有Web测试。

复杂度控制：退休持久化逐次attempt owner和全局容量分支；新增独立回执运行态与单一签名缓存owner，无旧新双写、无云端删除补偿器。发布/哈希/节点/镜像权威仍在Store，指标是异步派生值。目标与邻接回归证据有效，真实部署与race有界缺口，置信度B。
