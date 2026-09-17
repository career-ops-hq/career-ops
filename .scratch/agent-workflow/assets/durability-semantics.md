# Agent workflow 持久化与副作用边界研究

研究日期：2026-09-17。用于决策票「框架恢复机制能保证什么，哪些副作用仍需业务层保护？」；这是研究结论，不是框架选型或实施决定。未运行生产任务、调用模型或修改业务数据。

## 结论

框架保存的执行进度、业务数据库中的发布事实、外部系统中的副作用是三个不同边界。任何候选的 checkpoint 都不能直接证明外部写入 exactly-once。当前 SQLite 发布事务已经覆盖评分、artifact 索引、发布事件和业务 publish checkpoint；迁移不能把它拆成独立节点写入。

## 已核实的候选语义

| 候选 | 可恢复对象与重放 | 人工暂停 | 尚需业务层承担 |
| --- | --- | --- | --- |
| LangGraph | 按 thread 的 super-step checkpoint；并行步骤中已持久化的成功节点输出可避免重跑。`sync` 在下一步前保存，`async` 有崩溃丢进度窗口，`exit` 不提供中途进程崩溃恢复。SQLite saver 可本地运行。[Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers) | `interrupt` 配合持久化 saver；恢复时从中断节点开头重跑，interrupt 前代码也重跑。[Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) | 岗位认领、业务写入幂等、材料版本校验；不能从 thread ID 推导业务互斥。 |
| Pydantic AI / Graph | 须区分仍受支持、可互操作的原始 `BaseNode` Graph API 与 `GraphBuilder`：原始 API 有 persistence；Builder 当前没有内建持久化与恢复，不应把其状态对象等同跨进程恢复。另有 Harness `StepPersistence`，可用 SQLite 保存消息快照及工具效果账本；这不同于整个 Builder 图的持久调度。[Builder persistence](https://pydantic.dev/docs/ai/graph/builder/#persistence-and-resumability)、[Step Persistence](https://pydantic.dev/docs/ai/harness/step-persistence/) | Deferred tools 用原消息历史与按 call ID 对应的批准/结果继续运行；这些数据如何持久保存仍由选定运行方式决定。[Deferred Tools](https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/) | 必须先确定采用 Graph、Harness snapshots 还是 durable engine integration，不能笼统说 Pydantic 有或没有 durable workflow。 |
| OpenAI Agents SDK | Sessions 保存会话历史；RunState 可序列化暂停运行。二者不能混为通用任意崩溃点自动 checkpoint。恢复的特定 Session append 失败场景能保存 pending batch，但官方要求同 Session 独占访问，不能并发恢复独立快照。[Sessions](https://openai.github.io/openai-agents-python/sessions/)、[RunState](https://openai.github.io/openai-agents-python/ref/run_state/) | RunState 持久化 pending approvals 后跨进程恢复；批准默认按 call ID，`always_approve` 可在同一 run 持续生效。[HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/) | 外层生命周期调度、并发岗位认领、业务版本与幂等。 |

Pydantic 的当前官方 durable execution 集成包括 Temporal、DBOS、Prefect、Restate、AWS Lambda 等；其执行与部署保证须分别评估，不能把某个后端的能力归给裸 Graph。[Durable Execution](https://pydantic.dev/docs/ai/capabilities/durable_execution/overview/)

Pydantic Harness 特别把工具 `started` 后没有终态的情况标为 `unknown_after_crash`：工具副作用可能已发生。其完整快照与 interrupted 快照区分，只能证明可读取相应记录，不能解决第三方副作用提交的不确定性。[Step Persistence](https://pydantic.dev/docs/ai/harness/step-persistence/)

## 当前仓库的真实边界

只读检查 canonical checkout `/Users/oii/dev/career-ops`，HEAD `c3963e5240856f5dbd9d4bf8c01d83c2aa081f51`。runner 是已有未提交修改的快照，SHA-256 `c6e5e25c2689fe02d3e0b1012185311893cd82ab6820a7aace02b2792f8baaa9`；研究分支没有携带其修改。以下是源码事实，未做故障注入验证。

- [runner checkpoint](/Users/oii/dev/career-ops/scripts/hermes-score.py:323)：输入哈希匹配且输出哈希未变才复用；先写 phase output，再写 checkpoint。worker 对不完整、非 active 或超过 1800 秒的 evidence 清 checkpoint；阶段输入还包含日期、证据、来源或提示词。框架恢复不应取消这些业务有效性规则。
- [发布入口](/Users/oii/dev/career-ops/score-job.mjs:185)：先比较候选来源/规则 fingerprint，验证 report 和独立 review、检查 liveness；写报告及 review 文件，再调用 store.publish，最后写本地 state.json。
- [发布事务](/Users/oii/dev/career-ops/src/opportunities/store.mjs:318)：`BEGIN IMMEDIATE` 内要求 `evaluating`，写 eligibility、evaluation、artifact、publish checkpoint 和事件，并变为 `evaluated` 后 COMMIT。
- [认领与恢复](/Users/oii/dev/career-ops/src/opportunities/store.mjs:150)：claim 使用状态条件 UPDATE，claimNext 有事务；resume 按 worker 查 evaluating 且 attempts < 2，再更新 attempts。这不是具有到期时间和 fencing token 的完整租约协议。不能把同 worker 并发恢复的安全性当已验证事实。

## 两个关键故障场景

### 发布成功，执行 checkpoint 尚未保存

当前代码中“业务 publish checkpoint 与 DB 发布分离”这一假设不成立：它们在同一个 SQLite 事务。真正窗口是 DB COMMIT 成功后，state.json 尚未写入，或未来框架 checkpoint 尚未保存。重放 publish 会因 `requireState(evaluating)` 不满足而报错；这避免再次写评分，但不等于顺利恢复完成。

推论：未来需要在发布边界识别“同岗位、同输入与报告哈希已提交”，从权威 DB 重建成功结果，或明确转人工核对；不同哈希不得当成同一成功。至于如何表达该幂等契约，留给决策票，研究不替实现定案。

另一窗口是报告文件已写而 DB 事务未提交：会留下无数据库引用的文件。内容寻址文件名有助核对，但不构成跨文件系统和 SQLite 原子事务。已提交的 artifact 指针还需要能验证文件确实存在且哈希正确。

对于真正外部写入，发送成功而确认记录未保存时，框架重试无法判断是否已生效；要有接收端幂等键或可核对结果，否则维持 Unknown 并停止自动重复副作用。此为跨边界推论，不声称任何候选提供 exactly-once。

### 旧确认对应的材料已经变化

LangGraph 的 resume payload、Pydantic 的工具 call ID、Agents SDK 的 per-call approval 都只是运行机制；没有一个会自动理解本项目“岗位 + JD/证据 + CV/规则 + 材料版本”的批准对象。

推论：确认需引用不可变版本标识，执行受控动作前重新比较当前对象；若相关材料变更，暂停并收集新确认，不能只看 `approved=true`。Agents SDK 的 `always_approve` 不适合直接表达本地图要求的逐岗位逐版本确认。何种变化必须失效、确认保存在业务 DB 还是单独审计记录，仍是待决策项。

## 输入、代码升级与并发

- 输入有效性是业务语义：旧 checkpoint 可以恢复不等于旧 JD 仍存活、旧规则仍适用；访问失败必须保持 Unknown。后者来自地图约束，不是框架默认行为。
- Agents SDK 官方建议长期待处理状态同时记录 agent/SDK 版本，按匹配代码反序列化。[HITL versioning](https://openai.github.io/openai-agents-python/human_in_the_loop/)
- 对所有候选，待决策的是恢复旧版本、显式迁移、还是安全拒绝并重开；不能把“能反序列化”当“结果仍有效”。当前研究未证明任一框架能自动完成此项目的业务升级兼容。
- 框架图内并行不是队列 claim；DB 的岗位唯一性、运行所有者与并发恢复策略仍需明确。即使 saver 自身写入串行化，也不证明两个 worker 不会同时执行节点副作用。

## 给下一张决策/原型票的证伪条件

仅在隔离临时数据库和 fake model/tool 中检验，不触生产数据、申请提交或真实消息发送：

1. 在报告写完、DB COMMIT 前，以及 COMMIT 后、框架 checkpoint 前分别杀进程；重启应得到可解释状态，不重复 evaluation/event，也不能把已提交成功报告成永久失败。
2. 工具副作用完成后、工具结果持久化前杀进程；若不能凭业务幂等键核对，必须明确 Unknown，不能盲重试。
3. 暂停后退出进程，隔日恢复；批准相同版本才继续，换 JD/CV/材料后旧确认无效。
4. 两个进程同时认领/恢复同岗位；最多一个有效发布，不同岗位失败互不阻塞。确认恢复是否需要宿主锁而不是猜测 saver 已包办。
5. 更改阶段输入、输出文件、规则或运行版本；过期结果被拒绝或按明示策略重算，不静默沿用。

本研究只确认文档机制与源码边界；未安装或锁定候选 SDK，也未执行上述原型，所以本地兼容性、恢复正确性和最终选型均未验证。
