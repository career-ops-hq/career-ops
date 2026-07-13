# 共通コンテキスト -- career-ops（日本語）

<!-- ============================================================
     THIS FILE IS AUTO-UPDATABLE. Don't put personal data here.

     Your customizations go in modes/_profile.md (never auto-updated).
     This file contains system rules, scoring logic, and tool config
     that improve with each career-ops release.
     ============================================================ -->

## 真実のソース（EXCLUSIVE）

以下のファイルだけが、ユーザー向けコンテンツ（CV、カバーレター、フォーム回答、リクルーター向けメッセージ）の情報源です。Auto-memory、親ディレクトリの repo、セッションをまたいだ推測は対象外です。完全なルールは `AGENTS.md` / `CLAUDE.md` の "Source-of-Truth Boundary" を参照してください。

| ファイル | パス | いつ |
|---------|------|------|
| cv.md | `cv.md`（プロジェクトルート） | 常に |
| article-digest.md | `article-digest.md`（存在する場合） | 常に（詳細な proof points） |
| profile.yml | `config/profile.yml` | 常に（候補者の identity と target） |
| _profile.md | `modes/_profile.md` | 常に（ユーザー固有のアーキタイプ、ナラティブ、交渉） |
| writing-samples/ | `writing-samples/` | 候補者が外部に出す文章を生成する場合。まず `_profile.md` のキャッシュ済み `## Writing Style` を確認し、存在しない場合だけファイルを読む |
| voice-dna.md | `voice-dna.md`（プロジェクトルート、存在する場合） | 候補者が外部に出す文章を生成する場合。AI っぽさを避ける guardrail + voice。下の Voice DNA precedence を参照 |
| interview-prep | `interview-prep/story-bank.md`, `interview-prep/{company}-{role}.md` | ATS フォーム回答 / 面接コンテンツを生成する場合。ユーザー自身の STAR stories と prep notes（`cv.md` と同じ信頼レベル）。`apply` / `match-star` と interview modes が使用 |

**ルール：proof point のメトリクスを絶対にハードコードしない。** 評価時に `cv.md` と `article-digest.md` から読み取ること。
**ルール：記事・プロジェクトのメトリクスは、`article-digest.md` が `cv.md` より優先される。**
**ルール：このファイルの後に `_profile.md` を読む。`_profile.md` のユーザーカスタマイズはここのデフォルト値を上書きする。**
**ルール：`cv.md` または `article-digest.md` で明示されていない限り、ユーザーが project、repo、library、tool、framework、open-source artifact を authored したと主張してはならない。** 「使ったツール」を「作ったもの」と混同するのが最も多い捏造パターンであり、禁止。
**ルール：Keywords get reformulated, never fabricated.** 並べ替える、言い換える、強調するのはよい。ただし発明しない。根拠が in-scope file にない claim はユーザーに確認する。答えがない場合は省く。沈黙は捏造よりよい。

---

## スコアリングシステム

評価は 6 ブロック（A-F）と 1-5 の global score で行う：

| Dimension | 測定する内容 |
|-----------|-------------|
| Match con CV | スキル、経験、proof point の整合 |
| North Star alignment | 求人がユーザーの target archetypes（`_profile.md` より）にどれだけ合うか |
| Comp | 給与 vs 市場（5=上位四分位、1=大幅に下回る） |
| Cultural signals | 企業文化、成長性、安定性、remote policy |
| Red flags | ブロッカー、警告（negative adjustments） |
| **Global** | 上記の weighted average |

**Score interpretation:**
- 4.5+ → 強いマッチ、今すぐ応募を推奨
- 4.0-4.4 → 良好なマッチ、応募する価値あり
- 3.5-3.9 → まずまずだが理想ではない、特別な理由がある場合のみ応募
- Below 3.5 → 応募非推奨（AGENTS.md の Ethical Use を参照）

## Posting Legitimacy (Block G)

Block G は、求人が real, active opening である可能性を評価する。1-5 の global score には影響しない。独立した qualitative assessment として扱う。

**Three tiers:**
- **High Confidence** -- Real, active opening（多くの signal が positive）
- **Proceed with Caution** -- Mixed signals, worth noting（一部懸念あり）
- **Suspicious** -- 複数の ghost indicator があり、ユーザーが先に確認すべき

**Key signals（reliability で重み付け）:**

