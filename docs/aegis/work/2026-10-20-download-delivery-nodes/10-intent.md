# 下载交付节点实施 - Intent

## TaskIntentDraft
- Parent: ../../plans/2026-10-20-download-delivery-nodes.md，用户 2026-10-20 明确授权实施，覆盖旧的仅规划限制。
- Outcome: 完成七阶段代码、测试与部署文档；不连接或部署远端、不删除已有对象/归档、不写真实秘密。
- Success: 关键权限、加密、恢复、交付与客户端策略测试，Web lint/test/build，Go 回归；真实 Cloudreve/设备/部署证据分别记录。
- TaskStartSnapshot: root J:/GithubRep/Reze_SubmodHub; main; HEAD 98f71352de129ca844674d8bc9742a205bfd4f7f; origin/main +0/-0; unstaged docs/aegis/INDEX.md; untracked 原计划；无 staged 改动，单 worktree，无 Git 操作可见。
- Preserve: 不提交或覆盖以上既有文档改动。

## BaselineReadSetHint / BaselineUsageDraft
已读取计划、AGENTS.md、docs/frontend-contract.md、docs/operations.md、docs/github-release-source.md、server.go 数据类型与存储入口、settings.go、postgres.go。未发现 CONTEXT 文件。设计基线及各 owner 在对应实现前补读。

## Execution Readiness View
- Intent lock: 主 API 是发布/哈希/节点配置唯一权威；Cloudreve 与 GitHub 转发能力分离。
- Scope fence: 精灵包本地，应用更新和 WebDAV 不在范围；无真实凭据仍推进离线实现。
- Compatibility: 不保留旧同源客户端下载分支；严格外部 HTTPS origin 和凭据隔离替代它。
- Retirement: 不删历史归档和镜像；保留内置节点和 GitHub 出站代理。
- TDD Route: Mode auto; Decision strict; Strict authority recorded auto decision（计划第113行）；Test posture strict RED test。原因是权限、秘密持久化、共享契约及失败恢复。
- ArchitectureReviewRequired: yes，按各 owner 契约与最终 diff 自审；本环境无子代理。
- Change Necessity: 配置代理无法解除 API 归档中转或客户端同源拒绝；code-change，最小边界按七任务专责文件。
- Complexity: 新职责放专责 owner；server.go 已1787行，仅类型/路由接线，不堆协议或调度逻辑。
- Evidence boundary: 离线 green 不证明真实提供方、平台安装或部署通过。

## ImpactStatementDraft
Cloudreve 协议、AEAD、配置、镜像、交付票据、Web 管理、两平台共用下载器与运维。网络 I/O 不持全局 Store 锁，公开 DTO 无秘密，客户端最终校验发布哈希。
