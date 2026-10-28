# 节点只保留软件本体最新版 - Evidence

采集时间：2026-10-27（Asia/Hong_Kong），本地 Windows 工作区 `J:\GithubRep\Reze_SubmodHub`。

## 静态检查与构建

```
$env:GOCACHE=tmp\gocache; $env:GOMODCACHE=tmp\gomodcache
go build ./...   → 无输出（通过）
go vet ./...     → 无输出（通过）
```

## 新增用例

cloudreve 包（`internal/cloudreve/remove_test.go`）：

- `TestRemoveObjectsDeletesOnlyTheListedIDsAndConfirms` — 去重后只按 ID 删除，其他对象保留，删后重列确认。
- `TestRemoveObjectsFailsWhenTheObjectSurvives` — 提供方返回成功但对象仍在 → `cloudreve_cleanup_not_confirmed`。
- `TestRemoveObjectsRejectsUnownedInputBeforeTouchingTheProvider` — 空 ID、相对目录、含路径分隔的 ID、空串一律 `cloudreve_cleanup_identity_invalid`，且不产生任何提供方请求。

httpapi 包（`internal/httpapi/app_asset_retention_test.go`）：

- `TestAppAssetsKeepOnlyTheServedRelease` — 目录里有旧版本 `.exe`/`.apk`、读回失败残留 `app-…-updater.exe-<nonce>`、模组归档 `mod-1-….zip`、普通文件与目录项：只删前三类中的 app 对象，归档/普通文件/目录项与当前版本安装包全部保留；一轮 = 两次列目录（判定 + 复核）。
- `TestAppAssetsWaitForEveryCurrentAssetBeforeRetiringOldOnes` — 当前版本有一项 `pending` 时既不列目录也不删除。
- `TestAppAssetRetentionSurvivesAnUnreachableProvider` — 列目录失败时不产生任何删除记录。
- `TestMaintainAppAssetsRetiresOldInstallersOnceComplete` — 无上传任务时 worker 一轮即回收旧安装包；10 分钟窗口内的下一轮不再列目录；强制一轮会回收下一批。

## 回归

```
go test ./internal/cloudreve/ ./internal/httpapi/ -run 'RemoveObjects|AppAsset|MaintainAppAssets' -count=1
  连跑 3 次：全部 ok（cloudreve 0.44s / httpapi 0.69s 量级）

go test ./... -count=1
  ok  cmd/updater, cmd/version, internal/{auth,checksum,cloudreve,delivery,github,httpapi,install,maspath,package,solver,updater,updater/windows,version}
  无 FAIL
```

`-race` 不可用：本机 `go` 未启用 cgo（`-race requires cgo`），沿用项目既有做法以普通测试 + 连跑覆盖。

## 环境记录（避免误判）

- `go test` 必须显式给 `GOCACHE` / `GOMODCACHE` 指向 `tmp\gocache`、`tmp\gomodcache`：默认 `%LOCALAPPDATA%\go-build` 在工作区沙箱下不可写。仓库根的 `.gocache` / `.gotmp` 目前 ACL 不可写。
- **不要**把 `GOTMPDIR` 指到工作区内：`t.TempDir()` 的 `RemoveAll` 会随机报 `The directory is not empty`（先在 `internal/install` 三个用例上复现，去掉 `GOTMPDIR` 后全绿），与本任务代码无关。

## 未覆盖

- 未对真实 Cloudreve 节点执行删除：测试服需要一次真实发版，确认目录里的安装包从两份收敛到一份、且 `updater.exe` 与 `.apk` 混合残留一并回收。
- 未验证节点目录改配置后的遗留清理（按设计不覆盖）。
