# モード: kyujin -- 完全評価 A-G

候補者が求人（テキストまたは URL）を貼り付けたら、必ず 7 ブロック（A-F の評価 + G の legitimacy）を出力する：

## Liveness gate (URL inputs)

候補者が **URL**（JD テキストではなく）を貼り付けた場合、評価を始める前に求人がまだ live であることを確認する。Dead link は Block A に進めない。404 / expired page に対して A-G 評価、report、PDF を作るのは無駄。

1. ページ内容を取得する。`auto-pipeline` から来た場合（Step 0.5 がすでに navigate し、link を確認済み）、その snapshot を再利用する。直接 URL が渡された場合は Playwright（`browser_navigate` + `browser_snapshot`）で navigate し、title、URL、visible content を読む。
2. 投稿を分類する：
   - **active posting evidence:** title/role + 実際の job description または application/apply path
   - **closed posting evidence:** expired/closed/"no longer accepting applications"、JD がなく nav/footer だけ、generic careers/search page への hard redirect、404/410
3. 投稿が closed に見える場合は、**Block A の前で stop**：候補者に link が dead であると伝える。entry が `data/pipeline.md` 由来なら、`- [x] ~~Company | Role~~ -- 求人非アクティブ` として mark する。評価、report、CV は生成しない。
4. 候補者が JD テキストだけを貼った場合（URL なし）、liveness は確認できない。その limitation を note して進む。確認する link がないため。

この gate が解決するまで Block A に進まない。ここで取得した snapshot は Block G の freshness signals に再利用する。

## Step 0 -- Archetype Detection

求人を 6 つの archetype のいずれかに分類する（`_shared.md` 参照）。Hybrid の場合は最も近い 2 つを示す。これにより以下が決まる：
- Block B でどの proof points を優先するか
- Block E で summary をどう書き換えるか
- Block F でどの STAR stories を準備するか

## Block A -- Role Summary

Table with:
- Archetype detected
- Domain (platform/agentic/LLMOps/ML/enterprise)
- Function (build/consult/manage/deploy)
- Seniority
- Remote (full/hybrid/onsite)
- Team size (if mentioned)
- TL;DR in 1 sentence

## Block B -- Match with CV

`cv.md` を読む。JD の各 requirement を CV の exact lines に mapping した table を作る。

**Adapted to the archetype:**
- If FDE → delivery speed と client-facing proof points を優先
- If SA → system design と integrations を優先
- If PM → product discovery と metrics を優先
- If LLMOps → evals、observability、pipelines を優先
- If Agentic → multi-agent、HITL、orchestration を優先
- If Transformation → change management、adoption、scaling を優先

**Gaps** section with mitigation strategy for each. 各 gap について：
1. Hard blocker か nice-to-have か
2. 候補者は adjacent experience を示せるか
3. Portfolio project がこの gap を cover しているか
4. Concrete mitigation plan（cover letter 用 phrase、quick project など）

## Block C -- Level and Strategy

1. **Level detected** in the JD vs **candidate's natural level for that archetype**
2. **"Sell senior without lying" plan**: archetype に適応した specific phrases、highlight すべき concrete achievements、founder experience を advantage として position する方法
3. **"If they downlevel me" plan**: compensation が fair なら受け入れる、6-month review を交渉する、clear promotion criteria を求める

## Block D -- Comp and Demand

WebSearch を使って調べる：
- その role の current salaries（OpenWork、ビズリーチ、Glassdoor、Levels.fyi、Blind）
- Company の compensation reputation
- その role の demand trend

Data と cited sources 付きの table を作る。Data がない場合は、捏造せずその旨を書く。

**日本市場 -- 必須チェック：**
- 正社員か業務委託か。正社員なら賞与、有給、社会保険、通勤・住宅手当、退職金を比較に含める
- 業務委託なら月額と正社員換算を計算する
- 賞与の記載はあるか。月給何ヶ月分か
- ストックオプションはあるか。vesting、cliff、税制を評価する
- 年俸制か。賞与が含まれるか別か
- みなし残業はあるか。何時間分含まれ、超過分は支払われるか
- 住宅・通勤手当はあるか。月額はいくらか
- 健康保険・厚生年金は標準か手厚いか

## Block E -- Customization Plan

| # | Section | Current status | Proposed change | Why |
|---|---------|---------------|------------------|-----|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 changes to CV + Top 5 changes to LinkedIn to maximize match.

## Block F -- Interview Plan

