# Mode: gtop — Google Top Jobs (last-24h discovery + triage)

Bulk-discover fresh job postings from **Google Jobs**, keep only those posted in the **last 24 hours**, evaluate each for fit against the candidate's sources of truth, and return a ranked **"apply ASAP"** list of only the high-fit roles (global score ≥ 4.0/5).

This mode accepts an **optional argument**: a role title or keywords to search for. If omitted, it uses the candidate's pre-configured target role keywords from `portals.yml` and `config/profile.yml`.

| Invocation | What it does |
|------------|-------------|
| `/career-ops gtop` (no arg) | Uses the 3 default query clusters (Full-Stack/SWE, AI/ML, Broader Dev) from the candidate's title_filter.positive keywords |
| `/career-ops gtop AI Engineer` | Builds all 3 queries around "AI Engineer" instead of the default clusters |
| `/career-ops gtop "Full Stack"` | Builds all 3 queries around "Full Stack" |
| `/career-ops gtop backend engineer` | Builds all 3 queries around "Backend Engineer" |

The argument is a free-text role focus — whatever the user types after `gtop` becomes the primary search term. It's URL-encoded into the Google Jobs query alongside the candidate's location. If no argument is given, the pre-configured keyword clusters from `portals.yml` `title_filter.positive` are used.

It complements `scan` (per-portal/ATS) by casting a wider net across Google's aggregated job index, then filtering hard on freshness.

---

## Prerequisites

1. Run `node doctor.mjs --json`. If `onboardingNeeded` is true, switch to onboarding — do not run this mode.
2. Read the candidate sources of truth (same as all eval modes, per `_shared.md`):
   - `cv.md`
   - `config/profile.yml` (identity, location, target roles, comp)
   - `modes/_profile.md` (archetypes, narrative, proof points, comp targets)
   - `modes/_shared.md` (scoring system, archetype detection, legitimacy) — loaded automatically with this mode via SKILL.md context-loading
   - `article-digest.md` if it exists
3. Read `portals.yml` → `title_filter.positive` to get the candidate's target-role keywords. These drive the Google Jobs queries below.
4. Read `config/profile.yml` → `candidate.location` for the search locale (default: `Toronto`).

**NEVER hardcode proof-point metrics.** Read them from cv.md at evaluation time.

---

## Step 1 — Build the Google Jobs queries

Google Jobs search URL format (freshness baked into the keywords by default):

```
https://www.google.com/search?q={URL-encoded keywords, including "since yesterday"}+in+{LOCATION}&ibp=htl;jobs&hl=en&gl={GL}
```

- `gl={GL}` — the 2-letter country code for the candidate's location (e.g. `ca` for Canada, `us` for the US, `gb` for the UK). Derive it from `config/profile.yml` → `candidate.location`; default to `ca` only if the location is Canadian.

**Freshness is encoded directly in the `q` keywords, not via a URL date param or on-page button click.** Appending the literal phrase `since yesterday` to the search keywords makes Google's jobs index fetch only postings from the past ~24 hours — verified empirically (the user's own working URL uses this technique: `q=...in+toronto+since+yesterday`). This is more reliable than:
- `htichips=date_posted:today` — Google **strips** this param.
- `tbs=qdr:d` — Google keeps it, but it is a generic search param, not jobs-specific, and behavior is less consistent.
- Clicking the on-page "Date posted → Past 24 hours" button — adds an extra round-trip and page-state change; avoid it.

So: **every query's `q` MUST end with `since yesterday`**, and no on-page date filter button is ever clicked. Google rewrites the URL on load (drops `ibp=htl;jobs`, adds `udm=8&jbr=sep:0`) but the `since yesterday` term stays in `q`, so the freshness intent survives the rewrite.

**Note on freshness:** Because `since yesterday` narrows at the source, most results will already be under 24h, but Google can still sneak the occasional older posting ("1 day ago" boundary cards) through. The **Step 3 "Posted X ago" text filter remains the authoritative freshness gate** — every card MUST still pass it. The keyword phrase reduces noise; the text filter guarantees the 24h boundary.

Read the candidate's location from `config/profile.yml` → `candidate.location` (default: `Toronto`).

**If the user passed a custom role argument** (anything after `gtop` in the invocation), use it directly as the sole query keyword. Build 3 queries with that same keyword combined with related terms from `title_filter.positive`. **Every query MUST end with `since yesterday`** (before URL-encoding):

