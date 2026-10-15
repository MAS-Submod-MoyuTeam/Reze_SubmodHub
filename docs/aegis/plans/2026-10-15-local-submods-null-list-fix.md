# 本地已安装模组读取失败修复计划

日期：2026-10-15。状态：仅源码诊断与计划；未修改业务代码，未运行回归测试或实机复现。

## 目标与范围

修复 `Cannot read properties of null (reading 'map')`。扫描成功但没有未托管模组时，正常展示托管列表或空状态；真实读取错误仍提示失败并允许重试。

遵循根目录 `AGENTS.md` 的快速迭代约定，不引入旧版本兼容层，不迁移数据库，不操作测试服务器。延续 `docs/aegis/plans/2026-10-12-installed-mod-loading.md` 的加载、空状态和错误状态设计，不重构加载协调器。

## 源码证据与限制

- `cmd/client/SubmodHub/local_submods.go`：`scanLocalSubmodsCore` 在目录不存在时返回非 nil 空切片，但目录存在时以 `var result []LocalSubmod` 初始化；无结果追加时成功返回 nil 切片。
- nil 切片经 JSON 序列化成为 `null`，非 nil 空切片成为 `[]`。
- `clients/desktop/src/App.tsx` 的 `scanLocalSubmods` 将响应断言为数组后直接执行 `local.map(...)`；类型断言无法改变运行时 null。
- `clients/desktop/src/wails.ts` 原样返回桥接结果；当前生成绑定允许 `LocalSubmod[] | null`。
- `ListInstalledArchives` 已归一化空记录，不是当前优先修复对象。

已定位与报错吻合的源码缺陷，但尚未获得用户实机调用栈和响应，不能断言实机只存在这一种原因。优先复现目录存在但为空、没有可识别项、所有脚本均已托管三个条件；后两种需由测试确认确实没有结果追加。

## 修复设计

成功扫描结果的唯一责任方为 `scanLocalSubmodsCore`。将结果初始化改为 `result := make([]LocalSubmod, 0)`，确保成功返回数组。保留错误传播、托管排除、散落脚本、注册项、排序、警告及扫描限额语义。

不在前端增加 `local || []` 掩盖契约缺陷，不修改生成绑定，不顺带修改其他接口。若发现其他 null 来源，先补证据再调整范围。

## 文件与职责

| 文件 | 计划变更 |
| --- | --- |
| `cmd/client/SubmodHub/local_submods_test.go` | 空结果、JSON 序列化与托管排除回归测试 |
| `cmd/client/SubmodHub/local_submods.go` | 最小根因修复 |
| `cmd/client/SubmodHub/browser_server_test.go` | HTTP 桥接空数组契约测试 |
| `clients/desktop/src/App.tsx`、`clients/desktop/src/wails.ts` | 只读检查和人工验收，不计划修改 |

## 原子执行步骤

### 1. 写失败测试

1. 在 `local_submods_test.go` 添加表驱动测试 `TestLocalSubmodsEmptyResultIsJSONArray`。
2. 使用临时目录覆盖目录不存在、目录存在且为空、只有已托管脚本三种情况；托管场景沿用现有 manifest 夹具模式。
3. 断言错误为 nil、结果非 nil、长度为零、`json.Marshal` 严格输出 `[]`。按需导入标准库 `encoding/json`。
4. 运行目标测试，确认失败原因是目录存在时返回 nil，而非夹具或编译错误。

```powershell
go test ./cmd/client/SubmodHub -run '^TestLocalSubmodsEmptyResultIsJSONArray$' -count=1
```

### 2. 最小修复

1. 仅修改扫描结果切片的初始化，不变更错误返回分支。
2. 重跑新增测试，确认所有场景通过。
3. 运行相关扫描回归，确认识别、托管排除和散落脚本行为不退化。

```powershell
go test ./cmd/client/SubmodHub -run 'TestLocalSubmods|TestDesktopServiceScansLocalSubmods' -count=1
```

### 3. 桥接与完整回归

1. 参考 `browser_server_test.go` 的服务和 handler 初始化方式，新增 `TestBrowserServiceScanLocalSubmodsEmptyResult`。
2. 对目录存在但为空的实例请求 `/local/ScanLocalSubmods`，断言 HTTP 200，响应去除首尾空白后严格为 `[]`，不是 `null` 或错误对象。
3. 执行目标测试和客户端后端包完整回归；无关失败只记录，不扩大范围。
4. 对修改的 Go 文件运行 `gofmt`，重新执行目标回归及差异检查。

```powershell
go test ./cmd/client/SubmodHub -run '^TestBrowserServiceScanLocalSubmodsEmptyResult$' -count=1
go test ./cmd/client/SubmodHub -count=1
gofmt -w cmd/client/SubmodHub/local_submods.go cmd/client/SubmodHub/local_submods_test.go cmd/client/SubmodHub/browser_server_test.go
go test ./cmd/client/SubmodHub -run 'TestLocalSubmods|TestDesktopServiceScansLocalSubmods|TestBrowserServiceScanLocalSubmodsEmptyResult' -count=1
git diff --check
```

### 4. 实际界面验收

1. 重新构建并启动包含后端修复的桌面客户端，不能仅刷新旧进程的前端。
2. 空 `Submods` 临时实例：打开已安装页并强制刷新，加载结束显示成功空状态，无 null/map 错误。
3. 只有托管模组的实例：托管列表保留，未托管列表为空，无读取失败提示。
4. 有未托管模组的实例：名称、文件数、注册项及散落脚本展示正常。
5. 用临时实例或已有错误测试验证真实读取错误仍进入可重试错误状态，不伪装成成功空状态；不更改用户真实目录权限。
6. 记录运行模式、构建版本、测试输出和人工结果；无法启动图形客户端时，标记实机验收未完成。

## 验收、风险与回滚

- 完成标准：成功空扫描返回非 nil 空切片且序列化为 `[]`；目标和相关测试通过；界面验收完成或明确列出未验证项。
- 保留目录不存在的正常空结果分支和真实错误传播，不引入前端兼容回退。
- 工作区已有 `AdoptModal` 和 Wails 生成绑定的未提交变更，执行前核对，不覆盖、不回退、不纳入本修复。
- 主要风险为托管夹具路径不匹配、旧客户端未重建；通过明确 manifest 路径及重新构建启动规避。
- 回滚仅撤销本任务初始化及新增测试，不触碰安装记录、manifest、存档或其他未提交变更，不自动提交 Git。
