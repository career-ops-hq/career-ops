# Mode: scan — Portal Scanner (Job Discovery)

Scans configured job portals, filters by title relevance, and adds new offers to the pipeline for subsequent evaluation.

> **Note (v1.6+):** The default scanner (`scan.mjs` / `npm run scan`) is **zero-token** and uses structured sources: local parsers configured per company and public Greenhouse, Ashby, and Lever APIs. The levels with Playwright/WebSearch described below represent the **agent** workflow (executed by the AI agent), not what `scan.mjs` does. If a company does not have a local parser or a Greenhouse/Ashby/Lever API, `scan.mjs` will ignore it; in those cases, the agent must manually complete Level 1 (Playwright) or Level 3 (WebSearch).
>
> **Rule (v1.8+):** If a company's local parser completes successfully in Level 0, the agent **must not** repeat that company in Playwright (Level 1) or API (Level 2). In Level 3, general queries remain active, but results from companies already covered by a parser are discarded. See [Rule: Successful Local Parser](#rule-successful-local-parser--no-expensive-scraping-repetition).

## Recommended Execution

Execute as a subagent to avoid consuming the main agent's context:

```python
Agent(
    subagent_type="general-purpose",
    prompt="[content of this file + specific data]",
    run_in_background=True
)
```

## Configuration

Read `portals.yml` which contains:
- `search_queries`: List of WebSearch queries with `site:` filters per portal (broad discovery)
- `tracked_companies`: Specific companies with `careers_url` for direct navigation
- `tracked_companies[].parser`: Optional local parser for SSR pages or stable HTML
- `title_filter`: Keywords (positive/negative/seniority_boost) for filtering job titles

## Discovery Strategy (4 Levels)

### Level 0 — Local Parser (CHEAPEST)

**For each company in `tracked_companies` with a configured `parser`:** execute the local parser defined in `portals.yml`. This level is ideal when the careers page uses SSR or stable HTML and there is already a local JavaScript, Python, or other runtime script that extracts jobs without agent assistance.

Recommended Contract:

```yaml
- name: Example Company
  careers_url: https://example.com/careers
  scan_method: local_parser
  parser:
    command: node
    script: scripts/parsers/example-company-jobs.js
    format: jobs-json-v1
  enabled: true
```

Typically, the parser is company-specific and already knows the URL, selectors, and pagination. `args` is optional: use it however it helps the script author, for example, to reuse it across companies, pass `{careers_url}` or `{company}`, activate a debug flag, save a JSON snapshot, or control any parser-specific behavior.

The parser must output JSON to stdout:

Array format:

```json
[
  { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
]
```

Object format with `jobs`:

```json
{
  "jobs": [
    { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
  ]
}
```

Object format with `results`:

```json
{
  "results": [
    { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
  ]
}
```

`company` is optional; if not provided, `scan.mjs` uses the name from `tracked_companies`.

The scanner does not need to persist the full JSON after reading stdout. If a parser also generates an artifact for auditing or debugging, save it under `data/parser-output/{company}/` and keep it out of git (JSON files in `.gitignore`; `.gitkeep` files are kept in git to preserve the directory structure).

### Rule: Successful Local Parser — No Expensive Scraping Repetition

The goal of `scan_method: local_parser` is to **reduce tokens**: prevent the LLM from rescraping the same company using Playwright or redundant APIs.

During the agent's scan, keep the **`local_parser_ok`** set in memory. This set contains the names of companies (`tracked_companies[].name`) for which Level 0 completed successfully:

- `parser.command` + `parser.script` exist and the script executed without a fatal error.
- stdout was valid JSON (`[]`, `{ jobs: [] }`, or `{ results: [] }`).
- There was no timeout or process crash.

