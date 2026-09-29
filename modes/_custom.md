# Custom Instructions -- career-ops

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.

     Put your own house rules, custom workflows, and automations
     here -- anything you want the agent to ALWAYS do (or never do).

     This is for PROCEDURAL rules ("HOW I want things done").
     For WHO you are (archetypes, narrative, comp, negotiation),
     use modes/_profile.md instead. Keeping the two separate keeps
     each one readable.

     The agent reads this file alongside the system instructions;
     your rules here take precedence over the defaults, as long as
     they don't break the Data Contract (your files are never
     touched, and we never auto-submit an application for you).

     Because this is a user-layer file, anything you write here
     survives `node update-system.mjs`. Put customizations HERE,
     not in CLAUDE.md / modes/_shared.md / other system files --
     those get overwritten on update.
     ============================================================ -->

## House Rules

<!-- Rules the agent should always follow. Examples:
     - Always write evaluation summaries in British English.
     - Never include a photo in my CV (US / ATS-first market).
     - Cap each batch run at 20 listings unless I say otherwise.
     - If a report scores below 6, skip the cover letter. -->

(none yet -- add yours above)

## Custom Workflows

<!-- Multi-step routines you run often, given a short name. Examples:
     - "weekly review": scan my saved portals, evaluate the new roles,
       then give me a one-paragraph summary of the top 3.
     - "prep <company>": pull the JD, generate STAR stories from
       article-digest.md, and draft 5 likely interview questions. -->

- For every scan, run enabled `search_queries` with `method: playwright_listing` before WebSearch. Use `browser-extract.mjs` against the configured live LinkedIn Jobs URLs, keep only `/jobs/view/` links, canonicalize and deduplicate across cities. Fall back to the Playwright MCP on the same URL if the CLI extractor fails; never silently treat browser failure as zero LinkedIn results.
- Keep LinkedIn mainland China and Hong Kong discovery as separate searches. Public search-engine `site:linkedin.com` queries are fallback-only because their index under-represents mainland listings.

## Workflow Authority

The user-facing flow is discovery → scan → score → action decision → selected-role
application preparation. `workflow.career_ops` owns task identity, business
transitions, and the JSON CLI; Hermes only schedules the scan and score scripts.
Node providers and guarded browser readers may collect evidence, but Python
makes the filtering, prescreen, score, action, and publication decisions.
`data/opportunities.db` is the business source of truth. LangGraph checkpoints
record progress and never replace committed business facts.

### Prescreen and JD handoff

LangGraph scan freezes the source capture, extracts the complete JD, and calls
`workflow.prescreen.evaluate` for deterministic Stage 0 decisions. Liveness is
checked separately. A verified hard mismatch produces an exclusion with its
reason and evidence; it does not produce a score or application package.
Incomplete core evidence waits for a new capture. Unknown nonterminal facts
remain Unknown and follow the JD report into the score checklist. A completed
scan JD report is the normal score input; a changed JD or candidate/rule input
requires explicit re-evaluation. A cache or historical report is reusable only
when its content and input fingerprints still match.

### Score and action queue

LangGraph score researches, assesses, and renders one opportunity at a time.
The current JD, candidate sources, profile, rules, and research are frozen for
each version. Python validates the full report and source citations before the
business commit. Failed or interrupted stages wait or resume without
publishing a partial result. The scheduled score run advances one opportunity;
unscored jobs precede stale-score reassessment, and a second failed attempt
waits for manual handling. One job's failure does not erase another result.

`workflow.career_ops scores` displays range, coverage, rank, and input
validity. `workflow.career_ops decisions` displays current scored opportunities
in apply/verify/deprioritize order, with stale results separate; verified hard
failures remain exclusion events rather than scored rows. The action view does
not initiate application work. The user selects one role
and starts apply explicitly; daily scan and score never start apply.

### Selected-role application preparation

LangGraph apply prepares the selected role's plan, materials, Reactive Resume
payload, and PDF, then waits for whole-package human review and confirmation.
It never mutates `cv.md` or the configured Reactive Resume mother resume and
never submits an application or sends an application message. An unchosen
scored role remains available.

