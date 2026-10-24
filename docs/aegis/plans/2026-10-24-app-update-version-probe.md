# 应用自更新 VERSION 直读探测计划（仅后端）

状态：已实施（2026-10-24；本地单测与静态检查全绿，未对测试服部署）

## 1. 目标与验收

用户诉求（2026-10-24 直接要求，原文要点）：**仅对后端路径**，额外直接请求 GitHub 源的 `VERSION` 文件——既能绕过 REST API 限流，又能较快地发现新版本；同时保持「尽可能被动更新」，即有人来检查更新时才去检查，探测结果缓存 1 分钟。

范围栅栏：只改 `internal/github` 与 `internal/httpapi`。`internal/updater`、桌面/Android 客户端、Web 下载入口均不改动；`GET /api/v1/app-update` 的公开 JSON 不变。

验收（可自动验证）：

1. 描述接口在需要时（距上次权威刷新未到期）先读一次仓库根 `VERSION`，1 分钟内复用同一结果，突发多次检查只产生一次 raw 请求。
2. 探测值**高于**当前快照的 `tag_name` **且该版本对应的 tag 已存在**时，立刻把权威 Release 刷新提前（同一次请求内完成），描述随后返回新版本。
3. 探测值等于或低于快照时，不产生任何 REST 调用，行为与今天完全一致。
4. 探测值高于快照但 tag 尚未创建（CI 正在构建）时，不产生任何 REST 调用——只多做一次零配额的 raw 查询。
5. 探测失败（404/500/超时/被限速）时静默回落：不改变既有 10 分钟刷新节奏，不返回错误，不影响描述可用性。
6. `snapshot_age_seconds` 语义不变：它仍只表示「最近一次成功读取 Release 快照距今」，探测不得刷新它。
7. `VERSION` 只用于「可能有更新」这一个判断；它绝不产出资产、哈希或说明，也不覆盖 Release 的权威地位。
8. 探测请求不带 API Token（raw 主机不是 API 主机）。

## 2. 现状基线（改造前）

| 关注点 | 位置 | 改造前 |
| --- | --- | --- |
| 刷新节奏 | `internal/httpapi/app_release.go:33-34,118,130` | `checkedAt` + 10 分钟窗口；失败用 `now-(10min-2min)` 硬编码出 2 分钟退避 |
| 请求路径刷新 | `app_release.go:563` | `if s.appReleaseStale() { refreshAppRelease(ctx, false) }`，4 秒请求预算 |
| worker 刷新 | `app_release.go:485` | 15 秒 tick，`kickAppReleaseRefresh()` 后台刷新，仍受 10 分钟窗口约束 |
| 发布发现 | `app_release.go:178-205` | `ListReleases` 走 REST，受限流与配额影响 |
| raw 读取先例 | `internal/github/manifest.go:123-186` | `manifestURL` + `FetchManifest`：HEAD→main→master、404→`ErrNotFound`、403/429→`parseRateLimitError` |
| Token 边界 | `internal/github/releases.go:386` | 只有 `HasPrefix(currURL, c.baseURL)` 才附 `Authorization` |
| CI 顺序 | `.github/workflows/build-clients.yml` | 先 `go run ./cmd/version -check` 再建 tag，因此 tag 出现时 `VERSION` 已是新值 |

**Change Necessity**：不改代码无法达成——现有实现里「发现新版本」只有 REST 一条路，最短延迟就是 10 分钟；`VERSION` 直读是唯一能同时做到「绕过限流」「更快发现」的信号。最小改动边界 = `internal/github` 新增一个 raw 文件读取器 + `internal/httpapi` 新增探测与节奏门；不新增端点、不改 DTO、不碰客户端。

**Ripple Signal Triage**：命中「共享节奏逻辑（`checkedAt` 语义）+ 跨模块（`internal/github` ↔ `internal/httpapi`）+ 对外行为时序（描述何时变新）」。权威 owner：版本/哈希/说明 = GitHub Release；刷新时机 = `internal/httpapi`；raw 文件读取 = `internal/github`。下游消费者 = 桌面/Android 自更新与 Web 下载入口（均只读描述，契约不变）。

## 3. 设计

### 3.1 读取器（`internal/github/version_file.go`）

- `VersionFileName = "VERSION"`；`ErrInvalidVersionFile` 区分「文件在但不可信」与「文件不存在」。
- `rawFileURL(owner, repo, ref, file)` 从 `c.baseURL` 派生 raw 地址（与 `manifestURL` 同源策略：默认回落到 `raw.githubusercontent.com`，测试/自建镜像可指向同一 origin）。`manifestURL` 改为复用它，探针 ref 列表 `rawFileBranches`（`HEAD`/`main`/`master`）也由两处共用。
- `FetchRepoVersion` 逐 ref 探测，404 继续下一个，其余错误直接上抛；响应体上限 64 字节，`parseVersionFile` 只接受单行语义化版本（可带 `v` 前缀，返回时去掉）。

### 3.2 探测与节奏（`internal/httpapi/app_release_probe.go`）

新文件承载新职责，避免把第三种关注点塞进已经 634 行的 `app_release.go`：