| Signal | Source | Reliability | Notes |
|--------|--------|-------------|-------|
| Posting age | Page snapshot | High | Under 30d=good, 30-60d=mixed, 60d+=concerning（role type に応じて調整） |
| Apply button active | Page snapshot | High | 直接観測できる事実 |
| Tech specificity in JD | JD text | Medium | Generic JDs は ghost postings と相関するが、単に書き方が粗い場合もある |
| Requirements realism | JD text | Medium | 矛盾は強い signal、曖昧さは弱い signal |
| Recent layoff news | WebSearch | Medium | department、timing、company size を考慮する |
| Reposting pattern | scan-history.tsv | Medium | 同じ role が 90 日以内に 2 回以上 repost されていれば concerning |
| Salary transparency | JD text | Low | jurisdiction-dependent。非公開には legitimate reasons が多い |
| Role-company fit | Qualitative | Low | 主観的。supporting signal としてのみ使う |

**Ethical framing（MANDATORY）:**
- ユーザーが real opportunities に時間を優先配分するための補助
- 企業を dishonest と非難する形で提示しない
- Signals を提示し、判断はユーザーに委ねる
- Concerning signals には必ず legitimate explanations も添える

## Archetype Detection

すべての求人を以下の type のいずれか（または 2 つの hybrid）に分類する：

| Archetype | Key signals in JD |
|-----------|-------------------|
| AI Platform / LLMOps | "observability", "evals", "pipelines", "monitoring", "reliability" |
| Agentic / Automation | "agent", "HITL", "orchestration", "workflow", "multi-agent" |
| Technical AI PM | "PRD", "roadmap", "discovery", "stakeholder", "product manager" |
| AI Solutions Architect | "architecture", "enterprise", "integration", "design", "systems" |
| AI Forward Deployed | "client-facing", "deploy", "prototype", "fast delivery", "field" |
| AI Transformation | "change management", "adoption", "enablement", "transformation" |

Archetype を検出した後、`modes/_profile.md` を読み、該当 archetype に対するユーザー固有の framing と proof points を使う。

## 日本市場 -- 特記事項（重要）

日本の求人や交渉には、英語圏の求人だけでは出てこない用語や慣習がある。評価では以下を正しく扱う：

| 用語 | 意味 | 評価への影響 |
|-----|------|-------------|
| **正社員** | 無期雇用の正規雇用。社会保険、有給、賞与、退職金の対象 | 総額比較では年間報酬 = 月給 x 12 + 賞与（通常 2-6 ヶ月分）で計算 |
| **業務委託（フリーランス）** | 請負契約、個人事業主として働く | 月額が高く見えても社会保険・賞与・退職金なし。公正な比較のため正社員換算を計算 |
| **賞与 / ボーナス** | 年 2 回（夏・冬）支給される追加給与 | 正社員では給与の大きな割合。年収 = 月給 x（12 + 賞与月数）。比較で忘れない |
| **年俸制** | 年間総額を 12 または 14-16 で割る方式 | 賞与が年俸に含まれる場合があるため、内訳を確認 |
| **みなし残業 / 固定残業代** | 一定時間分の残業代があらかじめ月給に含まれる方式 | 何時間分か、超過分が別途支払われるかを確認。Red flag になり得る |
| **36 協定** | 時間外労働に関する労使協定 | 残業時間の上限を規定。働き方の健全性を測る signal |
| **試用期間** | 通常 3-6 ヶ月 | 日本では標準的。単体では red flag ではない |
| **退職金** | 退職時に支給される一時金 | 大企業・伝統企業で一般的。スタートアップでは少ない。長期前提の待遇 |
| **通勤手当** | 通勤交通費の実費支給 | 日本では標準的。上限（月 5 万円など）を確認 |
| **住宅手当 / 家賃補助** | 住居関連の手当 | 大企業や一部スタートアップで提供。月 2-10 万円程度 |
| **健康保険 / 厚生年金** | 社会保険（正社員は強制加入、会社が半分負担） | 正社員の隠れた報酬。業務委託との比較で重要 |
| **有給休暇** | 法定最低 10-20 日/年 | 取得率を確認。低すぎると red flag |
| **退職予告** | 正社員は通常 1-2 ヶ月前に通知 | 開始日を現職の退職予告期間込みで考える |
| **ストックオプション** | スタートアップの equity | vesting、cliff、税制（税制適格 vs 非適格）を評価 |

## グローバルルール

### 絶対にしない

1. 経験やメトリクスを捏造する
2. `cv.md` やポートフォリオファイルを変更する
3. 候補者の代わりに応募を送信する
4. 生成メッセージで電話番号を共有する
5. 市場以下の報酬を推奨する
6. 求人を読まずに PDF を生成する
7. corporate-speak を使う
8. tracker を無視する（評価したすべての求人を記録する）

### 常にする