JD requirements に mapping した 6-10 STAR+R stories（STAR + **Reflection**）：

| # | JD Requirement | STAR+R Story | S | T | A | R | Reflection |
|---|----------------|--------------|---|---|---|---|------------|

**Reflection** column は、何を学んだか、または次に何を変えるかを捉える。これは seniority の signal。Junior candidates は起きたことを説明する。Senior candidates は lessons を抽出する。

**Story Bank:** `interview-prep/story-bank.md` が存在する場合、これらの stories がすでにあるか確認する。なければ新しいものを append する。時間とともに、どの interview question にも適応できる 5-10 master stories の reusable bank を作る。

**Selected and framed according to the archetype:**
- FDE → delivery speed と client-facing を強調
- SA → architectural decisions を強調
- PM → discovery と trade-offs を強調
- LLMOps → metrics、evals、production hardening を強調
- Agentic → orchestration、error handling、HITL を強調
- Transformation → adoption、organizational change を強調

Also include:
- 1 recommended case study（どの project をどう present するか）
- Red-flag questions and how to answer them（例："why did you sell your company?", "do you have a team of reports?"）

## Block G -- Posting Legitimacy

Job posting を分析し、real, active opening かどうかを示す signals を出す。これは、ユーザーが hiring process につながりやすい機会に effort を優先配分するためのもの。

**Ethical framing:** Observations を提示し、accusations にしない。どの signal にも legitimate explanations があり得る。判断はユーザーが行う。

### Signals to analyze (in order):

**1. Posting Freshness**（liveness gate または `auto-pipeline` Step 0 で取得した Playwright snapshot から。JD テキストだけの場合は unavailable）:
- Date posted または "X days ago" を page から抽出
- Apply button state（active / closed / missing / redirects to generic page）
- URL が generic careers page に redirect された場合は note する

**2. Description Quality**（JD text から）:
- Specific technologies, frameworks, tools を named しているか
- Team size、reporting structure、org context に触れているか
- Requirements は realistic か（years of experience vs technology age）
- 最初の 6-12 months の scope が clear か
- Salary/compensation に触れているか
- JD のうち role-specific vs generic boilerplate の比率
- Internal contradictions があるか（entry-level title + staff requirements など）

**3. Company Hiring Signals**（2-3 WebSearch queries。Block D research と combine）:
- Search: `"{company}" layoffs {year}` -- date、scale、departments を note
- Search: `"{company}" hiring freeze {year}` -- announcements を note
- Layoffs が見つかった場合、この role と同じ department か確認

**4. Reposting Detection**（scan-history.tsv から）:
- company + similar role title が別 URL で過去に出ているか確認
- 回数と期間を note

**5. Role Market Context**（qualitative、additional queries なし）:
- この role は通常 4-6 weeks で埋まる common role か
- Role が company business に合っているか
- Seniority level が長く open になりやすい type か

### Output format:

**Assessment:** One of three tiers:
- **High Confidence** -- Multiple signals suggest a real, active opening
- **Proceed with Caution** -- Mixed signals worth noting
- **Suspicious** -- Multiple ghost job indicators, investigate before investing time

**Signals table:** 観測した各 signal、finding、weight（Positive / Neutral / Concerning）を table にする。

**Context Notes:** Niche role、government job、evergreen position など、concerning signals を説明し得る caveats を書く。

### Edge case handling:
- **Government/academic postings:** Timeline が長いのが標準。Threshold を調整（60-90 days は normal）。
- **Evergreen/continuous hire postings:** JD が "ongoing" / "rolling" と明示する場合は context として note。これは ghost job ではなく pipeline role。
- **Niche/executive roles:** Staff+、VP、Director、highly specialized roles は months open でも legitimate。Age thresholds を調整。
- **Startup / pre-revenue:** Early-stage companies は role が genuinely undefined で JD が vague なことがある。Description vagueness の重みを下げる。
- **No date available:** Posting age が判断できず、他に concerning signals がない場合、limited data の note 付きで default to "Proceed with Caution"。Evidence なしで "Suspicious" にしない。
- **Recruiter-sourced (no public posting):** Freshness signals unavailable。Active recruiter contact 自体を positive legitimacy signal として note。

---

## Cover Letter Draft (auto-generated after Block G)

Report を保存し tracker に記録した後、report file に `## Cover Letter Draft` として cover letter draft を append する。これは starting point であり final letter ではない。ユーザーは `/career-ops cover {slug}` で完成させる。

