# Mode: interview/debrief — 面试后复盘

真实面试结束后，记录问了什么，评估哪些答到位、哪些没有，在下一轮前补齐短板，并更新题库。

---

## When to Run This Skill

- 真实面试刚结束（记忆还新鲜时）
- 招聘电话挖出了流程相关的新信息之后
- 候选人得知下一轮形式与面试官时

---

## Inputs

1. **候选人的面试复盘** — 问了哪些题、怎么答的、感觉哪里强/弱
2. **面试官姓名与角色** — 用于预测下一轮
3. **本轮结果**（如已知）— moved forward / rejected / pending
4. **下一轮细节**（如已知）— 形式、面试官、时间线
5. **题库**，位于 `interview-prep/question-bank.md` — 用真实数据更新
6. **故事库**，位于 `interview-prep/story-bank.md` — 若挖出新故事则追加
7. **简历**，位于 `cv.md` + `article-digest.md`（如存在）— 把建议答案锚定在真实经历上
8. **已撤回主张**，位于 `interview-prep/retracted-claims.md`（如存在）— 硬门禁；即使候选人在面试里说了，也绝不把已撤回主张写进建议答案
9. **岗位专属准备文件** — 追加复盘笔记

---

## Step 1 — Capture What Was Asked

请候选人按记忆列出每一道题，尽量按顺序。不要给选项提示——先让他们自由回忆。

对每道已捕获的题：
- 他们说了什么？
- 面试官反应如何（正向信号、中性、顶回来、很快跳过）？
- 他们感觉自信还是不确定？

若记忆不完整，用定向追问：
- "有没有哪题让你措手不及？"
- "有没有哪题你事后希望换一种答法？"
- "面试官有没有追问什么——那通常意味着他们想听更多？"

---

## Step 2 — Honest Assessment Per Question

对每道题产出：

```markdown
**Q: [question]**
- What was said: [summary of their answer]
- What landed: [what was good — be specific]
- What was missing: [gap — precise technical term, missing result, no reflection, etc.]
- Correct/complete answer: [what the full answer should include]
- Status: ✅ Strong / 🟡 Solid / 🔴 Gap
```

要直接。若错过了该题考察的核心概念，就说出来。若回答确实很强，也要说。复盘是最有价值的学习时刻——含糊其辞等于浪费。

---

## Step 3 — Update Question Bank

对每道已复盘的题，更新 `interview-prep/question-bank.md`：
- 按真实表现把状态改为 ✅ / 🟡 / 🔴
- 从复盘加入短板笔记
- 加入题库里还没有、但本轮出现的新题

若题库不存在，用本轮面试的题目作为种子创建它。

---

## Step 4 — Close the Gaps

对每个识别出的 🔴 短板：

1. **讲清正确答案** — 清晰、简洁；有帮助时配上可操作示例（代码、计算、图示）
2. **尽量连到真实故事** — "你其实在 [故事库里已有故事] 里有这个——可以这样用"
3. **写入岗位专属准备文件**，放在 "Gaps to Close Before Round N" 小节下
4. **写入 `interview-prep/interview-prep-guide.md`**（若候选人维护该文件）——当它是可复用、超出本岗位的原则时

---

## Step 5 — Extract New Stories

真实面试有时会挖出候选人尚未准备好的故事。若候选人描述了一段尚未形式化的经历：

> "你在回答里提到了 [X]——这听起来可以做成一条正式的 STAR+R 故事。趁还新鲜，要不要现在一起拆出来？"

若同意，按 STAR+R（Situation, Task, Action, Result, Reflection）拆好，并追加到 `interview-prep/story-bank.md`。

---

## Step 6 — Next Round Intelligence

若候选人已知下一轮形式：

1. **预测可能的问题**，依据：
   - 下一位面试官的角色（例如资深 practitioner → 核心技能深度、设计；跨职能同伴 → 协作、领域边界；高管 → 战略、业务影响）
   - 本轮已覆盖内容（下一轮通常更深，而不是更广）
   - 本轮面试官显得最感兴趣的点

   每条预测都标 `[inferred]` — 绝不把预测题说成来自真实候选人或内部人士。

2. **为下一轮准备建优先级清单** — 按短板严重程度与被考到的可能性排序

3. **建议运行** `interview/plan`，带上下一轮细节，生成完整准备计划

---

## Step 7 — Probability Assessment (Optional)

若候选人要求对机会做诚实判断：

基于以下评估：
- 短板数量与严重程度（基本功上的 🔴 风险高于进阶题上的 🔴）
- 面试官信号（给出具体下一轮细节 = 正向；含糊 = 中性；通话很短 = 风险）
- 岗位匹配（年限、领域、地点）
- 差异化点（候选人说了大多数人不会说的东西）

