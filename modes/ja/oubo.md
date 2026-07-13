# モード: oubo -- 応募ライブアシスタント

> Free-text answers と cover-letter fields には `voice-dna.md`（存在する場合）を適用する。Full guardrail、conversational voice included（Tier 1 + Tier 2）。`_shared.md` → Voice DNA を参照。

候補者が Chrome で応募フォームを入力しているときの interactive mode。画面上の内容を読み、事前評価済みの求人 context を読み込み、フォームの各質問に personalized responses を生成する。

## Requirements

- **Best with Playwright in visible mode:** visible mode では、候補者が browser を見られ、Claude が page と interact できる。
- **Without Playwright:** 候補者が screenshot を共有するか、質問を手動で貼り付ける。

## Workflow

```text
1. DETECT      → Read active Chrome tab (screenshot/URL/title)
2. IDENTIFY    → Extract company + role from the page
3. SEARCH      → Match against existing reports in reports/
4. LOAD        → Read full report + Section G (if it exists)
5. PREFLIGHT   → Confirm posting liveness + company/role match before drafting
6. ANALYZE     → Identify ALL visible form questions
7. GENERATE    → For each question, generate a personalized response
8. PRESENT     → Show formatted responses for copy-paste
```

## Step 5 -- Preflight gate

Application answers を生成する前に、form が意図した active job を指していることを確認する。この gate は page detection、company/role identification、matching report load の後に実行する。

1. Visible URL、page title、company、role、closed/expired signals を読む。
2. URL がある場合、Playwright で liveness を確認する：
   - active posting evidence: title/role + job description または form fields + submit/apply path
   - closed posting evidence: expired/closed/no longer accepting applications、JD がなく nav/footer だけ、generic careers/search への hard redirect、404/410
3. Visible company and role を matched report と比較する。
4. Company または title が materially changed している場合、drafting 前に stop して聞く：
   "The form appears to be for [visible company] -- [visible role], but the matched report is [report company] -- [report role]. Do you want me to re-evaluate, adapt with this mismatch, or stop?"
5. Posting が closed に見える場合、candidate が known reason で明示的に override しない限り、final copy の生成を拒否する。
6. Candidate が questions だけ、または screenshot だけを貼ったため liveness を確認できない場合、その limitation を明示し、drafting 前に company、role、active posting の確認を求める。

この preflight が解決するまで Step 6 に進まない。

**Applying to several roles in one sitting?** この preflight は目の前の単一 form を確認する。Multi-role session の前、特に scanner entries が `**Verification:** unconfirmed (batch mode)` と marked されている場合は、`pipeline` mode の **Liveness sweep** を先に実行する（`node check-liveness.mjs --file <urls>`）。これにより `data/pipeline.md` から dead postings がまとめて落ち、expired role の tab を開かずに済む。

## Step 1 -- Detect the job

**With Playwright:** active page の snapshot を取得する。Title、URL、visible content を読む。

**Without Playwright:** 候補者に以下を依頼する：
- Form の screenshot を共有（Read tool で画像を読める）
- または form questions を text として貼り付け
- または company + role を伝えてもらい、こちらで検索する

## Step 2 -- Identify and search for context

1. Page から company name と role title を抽出
2. `reports/` を company name で検索（case-insensitive grep）
3. Match があれば full report を load
4. Section G があれば previous draft answers を base として load
5. Match がなければ notify し、quick auto-pipeline の実行を提案

## Step 3 -- Detect changes in the role

画面上の role が evaluation 済みの role と異なる場合：
- **Notify the candidate:** "The role has changed from [X] to [Y]. Do you want me to re-evaluate or adapt the responses to the new title?"
- **If adapt:** Candidate が mismatch を明示的に accept した後に限り、re-evaluate せず新しい role に responses を adjust
- **If re-evaluate:** Full A-F evaluation を実行し、report を update し、Section G を regenerate
- **Update tracker:** 必要に応じて `applications.md` の role title を変更

## Step 6 -- Analyze form questions

Visible questions をすべて特定する：
- Free text fields（cover letter、why this role など）
- Dropdowns（how did you hear、work authorization など）
- Yes/No（relocation、visa など）
- Salary fields（range、expectation）
- Upload fields（resume、cover letter PDF）

各 question を分類する：
- **Already answered in Section G** → 既存 response を adapt
- **New question** → report + `cv.md` から response を generate

各 field について、application form contract を preserve する：
- `field_type`: `text`, `textarea`, `select`, `radio`, `checkbox`, `number`, `file`, or `unknown`
- `required`: `yes`, `no`, or `unknown`
- `limit`: exact character/word limit if visible; otherwise `unknown`
- `options`: visible options for select/radio/checkbox fields
- `needs_candidate_confirmation`: `yes` for legal, demographic, work authorization, visa, relocation, salary, disability, veteran, sponsorship, background-check, or self-identification questions unless the answer is explicitly present in `config/profile.yml`

Legal、demographic、work-authorization、visa/sponsorship、salary、disability、veteran、background-check、relocation、self-identification fields の回答を捏造してはならない。回答が `config/profile.yml` または visible context に明示されていない場合は、`needs_candidate_confirmation` として mark し、候補者に確認するための最も安全な質問を出す。

## Step 7 -- Generate responses

各 question について、以下に従って response を生成する：

1. **Report context:** Block B の proof points、Block F の STAR stories を使う
2. **Previous Section G:** Draft response があれば base として使い refine
3. **"I'm choosing you" tone:** Same auto-pipeline framework
4. **Specificity:** 画面上に見える JD の specific detail を reference
5. **career-ops proof point:** "Additional info" field があれば含める
6. **Recruiter-side risk map:** `modes/heuristics/recruiter-side.md` を使い、question が解消しようとしている doubt（motivation、stack fit、logistics、comp、work-auth、availability、seniority）を特定し、そこに直接答える
7. **Disclosure discipline:** Logistics questions には truthfully に答えるが、unrelated motivation/fit answers で sensitive or HR-only details を自発的に出さない

**日本市場で頻出するフォーム特有の質問：**
- **希望年収（月額/年額、税込み）** → `profile.yml` のレンジを日本円で示し、「パッケージ全体に応じて応相談」と注記
- **雇用形態の希望（正社員/業務委託）** → `profile.yml` に従って回答。該当する場合は「どちらも対応可能」
- **稼働開始可能日** → 現在の退職予告期間を考慮した現実的な日付（正社員なら通常 1-2 ヶ月）
- **就労資格** → 明確に回答。未記載なら candidate confirmation が必要
- **語学力** → 言語ごとに level を記載（native、business、conversational、basic）
- **転居の可否** → `profile.yml` の location settings に従う

**Output format:**

```text
## Responses for [Company] -- [Role]

Based on: Report #NNN | Score: X.X/5 | Archetype: [type]

---

### 1. [Exact form question]
> [Response ready for copy-paste, or "Ask candidate: ..." if the field needs confirmation]

### 2. [Next question]
> [Response]

...

---

Notes:
- [Any observations about the role, changes, etc.]
- [Personalization suggestions the candidate should review]
```

## Step 8 -- Post-apply (optional)

候補者が application を submitted したと確認した場合：
1. 正規 CLI で status を "Applied" に update: `node set-status.mjs <report#> Applied`（`applications.md` のテーブルを手動編集しない）
2. Report の Section G を final responses で update
3. Next step として LinkedIn outreach 用の `/career-ops contacto` を提案

## Scroll handling

Form questions が visible area を超える場合：
- 候補者に scroll して別 screenshot を共有してもらう
- または remaining questions を paste してもらう
- Form 全体を cover するまで iteration で処理
