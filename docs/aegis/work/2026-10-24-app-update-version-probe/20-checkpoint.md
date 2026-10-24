# 应用自更新 VERSION 探测 - Checkpoint

## 分层
- `internal/github/version_file.go`：`VersionFileName`、`ErrInvalidVersionFile`、`rawFileURL`、`FetchRepoVersion`、`FetchRepoVersionAt`、`parseVersionFile`。仓库根文件的寻址与 ref 回退（`HEAD`→`main`→`master`）都收在这里，`manifest.go` 的 `manifestURL` 改为复用它、`manifestBranches` 改为引用 `rawFileBranches`。`FetchRepoVersionAt` 只探一个 ref、不回落分支，因为问的是「这个 tag 在不在」。
- `internal/httpapi/app_release_probe.go`：`appVersionProbeInterval`（1 分钟）、`appVersionProbeBudget`（1.5 秒）、`probeAppReleaseVersion`、`reserveAppReleaseProbe`、`finishAppReleaseProbe`、`appReleaseTagExists`、`appReleaseTagFor`、`versionIsNewer`。新职责单独成文件，避免把第三种关注点塞进已经 600+ 行的 `app_release.go`。
- `internal/httpapi/app_release.go`：`appReleaseState` 增加 `lastErr`/`probedAt`/`probing`/`probeAhead`/`aheadVersion`；`appReleaseStale()` → `appReleaseRefreshDue()` + `refreshDueLocked()`；`finishAppReleaseRefresh` 改为记录「这次尝试是否失败」；新增 `appReleaseServedTag`。
- `internal/httpapi/app_update_descriptor`：请求路径里先探测（仅当权威刷新未到期），再按规则决定是否刷新。

## 关键决策
1. **探测是触发器，不是数据源**。`VERSION` 唯一的用途是让「权威刷新」提前发生；资产、哈希、说明永远来自 Release 快照。这样即使 `VERSION` 领先于 tag（版本号已 bump、Release 未建），最坏结果也只是多花一次 REST 请求，不会产出半真半假的描述。
2. **探测窗口在发请求之前占用**。若在成功后才记 `probedAt`，探测失败时每个到达的客户端都会重试一次，正是「绕过限流」想避免的放大器。失败也占窗口 = 一分钟内最多一次 raw 请求，无论结果。
3. **探测只在「权威刷新尚未到期」时发生**。已经要刷新了还先探一次，等于为一个必然发生的请求多付一次 raw 往返。
4. **刷新节奏收敛为一个方法**。原先 `appReleaseStale()` 与 `reserveAppReleaseRefresh()` 各写一遍 `time.Since(checkedAt) >= 10min`，失败退避又靠 `checkedAt = now - 8min` 倒推时间。现在 `refreshDueLocked()` 是唯一规则：从未成功 → 立刻；上次失败 → 2 分钟后；探测发现更新 → 立刻；否则 → 10 分钟后。`checkedAt` 恢复「最后一次尝试」的本义。
5. **花 REST 前先零配额确认 tag 存在**：`VERSION` 高于快照还不够，还要该版本的 tag 已在仓库里。发布流程是先 bump `VERSION`、构建完成后才建 tag，所以「`VERSION` 领先于 tag」是构建期的常态；只看版本号会让整段构建时间每个探测窗口买一次 REST。tag 查询走同一个 raw 主机，零配额。
6. **一次尝试消费一次观测，且同一 VERSION 值只付一次**：`probeAhead` 在刷新尝试结束（无论成败）时清空，`aheadVersion` 记住已经付过配额的值。前者必须靠显式标志而非时间戳比较——Windows 时钟粒度下 `checkedAt` 与 `probedAt` 会落在同一 tick，用 `checkedAt.Before(probedAt)` 判断会随机失效（实现过程中确实因此出现过 flaky）。后者覆盖 tag 已存在但 Release 仍不可用（草稿、预发布、发布调用在途）的状态：那是唯一无法用 raw 区分「还没到」与「永远不到」的情形，按值封顶为一次 REST。
7. **探测失败保留上一次观测**：一次读失败不构成「没有新版本」的证据，直接清掉信号会让抖动把已知的新版本退回 10 分钟盲区。热循环风险已由上面两条挡住（失败走 2 分钟重试窗口、成功则清空）。
8. **比较走 `Masterminds/semver`**（`go.mod` 已有，`internal/solver` 在用），`v` 前缀与预发布后缀都按语义化版本处理，不自己写字符串比较。
9. **`parseVersionFile` 故意严格**：只接受单行 `X.Y.Z[-pre][+build]`。`1.2`、`0.9.13 stable`、多行都判为 `ErrInvalidVersionFile` 而非 `ErrNotFound`——「文件坏了」和「文件不存在」对运维是两条不同的线索，且都不能被当成版本号。
10. **`manifestURL` 与 `rawFileURL` 合并**：两者原本各写一遍「默认回落到 raw.githubusercontent.com + 拼路径」，仓库根文件的寻址只该有一个 owner。`manifestBranches` 也改为引用 `rawFileBranches`，ref 回退顺序不再两处维护。

## 未做 / 边界
- 未改 `internal/updater`、桌面/Android 客户端、Web 下载入口。
- 未加 `Cache-Control: no-cache` 之类去对抗 raw CDN 的 5 分钟缓存：那是上游属性，探测的价值是「比 10 分钟快且零配额」，不是秒级精确。
- 未在投递 worker tick 里探测：用户要求的是「有人检查时才检查」，worker 的 10 分钟节奏保持原样。
- 未做真实 GitHub 网络验收（本机 raw 直连可用性不稳定）；只用 httptest 与真实 URL 拼接断言覆盖。