要诚实。带清晰理由的概率区间，比虚假自信更有用。

---

## Step 8 — Save Debrief

追加到 `interview-prep/{company-slug}-{role-slug}.md`：

```markdown
## Round [N] Debrief — [YYYY-MM-DD]

**Interviewer:** [姓名, 角色]
**Round type:** [screening / technical / design-case-study / behavioral]
**Outcome:** [pending / moved forward / rejected]

### Questions Asked
[题目列表]

### Gaps Identified
[短板列表，附正确答案]

### Next Round
**Format:** [如已知]
**Interviewers:** [如已知]
**Priority prep:** [下一轮前优先补齐的 top 3 主题]

### Process Intel (recruiter / HM screens — omit if not applicable)
**Comp discussed:** [是 / 否 — 若是，说了什么、锚定在什么]
**Timeline:** [提到的任何日期或截止日期]
**Other candidates:** [若有披露]
**Next steps:** [面试官说的下一步是什么、何时完成]
```

**若本轮口头报出了薪酬数字**（候选人给了具体数字，而不只是"提到了薪酬"），且本轮对应的 tracker# **已知**：向 `data/salary-observations.tsv` 追加一行 `stated`（文件不存在则创建；格式见 `docs/SCRIPTS.md` → salary-gap），写入该 tracker#、本轮日期、金额/币种、来源 `user`、简短备注、轮次标签与面试官姓名。这能让 `interview/plan` 在下一轮前提醒候选人——见该模式 Inputs #9。若 tracker# 尚不可用，**跳过追加**——不要写入不完整或可能错绑的行；等 tracker# 明确后再补记。

---

## Step 9 — Write Session Transcript

复盘之后，再把机器可读的场次记录写到 `interview-prep/sessions/{company-slug}-{role-slug}-{round}-{YYYY-MM-DD}.md`。这是给下游分析模式用的结构化记录；带说话人标签的回合让消费者不必再推断谁在说。完整约定见 `interview-prep/sessions/README.md`。

格式：

```markdown
---
company: [company]
role: [role]
round: [screen | hiring-manager | technical | system-design | behavioral | onsite | final]
date: YYYY-MM-DD
interviewer_role: [role, if known]
source: debrief
---

## Q1
**Interviewer:** [question as asked]
<!-- competency: tag[, tag...] -->
**Candidate:** [answer as delivered / reconstructed in this debrief]

## Q2
...
```

记录规则：

- **把轮次类型映射到上面的 enum**（例如 recruiter screen → `screen`，HM screen → `hiring-manager`，technical deep-dive → `technical`，design/case-study → `system-design`）。
- **给每次作答打标签。** 在每行 `**Candidate:**` 正上方输出 `<!-- competency: tag[, tag...] -->` — lowercase-kebab-case，多能力用逗号分隔（例如 `system-design`、`people-leadership`、`incident-response`）。你在 Step 2 已评估过每次作答，按那次评估打标签，而不是重读。标签是自由形式；选该题实际考察的能力。
- **忠实重建候选人回合。** 用候选人在 Step 1 报告说过的内容，而不是理想化答案。Step 2 的"correct/complete answer"属于复盘文件，绝不要进记录——记录记的是发生了什么。
- **`source: debrief`。**
- 场次文件落在 gitignore 目录（真实姓名/公司永不进版本库）；写入时不要脱敏。

---

## Rules

- **立刻复盘。** 面试细节遗忘很快——几小时内，具体题目与反应就会忘掉。当天就跑这个 skill。
- **不要淡化短板。** 出于善意把 🔴 叫成 🟡，下一轮还会再撞上。
- **绝不把编造的主张塞进候选人口中。** Correct/complete answers 可以借用通用领域知识，但任何个人主张或指标必须来自候选人说过的内容、`cv.md`、`article-digest.md` 或故事库。
- **已撤回主张是硬门禁。** 若某主张出现在 `interview-prep/retracted-claims.md`，即使候选人在真实面试里说了，也绝不建议再用——改为标出："该主张在你的撤回清单里——压力下撑不住。这里有一个不依赖它的版本。"
- **记录新的撤回。** 若复盘发现候选人在真实面试用过、现在也同意撑不住的主张，提议追加到 `interview-prep/retracted-claims.md`：`**"[claim]"** ([context]). Reason: [one-line reason + correct framing if applicable].`
- **明确抽出词汇缺口。** 若候选人用了不精确术语而精确术语存在，把它加到 `interview-prep/interview-prep-guide.md` 的词汇小节（若候选人维护该文件）。
- **一个短板 = 一个修复。** 不要为每个短板塞一整套学习计划。优先下一轮最可能被考到的 1–2 个。
- **也要点名答得好的地方。** 复盘不只是找短板。说出哪些强——能强化正确行为，并为下一轮建立信心。