0. **Cover letter:** フォームが許可する場合は必ず含める。CV と同じ visual design。JD quotes を proof points に mapping。最大 1 ページ。
1. 評価前に `cv.md`、`_profile.md`、`article-digest.md`（存在する場合）を読む
1b. **各セッションの最初の評価で:** `node cv-sync-check.mjs` を実行。warnings があればユーザーに知らせる
2. 求人の archetype を検出し、`_profile.md` に従って framing を適応させる
3. マッチング時、CV の exact lines を引用する
4. comp と company data のために WebSearch を使う
5. 評価後に tracker に登録する
6. 求人の言語で生成する（EN default）
7. 直接的で actionable に書く。fluff を避ける
8. 日本語で生成する場合は、自然な tech Japanese を使う。短い文、action verbs、不要な受動態を避ける
8b. PDF Professional Summary に case study URLs を含める（recruiter はそこだけ読む可能性がある）
9. **Tracker additions as TSV** -- `applications.md` を新規追加のために直接編集しない。`batch/tracker-additions/` に TSV を書く
10. **すべての report header に `**URL:**` を含める**

### Tools

| Tool | Use |
|------|-----|
| WebSearch | Comp research, trends, company culture, LinkedIn contacts, fallback for JDs |
| WebFetch | Static pages から JD を抽出する fallback |
| Playwright | 求人検証（browser_navigate + browser_snapshot）。**NEVER 2+ agents with Playwright in parallel.** |
| Read | cv.md, _profile.md, article-digest.md, cv-template.html |
| Write | Temporary HTML for PDF, applications.md, reports .md |
| Edit | tracker 更新 |
| Canva MCP | Optional visual CV generation. Base design を duplicate し、text を edit して PDF export。`profile.yml` の `cv.canva_resume_design_id` が必要 |
| Bash | `node generate-pdf.mjs` |

### Time-to-offer priority
- Working demo + metrics > perfection
- Apply sooner > learn more
- 80/20 approach, timebox everything

---

## Voice DNA (writing guardrail)

`voice-dna.md` が project root に存在する場合、生成文章の guardrail として使う。これは user-layer で optional。存在を仮定しない。なければ静かに skip する。これはユーザー個人の style の下に置かれる。AI っぽさを抑え、足りない部分を補うが、`_profile.md` にあるユーザー自身の voice rules を常に優先する（Precedence を参照）。

**Two-tier scope（CV の正確性を守るための分離）:**

- **Tier 1 -- anti-AI-slop guardrail**（voice-dna §3 Banned List、§4 Patterns to Avoid: banned words、dead phrases、no em-dashes、no negative parallelisms、formatting rules）。HARD RULES。CV bullets と Professional Summary を含む **all generated text** に適用する。
- **Tier 2 -- conversational voice**（voice-dna §1-2: contractions、And/But sentence openers、"I think" / "maybe" のような hedging、parenthetical asides、direct "I"/"you"）。cover letters、LinkedIn outreach、follow-up emails など conversational candidate-facing prose のみに適用する。**CV/ATS text**（PDF bullets、Professional Summary）には Tier 2 を適用しない。そこでは formal, keyword-dense register を維持する。

**Accuracy always wins over style.** `cv.md` と `article-digest.md` の facts は voice-dna によって上書きされない。実在する metric を rhythm のために落とす、弱める、hedge することはしない。人間らしく見せるために detail を発明しない。voice-dna は wording を shaping するだけで content を変えない。

**Precedence with personal style（`_profile.md` always wins）:** `_profile.md` の `## Writing Style` が voice と tone の authority。`voice-dna.md` と `_profile.md` が衝突する場合は `_profile.md` が勝つ。例：`_profile.md` が em-dashes を使う style なら、voice-dna が避けるとしていても維持する。voice-dna の anti-AI-slop rules は `_profile.md` が silent な箇所にだけ適用する。`voice-dna.md` 自体も user file なので、strict guardrail を優先したいユーザーはその preference を `_profile.md` に書かなければよい。

---

## Writing Style Calibration

**まず `_profile.md` を確認する。** そこに `## Writing Style` section がある場合は直接使い、`writing-samples/` を再スキャンしない。再スキャンは new samples が追加された場合、またはユーザーが明示的に recalibrate を求めた場合のみ。

**When to apply:** ユーザーが送信または公開する文章を生成する前。cover letters、LinkedIn outreach、application form answers、follow-up emails、executive summaries、profile blurbs。Internal evaluation reports（A-F blocks、scores、analysis）には適用しない。

**If no cached style in `_profile.md`:** `writing-samples/` の全ファイルを読み、**`README.md` という名前のファイルは skip** する。user-provided samples が見つからなければ style calibration を skip し、writing sample（過去の cover letter、LinkedIn About、professional writing など）があると tailoring に役立つと一度だけ軽く伝える。samples がある場合、下の markers を抽出し、`_profile.md` の `## Writing Style` に書く。以後の session はこの step を skip する。

### What to extract

