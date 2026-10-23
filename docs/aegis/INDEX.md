# Document index

- [SubmodHub design](specs/2026-09-25-submodhub-design.md)
- [SubmodHub implementation plan](plans/2026-09-25-submodhub.md)
- [Frontend function and API contract](../frontend-contract.md)
- [Android All files access feasibility gate](../android-smoke.md)
- [Android client adaptation plan](plans/2026-10-16-android-client.md)
- [下载交付分离、Cloudreve 镜像与节点统一管理计划](plans/2026-10-20-download-delivery-nodes.md)
- [标签目录（Tag Catalog）计划](plans/2026-10-22-tag-catalog.md)
- [应用自更新节点交付计划](plans/2026-10-23-app-update-cloudreve-delivery.md)

Local reference projects used during design:

- `J:\MonikaModDev-zhCN\Monika After Story\game` — target MAS installation and built-in ZIP installer/uninstaller.
- `E:\GithubKu\MAICA_Server_Submod\game` — complex submod with `Submods` and `python-packages` content.
- `E:\GithubKu\MAS_UniSync` — Flarum login flow and user-group mapping reference.
- [Task center and safe transaction recovery](plans/2026-10-12-task-atomic-recovery.md)
| 2026-10-20 | plan | docs/aegis/plans/2026-10-20-download-delivery-nodes.md | 下载交付节点代码实施，真实验收待补 |
| 2026-10-08 | plan | docs/aegis/plans/2026-10-08-github-proxy-relay.md | 同源交付约束由新计划替代；同步与内置代理职责保留 |
| 2026-10-20 | work | docs/aegis/work/2026-10-20-download-delivery-nodes/10-intent.md | 下载交付节点实施 intent |
| 2026-10-20 | work | docs/aegis/work/2026-10-20-download-delivery-nodes/20-checkpoint.md | 下载交付节点实施 checkpoint |
| 2026-10-20 | work | docs/aegis/work/2026-10-20-download-delivery-nodes/90-evidence.md | 下载交付节点实施 evidence |
| 2026-10-20 | work | docs/aegis/work/2026-10-20-download-delivery-nodes/99-reflection.md | 下载交付节点实施 reflection |
| 2026-10-20 | adr | docs/aegis/adr/ADR-0001-download-delivery-authority.md | ADR-0001 - 主API发布权威与外部下载交付分离 |
| 2026-10-20 | work | docs/aegis/work/2026-10-20-download-delivery-nodes/91-review-fixes.md | 审查修复与回归验证 |
| 2026-10-22 | plan | docs/aegis/plans/2026-10-22-tag-catalog.md | 标签改为目录内多选（主/子标签、至少一个），管理员在设置页维护；代码与文档已实施，存量标签清空脚本待对测试服执行 |
| 2026-10-23 | plan | docs/aegis/plans/2026-10-23-app-update-cloudreve-delivery.md | 应用自更新资产纳入 Cloudreve 节点交付，主 API 成为更新检查权威；本地测试与静态检查通过，测试服与真机验收待补 |
| 2026-10-23 | adr | docs/aegis/adr/ADR-0002-app-update-delivery-authority.md | ADR-0002 - 应用自更新交付权威扩展（修订 ADR-0001 的应用自更新边界） |
