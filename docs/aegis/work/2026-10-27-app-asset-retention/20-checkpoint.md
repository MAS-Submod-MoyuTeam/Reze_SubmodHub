# 节点只保留软件本体最新版 - Checkpoint

## 判定边界
- **什么是「软件本体」**：镜像记录里以 `app-<tag>-<哈希前12位>-<资产名>` 命名的应用安装资产。模组归档是 `<mod>-<version>-<sha>.zip`，精灵包不进节点，两者都不在保留策略范围内。
- **为什么不能靠镜像行判断**：对账在发现新 tag 时就回收旧 tag 的 `AppAssetMirror` 行（描述只宣告当前版本），删除所需的对象信息随之消失；同时历史遗留对象根本没有行。因此保留策略改成「当前版本的保留集合 vs 节点目录清单」，既自愈历史包袱，也不依赖行的生命周期。
- **为什么必须「先齐后删」**：任一资产仍在 pending/uploading/failed 时，旧版本仍是客户端唯一能下载的副本；`appNodeKeepSet` 只有在当前版本每个可镜像资产在该节点 `ready` 且 `FileID` 非空时才返回可用保留集合。
- **为什么允许删「当前 tag 但不在保留集合」的对象**：读回校验失败时行会换成 `<name>-<nonce>`，原对象是坏字节或半成品；保留集合只包含行上的 `ObjectName`，这类残留正好被回收。

## 实现分区
- `internal/cloudreve/remove.go` — 唯一删除原语 `RemoveObjects`：按清单里的对象 ID 删除（不按名称重解析，被替换的文件因此不会被误删），删后重列目录确认，残留则返回 `cloudreve_cleanup_not_confirmed`；输入必须是绝对目录与非空、无路径分隔的对象 ID，否则 `cloudreve_cleanup_identity_invalid`。
- `internal/cloudreve/probe.go` — `DeleteCreatedObject` 改为复用 `RemoveObjects`，探针额外校验「名称也必须消失」，删除路径从两份收敛为一份。
- `internal/httpapi/app_asset_retention.go` — `isAppAssetObjectName`、`appNodeKeepSet`、`pruneStaleAppAssets`、`pruneNodeAppAssets`、`reserveAppPrune`。前缀 + 后缀判定覆盖 `<name>-<nonce>` 形态；目录项与其他文件不参与。
- `internal/httpapi/app_release.go` — worker 挂钩：`claimAppMirror` 无任务可领时执行一轮保留巡检（有任务时先传完，避免与上传抢同一目录）。
- `internal/httpapi/archive_mirrors.go` — `deliveryRuntime` 加进程内节流表 `appPruneAt`（按 node ID + revision）。

## 语义与阈值
- 节流：每节点 revision 10 分钟一轮（`appAssetPruneInterval`）。一轮成本是一次目录清单，比 15 秒 tick 慢是有意的。
- 预算：单节点一轮 2 分钟（`appAssetPruneBudget`）。回收与上传共用唯一 worker，卡住的提供方只能占用自己那一轮，不能靠 HTTP 超时把它拖到分钟级。
- 清单完整性：判定与复核都读完整目录（`Client.ListAll`），结束条件是「某页不再带来新对象」而不是「单页不满」——后者会把提供方的页大小当成我们的假设，页大小比预期小时悄悄截断。不分页的提供方只多付一次请求。
- 对象形状：`app-` 前缀 + 以 `.exe`/`.apk` 结尾，或其后缀只跟 12 位小写十六进制（读回残留）。判定不看「名字里出现 `.exe`」，避免把同目录归档带走。
- 保留集合：任一就绪行的 `ObjectName` 为空即整轮不动作（那是唯一会删掉当前安装包的输入错误）。
- 失败处理：列目录/删除失败只写脱敏日志（节点 ID、条数），不写持久状态、不改镜像状态；下一个窗口自动重试。
- 不改交付：描述里的 `sha256`/`size_bytes`/直链选择完全不感知回收；回收发生在单 worker 内，与上传互斥。
- 已知不覆盖：节点目录改配置后旧目录中的遗留对象不由本策略回收（只按当前 `Directory` 巡检）；管理员仍需手工清理整目录。若某次发布没有任何可镜像安装包（例如缺 `SHA256SUMS.txt` 哈希），保留策略整体不动作，旧安装包继续留在节点上——那属于「发布元数据不完整」的现场，需要人看一眼，不适合让自动回收顺手清空。

## 被否方案
- **在 `reconcileAppMirrors` 里删行时顺带删除对象**：对账发生在任何上传之前且不持凭据上下文，节点不可用时会把「删行」和「删对象」绑成一次失败；也清不掉历史遗留。
- **按行记录的 `FileID` 删除**：只覆盖有行对象，覆盖不到历史遗留与失败残留，且行在 tag 变更时已消失。
- **按名称删除**：目录清单读到删除之间文件可能被替换，按名重解析会删掉新对象；`RemoveObjects` 只认 ID。
- **保留最近两版**：用户要求「只保留最新版」，且旧版本没有任何读取路径。

## 验证待办
- 本地完成：`go build ./...`、`go vet ./...`、`go test ./...` 全绿（见 evidence）。
- 未完成：测试服真实 Cloudreve 节点上的回收验收（需要一次真实发版，观察目录从两份安装包收敛到一份）、`updater.exe` 与 `.apk` 混合残留的现场核对。
