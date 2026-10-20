# 下载交付节点实施 - Checkpoint

后续审查修复以[审查修复记录](91-review-fixes.md)为准：逐次尝试已退出快照，worker瞬时保存失败改为持续恢复，公开解析增加短预算/缓存/退避；下列为首轮实施记录。

- 日期：2026-10-20。
- Task ID: 2026-10-20-download-delivery-nodes。
- Git：main / 98f71352de129ca844674d8bc9742a205bfd4f7f；未提交。初始INDEX和原计划用户改动保留；未建分支/工作树。
- 实施目标：七阶段代码、测试及部署文档已提供；全计划真实验收保持needs-verification，不代表已部署。
- Cloudreve：独立会话/单次重登、正确错误分类、local/remote流式分片、对账、可信到期解析、允许origin、独立读回；新增精确对象清理和新进程ZIP探针cmd/cloudreve-probe。remote凭据/跳转测试通过。
- 节点：AES-GCM、节点AAD、共享设置revision、权限/CSRF/同源、脱敏DTO、CRUD/test、重启/保存失败回滚、显式离线原子主密钥轮换cmd/delivery-rekey。relay密钥最少32字节。
- 镜像：持久化四态、启动uploading恢复、最新GitHub/已发布站内普通包候选、全局worker1、独立读回SHA256、8次退避、节点revision变更失效；管理聚合状态及failed手工重试。
- 交付：ready权重选择、Cloudreve期限裕量、受众HMAC票据独立GitHub流式节点、内置最终回落。签发后复查发布/哈希/大小/下架状态。
- 客户端：受控HTTPS origin、DNS私网拒绝及钉住、跳转逐跳检查、不外发API凭据、过期/暂态限2次且第二次请求builtin、从零写临时文件、校验后幂等完成回执。精灵包独立本地路径不改。
- 统计：描述尝试、客户端报告完成、原服务端传输三个独立指标；普通包目录明确标客户端报告完成，精灵包仍标服务端传输；不相加冒充人数。
- Web：独立节点设置面板、失败保留表单并清秘密、状态聚合/失败重试。Playwright本地mock验证键盘/冲突/凭据不回显/builtin不可删除/原角色面板。
- 部署：主密钥占位注入、独立节点Dockerfile/Compose/HTTPS Nginx示例、查询日志脱敏/禁缓冲；运维/前端契约/GitHub来源及旧计划已同步。ADR-0001记录仓库已实现决策，非上线证明。
- 验证：根go test ./...、go vet ./...、Linux amd64四个命令编译通过；客户端go test .通过；共享UI24测、Web55测/lint/build通过；relay时序测试20次通过；CRLF-aware diff check通过。
- 分配基准：32/128MiB×1/4/8流通过，单流约80KiB、8流约600KiB Go分配；无网络/TLS，不能当RSS/吞吐压测。
- 证据：90-evidence.md完整命令/范围/限制。Web现有native-config和大chunk警告保留。
- 未覆盖：真实凭据下35字节payload/近128MiB ZIP/Range/清理及重登；Windows/Android实机外部下载/取消/安装和主API网络证明；Docker Compose/Nginx启动/真实Postgres恢复；实际CPU/RSS/连接数压测。本机无Docker，未提供独立凭据和设备。
- 剩余运行风险：worker保存镜像完成失败后停止，持久化uploading需存储恢复后重启恢复；失败上传可能遗留提供方会话，不全局清理。浏览器CORS和无跨域跳转是提供方接入条件。
- 边界：没有部署/连接远端；没有删除历史对象；未改updater；permission-recovery报告保留。
- 复杂度：协议、加密/票据/relay、配置、镜像、交付和回执独立owner；server.go仅字段、路由、描述接线。旧强制同源逻辑由HTTPS策略替代，原GitHub代理只保留同步/内置职责。活跃回执限一小时/10000条。
- 后续：按docs/download-delivery.md配置独立凭据及部署主密钥，在授权测试环境运行探针与实机/部署验收。不能把本地测试当整体验收。
