# 下载流程修复计划：GitHub 纯流式中转

## 范围

用户要求：GitHub 源在用户下载时只中转流量，不保存文件。此阶段更新诊断和计划，不实施业务修改。工作区已有未提交的安装安全修改，实施时必须保留。

不引入服务端准备任务、归档缓存或下载临时文件。不把上传源、本地归档下载与发布扫描的存储机制混入此次变更。发布/同步阶段使用 DownloadToTemp 的调用方单独保留；这里只替换用户下载 relay。

## 根因与证据

- internal/httpapi/github_relay.go:60 在写响应头之前 DownloadToTemp，全部下载、散列校验结束后才发送文件。因此上游下载期间客户端无法显示字节进度。
- ui/catalog-api.ts:169 在 fetch 返回后才触发进度回调。
- clients/desktop/src/App.tsx:224 把 ZIP 转为 Base64 发给 PreviewArchive。当前本地 Wails v3.0.0-beta.27 的 transport_http.go 设置 64 MiB runtime/分块组装上限，70 MB ZIP 编码后约 93 MB，超过限制。此错误属于安装桥接，单独下载 ZIP 不走该路径。
- 当前 github_relay_test.go 要求散列不符返回 502 JSON；纯流式中转不能继续保证该语义，必须显式修改测试和契约。

尚未获取完整用户日志和运行模式，也没有实机复现；诊断依赖当前源码及本地已安装依赖。上一轮 go test ./internal/github ./internal/httpapi 通过（缓存结果）。

## 设计与安全边界

GitHub → 服务端受控上游响应体 → 客户端，使用固定大小缓冲、背压和定期 Flush，不落盘也不整包缓存。保留代理重写、重定向目的地检查、请求取消、并发限制和合理超时。不得直接把任意前端 URL 作为上游地址。

响应前验证发布状态、已发布大小范围、上游状态及已知 Content-Length；失败时保留现有 JSON 错误和 Retry-After。未知 Content-Length 仍允许流式读取，但按发布大小和产品上限限制读取。

响应中保留发布记录的 Content-Length、X-Archive-SHA256；这些是预期元数据，不代表服务端已经验证完毕。服务端可边转发边计算散列，用于日志和下载计数，但散列不符时字节已送出，无法撤回或改为 502 JSON。

客户端必须完整验证大小/SHA-256 后才能保存或安装。上游断开、超限或中途读取失败时中止响应，不把 JSON 错误追加到 ZIP；检查 HTTP/1.1、HTTP/2 和包装 handler 的终止行为。散列不符必须由客户端拒绝，不能依靠连接中断保证识别。只在完整读取、写入和散列匹配后增加成功计数；这仍不代表用户已保存文件。

## 任务 1：先建立失败测试

修改 internal/httpapi/github_relay_test.go、internal/github/proxy_test.go、ui/catalog-api.test.ts。

- 分段上游用 channel 同步：发送并 Flush 第一段后，等待客户端读到第一段才允许发送尾段。旧 relay 会超时，新 relay 必须在上游 EOF 前读到字节，不能依靠 sleep 判断。
- 为下载阶段隔离临时目录，证明 relay 不创建归档文件；源码检查确保 relay 不调用 DownloadToTemp、CreateTemp 或整包 ReadAll。
- 覆盖已知/未知长度、大小不符、散列不符、取消、中断、429、404、HEAD 和并发 slot 释放。
- 将旧“所有散列错误都返回 502”用例拆为响应前长度错误与响应后客户端散列拒绝；代理/CDN 重定向仍必须走原安全入口。

## 任务 2：替换 relay owner

修改 internal/github/releases.go、internal/httpapi/github_relay.go，必要时 api/openapi.yaml。

增加受控打开归档响应的接口，复用 executeRequest 的代理和重定向逻辑，明确 response body/cancel 的关闭责任。保留 DownloadToTemp 给同步/发布调用方，避免复制另一套网络策略。

relay 在获得上游响应并完成前置检查后发送元数据，通过约 32–64 KiB 缓冲转发并有界 Flush。累计字节和增量散列，不做归档暂存。限制最多读取预期大小加一个探测字节；异常停止，不静默截断后宣称成功。记录开始时间、首字节、传输量和终止原因，不记录敏感令牌。

重新核对 HTTP client 的 60 秒 Timeout 与下载 context 的超时关系，不能认为 5 分钟 context 自动覆盖 client.Timeout。检查部署已有反向代理的响应缓冲；如存在，仅对归档路由关闭缓冲，不能全局放宽配置。

退休 relay 中临时文件、os.Open/os.Remove 和“全量校验后交付”的分支。明确新边界：服务端中转，客户端最终验证；不添加缓存或准备任务。

## 任务 3：完善 UI 阶段

修改 ui/catalog-api.ts、clients/desktop/src/App.tsx、clients/desktop/src/components/ModDetailModal.tsx 及对应测试。

在 descriptor 请求和等待响应时立即显示“获取下载信息/连接下载源”，拿到响应后显示真实递增字节，完整接收后切换“校验”。已知总量显示百分比，未知总量显示字节和不定进度，不显示 NaN。错误读取稳定 JSON code（仅响应前），区分网络中断、大小不符与散列不符。

节流更新但最终状态立即送达，支持 AbortSignal 和取消；失败不得创建保存链接或进入安装。服务端首字节变早后现有流读取进度自然覆盖上游传输，不需要第二条服务端进度通道。

## 任务 4：独立解决原生 body too large

新增 cmd/client/SubmodHub/archive_transfer.go 和对应测试；修改 bindings.go、browser_server.go、clients/desktop/src/wails.ts、App.tsx，并用项目生成工具刷新 bindings。

桌面 Go 从同源下载描述符获取归档，流式保存到客户端管理的暂存目录并验证散列。客户端本地暂存不是服务端存储，不违反 GitHub relay 不落盘的要求。桥接只传小型参数和不可猜测 archive_id；预览用句柄引用本地归档，不接受任意本地路径。

句柄绑定操作/实例、散列和有效期，限制单文件和总容量；取消、失败、过期和完成清理。原生事件/浏览器状态查询报告本地接收与校验进度。复用当前安装安全逻辑，不绕开扫描和计划校验。

退休 FileReader Base64 大请求；旧接口仅在确有兼容调用方时限期保留并显式限制小文件。不得修改 Wails 模块缓存或只提高其上限。先保持既有解包方式；文件型低内存扫描可另行安排。

## 验证与交付顺序

任务 1 → 任务 2/3 → 任务 4。流式中转修复进度但不会修复 Base64 桥接，不能混淆这两个结果。

- go test ./internal/github ./internal/httpapi
- 在 cmd/client 下执行 go test ./SubmodHub
- clients/desktop/node_modules/.bin/tsx.cmd --test ui/catalog-api.test.ts
- 实机验证原生/浏览器模式慢速真实 70 MB、接近 128 MiB、超限、取消、中断、散列错误；确认服务器无下载临时文件，客户端上游 EOF 前收到字节，桥接载荷不随 ZIP 大小增长。

新增测试/接口尚未实施，命令可用性实施时核对。回滚按 relay 与句柄安装切片进行；不得把已经收到全部字节等同于已验证成功。此次范围不修改上传归档存储，不承诺实时撤销已开始的流。
