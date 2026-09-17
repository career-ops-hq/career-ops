# 框架恢复机制能保证什么，哪些副作用仍需业务层保护？

Parent: ../map.md
Type: research
Labels: wayfinder:research
Status: resolved
Assignee: codex/durability_semantics
Blocked by:

## Question

调查 LangGraph、Pydantic AI/Graph、OpenAI Agents SDK 官方持久化与恢复语义：进程崩溃、节点重放、暂停后的恢复、恢复期间重复外部写入、输入或代码版本变化、并发认领分别由谁处理？结合当前 score-job.mjs、scripts/hermes-score.py 的边界，明确框架 checkpoint 不能替代哪些业务事务、幂等键和证据有效性检查。特别分析“发布已成功但 checkpoint 未写完”和“旧确认对应的材料已变化”两个场景。仅提出待决定的边界和原型证伪条件，不声称 exactly-once 或未经测试的兼容性。

## Comments

- 2026-09-17：已认领。研究分支 `research/agent-workflow-durability`，基点 `c3963e52`；隔离工作树 `/tmp/career-ops-wayfinder-durability`。研究文件为该分支的 `research/agent-workflow-durability.md`；当前评分 runner 以 canonical 工作区的未提交版本作为只读事实来源，不能把分支基点当成该文件的全部当前行为。

## Answer

2026-09-17：研究完成。[恢复语义、当前源码边界与故障注入条件](../assets/durability-semantics.md)；固定证据为 `research/agent-workflow-durability` 分支 commit `c919c889` 的 `research/agent-workflow-durability.md`。

框架进度、业务发布事实和外部副作用分别需要明确契约。当前 `store.publish` 已在同一事务保存发布结果和业务 checkpoint；待验证窗口为 DB COMMIT 后、state.json 或框架 checkpoint 前。状态检查阻止重复发布不等于顺畅恢复，下一决策需明确如何核对并恢复已提交结果。所有候选都不能代替本项目的证据有效性、确认版本失效和业务幂等规则；报告列出隔离原型的证伪场景，未运行生产或原型测试。
