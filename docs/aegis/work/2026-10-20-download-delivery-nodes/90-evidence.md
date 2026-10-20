# 下载交付节点实施 - Evidence

日期：2026-10-20；代码实现及离线验证，真实上线验收未完成。

## 已执行检查

- 根模块 `go test ./...`：通过，包含Cloudreve协议、加密票据、节点权限/CSRF/revision/保存回滚/重启、镜像候选与恢复、交付及回执、原有精灵包/扫描/发布测试。
- `go vet ./...`：通过。
- `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ./cmd/server ./cmd/download-node ./cmd/cloudreve-probe ./cmd/delivery-rekey`：通过。
- 嵌套客户端模块 `go test .`：通过，最新job pwsh-a75bf29f58a84de9，4~6秒；覆盖过期描述重取、显式内置回落、校验后报告及既有staging/取消/大小/哈希/精灵包测试。它不是Windows/Android实机安装证据。
- `tsx --test ../ui/catalog-api.test.ts ../ui/settings-api.test.ts`：24通过。
- Web `npm run lint`：通过；`npm run test`：55通过；`npm run build`：通过。最后产物index-Cx1Y4W67.js约654.69KB；现有Vite native config和chunk>500KB警告仍存在。
- `TestGitHubRelayScenarios -count=20`：通过。发现客户端Content-Length EOF先于服务端哈希/计数提交的测试时序问题；测试改为显式等待handler完成，生产计数时机未前移。
- 上游Cloudreve 3.8.3 serializer/error.go核对：401和40023为认证/会话错误，40001是参数错误；新增回归先失败后修正，不再错误重登。相关源码 https://github.com/cloudreve/Cloudreve/blob/3.8.3/pkg/serializer/error.go 。
- Cloudreve remote chunk测试验证API Cookie不外发、仅分片credential、大小/query正确、无授权跳转、拒绝未配置origin；对象清理测试验证精确ID/名称/大小并确认消失。
- Cloudreve ready交付集成：pending不选、ready只解析签名而不请求归档字节、TTL上限、node revision变更回落。
- 回执：仅保存token哈希，幂等、伪造拒绝、签发后版本撤回复查；一小时活跃回执上限10000。
- 密钥轮换：全量原子重加密、损坏凭据拒绝、重启新key可解密、旧key失败。
- 管理镜像重试：鉴权/CSRF/冲突，failed重置、ready不改；Web当前revision状态数量与retry动作实测。
- `git -c core.whitespace=cr-at-eol diff --check`通过。普通diff --check会把仓库已有CRLF末尾视作空白；保留原换行，未用整文件LF转换制造噪声。

## 浏览器交互（本地mock API）

本地受管Vite预览127.0.0.1:15173，Playwright只拦截该origin的API；没有调用真实网盘/生产API。

- 空外部节点提示回落；builtin无编辑/删除按钮。
- 标签可寻址；键盘Enter提交；模拟409提示冲突并保留名称，密码清空。
- 编辑已有凭据不回显密码；旧角色及GitHub代理面板仍可见。
- failed镜像点击重试，POST带CSRF和revision，状态从failed1变pending1、ready2保持。
- 尝试截图已保存浏览器profile的download-node-conflict.png，但当前模型无图像输入，未以截图做视觉布局验收。

## 应用分配基准（非部署压测）

`go test ./internal/delivery -run '^$' -bench BenchmarkRelayStream -benchtime=1x -benchmem`通过。Windows amd64，i5-12600KF；内存零流源、丢弃响应writer，无网络/TLS/磁盘：

| 文件 | 并发 | B/op | allocs/op |
|---|---:|---:|---:|
|32MiB|1|84664|73|
|32MiB|4|306864|243|
|32MiB|8|619216|477|
|128MiB|1|79744|61|
|128MiB|4|306112|238|
|128MiB|8|619568|485|

此证据只支持应用分配不随文件大小线性增加，不能当RSS、CPU、真实连接数、网络吞吐或生产失败率。

## 未覆盖与后续验收

- 没有提供独立网页登录凭据：未运行真实35字节payload ZIP、近128MiB ZIP上传/重登/签名从机可达/清理/Range探针。cmd/cloudreve-probe已具备显式临时对象探针能力，默认仅元数据。
- 没有Windows/Android设备链路验收：真实外部下载/取消/校验/安装与主API无归档字节转发仍需实测。
- 本机无Docker；Compose/Nginx实际解析、镜像构建、多节点启动、PostgreSQL实际恢复没有执行。已验证Linux命令编译，配置仅示例。
- 未做真实RSS/CPU/连接数/网络压力测试，未独立代码审查（当前禁止子代理）。
- worker元数据保存失败后当前worker停止，持久化uploading在重启恢复；运维应监控长期uploading并恢复存储后重启，不能宣称自动跨所有存储故障恢复。
- 云端临时上传失败可能留下提供方未完成上传会话；不自动全局清理会话或历史对象，管理员须按提供方规则处置。

- 工作区helper bundle成功；check退出1，剩余30项早于本次任务的旧文档未以helper识别的表格路径索引。本次计划、旧代理计划、ADR和工作记录已索引，未扩展为仓库全量文档治理。此失败不是业务测试失败，不能声称所有检查通过。

置信度：代码/本地回归B；真实端到端需求验收C/needs-verification。无远程部署，无历史对象删除，无Git提交。

## EvidenceBundleDraft: implementation

- Artifact key: local-code-verification
- Slice ID: implementation
- Type: local-tests
- Source: docs/aegis/work/2026-10-20-download-delivery-nodes/90-evidence.md
- Summary: 根Go测试/vet/Linux编译、共享客户端测试、24共享UI和55Web测试、Web构建、mock浏览器交互通过；仅应用分配基准，不是生产验收。
- Verifier: local command and Playwright results
- Evidence status: evidence-finalized

## EvidenceBundleDraft: live-acceptance

- Artifact key: external-acceptance-gap
- Slice ID: live-acceptance
- Type: environment-gap
- Source: docs/aegis/work/2026-10-20-download-delivery-nodes/90-evidence.md
- Summary: 缺少独立Cloudreve凭据、设备和Docker，真实上传/下载/部署/RSS未验收；workspace check另有30项旧文档索引缺口。
- Verifier: available environment and workspace check
- Evidence status: blocked