**How to generate the draft:**

1. `cv.md` を読む。JD の top requirements に最も relevant な achievement bullets を 4 つ選ぶ（exact wording、real metrics only）
2. `config/profile.yml` を読む。candidate name、current role、years of experience を抽出する
3. Role title と JD mission language に基づく 2-sentence opening を書く
4. `cv.md` summary から 1-paragraph profile intro を書き、JD domain に合わせる
5. "Problems / Why this company / Approach" section は placeholder にする。ここは user input が必要
6. Gaps（domain mismatch、language requirement、start date urgency）を detect and flag し、ユーザーがすぐ確認できるようにする

**Draft format to append to the report:**

```markdown
## Cover Letter Draft

> Draft generated at evaluation time. Complete via `/career-ops cover {slug}` to fill in angles, confirm research, and generate the PDF.
> Gaps flagged below -- address them during the cover flow.

---

**Opening** *(placeholder -- refine with your "why this role" angle)*
{2-sentence opening based on JD role title and mission language}

**Profile introduction**
{1 paragraph from cv.md summary, adapted to JD domain and required competencies}

**Key achievements** *(selected from cv.md -- exact wording preserved)*
- **{lead from cv.md},** {impact sentence with metric}.
- **{lead from cv.md},** {impact sentence with metric}.
- **{lead from cv.md},** {impact sentence with metric}.
- **{lead from cv.md},** {impact sentence with metric}.

**Problems I will solve** *(placeholder -- requires company research + your input)*
> To be completed: what challenges does {company} face that you'd address? How would you approach them?

**Closing**
I am happy to discuss further at your convenience.

---

**Gaps flagged:**
{List any detected gaps -- domain mismatch, language requirement, start date urgency, title mismatch. If none, write "None detected."}

**JD keywords to mirror** *(extracted for ATS + human read)*
{8-10 exact phrases from the JD}

---
*Run `/career-ops cover {slug}` to complete angles, confirm company research, and generate the PDF.*
```

`_shared.md` の Professional Writing section にある language rules を draft content にすべて適用する。No em dashes、no buzzwords、active voice、concrete claims only。

---

## Post-evaluation

**ALWAYS** after generating blocks A-G:

### 1. Save report .md

Full evaluation を `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` に保存する。

- `{###}` = next sequential number（3 digits, zero-padded）。競合を防ぐため、必ず `node reserve-report-num.mjs` を実行して番号を claim し（stdout returns `{###}`）、report を write してから `node reserve-report-num.mjs --release {###}` を実行して sentinel を release する。
- `{company-slug}` = company name in lowercase, without spaces（use hyphens）
- `{YYYY-MM-DD}` = current date

**Report format:**

```markdown
# Evaluation: {Company} -- {Role}

**Date:** {YYYY-MM-DD}
**URL:**
**Archetype:** {detected}
**Score:** {X/5}
**Legitimacy:** {High Confidence | Proceed with Caution | Suspicious}
**PDF:** {path or pending}

---

## A) Role Summary
(full content of block A)

## B) Match with CV
(full content of block B)

## C) Level and Strategy
(full content of block C)

## D) Comp and Demand
(full content of block D)

## E) Customization Plan
(full content of block E)

## F) Interview Plan
(full content of block F)

## G) Posting Legitimacy
(full content of block G)

## H) Draft Application Answers
(only if score >= 4.5 -- draft answers for the application form)

---

## Keywords extracted
(list of 15-20 keywords from the JD for ATS optimization)
```

### 2. Record in tracker

**ALWAYS** record in `data/applications.md`:
- Next sequential number
- Current date
- Company
- Role
- Score: match average (1-5)
- Status: `Evaluated`
- PDF: ❌（または auto-pipeline が PDF を生成した場合は ✅）
- Report: root-relative link `[001](reports/001-company-2026-01-01.md)`（`merge-tracker.mjs` 経由で merge されると tracker file からの相対 link に normalize される。例：`../reports/...`。#760 参照）

**Tracker format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

任意の Via 列（intermediary channel、#1596）を Company の後に置く layout も可：

```markdown
| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
```

- `Via` = 人材紹介会社（エージェント）名。直接応募は `—`。
- 求人企業が非公開の場合は Company に構造マーカー `?` を書く（「非公開」「機密」などの単語は書かない — locale 依存の文字列は dedup/verify の特別処理をすり抜ける）。識別用の説明（業界・勤務地など）は Notes に記載。