| Level | If the company is in `local_parser_ok` |
|-------|----------------------------------------|
| **1 — Playwright** | **Skip** — do not `browser_navigate` to its `careers_url` (most expensive token-consuming method) |
| **2 — API** | **Skip** — do not WebFetch its `api:` (already covered by parser; `scan.mjs` does not use API after a successful parser either) |
| **3 — WebSearch** | Run **general** queries (`site:`, role titles); **discard** any hit whose normalized company matches `local_parser_ok` |

**Exceptions:**

- Parser **failed** → the company is **not** added to `local_parser_ok`; Levels 1 and 2 apply normally (same criteria as the fallback in `scan.mjs` when the parser fails and an ATS API is available).
- Level 3: do not deactivate cross-cutting queries (`site:jobs.ashbyhq.com`, `site:boards.greenhouse.io`, etc.) — these are used to discover **new** companies. Only filter out results for companies already in `tracked_companies` with a successful parser.
- Do not create dedicated `search_queries` for a company with an active local parser (e.g. `site:jobs.ashbyhq.com/cohere "AI Engineer"`); use the parser or, if it fails, Playwright/API.

**Recommended Level 0:** run `node scan.mjs` (or `npm run scan`) at the start of the agent's workflow. This covers local parsers + APIs in a single zero-token step and returns which companies used the `local-parser` successfully.

### Level 1 — Direct Playwright (PRIMARY)

**For each company in `tracked_companies` that is not in `local_parser_ok`:** Navigate to its `careers_url` with Playwright (`browser_navigate` + `browser_snapshot`), read ALL visible job listings, and extract the title + URL for each. This is the most reliable method because:
- It views the page in real time (not cached Google results)
- It works with SPAs (Ashby, Lever, Workday)
- It detects new offers instantly
- It does not depend on Google indexing

**Every company MUST have a `careers_url` in portals.yml.** If it does not, search for it once, save it, and use it in future scans.

### Level 2 — ATS APIs / Feeds (COMPLEMENTARY)

For companies with a public API or structured feed **that are not in `local_parser_ok`**, use the JSON/XML response as a fast complement to Level 1. This is faster than Playwright and reduces visual scraping errors.

**Current Support (variables inside `{}`):**
- **Greenhouse**: `https://boards-api.greenhouse.io/v1/boards/{company}/jobs`
- **Ashby**: `https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams`
- **BambooHR**: list `https://{company}.bamboohr.com/careers/list`; job details `https://{company}.bamboohr.com/careers/{id}/detail`
- **Lever**: `https://api.lever.co/v0/postings/{company}?mode=json`
- **Teamtailor**: `https://{company}.teamtailor.com/jobs.rss`
- **Workday**: `https://{company}.{shard}.myworkdayjobs.com/wday/cxs/{company}/{site}/jobs`

**Parsing Conventions by Provider:**
- `greenhouse`: `jobs[]` → `title`, `absolute_url`
- `ashby`: GraphQL `ApiJobBoardWithTeams` with `organizationHostedJobsPageName={company}` → `jobBoard.jobPostings[]` (`title`, `id`; build public URL if not present in payload)
- `bamboohr`: list `result[]` → `jobOpeningName`, `id`; build detail URL `https://{company}.bamboohr.com/careers/{id}/detail`; to read full JD, make a GET request to the detail URL and use `result.jobOpening` (`jobOpeningName`, `description`, `datePosted`, `minimumExperience`, `compensation`, `jobOpeningShareUrl`)
- `lever`: root array `[]` → `text`, `hostedUrl` (fallback: `applyUrl`)
- `teamtailor`: RSS items → `title`, `link`
- `workday`: `jobPostings[]`/`jobPostings` (based on tenant) → `title`, `externalPath` or URL built from the host

### Level 3 — WebSearch Queries (BROAD DISCOVERY)

The `search_queries` with `site:` filters cover portals transversally (all Ashby, all Greenhouse, etc.). Useful for discovering NEW companies that are not yet in `tracked_companies`, but results might be outdated. After filtering out hits from companies in `local_parser_ok`, the remaining results are deduplicated with Levels 0–2.

