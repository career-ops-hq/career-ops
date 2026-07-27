# モード: pipeline -- URL Inbox (Second Brain)

`data/pipeline.md` に保存された job URLs を処理する。ユーザーはいつでも URL を追加し、後から `/career-ops pipeline` を実行してまとめて処理する。

## Liveness sweep

**URLs を処理する前に必ず実行する。** Scanner が headless/batch mode で追加した entries は、Playwright が使えなかったため `**Verification:** unconfirmed (batch mode)` を持つ。つまり liveness は未確認。Sweep なしでは dead postings が 1 tab ずつ evaluation に到達し、phantom roles に時間と tokens を使ってしまう（8 件の stale URLs がある inbox なら 8 回分の無駄な evaluations になる）。

Per-URL loop の前に、zero-token liveness checker で pending URLs をまとめて sweep する：

1. "Pending" section のすべての `- [ ]` URL を temp file に集める（1 URL per line）。
2. `node check-liveness.mjs --file <tmpfile>` を実行する（large batches では WAF rate limits を避けるため `--throttle` を追加。pure Playwright、zero Claude tokens）。Checker は URL ごとの verdict を出し、expired/uncertain がある場合は non-zero で終了する。
3. Checker が **expired/closed** と報告した URL は処理せず pipeline entry を resolve する：`- [x] ~~URL | Company | Role~~ -- posting expired (liveness sweep)` として "Processed" に移し、すでに tracker row がある場合は `Discarded` にする。**JD extraction、evaluation、report/PDF generation はしない。**
4. `uncertain` results は残し、normal per-URL extraction 中に確認する（一時的な timeout で live posting を落とさないため）。
5. 生き残った live URLs だけが下の per-URL processing loop に進む。

これは `auto-pipeline` の per-URL liveness gate（Step 0.5）や `apply` preflight を置き換えるものではなく補完するもの。Dead postings を upfront, in bulk で落とし、ユーザーが expired role の tab を開いたり token を使ったりしないようにする。

## Workflow

1. **Read** `data/pipeline.md` → "Pending" section の `- [ ]` items を探す。最初に上の **Liveness sweep** を実行し、expired entries を落としてから続行する。
2. **For each surviving pending URL**:
   a. `node reserve-report-num.mjs` を実行して次の `REPORT_NUM` を atomically claim する（report が書き込まれたら `node reserve-report-num.mjs --release <num>` で sentinel を release）
   b. **Extract JD** using Playwright（browser_navigate + browser_snapshot）→ WebFetch → WebSearch
   c. URL に access できない場合 → note 付きで `- [!]` と mark し、次へ進む
   d. **Execute full auto-pipeline**: Evaluation A-F → Report .md → PDF（score >= `auto_pdf_score_threshold` の場合）→ Tracker
   e. **Move from "Pending" to "Processed"**: `- [x] #NNN | URL | Company | Role | Score/5 | PDF ✅/❌`

   **About the PDF gate (configurable):** `config/profile.yml` → `auto_pdf_score_threshold` を読む。Key がなければ default は `3.0`（この mode の original gate）。Evaluation score が threshold 未満なら PDF generation を skip する。Report は通常通り書き、header に `**PDF:** not generated -- run /career-ops pdf {company-slug} to create on demand` と表示し、tracker では PDF ❌。Score が threshold 以上なら通常通り PDF を生成する。

   **Tuning it:** Tailored PDF generation は entry あたり ~30-60s かかる（Playwright launch + HTML render）うえ、使われないことも多い。多くの roles は 2.x/3.x で application stage まで進まない。`auto_pdf_score_threshold` を上げる（例：`4.0`）と marginal offers では report のみを書き、PDF は `/career-ops pdf {slug}` で on demand に作れる。`0` にするとすべての offers で PDF を生成する。Path A `/career-ops pipeline` と Path B `batch/batch-runner.sh` は同じ key を読むため、どちらで処理しても behavior は同じ。
3. **If there are 3+ pending URLs**, speed を上げるため agents を並列起動する（Agent tool with `run_in_background`）。
4. **At the end**, summary table を表示：

```markdown
| # | Company | Role | Score | PDF | Recommended action |
```

## Format of pipeline.md

```markdown
## Pending
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [ ] https://jobs.ashbyhq.com/acme/789 | Acme Corp | Solutions Architect | Remote (US)
- [!] https://private.url/job -- Error: login required

## Processed
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

Pending lines are `- [ ] {url} | {company} | {title} | {location}`. Scanner は ATS が location を expose する場合、末尾の `| {location}` column を埋める。古い 3-column lines（location なし）も valid で、empty location として読む。

> 注：既存ファイルが日本語 section headings（`未処理` / `処理済み`）を使っている場合は、その style を維持してよい。読み取りは柔軟に行い、書き込み時は既存 file の style を保つ。

## Intelligent JD detection from URL

1. **Playwright (preferred):** `browser_navigate` + `browser_snapshot`. すべての SPA で動く。
   - **オプション — CLI 抽出 (`config/profile.yml` の `scan.extractor: cli`):** 代わりに `node browser-extract.mjs <url>`（`--mode jd`）を実行 — コンパクトな `{ "url", "title", "text" }`、トークン数が少ない（ポータル依存）。エラー時や未導入時は**静かに** `browser_navigate` + `browser_snapshot` へフォールバック。
2. **WebFetch (fallback):** Static pages または Playwright が unavailable な場合。
3. **WebSearch (last resort):** JD を index している secondary portals で検索。

**Special cases:**
- **LinkedIn:** login が必要な場合あり → `[!]` と mark し、ユーザーに text paste を依頼
- **PDF:** URL が PDF を指す場合、Read tool で直接読む
- **`local:` prefix:** Local file を読む。Example: `local:jds/linkedin-pm-ai.md` → `jds/linkedin-pm-ai.md`
- **Wantedly / Green / Findy:** 日本の主要 platforms。まず Playwright で確認
- **doda / リクナビNEXT / マイナビ転職:** 日本の大手 job portals。Usually WebFetch または Playwright で確認
- **ビズリーチ:** ハイクラス求人。Login が必要な場合あり
- **LinkedIn JP:** Global LinkedIn と同じ constraints。Login が必要な場合あり

## Automatic numbering

1. `node reserve-report-num.mjs` を実行して next sequential number を claim する（stdout returns `{###}`）。
2. その number を使って report file を書く。
3. Report が書けたら `node reserve-report-num.mjs --release {###}` を実行して sentinel を release する。

## Source synchronization

URL を処理する前に sync を verify：

```bash
node cv-sync-check.mjs
```

Desynchronization があれば、続行前にユーザーに warn する。