- **Query A:** `{custom-role} in {LOCATION} since yesterday`
- **Query B:** `{custom-role} OR related-variant-1 OR related-variant-2 in {LOCATION} since yesterday`
- **Query C:** `{custom-role} OR other-variant-1 OR other-variant-2 in {LOCATION} since yesterday`

URL-encode each query (spaces → `+`, quotes and parentheses → percent-encoded).

**If no argument was given**, construct **exactly 3 queries** from the candidate's pre-configured keywords (from `portals.yml` `title_filter.positive` + `config/profile.yml` target roles), clustered by theme. Replace `{LOCATION}` below with the actual location. **Every query MUST end with `since yesterday`:**

- **Query A — Full-Stack / SWE / Backend cluster:**
  `("Full Stack" OR "Software Engineer" OR "Backend Engineer" OR "Node.js" OR "React Developer") in {LOCATION} since yesterday`
- **Query B — AI / ML / Automation cluster:**
  `("AI Engineer" OR "ML" OR "LLM" OR "Agent" OR "Automation" OR "RAG" OR "GenAI") in {LOCATION} since yesterday`
- **Query C — Broader Developer cluster:**
  `("Software Developer" OR "Application Developer" OR "Platform Engineer" OR "Full Stack Developer") in {LOCATION} since yesterday`

Do not exceed 3 queries in either mode.

---

## Step 2 — Scrape each query with Playwright

For each query URL:

1. `browser_navigate` → the encoded Google Jobs URL.
2. Wait for results to render — use `browser_wait_for` on text like `"Apply"` or `"ago"` (posting-age text), or wait ~3–5s. Google Jobs cards load via AJAX.
3. `browser_snapshot` → capture the rendered page.
4. Parse job **cards** from the snapshot. Google Jobs renders each listing as a clickable `button` in the left panel. For each card, extract:
   - **title** — the card's heading / link text
   - **company** — the text just below the title (smaller, often grey)
   - **location** — the city/region text
   - **postedAge** — the relative-time text (e.g. `"Posted 3 hours ago"`, `"1 day ago"`, `"Reposted 2 hours ago"`, `"30+ days ago"`, `"just now"`)
   - **viaSource** — the `via X` text at the end of the location line (e.g. `"via LinkedIn"`, `"via Indeed"`, `"via Recruit.net"`). This tells you which portal the posting is listed on.
   - **cardRef** — the `ref=` of the card button, so you can click it later
   - **cardName** — the full accessible name text of the button (needed as the click target)

   **Do NOT try to extract a destination URL from the card itself.** Google Jobs cards are buttons, not hyperlinks — there is no `href` to read. The real apply URL is only accessible inside the detail panel after clicking the card.

5. If a Google "More jobs" / pagination control is present, click it (`browser_click`) to reveal more cards. After the click, `browser_snapshot` again and re-parse the newly revealed cards — but **cap at ~30 cards per query** to bound tokens.

**Bot-challenge handling:** If the snapshot shows a CAPTCHA / "Just a moment…" / "unusual traffic" page instead of job cards, note it and skip that query. Continue with the others. Do not retry aggressively.

### Step 2.5 — Filter to trusted portals only

Google Jobs surfaces listings from a mix of sources. Many are **aggregator/scraper portals** that repost content from the real source — applying through them is slower, less reliable, and often dead ends. Keep only cards whose source (the `via X` text on each card) is one of:

| Source | `via` text example | Why trusted |
|--------|--------------------|------------|
| **LinkedIn Jobs** | `via LinkedIn` | Direct company posting on LinkedIn |
| **Indeed** | `via Indeed` | Primary job board, companies post directly |
| **Company's own careers portal** | `via {Company} Careers` / `via RBC Careers` / `via U.S. Bank Careers` | Direct portal, canonical source |
| **Greenhouse** | `via Greenhouse` (rare on Google Jobs) | Official ATS used by the company |
| **Ashby** | `via Ashby` (rare on Google Jobs) | Official ATS |
| **Lever** | `via Lever` (rare on Google Jobs) | Official ATS |
| **Workday** | `via Workday` or `via {Company} Careers` (URL checked in Step 4 if `myworkdayjobs.com`) | Official ATS |
| **ICIMS** | `via {Company} - ICIMS` | Official ATS |
| **BambooHR** / **Breezy** / **Pinpoint** / **Jobvite** / **SmartRecruiters** | any company's official ATS name | Company's official hiring platform |