Before rendering a role-specific CV, record its actual changes in the
application bundle's `cv/tailored/vNNN/changes.md`. Tailoring must make
truthful, evidence-backed choices in the experience section, not only change
the summary or keywords. If no material experience change is justified, state
that the base CV is the best available version and ask whether to use it
unchanged. Never label an unchanged CV as tailored. When a quantified or scope
claim lacks verification, offer to confirm, correct, mark narrative-only, or
record “I don't know”; never promote a guess to a verified fact.

## Output Preferences

### Scoring Rules — attractiveness-v1

2026-09-11 正式启用：主分数表达入职吸引力（工作方向、待遇、团队、公司是否令人满意），能力竞争力单列。所有新评估与重评由 LangGraph 生成不可变报告成果，并经确定性校验和业务提交成为正式评分。旧报告保留原始记录，显示为待重评；旧匹配分与吸引力分不可换算或混排。

本节是正式评分与格式契约，覆盖 `_shared.md`、`oferta.md`、batch 的整体判断、平均章节分和旧五维规则。历史报告仍属于原模型，不得标为 attractiveness-v1。

1. 冻结完整 JD、批准的候选来源和本规则，记录源路径与 SHA-256。历史报告只供审计，不能作为候选事实或完整 JD 的替代品。完整 JD 缺失则记录 incomplete，不生成评分报告；历史快照评估必须注明未复核当前有效性。scan 交接的 `location_evidence`、`employment_evidence` 和 `liveness_reason` 属于正式岗位来源证据；有官方地点时不得写成未披露，有浏览器快照时不得写成缺少页面快照。快照证明采集时的状态，申请前仍须重新核验。
2. 权重只读取 `config/profile.yml` 的 `attractiveness.weights`。四维为 direction（实际工作内容与职业方向）、compensation（相对所在地个人底线和目标的薪酬福利）、team（工时、管理、协作、自主权、工作安排）、company（业务前景、稳定性、技术投入）。能力缺口、资格门槛和真实性独立展示；同一负面事实只在一个吸引力维度计分。公司名气本身不加分；公司资料不等于团队资料；明确远程是 team 的正面依据，现场办公不扣分。
3. 先定档再加权：1=明显不符合偏好；2=明显不足、需要较大妥协；3=达到可接受水平；4=明显诱人、符合期待；5=非常理想且有充分证据。分项仅取整数；普通后端在可接受方向内，不能仅因非 AI 岗打低分。薪酬刚达到个人最低线为3分，达到明确个人目标支持4分，5分需要显著超出目标的证据；没有具体目标时不能自行补造。薪酬区间上限、OTE、股权或公司支付能力不能冒充保证底薪。
   direction 定档边界：5=JD 明确以首选 Agent/Applied AI 产品系统为主要工作，并明确承担从设计到交付或运营的职责；4=明确符合全栈/后端/AI 工程方向且有具体产品贡献，但首选 AI 产品职责并非主要工作或未明确；3=可接受的软件岗位，缺乏上述方向增益；2=明显偏离但仍有可迁移内容；1=主要工作不在可接受方向内。未声明行业偏好不扣分，也不阻止5分；候选人技能或年限不足单列竞争力，不改变工作内容本身的吸引力。team 评价实际管理与工作安排，不重复给 direction 的产品职责加分。
