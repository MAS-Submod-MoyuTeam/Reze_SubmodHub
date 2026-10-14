# 未托管 Submod 商店识别与收养实施计划

日期：2026-10-14  
状态：待实施  
范围：桌面客户端、本地扫描与安装核心、商店匹配接口

## 1. 目标与边界

检索未托管 `.rpy` 的真实 Submod 注册头，与商店注册标识精确匹配，优先只有一个注册标识的候选，优化显式收养并实现持久化。检测卡片仅展示摘要与少量路径，完整文件清单放入独立受限高度视图。

不自动收养、不执行本地脚本、不做模糊名称匹配、不全盘推断资源归属，不同步改造 Android/Web 演示端。身份匹配不等于版本、完整性或安全性验证。

## 2. 当前基线

- `cmd/client/SubmodHub/bindings.go`：`ScanLocalSubmods` 按子目录遍历，忽略根目录散落文件，宽泛正则只提取首个名称、作者、版本。
- `internal/package/submod.go`：已有静态解析器 `parseSubmods`，可抽出共享入口；需补充注释、字符串和损坏输入测试，不能假设现有实现已完全可靠。
- `internal/httpapi/dependency_links.go`：已有已发布版本注册名称精确匹配及单注册优先规则，保持原依赖链接行为不变。
- `clients/desktop/src/App.tsx`：当前按托管目录整体过滤本地项；收养仅修改前端状态，没有持久化调用。
- `clients/desktop/src/components/AdoptModal.tsx`：手填 ID、版本并直接构造托管对象。
- `clients/desktop/src/components/InstalledView.tsx`：直接渲染全部 `unmanaged_paths`。
- `internal/install/manifest.go`、`internal/install/transaction.go`、`cmd/client/SubmodHub/installed_archives.go`：继续作为账本、事务与回执所有者；实施前核实内容快照和恢复链路。
- `docs/frontend-contract.md`：保持未托管仅查看/显式收养、不提供直接卸载。

工作区已有 `cmd/client/SubmodHub/frontend/bindings/github.com/reze/submodhub/cmd/client/desktopservice.ts` 未提交修改，更新绑定前保留、审查，不覆盖用户变化。

## 3. 匹配规则

注册标识为真实 `Submod(...)` 中的静态字符串 `name`，包括现有支持的 `store.mas_submod_utils.Submod(...)`。大小写敏感、精确匹配；作者、版本、目录名仅为辅助信息。保留所有注册条目及来源，不能丢弃未知条目以提升置信度。

| 情况 | 处理 |
| --- | --- |
| 本地一个明确标识，唯一单注册候选 | 识别为同一模组，推荐显式收养 |
| 单注册与多注册候选同时存在 | 优先单注册，多注册保留为次级候选 |
| 最高优先级多个模组 | 标记歧义，用户选择，不静默绑定 |
| 只有多注册候选 | 显示完整注册集合，确认后绑定 |
| 本地多个不同标识或未知注册 | 标记组合目录/解析不完整，不整组快速收养 |
| 无注册、动态名称或无匹配 | 保留未识别与本地收养入口 |

单注册优先以具体发布版本扫描报告为依据：只有一个已知注册且无其他未知注册才能进入该优先级。仅查询用户可见、已发布版本。同一模组历史版本去重为一个候选，同时保留版本证据。

不能因名称匹配就填写最新 `version_id`、标记 `intact` 或绕过更新预览。

## 4. 拟新增契约

- 本地扫描返回稳定分组 ID、注册数组、警告及完整文件路径/大小/哈希；注册数组含名称、作者、声明版本、来源和未知状态。
- 商店批量匹配仅发送去重名称，不上传本地脚本、绝对路径或文件清单；返回候选 ID、标题、注册集合、优先级、版本证据与理由。
- 匹配状态区分等待、已匹配、歧义、无匹配、不可用；网络错误不能视为无匹配。
- 收养预览绑定实例 ID、扫描分组、所选候选和文件范围，提交使用后端计划 ID，不接受前端托管对象作为成功依据。
- 商店身份、已验证发布版本、本地基线分开记录；版本未知时发布 `version_id` 留空，不伪造商店版本。
- 实例 ID 和 generation 贯穿扫描、匹配、预览及提交；前端忽略旧响应，后端也绑定目标实例，不只依赖全局当前目录。

