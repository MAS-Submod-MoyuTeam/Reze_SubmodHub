# 评审修复（2026-10-27）

评审对象是当时工作区里两批未提交改动：**A** 应用安装包在节点上只保留当前发布版本（`internal/cloudreve`、`internal/httpapi`、ADR-0002 Amendment）；**B** 桌面端「未托管项标注所属已托管模组」与「账本不可解析返回 `manifest_corrupt`」（`cmd/client/SubmodHub`、`clients/desktop`、`internal/install` 的派生产物键）。

两批改动在生产代码上互不依赖，只是当时混在同一个工作区里；下面按它们各自归属记录修复，未合并语义。

## 处置表

| 编号 | 发现 | 处置 | 验证 |
| --- | --- | --- | --- |
| A-P1 | `client.List` 只发一次 `GET /directory`，`Listing` 里也没有能判断截断的字段。安装包与**永不删除**的归档同目录，目录变长后旧安装包可能落在第二页，回收漏删，且 `RemoveObjects` 的「删后重列确认」只在第一页找 → 给出不可信确认 | 新增 `Client.ListAll`：按 `page`/`page_size` 逐页取全，**结束条件是某页不再带来新对象**（不拿单页条数当结束条件，页大小假设与实际不符时不会悄悄截断；不分页的提供方只多付一次请求），超过 `directoryMaxPages` 返回 `cloudreve_directory_listing_incomplete` 而不是返回截断清单。`RemoveObjects`、`DeleteCreatedObject`、上传后读回、`cmd/cloudreve-probe` 改用完整清单；`EnsureDirectory` 仍用单次 `List`（它需要 404 语义） | `listall_test.go`：分页 250 对象（4 次请求、取全）、忽略分页（2 次请求、不重复）、空目录（1 次）、相对路径不触达提供方 |
| A-P2 | 回收用的是 worker 的长生命周期 ctx，而 `cloudreveClient` 超时 5 分钟；回收与上传共用唯一 worker | 每节点一轮加 `appAssetPruneBudget = 2 * time.Minute` | 既有用例（不可达提供方、节流）保持通过 |
| A-P2 | `appPruneAt` 只增不删，revision 变动或删节点后留下死键 | `forgetDeliverySession` 按 `nodeID/` 前缀清理 | `TestAppAssetPrunePacingIsDroppedWithTheNodeSession` |
| A-P3 | 判定用 `Contains(".exe")`，同目录归档若以 `app-` 开头且名字含 `.exe` 会被误删 | 改为「`app-` 前缀 + 以 `.exe`/`.apk` 结尾」，或其后只跟 12 位小写十六进制的读回残留 | `TestAppAssetObjectPredicateCoversGeneratedNamesOnly` |
| A-P3 | `keep` 只要求 `ready && FileID != ""`，若某行 `ObjectName` 为空，保留集合匹配不到任何对象 → 会删掉当前版本安装包 | `ObjectName` 为空时整轮不动作 | `TestAppAssetRetentionKeepsInstallersWhenTheKeepSetIsUnusable` |
| A-缺口 | 「先齐后删」是按节点的，但没有多节点用例 | 补「完整节点回收、未齐节点完全不动」 | `TestAppAssetRetentionRunsPerNode` |
| B-P1 | `manifest_corrupt` 是**不可自愈**态，契约却写「引导刷新状态或重新扫描」——重新扫描只会再失败一次 | 账本没有备份可回退，因此不新增自动重建（那是持久化决策）：契约改为说明必须给出账本路径并写明只能人工修复或重建 | `docs/frontend-contract.md` 错误码表 |
| B-P2 | `loadLedger` 注释声称「唯一读取者」，实际另有 4 处直呼 `core.LoadManifest()`，同一错误码有两种表示 | 4 处（安装/修复/优先级预览、收养）全部收敛到 `loadLedger`；注释改为描述现状；`ErrManifestCorrupt` 保持裸码，并写清为何不包装底层解析错误（客户端把该字符串当文案展示，没有呈现解析细节的出口） | `go test ./cmd/client/SubmodHub`；`ErrManifestCorrupt` 消息断言 |
| B-P3 | 文档说「归属取自文件层，`paths` 只作回退」，代码取并集：重装换主后旧 `paths` 仍会让陈旧安装名出现在卡片上 | 按目录分开存放：该目录有文件层就用文件层，没有才用 `paths` | `TestLocalSubmodsPrefersFileLayersOverInstallationPaths`、`TestLocalSubmodsFallsBackToInstallationPathsWithoutLayers` |
| B-P3 | 探针改后一次删除要读三次目录 | 保留（名称不是身份，只有名称检查能证明没被替换），注释里写明这次多读是有意的 | `internal/cloudreve/probe_test.go` |
| B-P3 | `compiledArtifactKeys` 每次扫描为每个托管源做 stat | 不改实现，注释写明量级与「每次刷新一次，不是每个文件一次」 | — |

## 语义变化

- **目录清单**：从「一次响应」变成「完整清单」。凡是判断「对象已删除 / 对象不存在」的地方都必须用 `ListAll`；新增调用点不得再退回 `List`。
- **对象判定**：回收只认安装包形状，归档与普通文件不再可能被 `app-` + `.exe` 的松散匹配带走。
- **账本读取**：`s.core.LoadManifest()` 在桌面服务里不再被业务代码直接调用，`manifest_corrupt` 只有一种写法。
- **未托管归属**：文件层优先，`paths` 按目录回退。

## 未处理（需人决定）

- 账本的**真实恢复路径**：当前只在契约里写清「人工修复或重建」。备份 `manifest.json.bak` 或在应用内重建账本是持久化决策，未擅自加入。
- **提交拆分**：两批改动仍在同一工作区、未提交；建议分 `feat(delivery)` 与 `fix(client)` 两次提交，并 `git add` 未跟踪的 `docs/aegis/work/` 与 `internal/install/derived_artifact_test.go`。
- **真实节点验收**：仍缺一次真实发版，确认目录从两份安装包收敛到一份，以及 `updater.exe` 与 `.apk` 混合残留一并回收。
- **基线失败**：`clients/desktop` 全量用例 258/260，失败的两条在 `CatalogView.scroll.test.tsx`；该测试文件与 `CatalogView.tsx` 都不在本次改动内，判断为既有失败，需在干净基线上确认。

## 验证

```powershell
# 仓库根
go build ./... ; go vet ./... ; go test ./... -count=1        # 全绿
# 客户端模块（独立 go.mod）
cd cmd/client/SubmodHub ; go test ./... -count=1               # ok 12.9s
# 桌面端
cd clients/desktop ; npx tsc --noEmit                          # 通过
npx tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"          # 258/260（两条为基线失败，见上）
```

`-race` 仍不可用（本机 `go` 未启用 cgo），沿用项目既有做法：普通测试 + 连跑。