**Execution Priority:**
1. Level 0: Local Parser → companies with a configured `parser:` and existing script; build `local_parser_ok`
2. Level 1: Playwright → `tracked_companies` with a `careers_url`, **except** `local_parser_ok`
3. Level 2: API → `tracked_companies` with an `api:`, **except** `local_parser_ok`
4. Level 3: WebSearch → all `search_queries` with `enabled: true`; discard hits from companies in `local_parser_ok`

Levels are additive — they are executed in order, and results are merged and deduplicated. Companies in `local_parser_ok` **do not** go through Levels 1 or 2; in Level 3, they only contribute transversal discovery (other companies on the same portal).

## Workflow

1. **Read Configuration**: `portals.yml`
2. **Read History**: `data/scan-history.tsv` → already seen URLs
3. **Read Dedup Sources**: `data/applications.md` + `data/pipeline.md`

3.5. **Level 0 — Local Parser** (`scan.mjs`, zero-token):
   Initialize `local_parser_ok = []`.
   Prefer running `node scan.mjs` once to cover all zero-token local parsers + APIs; if executing manually, repeat the following logic.
   For each company in `tracked_companies` with `enabled: true`, `parser.command`, and an existing script:
   a. Execute `parser.command` with `parser.script` + `parser.args` using local process execution without shell.
   b. Expand `{careers_url}` and `{company}` placeholders in arguments.
   c. Read JSON from stdout (`[]`, `{ jobs: [] }`, or `{ results: [] }`).
   d. Normalize each job to `{title, url, company, location}`.
   e. Resolve relative URLs against `careers_url`.
   f. If the parser fails, log the error, attempt fallback via the ATS API if it exists, and continue with the other companies (**do not** add to `local_parser_ok`).
   g. If the parser completes successfully (steps c–e without fatal error), add `entry.name` to `local_parser_ok` and accumulate jobs in candidates.

4. **Level 1 — Playwright Scan** (parallel in batches of 3-5):
   For each company in `tracked_companies` with `enabled: true`, a defined `careers_url`, and a **name not listed in `local_parser_ok`**:
   a. `browser_navigate` to `careers_url`.
   b. `browser_snapshot` to read all job listings.
   c. If the page has filters/departments, navigate the relevant sections.
   d. For each job listing, extract: `{title, url, company}`.
   e. If the page has pagination, navigate subsequent pages.
   f. Accumulate in the candidates list.
   g. If `careers_url` fails (404, redirect), attempt `scan_query` as a fallback and note it to update the URL later.

5. **Level 2 — ATS APIs / Feeds** (parallel):
   For each company in `tracked_companies` with a defined `api:`, `enabled: true`, and a **name not listed in `local_parser_ok`**:
   a. WebFetch the API/feed URL.
   b. If `api_provider` is defined, use its parser; if undefined, infer by domain (`boards-api.greenhouse.io`, `jobs.ashbyhq.com`, `api.lever.co`, `*.bamboohr.com`, `*.teamtailor.com`, `*.myworkdayjobs.com`).
   c. For **Ashby**, send a POST request with:
      - `operationName: ApiJobBoardWithTeams`
      - `variables.organizationHostedJobsPageName: {company}`
      - GraphQL query of `jobBoardWithTeams` + `jobPostings { id title locationName employmentType compensationTierSummary }`
   d. For **BambooHR**, the list only returns basic metadata. For each relevant item, retrieve the `id`, make a GET request to `https://{company}.bamboohr.com/careers/{id}/detail`, and extract the full JD from `result.jobOpening`. Use `jobOpeningShareUrl` as the public URL if present; otherwise, use the detail URL.
   e. For **Workday**, send a JSON POST request with at least `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` and paginate by `offset` until results are exhausted.
   f. For each job, extract and normalize: `{title, url, company}`.
   g. Accumulate in the candidates list (deduplicated against Level 1).