4. 证据不足以判定整个维度时 score=null，计算范围[1,5]；有部分正面线索可写在理由中，但不能凭想象缩窄范围。已知维度为[score,score]。总下限/上限分别为四维下限/上限的加权和，保留两位小数以便复算；coverage 为已知维度权重之和（0–1）。范围不是统计置信区间，中点不是估计分数。全部未知也不能跳过完整 JD 前置条件。
5. 高吸引力且条件充分核实的岗位优先申请；高潜力但未知项多的岗位优先补证。不得仅按区间下限排序；不得把旧4.0/4.5匹配分阈值搬到吸引力范围上。既有 Stage 0 门槛不变；评分完成不等于门槛通过；申请始终由用户选择启动。
6. 保持以下二级标题及顺序：`## A. 岗位概览`、`## B. 能力竞争力`、`## C. 入职吸引力`、`## D. 薪酬与需求`、`## E. 补证问题`、`## G. 岗位真实性`、`## Risk Summary`、`## Evaluation Checklist`、`## Machine Summary`。能力映射逐项列出 JD 的实质必备与加分要求，拆开复合要求，使用 Proven/Adjacent/Gap/Unverified，并列候选证据、招聘影响及应对；不得将原型、进行中或相邻经验提升为生产证明。正文不重复逐维 rationale，只给结论与关键数字；D 只保留 JD 报价与市场基准结论；G 限两三行；Risk 使用短表。Checklist 汇总地点、雇佣、规模、工时、待遇、真实性及未解决的能力问题。
7. Machine Summary 使用 `report_format: scoring-v2`、`scoring_model: attractiveness-v1`、`score: null`、`company`、`role`、`complete_jd: true`、`jd_source`（冻结 JD 的 source id）、`sources`、`dimensions`、`attractiveness`。sources 为 `{id, path, sha256}` 数组（路径相对仓库）；dimensions 的四个键各为 `{score, rationale, evidence: [{source, quote}]}`，引用须逐字来自冻结来源。未知项也须解释缺失信息；已知项必须有证据。attractiveness 为 `{lower, upper, coverage}`，只由确定性计算生成。报告正文必须使用相同范围，不展示一个旧式总分。
8. LangGraph 的报告阶段在业务提交前运行 Python 确定性校验：标题顺序、完整 JD、分项范围、权重、源哈希、引文及区间复算必须通过。真实验收样本另由人工检查证据是否支持判定、能力映射是否覆盖 JD；机械校验不能证明语义公允。重复盲评使用同一冻结材料，保留每次原始判定并报告差异，不能用重复计算代替重复评估。

### Report validation and decision gate

- LangGraph score 在业务提交前校验完整 JD、当前输入、来源状态、报告结构、引文、区间复算和报告哈希；失败则保留待修订任务，不发布。正式结果和来源保留为业务证据。机器校验不能证明语义公允，真实样本仍须人工质量抽查；日常评分不设独立模型审查或人工审批。
- 初筛门槛保留 location/employment/size/compensation/eligibility/liveness 的 Pass/Fail/Unknown。历史快照的当前有效性须重新核验，信息未知不能写成失败。
- 正式决策读取 profile 的 `attractiveness.acceptable_line`，这是吸引力可接受线，不是旧匹配分阈值。任意硬门槛Fail→discard；否则上限低于线→deprioritize；否则门槛有Unknown、申请条件未核实或下限低于线→verify；其余→apply。等于线视为达到。完整JD缺失不产生评分，不进入该评分队列。
- Agent 可基于多个独立、同向且无可信反向证据的强信号进行事实推理并定档，不必机械等待单一来源直接给出结论。报告理由写明事实、适用范围、推理链与反向证据；品牌页自填、搜索摘要或市场数据单独不足以判定硬门槛，但与注册时间、官网业务阶段、JD 明示阶段等独立信号一致时，可支持 `Fail` 或 `Pass`。无法排除关键反向解释时仍用 `Unknown`。
- `workflow.career_ops scores` 只读展示区间、覆盖率、排序及输入过期原因；无效或过期报告不得进入通知或申请准备。deadline 为已知 ISO 日期或 null，effort_days 为有依据的工作日或 null；无证据不填数。
- 先分apply/verify/deprioritize/discard；组内按已知截止日期较早、预计工作量较少、证据覆盖较高排列；仅apply组再按下限降序，其余以id稳定打破平局。缺失日期或工作量排在该字段已知项后。此顺序是透明的行动调度，不是假定未知机会不值得去；重叠区间不声称存在满意度的严格排序。
- 补充定档锚点用于定档校准：compensation的1/2分别是明显/轻微低于个人底线（均不能补偿硬门槛），3达到底线但未达目标，4达到明确目标，5有显著超出目标上沿的保证收入证据；无法区分相邻档时记录分歧，不能随意加小数。
- team：1有明确长期强制无补偿加班和差管理证据；2有明确需要较大妥协的工作安排；3同团队证据确认可接受工时、协作和管理；4在3基础上有明确弹性/自主权等正面实践；5在4基础上有实际远程选择、稳定可持续安排和团队证据支持。公司级福利宣传、hybrid单词或导师承诺不足以判定整个维度，保留Unknown。
- company：1有经营中断/资金无法持续的可靠证据；2有持续经营但明显收缩或资源不足证据；3业务持续、资源足以支撑岗位；4有可验证增长与持续技术投入；5在4基础上有强业务韧性与岗位所在业务的长期资源承诺。公司名气、单一增长数字不能独立确定整个维度；缺经营/团队业务投入关键证据时Unknown。
- 校准分别记录合成场景测试与真实证据测试。合成场景只能检验规则能否一致执行，不能证明真实招聘信息充分或实际满意度。新样本留出评估不能先给评估者参考答案；保留分歧，未校准边界列为上线前限制。