**Tone & register**
- Formal vs. conversational
- Confident vs. hedging（"I think", "perhaps", "somewhat" のような qualifiers を見る）
- Warm vs. transactional
- Degree of self-promotion。undersell するか、match するか、achievements を前に出すか

**Sentence structure**
- Average sentence length。short and punchy か、long and layered か
- Fragments for emphasis の有無
- Clause nesting and complexity
- Sentence openings。subject-first、action-first、context-first か

**Punctuation habits**
- Em dashes、en dashes、parentheses の使い方
- Oxford comma の有無
- Ellipses の有無
- Exclamation marks の頻度
- Semicolons vs. full stops

**Vocabulary**
- Technical density。1 paragraph あたりの jargon 量
- Preferred synonyms（例："built" vs "developed" vs "engineered"）
- 繰り返し使う words / phrases は維持する
- 出てこない words は導入しない

**Paragraph and structure patterns**
- Paragraph length。one-liners か developed blocks か
- Bullet-heavy or prose-heavy
- Idea sequencing。problem → solution、result-first、chronological か
- Headers の使い方

**Voice signatures**
- First-person patterns（"I led", "we built", "our team"）
- Active vs. passive ratio
- Habitual openers and closers
- Rhetorical moves。questions、contrast、micro-stories の有無

### Rules

- **Only extract what is demonstrably present.** 1 つの data point から推測しない。
- **Idiosyncratic choices are intentional.** 独特な punctuation や phrasing はユーザーの voice。勝手に直さない。
- **If samples conflict**, 最も新しいもの、または用途が近いものを重視する。
- **If samples are sparse**, reliable に抽出できるものだけ適用し、残りは defaults に fallback する。
- **Style calibration applies to tone and structure only.** Samples から content、claims、metrics を CVs、reports、evaluations に取り込まない。
- **No verbatim copying or personal identifiers.** 抽象的な style descriptors のみ保存する。ユーザーの文を verbatim quote しない。names、emails、phone numbers を保持しない。"Preserve idiosyncratic choices" は stylistic traits にだけ適用する。

### Persisting the extracted style

Scan 後、user-provided sample が少なくとも 1 つあった場合のみ `modes/_profile.md` に書く。既存の `## Writing Style` section を見つけ、その section 全体を次の `##` heading（または EOF）まで置き換える。なければ append する。これにより canonical section は常に 1 つだけになる。Samples がなければ section を書かない、変更しない。

```markdown
## Writing Style

_Extracted from writing-samples/ on {date}. Re-run if new samples are added._

**Tone:** {e.g. conversational, confident, no hedging qualifiers}
**Sentence length:** {e.g. short and punchy, avg 12 words}
**Openings:** {e.g. action-first, subject-first}
**Punctuation:** {e.g. em dashes for asides, Oxford comma, no ellipses}
**Vocabulary:** {e.g. prefers "built"/"ran"/"cut" over "developed"/"led"/"reduced"}
**Structure:** {e.g. prose-heavy, result-first sequencing}
**Voice:** {e.g. "I led", active voice dominant, no rhetorical questions}
**Avoid:** {words or patterns absent from samples}
```

---

## Professional Writing & ATS Compatibility

これらの rules は、candidate-facing documents に入るすべての generated text に適用する。PDF summaries、bullets、cover letters、form answers、LinkedIn messages。Internal evaluation reports には適用しない。

Recruiter-side risk mapping、six-second clarity、business-value bullets、ATS reality checks については `modes/heuristics/recruiter-side.md` を読む。

### Avoid cliché phrases
_`voice-dna.md` が存在する場合、その §3 Banned List が canonical でより完全な list になり、この fallback list より優先される。_
- "passionate about" / "results-oriented" / "proven track record"
- "leveraged"（"used" または tool 名を書く）
- "spearheaded"（"led" または "ran" を使う）
- "facilitated"（"ran" または "set up" を使う）
- "synergies" / "robust" / "seamless" / "cutting-edge" / "innovative"
- "in today's fast-paced world"
- "demonstrated ability to" / "best practices"（practice 名を具体的に書く）

### Unicode normalization for ATS
`generate-pdf.mjs` は em-dashes、smart quotes、zero-width characters を ATS 互換のため ASCII equivalents に自動 normalize する。ただし生成時点で避ける。

### Vary sentence structure
- すべての bullet を同じ verb で始めない
- Sentence length を混ぜる（短い文。Context 付きの少し長い文。また短い文）
- いつも "X, Y, and Z" にしない。2 items のときも 4 items のときもある

### Prefer specifics over abstractions
- "Cut p95 latency from 2.1s to 380ms" は "improved performance" よりよい
- "Postgres + pgvector for retrieval over 12k docs" は "designed scalable RAG architecture" よりよい
- 許可される範囲で tools、projects、customers を名指しする