- 状态新增 `probedAt/probing/probeAhead/aheadVersion`（与 `release/checksums/fetchedAt/checkedAt` 同一把锁）。
- `probeAppReleaseVersion(ctx)`：单飞 + 1 分钟窗口；**在发请求前就占用窗口**，所以失败也不会被下一次检查立刻重试。失败静默保留上一次观测。
- 探测值高于快照时，再用同一个 raw 主机查一次该版本对应的 tag（`appReleaseTagFor` 从当前快照的 tag 前缀派生，不硬编码 `v`）。tag 不存在 = CI 还在构建 = Release 一定不存在，因此**不花 REST**。
- `probeAhead` 由 `versionIsNewer(probed, served)` 计算（`Masterminds/semver`，`go.mod` 已有，无需新依赖）。
- `aheadVersion` 记录「已经为哪个 VERSION 值付过一次 REST」。tag 已存在但 Release 还不可用（草稿、预发布、发布调用尚未完成）是唯一无法用 raw 区分「还没到」与「永远不到」的状态，此门把它压成「每个 VERSION 值最多一次 REST」，而不是每个探测窗口一次。

### 3.3 节奏门（`app_release.go` 最小改动）

`appReleaseStale()` 换成 `appReleaseRefreshDue()`，并由 `appReleaseState.refreshDueLocked()` 独占节奏规则：

| 状态 | 下一次权威刷新 |
| --- | --- |
| 刚成功、探测未发现更新 | 10 分钟后 |
| 刚成功、探测发现更新（tag 已存在、该值未付过） | 立刻 |
| 上一次失败（无论探测结论） | 2 分钟后 |
| 从未成功过 | 立刻 |

顺带消掉 `checkedAt = now - (10min - 2min)` 这个「用时间倒退表达退避」的写法：`checkedAt` 恢复为「最后一次尝试的时刻」，退避由规则表达。

### 3.4 触发点

只在 `appUpdateDescriptor` 里、且**仅当权威刷新尚未到期时**才探测：已经要刷新就没必要先花一次 raw 请求。worker tick 不探测——用户要的是「有人检查时才检查」，worker 的 10 分钟节奏保持原样。

## 4. 测试

| 用例 | 位置 | 断言 |
| --- | --- | --- |
| 读仓库根 VERSION | `internal/github/version_file_test.go` | 只探一个路径，返回值去空白 |
| HEAD 缺失回落 main | 同上 | 探测顺序 `HEAD,main` |
| 不可信内容 | 同上 | 空/多行/两段式 → `ErrInvalidVersionFile` |
| 文件缺失 | 同上 | `ErrNotFound` |
| 不泄漏 Token | 同上 | 生产 URL 为 `raw.githubusercontent.com`，且不带 `Authorization` |
| 探测更高 → 刷新 | `internal/httpapi/app_release_test.go` | 描述返回新版本，REST 调用 +1 |
| 探测相等 → 不刷新 | 同上 | REST 调用不变 |
| 1 分钟内复用 | 同上 | VERSION 只请求一次 |
| VERSION 领先但 tag 未建 | 同上 | 跨多个探测窗口 REST 调用不变，每次窗口仍读 VERSION 并查 tag |
| tag 出现后提升 | 同上 | 描述返回新版本，REST 调用恰好 +1 |
| tag 在但 Release 不可用 | 同上 | 第一个窗口 REST +1，后续窗口不再增加 |
| VERSION 变化后重新武装 | 同上 | 新值再买一次 REST |
| 探测失败 → 回落 | 同上 | 200 + 旧快照，REST 调用不变 |
| 失败后退避 | 同上 | 2 分钟内第二次检查不再打 REST |

回归边界：`internal/httpapi` 全量（描述契约、镜像、对账）+ `internal/github` 全量（manifest/release/proxy）。

## 5. 文档同步

- `docs/app-update.md` §5：新增「VERSION 探测」段落，写明 1 分钟缓存、只提前刷新、不影响 `snapshot_age_seconds`。
- `docs/download-delivery.md`：刷新节奏那句补上探测。
- `docs/aegis/adr/ADR-0002-app-update-delivery-authority.md`：新增 Amendment 2026-10-24。
- `docs/frontend-contract.md`：无需改动（公开 JSON 未变）。

## 6. 风险与边界

- raw CDN 自带 `Cache-Control: max-age=300`，服务端 1 分钟缓存拿到的值最多可能落后约 5 分钟。这是上游属性，不为此加 `Cache-Control: no-cache` 请求头去对抗——1 分钟窗口的价值在「比 10 分钟快且零配额」，不在秒级精确。
- `VERSION` 领先于 tag 是 CI 的常态（先 bump 文件、构建完成后才建 tag），不是边缘情况。因此判据不能只看「版本更高」，还必须确认该版本的 tag 已存在；否则整个构建窗口会每分钟打一次 REST。tag 查询走 raw 主机，零配额。
- tag 已存在但 Release 仍不可用（草稿、预发布、发布调用在途）是唯一无法用 raw 区分「还没到」与「永远不到」的状态；`aheadVersion` 把它压成每个 VERSION 值最多一次 REST，而不是每个探测窗口一次。代价是这种状态下新版本最多晚一个 10 分钟窗口被发现。
- 探测不改变「无快照 → 503」路径：没有快照时刷新本来就到期，探测被跳过。