## 5. 实施任务

每项先补最小失败测试，再实现并运行对应验证。不自动提交或创建分支。

### 任务 1：共享解析与文件级扫描

修改：`internal/package/submod.go`、`internal/package/scan_test.go`、`cmd/client/SubmodHub/bindings.go`。新增：`cmd/client/SubmodHub/local_submods.go`、`cmd/client/SubmodHub/local_submods_test.go`。

- [ ] 导出共享静态解析入口，包扫描和本地扫描共用；测试多行注册、多注册、注释/普通字符串/三引号示例、动态名称、不完整输入与解析超限。
- [ ] 提取扫描实现，按账本实际托管路径逐文件排除，覆盖同目录新加未托管文件和根目录散落 `.rpy`。
- [ ] 目录仅为展示分组，不自动证明归属；不明素材和生成的 `.rpyc` 不自动纳管。
- [ ] 规范路径、防止符号链接/重解析点越界；读取失败记警告，为字节数、文件数和注册数设置明确上限，超限标记不完整。

验证：`go test ./internal/package ./cmd/client/SubmodHub`；扫描前后文件哈希不变。

修复轨：真实注册解析、文件级判断、根目录发现。退役轨：删除宽泛字段正则和前端整目录过滤，避免重复解析器。

### 任务 2：批量商店匹配

修改：`internal/httpapi/dependency_links.go`、`internal/httpapi/dependency_links_test.go`。新增：`internal/httpapi/registration_matches.go`、`internal/httpapi/registration_matches_test.go`；在现有路由所有者接入。

- [ ] 测试单注册优先、同级歧义、多注册降级、未知注册不提升优先级、历史版本去重、不可见/未发布排除和无匹配。
- [ ] 共用评分规则，保持依赖链接输出与排序；收养返回完整候选及具体版本证据。
- [ ] 名称去重，限制数量和长度，超限明确拒绝；一次扫描批量查询，不逐文件请求。

验证：`go test ./internal/httpapi`，既有依赖链接回归通过。

修复轨：共享身份匹配规则。退役轨：不新增前端独立算法，保留原依赖链接接口。

### 任务 3：真实持久化收养

新增：`internal/install/adoption.go`、`internal/install/adoption_test.go`、`cmd/client/SubmodHub/adoption.go`、`cmd/client/SubmodHub/adoption_test.go`。按必要性修改账本、事务与安装回执所有者。

- [ ] 测试只读预览、持久化、提交前哈希漂移、实例切换、重复提交、归属冲突、越界及失败回滚。
- [ ] 用选定版本文件清单和哈希辅助确认版本、归属；展示匹配、缺失、修改、额外文件，证据不足则记录本地基线。
- [ ] 默认收养明确归属文件，额外文件排除；组合目录先明确子集；注册文件缺失或身份变化阻断提交。
- [ ] 未匹配项允许显式本地收养，不关联虚构商店 ID，不启用商店自动更新。
- [ ] 提交重检实例、路径、哈希和归属，复用锁、日志、快照，持久化账本及回执；失败不留下半托管记录。
- [ ] 收养不覆盖、移动或删除游戏文件；原手动文件记录为原始基线，后续卸载默认保留/恢复该基线，预览明确说明。
- [ ] 操作历史标记收养；服务重建后仍能读取托管记录。

验证：`go test ./internal/install ./cmd/client/SubmodHub`；fixture 比较收养前后游戏文件哈希，重建服务读回记录，更新后卸载恢复原基线。

修复轨：安装核心真实落盘。退役轨：删除纯前端假成功，不建立旁路账本。

### 任务 4：桌面匹配与向导

修改：`clients/desktop/src/wails.ts`、`clients/desktop/src/types/client.ts`、`clients/desktop/src/App.tsx`、`clients/desktop/src/components/AdoptModal.tsx`。新增：`clients/desktop/src/unmanagedMatching.ts`、`clients/desktop/src/unmanagedMatching.test.ts`、`clients/desktop/src/components/AdoptModal.test.tsx`。按项目方式更新原生绑定。