6. **Level 3 — WebSearch Queries** (parallel if possible):
   For each query in `search_queries` with `enabled: true` (general queries by portal/role — not dedicated queries for a company with an active local parser):
   a. Execute WebSearch with the defined `query`.
   b. From each result, extract: `{title, url, company}`.
      - **title**: from the result title (before " @ " or " | ")
      - **url**: URL of the result
      - **company**: after " @ " in the title, or extract from the domain/path
   c. **Skip** the result if the normalized `company` matches any name in `local_parser_ok`.
   d. Accumulate the rest in the candidates list (deduplicated against Levels 0+1+2).

6. **Filter by Title** using `title_filter` from `portals.yml`:
   - At least 1 keyword from `positive` must appear in the title (case-insensitive).
   - 0 keywords from `negative` must appear.
   - `seniority_boost` keywords give priority but are not mandatory.

6b. **Filter by Location (Optional)** using `location_filter` from `portals.yml`:
   - If the `location_filter` block is absent, all locations pass (default behavior).
   - Empty location on a posting → passes (do not penalize missing data).
   - Any keyword from `block` present → reject (precedes allow).
   - Empty `allow` → passes (already cleared block).
   - Non-empty `allow` → must match at least one keyword.
   - All matches are case-insensitive substring matches.
   - The location is persisted as the 7th column in `scan-history.tsv` for later auditing.

7. **Deduplicate** against 3 sources:
   - `scan-history.tsv` → exact URL already seen
   - `applications.md` → normalized company + role already evaluated
   - `pipeline.md` → exact URL already in pending or processed list

7.5. **Verify Liveness of WebSearch Results (Level 3)** — BEFORE adding to pipeline:

   WebSearch results can be outdated (Google caches results for weeks or months). To avoid evaluating expired offers, verify every new URL coming from Level 3 using Playwright. Levels 1 and 2 are inherently real-time and do not require this verification.

   For each new Level 3 URL (sequential — NEVER parallel Playwright):
   a. `browser_navigate` to the URL.
   b. `browser_snapshot` to read the content.
   c. Classify:
      - **Active**: visible job title + role description + visible Apply/Submit/Apply Now control inside the main content area. Do not count generic header/navbar/footer text.
      - **Expired** (any of these signals):
        - Final URL contains `?error=true` (Greenhouse redirects here when an offer is closed).
        - Page contains: "job no longer available" / "no longer open" / "position has been filled" / "this job has expired" / "page not found".
        - Only navbar and footer are visible, with no JD content (content < ~300 characters).
   d. If expired: record in `scan-history.tsv` with status `skipped_expired` and discard.
   e. If active: continue to step 8.

   **Do not interrupt the entire scan if a single URL fails.** If `browser_navigate` errors (timeout, 403, etc.), mark as `skipped_expired` and continue with the next one.

8. **For each new verified offer that passes filters**:
   a. Add to the `pipeline.md` "Pending" section: `- [ ] {url} | {company} | {title}`
   b. Record in `scan-history.tsv`: `{url}\t{date}\t{query_name}\t{title}\t{company}\tadded`

9. **Offers filtered by title**: record in `scan-history.tsv` with status `skipped_title`.
10. **Duplicate offers**: record with status `skipped_dup`.
11. **Expired offers (Level 3)**: record with status `skipped_expired`.

## Extraction of Title and Company from WebSearch Results

WebSearch results typically come in the format: `"Job Title @ Company"`, `"Job Title | Company"`, or `"Job Title — Company"`.

Extraction patterns by portal:
- **Ashby**: `"Senior AI PM (Remote) @ EverAI"` → title: `Senior AI PM`, company: `EverAI`
- **Greenhouse**: `"AI Engineer at Anthropic"` → title: `AI Engineer`, company: `Anthropic`
- **Lever**: `"Product Manager - AI @ Temporal"` → title: `Product Manager - AI`, company: `Temporal`

Generic regex: `(.+?)(?:\s*[@|—–-]\s*|\s+at\s+)(.+?)$`

## Private URLs

