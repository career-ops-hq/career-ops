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

`workflow.career_ops scores` displays dimension scores and input
validity. `workflow.career_ops decisions` displays current scored opportunities
in focus/deprioritize order, with stale results separate; verified hard
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

### Scoring Rules — attractiveness-v3

入职吸引力只记录 direction（工作内容与职业方向）、compensation（相对个人底线和目标的薪酬福利）、company（经营、技术投入与公司级工作文化）三个维度的整数分数或 Unknown，不计算权重、总分、范围或覆盖率。能力竞争力、资格门槛和岗位真实性单列；同一事实不要重复扣分。

1. 冻结完整且采集时有效的 JD、CV、profile、targeting、规则及联网研究，记录来源路径与 SHA-256。完整 JD 缺失时等待补证，不生成评分报告；历史快照不证明当前仍开放，申请前复核。
2. 分项标准：1=明显不符合偏好；2=明显不足、需要较大妥协；3=达到可接受水平；4=明显诱人、符合期待；5=非常理想且有充分证据。证据不足以判定整个维度时用 null，解释未知与补证方式。薪酬刚达到个人最低线为3分，达到明确目标支持4分，显著超出目标的保证收入才支持5分；OTE、股权与公司支付能力不能冒充保证底薪。
3. direction 的5分须有 JD 明确的首选 Agent/Applied AI 产品系统主责及设计到交付或运营责任；4分须有明确的全栈、后端或 AI 工程方向及具体产品贡献；3分为可接受的软件岗位。候选技能缺口单列，不改变岗位工作内容本身的吸引力。
4. company 综合经营稳定性、技术投入与公司级工作制度和文化。主动搜索公司级工时、周末工作、加班补偿、管理与协作；官方口径缺失时搜索论坛等员工反馈，标注时间、地区与自述性质，不能把单条匿名反馈当成已证实的全公司制度。无法判定则 Unknown。
5. 完整报告保持 A. 岗位概览、B. 能力竞争力、C. 入职吸引力、D. 薪酬与需求、E. 补证问题、G. 岗位真实性、Risk Summary、Evaluation Checklist、Machine Summary 的二级标题及顺序。C 只列三个维度及各自分数或 Unknown。能力映射按 JD 要求列 Proven/Adjacent/Gap/Unverified 与候选证据，不把原型或相邻经验写成生产证明。
6. Machine Summary 使用 report_format: scoring-v2、scoring_model: attractiveness-v3、岗位身份、完整 JD 标记、冻结 sources 与三个 dimensions。各维为 {score, rationale, evidence: [{source, quote}]}；已知分数必须有可核对的冻结引文。不要写总分或 attractiveness 汇总对象。
7. 发布前确定性校验当前输入、标题、维度、分数范围、来源哈希、引文、报告哈希；失败则保留待修订任务。机械校验不能证明语义公允，真实样本仍需核对证据适用性。
8. “值得关注”要求至少两个维度有分，且所有已打分维度均不低于4。已确认的硬门槛失败直接 discard；其他岗位按该规则进入 focus 或 deprioritize。分组内按已知截止日期、预计工作量及机会 ID 排序，不合成总分。未知初筛证据仍须补证；申请由用户选择启动。

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

### Scoring Rules — 正式联网研究

新评分和主动重评继续执行每岗位最多五次搜索；查询 compensation 与 company，并在 company 中调查公司级工时、周末工作、加班补偿和企业文化。官方来源用于核对职位和经营事实；公司工作制度难从官方口径查到时，主动查询论坛和员工反馈。记录来源实体、日期、地区、岗位适用性、冲突及访问失败；搜索摘要不能当作已读取正文，未找到负面材料也不是正面证据。

冻结 research JSON：searched_at、实际 queries、dimensions 中的 compensation/company 结论与下一步，以及 findings 的 URL、实体、范围、访问状态、日期、局限与可引用摘录。检索完成但证据不足时保留 Unknown 和补证问题。报告及来源通过校验后才发布；旧报告保留原格式。

### Scored 发布与重评

完整 JD、校验和业务提交通过后，SQLite 保存三个维度分数、报告路径及哈希。当前输入改变时重新评估；旧报告作为历史证据保留，不能把旧总分换算成新维度分。scores 展示分项与过期原因，decisions 使用上述“值得关注”规则，通知也使用同一规则。申请始终由用户选择，不自动提交。

### Hermes 定时评分

- 固定 score cron 每二十分钟触发一次，使用 `scripts/career-ops-score.sh` 调用 Python `cron-score`，每次只推进一个岗位。单次任务预算900秒，870秒后不再启动新阶段；硬截止终止模型子进程树，调度间隔不能代替互斥。
- `data/opportunities.db` 是机会与任务的权威队列；任务行记录尝试次数、模型调用与耗时。首次失败排在未尝试岗位后，第二次失败留待人工处理，不再自动重试。手动处理或候选资料/规则更新后可重评。
- scan 在筛选、去重后保留来源抓取证据；失败保留原因，不能写 complete_jd=true。score 使用 scan 正式交接的完整 JD 和来源有效性证据；历史快照不代表岗位此刻仍开放，申请前重新核验。
- 任务锁防止同一岗位并发执行；SQLite 短事务维护业务归属，网络和模型调用不占用业务事务。
- 初始上下文由程序组装：当前评分规则、候选主来源、本岗位 JD 与冻结研究。定时任务不预载全功能 skill、上轮自然语言输出或全池报告。
- 预筛中明确未知的相关年限保留待确认并继续评分；不能把“尚未证明满足年限”写成零年并淘汰。
- 模型提供事实和判断；Python/LangGraph 负责来源冻结、结构化校验、哈希、报告及业务发布。同一输入仅发布一次；证据或报告不合格则修订或等待，不越过确定性门禁。
- 研究与评分分别保存检查点；研究最多五次查询，正文只读取一批、最多三个页面，每页最多4000字符；冻结实际返回的正文摘录，同一URL只保存一份，供评分与复核核对上下文。读取失败保留原因和Unknown，不追加浏览循环。评分只接收冻结研究，不重放搜索过程。
- 检查点绑定输入和产物哈希；候选事实、评分规则或 JD 变化使受影响阶段失效。来源有效性不足则等待补证；每岗通过确定性校验后立即发布，历史报告保留原格式和原始证据。
- 单次发布率、超时率、尝试次数和累计耗时分别记录；恢复运行的耗时不得称为从头完成的耗时。CV详细改写和面试准备在用户选岗后执行。
