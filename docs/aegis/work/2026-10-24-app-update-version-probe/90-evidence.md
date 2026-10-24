# 应用自更新 VERSION 探测 - Evidence

抓取时间：2026-10-24（+0800）。工作区 `main`，本记录对应 HEAD `300e9b5` 之上的未提交改动。

## 静态检查与测试（本机，可复现）

| 命令 | 结果 |
|---|---|
| `go build ./...` | exit 0 |
| `go vet ./...` | exit 0 |
| `go test ./...` | 全部 ok（17 个包，含 `internal/github`、`internal/httpapi`） |
| `go test ./internal/httpapi/ -run TestAppUpdate -count=10` | ok（连跑 10 轮无 flaky） |
| `go test ./internal/httpapi/ ./internal/github/ -count=3` | ok / ok |
| `gofmt -l` 六个改动文件 | 无输出 |

P1 修复后重跑：`go vet ./internal/httpapi ./internal/github` exit 0；`go test ./internal/httpapi ./internal/github` ok（2.652s / 0.790s）；`go test ./internal/httpapi -run TestAppUpdate -count=10` ok；`go test ./...` 全部 ok；`gofmt -l` 仍只列出既有未格式化文件，改动的五个 Go 文件均不在其中。

全量跑动中出现过一次 `internal/install` 的 `TestSafeAtomicRenameRotation/restore` 失败（Windows 文件轮转），该包与本次改动无关且 `-count=5` 单独复跑与随后的全量复跑均 ok，判定为既有 flaky，不计入本次结论。

`-race` 无法执行：本机 `gcc` 不在 `PATH`，`CGO_ENABLED=1` 后报 `cgo: C compiler "gcc" not found`。并发正确性由「单飞标志 + 同一把 `state.mu`」的设计与连跑 10 轮的用例兜底，但**未经 race detector 验证**，这一点如实记录。

新增用例：

| 用例 | 文件 | 覆盖 |
|---|---|---|
| `TestFetchRepoVersionReadsRepositoryRootFile` | `internal/github/version_file_test.go` | 只探一个路径、返回值去空白 |
| `TestFetchRepoVersionFallsBackToNamedBranches` | 同上 | `HEAD` 缺失回落 `main`，`v` 前缀被剥掉 |
| `TestFetchRepoVersionReportsMissingFileAsNotFound` | 同上 | 三个 ref 全 404 → `ErrNotFound` |
| `TestFetchRepoVersionRejectsUntrustedContent`（5 子例） | 同上 | 空/多行/两段式/非版本/带尾巴 → `ErrInvalidVersionFile`，且不误判为 `ErrNotFound` |
| `TestFetchRepoVersionNeverSendsToken` | 同上 | 生产 URL 精确等于 `raw.githubusercontent.com/...`，且无 `Authorization` |
| `TestAppUpdateProbePromotesNewerVersion` | `internal/httpapi/app_release_test.go` | 探测更高且 tag 已存在 → 描述切到新版本，只探一次 |
| `TestAppUpdateProbeLeavesEqualVersionAlone` | 同上 | 相等 → REST 调用数不变 |
| `TestAppUpdateProbeIsCachedForAMinute` | 同上 | 3 次请求只产生 1 次 VERSION 请求 |
| `TestAppUpdateProbeWaitsForTheTagBeforeRefreshing` | 同上 | `VERSION` 领先但 tag 未建：5 个探测窗口 REST 调用零增长，每次窗口仍读 VERSION 并查 tag |
| `TestAppUpdateProbePromotesWhenTheTagAppears` | 同上 | tag 出现后下一个窗口提升，REST 恰好 +1 |
| `TestAppUpdateProbePaysOnceForATagWithoutARelease` | 同上 | tag 在但 Release 不可用：首个窗口 +1，后续 5 个窗口不再增加 |
| `TestAppUpdateProbeRearmsWhenVersionChanges` | 同上 | 换一个 VERSION 值后重新武装，再买一次 |
| `TestAppUpdateProbeFailureKeepsServingSnapshot` | 同上 | 探测 500 → 200 + 旧快照，刷新节奏不变 |
| `TestAppUpdateProbeDoesNotRetryFasterThanTheRetryInterval` | 同上 | Release API 失败后，探测不能把刷新提前到 2 分钟重试窗口之前 |

`fakeAppRelease` 已扩展为同时提供 `/repos/owner/repo/releases`、`/dl/<name>` 与 `/owner/repo/<ref>/VERSION`，并记录三类调用次数。VERSION 端点区分分支 ref 与 tag ref：分支返回分支上的值，tag 返回该 tag 上的值，未知 ref 返回 404——这正是探测用来「零配额确认 tag 是否已存在」的行为。用例因此能断言「REST 调用有没有发生」而不只是看输出。

## 真实上游探测（2026-10-24 +0800）

```
GET https://raw.githubusercontent.com/MAS-Submod-MoyuTeam/Reze_SubmodHub/HEAD/VERSION
→ 200, body "0.9.13", Cache-Control: max-age=300

GET .../Reze_SubmodHub/v0.9.13/VERSION → 200, body "0.9.13"
GET .../Reze_SubmodHub/v0.9.99/VERSION → 404
```

前两条说明「直读仓库根文件」这条路在本仓库上真实可用，且响应头确实带 5 分钟 CDN 缓存——这是文档里「最多落后约 5 分钟」的实测依据。后两条是 P1 修法的前提：raw 主机能解析 tag ref，且对不存在的 tag 返回 404，因此探测可以在零配额下判断「该版本的 tag 建好了没有」，不必靠 REST 去试。

## 边界说明

- **未做真实网络路径的服务端联调**：本机 raw 直连可用，但没有把测试服 `100.72.137.92` 换成新二进制去观察一次真实的「探测 → 提前刷新」。
- **`-race` 未执行**（缺 gcc），并发安全性只有设计与重复运行支撑。
- **「`VERSION` 领先于 tag」是 CI 常态，不是人为构造的状态**：`build-clients.yml` 的 `version` job 先 bump `VERSION`，`windows`/`android` 构建（各自 60 分钟超时）跑完后 `publish` 才 `gh release create`。早期版本把这一窗口误判为「不会出现」，P1 由此漏网；现在的用例按真实时序建模（`bumpVersion` → 构建期 → `publish`）。