If a non-publicly accessible URL is found:
1. Save the JD in `jds/{company}-{role-slug}.md`.
2. Add to `pipeline.md` as: `- [ ] local:jds/{company}-{role-slug}.md | {company} | {title}`

## Scan History

`data/scan-history.tsv` tracks ALL seen URLs:

```tsv
url	first_seen	portal	title	company	status
https://...	2026-02-10	Ashby — AI PM	PM AI	Acme	added
```

## Output Summary

```text
Portal Scan — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Queries executed: N
Offers found: N total
Filtered by title: N relevant
Duplicates: N (already evaluated or in pipeline)
Expired discarded: N (dead links, Level 3)
New added to pipeline.md: N

  + {company} | {title} | {query_name}
  ...

→ Run /career-ops pipeline to evaluate the new offers.
```

## Managing careers_url

Every company in `tracked_companies` must have a `careers_url` — the direct URL to its offers page. This avoids searching for it every time.

**RULE: Always use the corporate careers URL of the company; fallback to the direct ATS endpoint only if no corporate careers page exists.**

The `careers_url` should point to the company's own careers page whenever available. Many companies use Workday, Greenhouse, or Lever under the hood, but expose vacancy IDs only through their corporate domain. Using the direct ATS URL when a corporate careers page exists can cause false 410 errors because job IDs do not match.

| ✅ Correct (corporate) | ❌ Incorrect as first choice (direct ATS) |
|---|---|
| `https://careers.mastercard.com` | `https://mastercard.wd1.myworkdayjobs.com` |
| `https://openai.com/careers` | `https://job-boards.greenhouse.io/openai` |
| `https://stripe.com/jobs` | `https://jobs.lever.co/stripe` |

Fallback: if you only have the direct ATS URL, navigate first to the company's website and locate their corporate careers page. Use the direct ATS URL only if the company does not have its own corporate careers page.

**Known Patterns by Platform:**
- **Ashby:** `https://jobs.ashbyhq.com/{slug}`
- **Greenhouse:** `https://job-boards.greenhouse.io/{slug}` or `https://job-boards.eu.greenhouse.io/{slug}`
- **Lever:** `https://jobs.lever.co/{slug}`
- **BambooHR:** list `https://{company}.bamboohr.com/careers/list`; detail `https://{company}.bamboohr.com/careers/{id}/detail`
- **Teamtailor:** `https://{company}.teamtailor.com/jobs`
- **Workday:** `https://{company}.{shard}.myworkdayjobs.com/{site}`
- **Custom:** The company's own URL (e.g. `https://openai.com/careers`)

**API/Feed Patterns by Platform:**
- **Ashby API:** `https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams`
- **BambooHR API:** list `https://{company}.bamboohr.com/careers/list`; detail `https://{company}.bamboohr.com/careers/{id}/detail` (`result.jobOpening`)
- **Lever API:** `https://api.lever.co/v0/postings/{company}?mode=json`
- **Teamtailor RSS:** `https://{company}.teamtailor.com/jobs.rss`
- **Workday API:** `https://{company}.{shard}.myworkdayjobs.com/wday/cxs/{company}/{site}/jobs`

**If `careers_url` does not exist** for a company:
1. Attempt the pattern of its known platform.
2. If it fails, do a quick WebSearch: `"{company}" careers jobs`.
3. Navigate with Playwright to confirm it works.
4. **Save the found URL in portals.yml** for future scans.

**If `careers_url` returns 404 or redirect:**
1. Note it in the output summary.
2. Attempt `scan_query` as a fallback.
3. Mark it for manual update.

## Maintenance of portals.yml

- **ALWAYS save `careers_url`** when adding a new company.
- Add new queries as interesting portals or roles are discovered.
- Deactivate noisy queries with `enabled: false`.
- Adjust filter keywords as target roles evolve.
- Add companies to `tracked_companies` when you want to follow them closely.
- Verify `careers_url` periodically — companies change ATS platforms.