<!-- How you like results formatted. Examples:
     - Reports: lead with the score and the one-line verdict.
     - Show the per-step token breakdown after a batch run.
     - Save PDFs date-first: YYYY-MM-DD-company.pdf -->

(none yet -- add yours above)

## Off-Limits

<!-- Things the agent must never do for you. Examples:
     - Never auto-fill or submit an application without showing me first.
     - Never edit a system file to customize my setup -- put it here. -->

(none yet -- add yours above)

### Scoring Rules — 正式联网研究（research-required-v1）

状态：2026-09-11 用户批准正式启用并试运行。LangGraph score 的所有新建或主动重评岗位报告必须执行本节，定时评分同样适用。只扫描、只展示已有评分和历史报告不触发重评。统一使用上述 attractiveness-v1 区间评分与行动规则。

本节覆盖 oferta 中“JD 未披露工资就压缩 D 并跳过研究/提问”的规则。沿用每岗位最多 5 次搜索、主评估者单轮研究；批量执行时把本节随 `_custom.md` 传给每个评分者。

- 打分前主动搜索待遇、团队和公司三维，不能因为 JD 没写就停止。先识别品牌、法律实体、招聘代理与实际雇主，再按公司+城市+职级查薪酬，按团队+地点查工时/管理/远程实践，按实际业务查经营、资金与技术投入。优先官方招聘、财报/公告、薪酬机构原始数据；员工反馈注明日期、地区、团队与自述性质，多个转载不算独立印证。预留至少一次查询给每个维度，可共用查询；访问失败记录失败，不能当作无风险或零结果。
- 综合评估允许外部证据支持分项，不要求全部来自 JD 或 offer。需要写清“事实→适用范围→推断→档位”：同公司同城同职级工资可帮助判断，但市场工资不能冒充岗位工资，保证底薪门槛仍需可对应本岗位的证据；公司级文化只能作线索，同团队的可核查实践可支持 team；财报、经营和投入证据可支持 company。过时、矛盾或身份不匹配的证据单列，无法定档才保留 Unknown。没搜到负面不是正面证据；没有薪资报价也不删除市场分析。
- 冻结短摘录及研究日志，不复制整页。新报告 sources 必须含 research（JSON）和本版 rules，校验器由规则标记强制检查研究记录；历史报告保留原版本，重评时必须采用当前规则。JSON含 searched_at、实际 queries（最多5条）、dimensions 的 compensation/team/company（queries为查询下标，conclusion、next_step），findings含唯一id、url、entity、scope（role/team/company/adjacent_role/market/unresolved）、status（retrieved/search_only/failed/excluded）、published_at（未知null）、limitation，以及 retrieved 才有的 source/quote（其他状态均null）。来源文件继续通过 SHA-256 校验。
- C 的理由纳入研究结论；D 保留 JD 报价与市场基准的区别；E 写剩余问题；Checklist 更新门槛证据。搜索结果摘要不能作为已读取正文；其他职位的远程政策不能直接转移；匿名客户不能借代理的工资/人数/口碑评分。报告理由须核对来源实体、时间、地区/职级/团队适用性及冲突处理，不能只验证引文存在。浏览器有效性核验仍单独执行。
- 正式报告交付条件：在 E 中保留“外部研究记录”，列出研究日期、实际查询，以及待遇/团队/公司各自的来源链接、短摘录、来源日期（未知写未知）、适用范围、结论和下一步；来源摘录随报告冻结保存。Evaluation Checklist 增加“联网研究：完成/受阻”及记录链接。三维均执行查询并说明结论才算完成；没有结果可算搜索完成，但不能把未知项判为通过。搜索工具不可用时标受阻，报告作为待完善草稿，保留原队列状态，不能宣称完整评分已完成。正常搜索后仍缺岗位资料则保留 Unknown 和补证问题，可按既有流程交付。
- 发布前完成确定性报告与来源校验；不合格或过期则保留待完善任务，不发布正式评分。展示统一为 `吸引力 L–U/5（覆盖率P%）`，行动依据当前门槛证据和 profile 判断；不再使用单分平均或旧 4.0/4.5 阈值。

