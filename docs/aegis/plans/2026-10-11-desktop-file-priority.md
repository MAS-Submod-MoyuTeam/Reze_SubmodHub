# PC 客户端文件覆盖优先级实施计划

日期：2026-10-11。供其他 agents 实施，本轮不改业务代码。

## 目标与边界

- 数字越大，同路径冲突时该模组文件优先生效；低优先级覆盖层保留用于还原。
- 复用后端现有优先级选项，不引入独立排序系统，不管理脚本加载/执行顺序。
- 首版实现真实读取、数字编辑、覆盖详情、变更预览、事务应用、重新读取。
- 不做拖拽、逐文件指定赢家、自动收养、Android UI 改造。
- 不自动提交或创建分支；隔离工作树由协调者安排。

## 基线与未知项

- docs/frontend-contract.md 定义 PreviewPriority，但文档不是已实现接口的证明。
- internal/solver/solver.go 已有 Priority，同值依次比较 Sequence、ModID。
- internal/httpapi/server.go 和 api/openapi.yaml 的 recommended_priority 是推荐值，不是已安装实际值。
- internal/install/manifest.go 使用 InstallationRecord.Order / LayerRecord.Order，ActiveLayer 取排序后末层；planner.go 更新保留 Order。
- clients/desktop/src/App.tsx 扫描及安装完成处写死 priority: 50；应用回调仅改 React 状态却提示已持久化。
- clients/desktop/src/components/PriorityLayersView.tsx 范围硬编码 0～100，预览是示例数据，描述混入脚本执行次序。
- clients/desktop/src/wails.ts 同时支持 native 与浏览器 /local/；cmd/client/SubmodHub/bindings.go 已有计划预览及执行机制。
- cmd/client/SubmodHub/frontend/vite.config.ts 使用 clients/desktop 作为源码根，不要新增第二套 frontend 页面。

用户已确认后端提供优先级选项。当前检索未确认完整 PC 调整链路，不能断言功能不存在或直接重写。
实施前必须冻结真实字段/存储位置、合法范围/默认值、同值规则、Priority 与 Order 关系、真实 API/DTO、错误格式、bindings 生成命令。
同时确认 MAS 实例 ID、安装记录 ID、mod_id 的区别和唯一性，以及覆盖链/统计的数据来源。
若缺实际接线，仅补原有链路；任何持久化格式或同值规则变化先经协调者确认。

## 目标交互和安全契约

- 左侧托管模组按数字降序展示，直接输入/增减；范围服从后台，不自行限定 0～100。
- 显示当前值、草稿值、生效/被覆盖文件数；未知统计不假装为零。
- 右侧展示真实路径、参与模组及优先级、赢家、可用漂移状态，支持路径搜索。
- 原始文件是只读还原基线，不是可调优先级的模组。
- 预览展示路径、原来源→新来源、内容变化、阻断和风险；同哈希归属变化单独说明。
- 基线/草稿分离，dirty 按差异计算；改回原值即无变更。
- 严格整数校验，不用 parseInt 静默接受 1.5 或 1abc。
- 修改草稿、切实例、安装/更新/卸载或 generation 改变后旧预览失效。
- 异步请求绑定实例与序号，忽略过期响应；切实例有草稿时提示放弃。
- 应用中禁止重复提交/切目标实例；后台仍校验计划身份、实例、generation、锁和漂移。
- 预览只读，应用走事务。失败保留草稿，不假成功；成功后刷新权威数据和相关缓存。
- 已提交但刷新失败显示“已应用，状态刷新失败”，不诱导重复写盘。
- 未托管不可调整，推荐值不覆盖用户值；语义冲突仍按现有规则阻断。
- 空实例、无托管、无共享文件、加载、错误、阻断和应用中均有明确状态。

## Agent 分工

先完成 Task 0 冻结契约，再并行；本计划不要求当前会话启动 agents。

| Agent | 任务 | 独占写入范围 |
| --- | --- | --- |
| A 后端 | 0、1 | internal/solver、internal/install、实际 core 包、cmd/client/SubmodHub Go 文件及生成 bindings |
| B 页面 | 3 | PriorityLayersView.tsx、必要页面子组件 |
| C 接入 | 2、4 | wails.ts、types/client.ts、App.tsx、新增 priorityLayers.ts 与测试 |
| D 验收 | 5 | docs/frontend-contract.md、验收证据；新测试文件先约定 owner |

A/B/C 先冻结 DTO 与组件 props，之后 B/C 可并行；只有 A 生成 bindings，其他 agents 不手写生成文件。D 合并后验收。
两个 agents 时，A 后端，B 页面及接入，协调者验收。不允许多人同时改同一 DTO 文件。

## 实施任务

### Task 0：真实契约核对

