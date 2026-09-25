# Task Plan: Monika After Story Submod Hub

## Goal
产出一个可执行的 Monika After Story 子模组商店与安装器总体计划，覆盖 WebUI、Windows/Android 客户端、包格式、安装卸载和冲突处理。

## Phases
- [x] Phase 1: 建立项目与样例上下文
- [x] Phase 2: 明确需求、边界和关键决策
- [x] Phase 3: 形成架构与分阶段路线图
- [x] Phase 4: 输出并复核计划文档

## Key Questions
1. 商店后端是否需要账号、审核和私有发布能力？
2. 客户端如何定位游戏目录，尤其是 Android 的应用沙盒限制？
3. 是否要求兼容现有无清单 ZIP 和 MAS 原生 Submod 注册机制？
4. 冲突解决的默认策略和用户可接受的回滚范围是什么？

## Decisions Made
- 前端 UI 只输出功能、页面和交互契约；实现交给其他 agent。
- 计划优先考虑 Go + Wails v3，但会评估 Android 方案的实际可行性。
- 现有 MAS 目录结构和 `Submods` 机制是兼容边界。

## Status
**Complete** - 设计文档与实施计划已写入 `docs/aegis/`；Android Wails v3/SAF 真机验证是实施第一道门。
