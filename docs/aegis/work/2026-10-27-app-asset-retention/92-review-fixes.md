# 第二轮评审修复（2026-10-29）

评审对象仍是同一工作区里的三批未提交改动：**A** 节点只保留当前安装包、**B** 桌面端账本错误与未托管归属、**C** 作者声明发布平台 + 提交闸门。第一轮见 `91-review-fixes.md`；本轮处理它之后复核发现的问题，并为 C 批补上修复记录。

## 处置表

| 编号 | 发现 | 处置 | 验证 |
| --- | --- | --- | --- |
| P1 派生字节码大小写 | 扫描把账本**规范键**（Windows 已小写）传给 `install.DerivedArtifactKeys`，而 `pycacheArtifacts` 用大小写敏感前缀匹配 `<module>.`；`Helper.py` 的 `__pycache__/Helper.cpython-311.pyc` 因此仍被列为未托管 | `pycacheArtifacts` 比较前两侧统一小写；`compiledArtifactKeys` 与函数注释写明入参是规范键。新增 `TestDerivedArtifactKeysMatchesPycacheCaseInsensitively` 与 `TestLocalSubmodsSkipsCompiledArtifactsOfMixedCaseModule` | `go test ./internal/install -run DerivedArtifact`、`go test ./...`（cmd/client） |
| P1 平台声明未校验 | 本地源创建/编辑把 `supported_platforms` 原样落盘：显式空集合让模组在目录里完全不可见且提交闸门静默跳过，未知/大小写变体同样不可见；编辑缺省该字段还会清空原声明 | 新增 `normalizeDeclaredPlatforms`：只接受 windows/android、去重、按固定顺序归一，显式空集合与未知平台返回 400；创建缺省按历史默认记两个平台（github 源仍由规则派生）；编辑缺省保留原声明 | `TestLocalModPlatformDeclarationIsValidatedOnCreate`、`TestLocalModPlatformDeclarationOnEdit`；`submissions_test.go` 的 `["windows","linux"]` 改为合法声明 |
| P1 发布不复核覆盖 | 提交闸门只在 submit 执行；声明可在提交后被放宽，早于闸门的提交也从未校验，approve/publish 仍会把「缺某平台归档」的分平台版本上线 | `requirePublishablePlatformCoverage` 在 approve 与 publish 两处执行，返回 409 `archive_required`；approve 的检查放在任何内存改写之前，失败不改提交状态 | `TestReviewPublishRefusesUncoveredDeclaredPlatform`（拒绝 + 不动状态 + 补齐后放行） |
| P1 账本文案缺失 | 契约要求 `manifest_corrupt` 的文案给出账本路径并说明不可自愈，桌面端只 toast 裸码 | 新增 `clients/desktop/src/scanErrors.ts` 的 `describeScanFailure`，扫描失败时同时喂给内联错误态与 toast；其他错误原样透传 | `scanErrors.test.ts`；`tsc --noEmit` |
| P2 回收日志无错误码 | 三种失败都只记节点 ID，线上无法区分节点不可达、删除未确认与清单超限 | 日志追加 `%v`；这些错误按包约束本身就是脱敏码，不含响应文本与 URL | 既有回收/节点用例保持通过 |
| P2 分页上限无覆盖 | `ListAll` 的 20 页上限从未被测到，而它现在也约束上传读回 | 新增 `TestListAllRefusesATruncatedListing`：超限返回 `cloudreve_directory_listing_incomplete` 且不返回部分清单 | `go test ./internal/cloudreve` |
| P3 格式与测试细节 | `app_asset_retention_test.go` 结尾 `}}`、`local_submods_test.go` 声明与首语句同行；节流水位表测试用 `s.mu` 保护 `pruneMu` 的数据 | `gofmt` 修正；测试改用 `pruneMu` | `gofmt -l`（改动文件） |

## 语义变化

- **平台声明是服务端校验字段**：本地源创建缺省 = 两个平台（历史默认），显式空集合 = 400；编辑缺省 = 保留。`supported_platforms` 的存储形态从此固定为非空、去重、`windows`→`android` 顺序。
- **发布前复核平台覆盖**：approve 与 publish 与 submit 使用同一条 `missingDeclaredPlatformArchives` 规则，错误码统一 `archive_required`。
- **派生字节码归属**：与源文件的大小写无关；生产路径传入的小写规范键不再影响 `__pycache__` 匹配。

## 未处理（需人决定）

- **真实节点验收**：仍缺一次真实发版，确认目录里安装包从两份收敛到一份、`updater.exe` 与 `.apk` 混合残留一并回收。
- **历史空声明不回填**：改动前已被写成 `[]` 的本地模组不会在读取时被改写；它们仍按「不发布到任何平台」处理，直到作者编辑一次模组把默认的两个平台写回。当前没有批量迁移。
- **目录对象数上限**：`ListAll` 最多 20 页 × 100 条（≈1999 个对象），超过即报 `cloudreve_directory_listing_incomplete`；若真实 Cloudreve 确实分页，这个共享目录（归档永不删除）有朝一日会让上传读回失败。当前规模下不触发，未改上限。
- **异常分页的静默截断**：停止条件是「某页不再带来新对象」，若提供方返回整页重复（偏移/`data:null`）会返回不完整清单而不报错；对回收是少删，对删除复核是不安全方向。低概率，未改。
- **TS 测试未在本机执行**：沙箱内 `tsx --test` 因 esbuild 起子进程返回 `spawn EPERM`，`scanErrors.test.ts`、`InstalledView.test.tsx`、`VersionArchiveUploader.test.tsx`、`versionShipping.test.ts` 仅通过 `tsc --noEmit`；需在正常环境跑一次。

## 验证

```powershell
# 仓库根
go build ./... ; go vet ./internal/{cloudreve,httpapi,install} ./cmd/cloudreve-probe   # 通过
go test ./internal/cloudreve ./internal/httpapi -count=1                               # ok
go test ./internal/install -run DerivedArtifact -count=1                               # ok
# 客户端模块（独立 go.mod）
cd cmd/client/SubmodHub ; go test ./... -count=1                                        # ok 7.9s
# 类型检查
cd clients/desktop ; npx tsc --noEmit                                                   # 通过
cd web ; npx tsc --noEmit                                                               # 通过
```

`internal/install` 全量仍会随机出现 `t.TempDir` 清理 `The directory is not empty`（90-evidence 记录的环境坑，与改动无关）；`-race` 仍不可用（本机 go 未启用 cgo）。