### Scored 发布与重评

- 完整 JD、确定性校验和业务提交均通过后，SQLite 才保存正式评分与报告；保留机会 ID、URL、城市、报告成果路径和哈希。apply 表示建议用户启动申请准备，verify 表示优先补证，deprioritize 表示暂缓，discard 表示已核实硬门槛失败。它们不是投递状态，也不自动提交。
- 评分任务先处理未评分岗位，明确重评时使用当前候选资料、规则和 JD；取得完整 JD 并核验有效性。Hermes 定时评分每次只领取一岗，使用下节的预算与重试规则。新版本通过前保留旧报告。禁止把旧数值按比例变成新分数。
- 只读查询展示范围、覆盖率和缺失信息；旧报告待重评、校验失败报告单列，不触发搜索或重评。能力差距分析不使用吸引力作为技能权重。


### Hermes 定时评分

- 固定 score cron 每二十分钟触发一次，使用 `scripts/career-ops-score.sh` 调用 Python `cron-score`，每次只推进一个岗位。单次任务预算900秒，870秒后不再启动新阶段；硬截止终止模型子进程树，调度间隔不能代替互斥。
- `data/opportunities.db` 是机会与任务的权威队列；任务行记录尝试次数、模型调用与耗时。首次失败排在未尝试岗位后，第二次失败留待人工处理，不再自动重试。手动处理或候选资料/规则更新后可重评。
- scan 在筛选、去重后保留来源抓取证据；失败保留原因，不能写 complete_jd=true。score 使用 scan 正式交接的完整 JD 和来源有效性证据；历史快照不代表岗位此刻仍开放，申请前重新核验。
- 任务锁防止同一岗位并发执行；SQLite 短事务维护业务归属，网络和模型调用不占用业务事务。
- 初始上下文由程序组装：当前评分规则、候选主来源、本岗位 JD 与冻结研究。定时任务不预载全功能 skill、上轮自然语言输出或全池报告。
- 预筛中明确未知的相关年限保留待确认并继续评分；不能把“尚未证明满足年限”写成零年并淘汰。
- 模型提供事实和判断；Python/LangGraph 负责来源冻结、结构化校验、哈希、区间复算、报告及业务发布。同一输入仅发布一次；证据或报告不合格则修订或等待，不越过确定性门禁。
- 研究与评分分别保存检查点；研究最多五次查询，正文只读取一批、最多三个页面，每页最多4000字符；冻结实际返回的正文摘录，同一URL只保存一份，供评分与复核核对上下文。读取失败保留原因和Unknown，不追加浏览循环。评分只接收冻结研究，不重放搜索过程。
- 检查点绑定输入和产物哈希；候选事实、评分规则或 JD 变化使受影响阶段失效。来源有效性不足则等待补证；每岗通过确定性校验后立即发布，历史报告保留原格式和原始证据。
- 单次发布率、超时率、尝试次数和累计耗时分别记录；恢复运行的耗时不得称为从头完成的耗时。CV详细改写和面试准备在用户选岗后执行。
