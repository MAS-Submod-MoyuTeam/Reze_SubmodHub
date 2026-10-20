# ADR-0001 - 主API发布权威与外部下载交付分离

Status: `recorded-from-work`
Date: `2026-10-20`

## Source Evidence

- 节点配置、镜像状态、交付解析、独立relay及共享下载器代码；本地自动测试与浏览器mock交互。真实提供方、设备和部署尚待验收。
## Context

主服务器重复传输普通包消耗带宽；网盘对象元数据不构成发布哈希证明；跨域交付不能泄漏API凭据。

## Decision

Store仍为唯一发布、哈希、节点及镜像权威；Cloudreve镜像独立读回哈希后ready；独立GitHub节点只持短期受众票据；客户端下载器验证允许origin和发布哈希；精灵包本地。

## Alternatives Considered

- 所有归档继续由主API强制同源传输，配置简单但带宽仍集中。
- 将发布状态或凭据直接委托存储/浏览器，破坏权威和秘密边界，拒绝。
## Consequences

- 引入持久化镜像任务、部署主密钥和独立节点运维；客户端报告完成与描述尝试分开计数；旧镜像和本地归档继续保留。
## Compatibility Boundary

仅普通包下载策略变化；角色、扫描、版本不可变、精灵包及应用自更新边界保留；不部署远端或删除历史对象。

## Retirement Impact

旧客户端强制同源职责由受控HTTPS策略替代；GitHub代理保留同步与内置回落，非历史兼容桥；旧计划标注替代范围。

## Baseline Sync

- Needed: needed
- Target: docs/frontend-contract.md
- Action: update baseline
- Reason: 契约、运维与GitHub来源文档已更新；实现不等于真实上线验收。

## Evidence References

- docs/aegis/work/2026-10-20-download-delivery-nodes/20-checkpoint.md
- docs/download-delivery.md
## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
