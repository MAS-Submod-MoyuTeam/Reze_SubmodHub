# 应用自更新 VERSION 探测 - Review Fixes

实施过程中自查发现并修掉的问题，均在提交前完成。

## 1. 用时间戳比较「消费」观测，在 Windows 上 flaky

初版把 `probeAhead` 做成派生状态：`checkedAt.Before(probedAt)` 才承认观测有效。理由是「派生状态不会留下过期的 ahead」。

实测 `go test -count=5` 会随机失败：探测与随后的刷新可能落在同一个时钟 tick 内，`checkedAt.Before(probedAt)` 为假，刚观测到的「有新版本」立刻失效，描述返回旧版本。Windows 的时钟粒度足够粗，这不是理论风险。

改为显式标志：`finishAppReleaseRefresh` 无条件清 `probeAhead`。语义相同（一次尝试消费一次观测），但不依赖时间戳分辨率。改后 `-count=10` 连跑稳定。

## 2. worker 路径被探测信号污染

中途尝试给 `reserveAppReleaseRefresh` 加 `honorProbe` 参数，想让投递 worker 忽略 `probeAhead`，担心「`VERSION` 领先于 tag」会让 15 秒的 worker tick 变成 REST 轮询。

当时的结论是「担心不成立」，理由是「`probeAhead` 只在下一次刷新尝试之前为真，最多产生一次额外 REST」。**这个结论是错的**，见 §4。参数确实不该加，但理由应当是「节奏规则只有一处，不该按调用方分叉」，而不是「额外 REST 只有一次」。撤掉参数本身仍然正确：`reserveAppReleaseRefresh(force bool)` 保持单一形态。

## 3. `Set-Content` 把 `app_release.go` 整体改成 CRLF

用 PowerShell 批量替换调用点时 `Set-Content` 重写了整个文件，行尾从 LF 变成 CRLF，`git diff` 因此显示 1314 行变更（真实改动 72 行）。

仓库没有 `.gitattributes`，`core.autocrlf=false`，Git 里存的是 LF。已用 `[System.IO.File]::WriteAllText` + UTF8 无 BOM 把行尾还原为 LF，`git diff --stat` 回到 72 行，`gofmt -l` 无输出。后续改动该文件时不要用 `Set-Content`/`Out-File`。

## 4. `VERSION` 领先 tag 期间每分钟一次 REST（P1，已修）

评审实测：`bumpVersion` 后连续 5 个探测窗口，REST 调用 1→6。原因链条很短——`refreshDueLocked` 见到 `probeAhead` 就返回「到期」，`finishAppReleaseRefresh` 无条件清 `probeAhead`，下一次探测读到同一个仍然领先的 `VERSION` 又把它置真，于是每个探测窗口买一次 REST。

关键事实：**这不是边缘情况，而是 CI 的常态**。`.github/workflows/build-clients.yml` 里 `version` job 先 bump `VERSION`，`windows`/`android` 两个构建 job 跑完（各自 60 分钟超时）之后 `publish` 才 `gh release create`。也就是说「`VERSION` 领先于 tag」持续整个构建期，而 §2 里「最多一次额外 REST」的判断正建立在这个前提之上，所以它错了。

修法不是「按值只付一次」——那样探测会在 tag 出现前就把额度用掉，之后新版本仍要等 10 分钟常规节奏，功能等于失效。正确判据是「**该版本的 tag 是否已经存在**」：

- `raw.githubusercontent.com/<owner>/<repo>/<ref>/VERSION` 能解析 tag ref（实测 `v0.9.13` → 200，`v0.9.99` → 404），所以探测可以用零配额的 raw 请求回答「tag 建好了吗」。
- tag 不存在 ⇒ Release 一定不存在 ⇒ 不花 REST。整个构建窗口的额外 REST 归零。
- tag 存在但 Release 不可用（草稿、预发布、发布调用在途）是唯一无法用 raw 区分「还没到」与「永远不到」的状态，用 `aheadVersion` 压成「每个 VERSION 值最多一次 REST」。

配套新增 `FetchRepoVersionAt`（只探一个 ref，不回落分支——问的是「这个 ref 在不在」）、`appReleaseTagFor`（tag 前缀从当前快照派生，不硬编码 `v`）、`appReleaseServedTag`。用例覆盖四个方向：tag 未建时多窗口零 REST、tag 出现后恰好一次提升、tag 在但 Release 缺时只付一次、`VERSION` 变化后重新武装。