**Deny the following known aggregator/scraper portals (non-exhaustive):** Recruit.net, Built In, Zippia, Expertini, Toronto Jobs Expertini, Learn4Good, JobServe, CareerBuilder, Monster, SimplyHired, Glassdoor (aggregated), Jooble, Tarta.ai, Adzuna, GrabJobs, JobisJob, Jobrapido, Neuvoo, WowJobs, Snagajob, ZipRecruiter (aggregated).

**How to check the source on each card:** The `via X` text appears on the card after the location — e.g. `Toronto, ON • via LinkedIn`. Trust or deny based on the `via` text using the tables above. If a card has no recognizable `via` text, **drop it** — Google Jobs cards are buttons without visible URL targets, so there is no URL to fall back on at this stage. The `via` text is the only source signal available before clicking the card.

**Important nuance for LinkedIn:** LinkedIn postings on Google Jobs are often direct company postings. Trust them even though LinkedIn may sometimes require login — the Step 4 fallback chain (`WebSearch`) handles that case.

**Important nuance for Indeed:** Indeed is a primary board, not a scraper. Companies post directly on Indeed. Trust Indeed listings.

---

## Step 3 — Filter to last 24 hours (authoritative freshness gate)

**This is the primary and authoritative freshness filter.** Google Jobs returns a mix of ages regardless of any URL param or on-page filter, so every card MUST pass this text-based check before it proceeds — do not assume the results are already filtered.

Parse `postedAge` text into an age estimate, then keep only cards whose age is **≤ 24 hours**. Boundary rule: `1 day ago` is treated as ~24h and **included** (a "1 day ago" card on Google can be 12–24h old). A card with **no** `postedAge` text (age unknown) is dropped — freshness cannot be confirmed.

Parsing rules:

| Text pattern | Age | Keep? |
|--------------|-----|-------|
| `just now` / `Posted just now` | ~0h | ✅ |
| `N minutes ago` | N min | ✅ |
| `N hours ago` (N < 24) | N h | ✅ |
| `1 day ago` | ~24h (boundary) | ✅ |
| `N days ago` (N > 1) | N×24h | ❌ |
| `30+ days ago` | >24h | ❌ |
| `Reposted …` | strip `Reposted `, then apply the rules above | — |
| `Posted …` | strip `Posted `, then apply the rules above | — |

### Step 3.5 — Deduplicate + cap

Accross all 3 queries, the same posting can appear multiple times. Dedupe by `company + title` (case-insensitive), keeping the one with the freshest `postedAge`.

Then **cap the evaluation set at 10** postings. If more than 10 are fresh, keep the 10 most recent (smallest parsed age). Drop the rest silently but mention the count in the final summary.

---

## Step 4 — Extract the JD + apply URL for each fresh posting (up to 10)

Google Jobs shows each posting's details in a **right-side detail panel** that opens when you click a card. The card buttons remain on the page throughout — clicking a new card replaces the panel for the previous one. So process cards **sequentially**, one at a time:

For each surviving card (that passed Step 2.5's portal filter):

1. **Click the card:** `browser_click` on the card's button (using its `ref=` or full accessible name from Step 2). This opens the detail panel.
2. **Wait for the panel to render** — `browser_snapshot` or `browser_find` on the detail dialog.
3. **Extract the destination URL(s):** the detail panel has a `list` of "Apply on X" links, each with a real `href` (not a Google redirect). Read the URL of the **primary/company ATS link** (the first apply link is usually the best — e.g. `Apply on U.S. Bank Careers` rather than `Apply on Built In` or `Apply on LinkedIn`).
4. **Extract the JD text:** the panel contains a "Job description" heading with expandable text. Click "Show full description" (`browser_click`) if collapsed, then read the full JD content from the panel.
5. **Liveness gate (Block G-style, zero WebSearch):** from the panel content, classify:
   - **active:** title/role + real JD text or an Apply path
   - **closed:** "no longer accepting", "position filled", empty shell with only nav/footer
   - If **closed**, skip this role silently (counts toward the 10-cap).

6. **If the detail panel doesn't have enough JD text** (some Google Jobs panels show only a short snippet), navigate to the apply URL directly as fallback:
   - **Security check:** Before navigating, validate the extracted URL is an `https:` URL whose host matches an approved source (linkedin.com, indeed.com, myworkdayjobs.com, greenhouse.io, jobs.ashbyhq.com, lever.co, or a company careers domain). Reject non-HTTPS or unapproved destinations — skip this card instead.
   - **Open in a new tab:** use `browser_tabs` to create a new tab, `browser_navigate` → the extracted apply URL there. This preserves the Google Jobs page with its card buttons and detail panel for subsequent cards.
   - After extracting the JD, close the fallback tab to return to Google Jobs.
7. **Platform notes for fallback navigation:**
   - Greenhouse / Ashby / Lever / company career pages: snapshot works after full render.
   - Workday (`*.myworkdayjobs.com`): heavy SPA — wait longer before snapshot. WebFetch fallback is allowed only in headless batch mode; if used, mark the report header with `**Verification:** unconfirmed (batch mode)`. In interactive mode, keep it Playwright-only.
   - LinkedIn (`linkedin.com/jobs`): often redirects to login. If the snapshot shows "Sign In", fall back to WebSearch for `{company} {role} job description` — **this counts toward the 5-query total WebSearch budget** (see bounded research budget in Step 5).

**Token discipline:** Do not dump the full JD text into your response. Extract the key fields silently (title, company, location, requirements, salary if listed) and keep only a short note for scoring.

---

## Step 5 — Full A-G evaluation per role

For each posting with a usable JD, run an A-G evaluation using the same scoring system and archetype detection from `_shared.md` and the block structure from `oferta.md`. Proof points from `cv.md` / `article-digest.md` / `_profile.md`. When a market-specific mode (e.g. German `modes/de/`) is active, use its vocabulary and rules, but do not switch market modes solely because a job description is in another language — the user must request it or configure it in `config/profile.yml`.

Evaluate the following blocks (compact form — 2-4 sentences each):

- **Archetype** — one of the 6 from `_shared.md` (AI Platform/LLMOps, Agentic/Automation, Technical AI PM, AI Solutions Architect, AI Forward Deployed, AI Transformation), mapped to the user's full-stack/backend/general-SWE archetypes in `_profile.md` when the role isn't an AI archetype.
- **Block A — Role Summary:** title, seniority, location, remote/hybrid/onsite, one-line on what the role is.
- **Block B — Match with CV:** map the 3–5 strongest JD requirements to concrete `cv.md` proof points (cite the line/project, never fabricate). Score the skill match 1–5.
- **Block C — Level & Strategy:** is the seniority a fit for the candidate (read years of experience from `config/profile.yml` or `cv.md` — do not hardcode)? 1 sentence.
- **Block D — Comp:** **no WebSearch.** If salary is in the JD, compare to the user's comp target from `_profile.md`. If absent, mark "unknown — verify." Do not research Levels.fyi/Glassdoor.
- **Block E & F — Omitted** (Customization Plan and Interview Plan are not evaluated at triage stage). In the saved report, note them as "Omitted — evaluate with `/career-ops oferta` before applying."
- **Block G — Legitimacy:** posting age (already known), apply-button state (from the JD snapshot), and **at most 1 WebSearch** only if a concerning signal appears (vague JD, contradictory requirements, recent layoff news). Default to 0 WebSearch here.

Compute the **global score (1–5)** per `_shared.md` (weighted match + North Star + comp + cultural signals − red flags). Apply Block G as a qualitative flag, not a numeric adjustment.

**Bounded research budget (firm):**
- Max **1 WebSearch per role**, only for Block G concerns.
- Max **5 WebSearch queries total** across the whole run.
- **No subagents, no `deep-research`, no recursive skill calls.**

---

## Step 5.5 — Write report + tracker entry for high-fit roles (≥ 4.0)

For roles with global score **≥ 4.0/5**, do the following so the user has an actionable artifact to apply from:

1. **Reserve a report number:** run `node reserve-report-num.mjs` to get the next sequential `REPORT_NUM`. Guard all subsequent steps with cleanup: if any step fails, release the sentinel before stopping.
2. **Sanitize the company slug:** derive a safe slug from the company name by lowercasing, replacing spaces with hyphens, and removing any characters that are not alphanumeric, hyphens, or underscores. Verify the slug contains no path separators (`/` or `\`), no `..` traversal sequences, and no control characters. Reject the listing if the slug is unsafe.
3. **Write a full evaluation report** to `reports/{REPORT_NUM}-{company-slug}-{YYYY-MM-DD}.md` following the `oferta.md` report format (same header fields: `#`, `URL:`, `Score:`, `PDF:`, `**Legitimacy:** {tier}`, all 7 blocks A-G). Use the evaluation data from Step 5. Verify the resolved path stays within the `reports/` directory.
4. **Generate PDF:** run the full pipeline from `modes/pdf.md` to produce a tailored CV PDF. Run `node generate-pdf.mjs` for the HTML→PDF conversion.
5. **Write a TSV tracker addition** to `batch/tracker-additions/{REPORT_NUM}-{company-slug}.tsv` following the standard 9-column TSV format (see Pipeline Integrity in CLAUDE.md). Verify the resolved path stays within the `batch/tracker-additions/` directory.
6. **Merge + clean up the tracker:**
   - Run `node merge-tracker.mjs` to integrate the new entry into `data/applications.md`.
   - Then run `node normalize-statuses.mjs` and `node dedup-tracker.mjs` to enforce canonical states and remove any duplicates.
   - Finally run `node verify-pipeline.mjs` to confirm pipeline integrity.

(Or skip the full pipeline and do the above in a single pass — the point is the same: high-fit roles get persisted as evaluable artifacts.)

**Always release the sentinel,** even if a step fails partway: `node reserve-report-num.mjs --release {REPORT_NUM}`. A stale reservation blocks future report numbering until garbage-collected.

---

## Step 6 — Rank and output

1. Keep only roles with **global score ≥ 4.0/5**.
2. Rank descending by score (tiebreak: freshest first).
3. Output **only** this format. Do not show marginal/low-fit roles in detail — list them in a one-line "below threshold" footer so the candidate knows what was dropped.

```
## gtop — Google Top Jobs (last 24h)

Scanned: 3 queries · {N} cards total · {M} fresh (<24h) · {K} evaluated · {P} high-fit (≥ 4.0/5)

### ✅ Apply ASAP

1. **{Role} @ {Company}** — 4.X/5
   - Report: {####} | PDF: ✅
   - URL: {direct posting URL}
   - Archetype: {archetype}
   - Posted: {age text} · {location} · {remote/hybrid/onsite}
   - Score: skills X/5 · North Star X/5 · comp X/5 — legitimacy: {High Confidence | Proceed with Caution}
   - Why apply: {one paragraph tying 1–2 concrete cv.md proof points to the top JD requirements — no fabrication}
   - Action: Apply today / Apply this week — {one-line urgency rationale}

2. … (continue for each ≥ 4.0 role)

### Below threshold (evaluated, score < 4.0)

> **Recommendation:** Strongly discourage applying to these roles. Proceed with an application only if the user gives a specific reason to override this recommendation.

- [3.8] {Role} @ {Company} — {one-line reason: e.g. "requires 6+ YOE Scala, level mismatch"}
- …
```

If **no role clears 4.0**, branch on whether any roles were evaluated:

- If at least one role was evaluated (M > 0):
  > No high-fit roles in the last 24h across the 3 queries. {M} fresh postings were evaluated; strongest was {Role} @ {Company} at {score}/5. Re-run tomorrow, adjust keywords in `portals.yml`, or run `/career-ops scan` for direct-portal discovery.
- If no roles were evaluated (M = 0 — e.g. CAPTCHA blocked all queries, or no postings under 24h):
  > No fresh postings found in the last 24h. This could be a quiet day, or CAPTCHA/bot-blocking may have affected the queries. Re-run tomorrow, or try `/career-ops scan` for direct-portal discovery.

**Next steps line** (always, if ≥ 4.0 roles exist):
> These are triage picks, not full evaluations. For any role you'll actually apply to, run `/career-ops oferta {url}` for the complete A-G report + tailored CV, then `/career-ops apply {url}` to fill the form.

---

## Guardrails (firm)

1. **Max 3 search queries** — do not add a 4th.
2. **Max ~30 cards parsed per query.**
3. **Max 10 JD evaluations per run** — if more are fresh, evaluate the 10 most recent.
4. **Max 1 WebSearch per role**, max **5 total** across the run — only for Block G concerns.
5. **No subagents, no `deep-research`, no recursive skill calls.** Sequential, single-pass.
6. **Report + PDF + tracker only for ≥ 4.0 roles.** For roles below threshold, no artifacts are written. No cover letters at this stage.
7. **Never hardcode cv.md metrics.** Read at evaluation time.
8. **Never fabricate proof points.** If a JD requirement isn't backed by an in-scope file, omit the match — silence is fine.
9. If a Google query hits a bot challenge, skip it and reduce scope rather than retry-looping.
10. **Trusted portals only** — after extracting cards, drop any whose source (`via X` text or URL domain) is an aggregator/scraper board (Recruit.net, Built In, Expertini, Zippia, etc.). Only keep LinkedIn, Indeed, Workday, Greenhouse, Ashby, Lever, ICIMS, and direct company careers pages. If uncertain, err on dropping.
