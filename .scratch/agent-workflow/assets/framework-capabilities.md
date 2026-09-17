# Agent Workflow 框架能力研究

核查日期：2026-09-17。范围：官方在线文档及官方仓库；没有安装框架、调用现有模型服务或运行兼容性测试。本报告提出原型候选，不决定选型。

## 结论

**建议进入后续原型讨论的两条路线：LangGraph + SQLite checkpoint；Pydantic AI + DBOS + SQLite。** 后者的 durable runtime 来自 DBOS，不能把它写成 Pydantic Graph 原生能力。OpenAI Agents SDK 可作为执行层候选或对照，但单独使用仍需决定完整业务 workflow 的持久控制流如何实现。以上是基于已确认本地运行约束的研究推论，尚非性能、可靠性或迁移成本结论。

必须区分三层：agent loop 决定模型何时调用工具；workflow 用代码规定阶段和分支；durable runtime 保存可恢复进度。会话历史、结构化输出、人工工具审批都不能单独证明完整业务流程可恢复。

## 已核实的能力

| 候选 | 显式流程与 agent 执行 | 持久暂停、恢复及本地依赖 |
| --- | --- | --- |
| LangGraph | 节点、边与条件路由由代码定义；模型和工具可放入节点。[工作流文档](https://docs.langchain.com/oss/python/langgraph/workflows-agents) | 文件 SQLite checkpointer 需另装包，无需 Agent Server；`interrupt` + thread ID + `Command(resume=...)` 可跨进程等待。恢复会重跑中断节点开头，副作用须幂等。[checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)、[interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) |
| Pydantic AI / Graph | AI 提供 agent loop、类型化输出及工具；GraphBuilder 提供步骤、分支、并行。[Graph](https://pydantic.dev/docs/ai/graph/graph/)、[输出](https://pydantic.dev/docs/ai/core-concepts/output/) | 当前 GraphBuilder 明确**没有原生状态持久化**。工具审批可延期并通过历史与 deferred results 继续，但完整耐故障执行应接 durable backend。[GraphBuilder](https://pydantic.dev/docs/ai/graph/builder/)、[deferred tools](https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/) |
| Pydantic AI + DBOS | Python workflow 装饰器编排，agent 调用由官方 durability 集成包装；是否仍需要 Graph 是后续设计问题。 | DBOS 在进程内运行，支持 SQLite 或 Postgres；官方示例使用 SQLite，生产推荐 Postgres。模型请求等经步骤保存，依赖与结果必须可序列化；不能把任意现有函数都视作自动可恢复。[官方集成](https://pydantic.dev/docs/ai/capabilities/durable_execution/dbos/) |
| OpenAI Agents SDK | 内置 agent loop、工具和 `output_type`；代码可顺序或并行调用 agent。handoff 本身不等于强制业务阶段图。[agents](https://openai.github.io/openai-agents-python/agents/)、[orchestration](https://openai.github.io/openai-agents-python/multi_agent/) | `RunState` 可序列化人工审批暂停并在另一进程恢复，存储由应用负责。完整长任务耐故障编排另有 Temporal、Dapr、Restate 集成；不能把 SQLite session 当成完整 workflow checkpoint。[HITL](https://github.com/openai/openai-agents-python/blob/main/docs/human_in_the_loop.md)、[runner](https://github.com/openai/openai-agents-python/blob/main/docs/running_agents.md) |

LangGraph 的 `sync` 在进入下一步前完成 checkpoint；`async` 有崩溃丢失窗口，`exit` 不保证途中崩溃恢复。SQLite 被官方定位为本地工作流/实验选项，不据此宣称多进程生产可靠性已成立。[持久模式](https://docs.langchain.com/oss/python/langgraph/checkpointers)

Pydantic AI Harness 另有 `StepPersistence`、本地 `SqliteStepStore` 与 tool-effect ledger；它保存消息快照和工具效果记录，不等于 Graph 节点恢复。官方明确将 graph-node resume 排除在该能力范围外。因此不能把上表读成“Pydantic 没有本地持久化”，也不能因存在 SQLite store 就推断整张流程图耐故障。[Step Persistence](https://pydantic.dev/docs/ai/harness/step-persistence/)

Temporal 仅作重量级对照：本地也需要 Temporal Service 与 worker；官方开发服务默认内存存储，不能拿默认启动成功证明重启耐久性。当前“优先无额外服务”使它暂不进入第一轮短名单，而非能力不足。[本地部署](https://docs.temporal.io/develop/python/set-up-your-local-python)

## 模型与现有 CLI 接入

三条 agent 路线均有自定义 OpenAI-compatible endpoint 接口：LangChain `ChatOpenAI(base_url=...)`、Pydantic `OpenAIProvider`、Agents SDK `AsyncOpenAI` + `OpenAIChatCompletionsModel`。这只证明接入机制存在。工具调用、JSON schema、流式和供应商额外 reasoning 字段仍需实测；LangChain 明确不保留任意第三方扩展字段。[LangChain](https://reference.langchain.com/python/langchain-openai/langchain_openai/chat_models/base/ChatOpenAI)、[Pydantic](https://pydantic.dev/docs/ai/models/openai/)、[Agents SDK](https://openai.github.io/openai-agents-python/models/)

架构推论：Python 编排可先调用既有 Python 函数和 Node CLI，不必改写全部工具；子进程退出码、结构化返回、超时、产物版本和重复执行责任仍由适配边界承担。本报告没有核查 Hermes 嵌入接口，不能据此承诺无缝接入或替换。

## 下一决策需要验证的未知项

1. 在指定发布版本中验证暂停、进程退出、重启恢复；文档随主线变化，尤其不要混用 Pydantic 旧 Graph 与 GraphBuilder API。
2. 在“外部写入已成功、checkpoint 尚未保存”处杀进程，验证业务幂等；框架 checkpoint 不能代替 `opportunities.db` 的事实权威或业务去重。
3. 确认绑定岗位、材料及政策版本；恢复前拒绝过期确认。框架工具审批没有证明这些领域约束已实现。
4. 两个岗位分别运行，一个失败另一个继续；验证 SQLite 锁与恢复互斥。核查点是实际 cron 并发方式，不是框架宣传的并行能力。
5. 用现有服务验证结构化输出、工具往返及超时，记录成本和可观察性；访问失败仍应是 Unknown。

这些是后续原型的验收输入，本轮没有实施原型或迁移。
