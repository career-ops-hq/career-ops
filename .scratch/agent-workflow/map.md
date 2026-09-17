# 用显式 Agent Workflow 编排求职流程

Label: wayfinder:map
Status: open

## Destination

确定从岗位发现、存活与资格检查、评分、shortlist、人工确认到申请材料准备的框架、执行边界和迁移路线，达到可以开始实施的程度。首批迁移评分流程；本地图只完成决策，不实施迁移。

## Notes

- 用户于 2026-09-17 两轮确认以下规划约束；它们是地图起点，不代表框架已经选定。
- 优先让代码强制执行流程边界，并支持可靠中断恢复。
- 优先本地运行且无需额外常驻服务；更重方案必须证明收益。允许替换 Hermes agent 执行层，保留现有模型服务和 CLI/定时任务使用方式作为评估约束。
- 人工确认需要持久化，跨日、进程重启后可继续；确认绑定岗位和相关材料版本，相关变化后不能复用旧确认。
- 单岗位失败不阻塞其他岗位；只复用仍有效的阶段结果；重试不能重复发布或重复产生业务写入。访问失败保持 Unknown，不能推断岗位关闭。
- `data/opportunities.db` 是业务事实的权威存储；来源快照和 Markdown 报告是不可变证据。框架 checkpoint 与业务事实的职责需要明确决定。
- 保留评分政策、验证器、独立审查和候选人事实边界；禁止提交申请或发送消息。不要把 prompt 中的业务政策误当成应被删除的编排。
- 使用 wayfinder、grilling、domain-modeling；research 票由 research 子代理调查一手来源。每次后续会话至多解决一张非 research 票。
- 本地 Markdown tracker：子票位于 `issues/`；`Parent` 指向本图，`Labels` 标明类型；`Status: open/claimed/resolved` 与 `Assignee` 表示认领，`Blocked by` 表示依赖。按票号选择 open、无未解决依赖且无 assignee 的首张票。先认领，再工作；答案追加在子票，地图只保存摘要和链接。
- 图创建时工作区已有 `scripts/hermes-score.py` 和 `scripts/discord-idempotent-post.py` 修改；不覆盖、不夹带提交。研究采用独立 `research/` 分支。

## Decisions so far

- [哪些框架满足本地 Agent Workflow 的最低能力要求？](issues/01-framework-capabilities.md) — 已核查框架能力；形成两条原型候选路线，保留模型兼容性和实际恢复行为待验证。
- [框架恢复机制能保证什么，哪些副作用仍需业务层保护？](issues/02-durability-semantics.md) — 已区分框架进度与业务发布事务，记录提交后崩溃、确认失效和并发恢复的证伪条件。

## Not yet specified

- 选定框架及执行边界后，非评分阶段如何接入、如何保持各阶段上下文和证据链。
- 恢复模型明确后，具体人工交互入口、确认失效提示和操作体验。
- 首批原型暴露的问题如何影响生产切换、回退条件及旧编排的完整移除范围。

## Out of scope

- 实施框架迁移、修改生产 cron、迁移业务数据和上线；本轮只产出可执行的决策路线。
- 自动提交申请或自动发送消息。
- 面试准备、CV 维护和查询功能的独立 workflow 设计；本轮保留调用接口。
- Web/TUI 产品建设、改写评分政策、切换模型作为默认解法。