1. 阅读上述基线及事务安全/文件清单实现，定位现有优先级入口和写盘链路。
2. 输出真实 API/DTO、范围、默认值、同值规则、更新保留规则和旧数据策略。
3. 明确 Priority/Order 关系、现有复用点、最小缺口；协调者确认兼容性。
4. 冻结读取（实例/generation/安装标识/实际值）、覆盖详情（路径/各层/赢家）、预览（变更映射/计划/阻断/风险）、应用和错误契约。

验收：每个字段有权威来源，不用推荐值或文档代替实际实现。

### Task 1：后台复用与最小补齐

1. 先写失败测试，验证实际引擎高低优先级及同值规则，不仅测 solver。
2. 接通真实读取与覆盖查询，不靠目录扫描猜归属。
3. 测预览不写盘、赢家变化、无共享路径、同哈希归属变化、非法请求。
4. 如缺调整计划，在原 planner/transaction 内补齐，不直接写文件绕过事务。
5. 复用 Blob、快照、回滚、恢复及漂移检查，应用复核实例/generation/锁。
6. 测更新保留值、卸载露出正确下层、调整不重写原始快照。
7. 同步 DesktopService、browser_server.go、生成 bindings 并测两条通道。
8. 如需迁移缺失字段，确定默认策略且保留旧赢家；打开页面不能自动重排磁盘。

验收：实际值和磁盘赢家跨重启一致，安装/更新/卸载/恢复不回退。

### Task 2：前端类型和可测逻辑

1. 按冻结 DTO 修改 types/client.ts、wails.ts，双通道参数一致。
2. 新增 priorityLayers.ts 放校验、差异计算及可注入请求控制，避免 App 再堆算法。
3. 沿用 node:test + tsx，先测非法输入、改回原值、过期响应、预览失效。
4. 状态按实例及安装记录隔离，仅在后台保证唯一时用 mod_id 映射。
5. 前端仅展示排序，不另算实际赢家；生产失败不回退 mock。

### Task 3：页面改造

1. 删除固定 previewDiffs、硬编码范围、脚本顺序描述。
2. 接受受控 props，展示草稿差异和正确按钮状态。
3. 展示真实覆盖链及变更列表，不读文件正文；补齐空态及错误状态。
4. 输入有标签、键盘可操作，状态不只靠颜色。
5. 保存调用后不立即清草稿，由真实应用和刷新确认成功。

### Task 4：App 集成与旧路径退休

1. 删除扫描及安装完成处 priority: 50，改读真实值。
2. 替换仅 setInstalledMods 的应用回调，接真实预览和计划执行。
3. 集成页面 props；可复用 PlanPreviewModal，但不把调整伪装成安装/卸载。
4. 切实例、安装/更新/卸载后刷新基线，清覆盖统计及文件详情缓存。
5. 移除生产 mock 回退、虚假成功 toast；区分应用失败与刷新失败。

### Task 5：整合验收

使用临时 MAS 目录和测试归档，禁止破坏性操作真实游戏目录。
必须验证：A=10/B=20 时 B 生效；A 改 30 预览不写盘、确认后 A 生效；同值稳定；同哈希归属变化；无共享路径仍可持久化；更新保留值；卸载露下层及最终还原；外部修改阻断；陈旧计划拒绝；切实例/过期请求隔离；失败不假成功；空态；双通道一致；重启后磁盘哈希和页面一致。

建议命令，先核对工具和平台 build tags：

```powershell
# 仓库根，先聚焦再回归
go test ./internal/solver ./internal/install
go test ./...
# 嵌套 Go module 单独验证
Set-Location cmd/client/SubmodHub
go test ./...
# 前端现有测试方式
Set-Location ../../../clients/desktop
npx tsx --test src/priorityLayers.test.ts src/installedFiles.test.ts src/planPreview.test.ts
npm run lint
# 实际 Wails 配置包含 bindings alias
Set-Location ../../cmd/client/SubmodHub/frontend
npm run build
```

Playwright 验证浏览器模式，原生 Wails 至少人工 smoke 一轮。测试不可执行时记录命令、错误及未验范围，不宣称全部通过。不修无关失败，不加新框架、不更新无关依赖。

## 完成定义与交接

- 数字优先级和磁盘覆盖由同一后端规则控制，跨重启持久化。
- 无假预览/假成功/独立赢家算法；保留漂移检查、快照、事务回滚、卸载还原。
- 安装列表、文件详情、优先级页面一致。
- 更新 docs/frontend-contract.md 的实际 API/范围/同值规则/错误，不把建议名称写成既存接口。
- 每个 agent 交付修改文件、契约变化、测试命令及结果、未解决项；编译通过不代替磁盘验收。
- 协调者审阅旧数据兼容和 bindings，全部验收后宣布完成。
- 如改变 manifest，先给兼容读取及回滚策略；禁止删用户状态目录来回滚。
