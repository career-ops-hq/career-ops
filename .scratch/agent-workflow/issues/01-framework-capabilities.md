# 哪些框架满足本地 Agent Workflow 的最低能力要求？

Parent: ../map.md
Type: research
Labels: wayfinder:research
Status: resolved
Assignee: codex/framework_capabilities
Blocked by:

## Question

基于当前官方文档和源码，对 LangGraph、Pydantic AI/Graph、OpenAI Agents SDK 做有界比较：显式阶段及条件分支、结构化输出和工具执行、持久化暂停与恢复、本地运行依赖、自定义 OpenAI-compatible 模型服务，以及现有 Python agent / Node CLI 接入。区分 agent loop、workflow 控制流和 durable runtime，指出能力是内置、需要额外服务，还是需要自行实现。必要时把 Temporal 作为重量级对照，不扩展为全市场调查。给出可进入原型的短名单与未知项，不替用户选定框架；每个重要判断链接一手来源并注明核查日期。

## Comments

- 2026-09-17：已认领。研究分支 `research/agent-workflow-capabilities`，基点 `c3963e52`；隔离工作树 `/tmp/career-ops-wayfinder-capabilities`。研究文件为该分支的 `research/agent-workflow-capabilities.md`；完成后在本票记录固定 commit 和可直接读取的本地副本。

## Answer

2026-09-17：研究完成。[一手来源与比较报告](../assets/framework-capabilities.md)；固定证据为 `research/agent-workflow-capabilities` 分支 commit `4988df64` 的 `research/agent-workflow-capabilities.md`。

可进入后续讨论的路线为 LangGraph + SQLite，以及 Pydantic AI + DBOS + SQLite；这是研究短名单，不是用户选型决定。Pydantic GraphBuilder、Harness StepPersistence 与 DBOS 的恢复范围不同，不能混为一谈。Agents SDK 支持持久 RunState 审批，但不能由此推定完整业务流程的 crash recovery。现有模型服务、并发和进程中断恢复尚未实测，留待原型验证。