- [ ] 接入注册数组、批量候选、预览与提交；纯状态映射放入可测试 helper。
- [ ] 唯一候选显示“收养为「商店名称」”，预填并锁定商店 ID；歧义必须选择。
- [ ] 展示声明版本、版本证据、文件数量、差异和基线说明，移除默认伪造的 `1.0.0-adopted`。
- [ ] 离线保留本地结果与重试；切换实例关闭旧向导，丢弃旧响应，提交时禁用重复确认。
- [ ] 后端提交且读回成功才提示完整成功；提交成功但刷新失败提示“已提交，列表刷新失败”，避免再次收养。
- [ ] 分清扫描项 ID、商店 ID、安装 ID，避免改 ID 后无法定位原项。

验证：在 `clients/desktop` 执行 `npx tsx --test src/unmanagedMatching.test.ts src/components/AdoptModal.test.tsx`，覆盖歧义、离线、失败和实例切换。

修复轨：身份与提交状态准确。退役轨：移除直接构造托管对象路径，保留扫描加载协调机制。

### 任务 5：限制展示与契约更新

修改：`clients/desktop/src/components/InstalledView.tsx`、其测试、`clients/desktop/src/components/AdoptModal.tsx`、`docs/frontend-contract.md`。优先复用文件详情视图；无法复用时新增 `clients/desktop/src/components/UnmanagedFilesModal.tsx` 及同名测试。

- [ ] 卡片显示名称、版本、匹配状态、总文件数和大小；路径最多 3 条，优先注册文件，剩余显示“另有 N 个文件”。
- [ ] 完整清单使用独立弹窗、搜索、每页 50 条分页、固定高度内部滚动，不在卡片无限展开。
- [ ] 向导限制视口高度，正文滚动，底部按钮始终可见，长路径换行。
- [ ] 1000 文件 fixture 验证渲染上限、计数、分页和搜索；组合目录没有无条件快速收养按钮。
- [ ] 契约补充匹配、歧义、离线、真实收养、版本未知及展示上限。

验证：`npx tsx --test src/components/InstalledView.test.tsx src/components/AdoptModal.test.tsx`；新增独立弹窗时追加对应测试；Playwright 检查常规/窄视口及底部按钮。

修复轨：完整数据保留、展示受限。退役轨：删除完整路径数组直出，不截断后台提交证据。

## 6. 总体验收

```powershell
go test ./internal/package ./internal/httpapi ./internal/install ./cmd/client/SubmodHub
Set-Location clients/desktop
npx tsx --test src/unmanagedMatching.test.ts src/components/AdoptModal.test.tsx src/components/InstalledView.test.tsx
npm run lint
npm run build
```

新增独立弹窗时将其测试加入命令。区分本次回归和既有失败，不修复无关问题。

端到端验收：手动放入单注册脚本 → 唯一候选与依据 → 显式预览 → 收养后游戏内容不变 → 重启仍托管 → 同目录新增文件仍可发现。歧义、多注册、未知解析不得自动绑定；离线仍可查看；预览后改文件或切实例必须使计划失效；1000 文件不撑出界面。

未实际验证客户端重启或视口时，实施报告必须标注未验证，不能用单元测试替代。

## 7. 风险与回退

- 名称可能重复或被冒用，匹配不代表可信，必须显示歧义与文件差异。
- 历史版本注册集合可能改变，推荐证据须指向具体报告。
- 跨目录素材和组合包归属无法仅靠注册头证明，一期只收养明确范围。
- 账本/回执字段扩展需求在实施前核实真实读写链路，不另写兼容所有者。
- 如需数据库更新，使用针对测试服务器 `100.72.137.92` 的独立小脚本，不保留旧假收养兼容逻辑。
- 回退 UI/匹配不得删除已收养账本、快照或用户文件；持久化撤销通过既有恢复机制。
- 本文件仅为实施计划，尚未执行代码实现、测试、服务器更新或发布。
