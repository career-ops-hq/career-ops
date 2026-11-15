# Local Parser Cookbook

Local parsers let `scan.mjs` read SSR, static, or user-saved career pages without asking an agent to browse the page. The parser runs as a local command, prints normalized jobs JSON to stdout, and lets the scanner keep using the same title filtering, deduplication, and pipeline output flow.

## When To Use This

Use `scan_method: local_parser` when a company career page has stable HTML, a documented endpoint, or another deterministic source that is easier to parse locally than with Playwright. The parser can be written in JavaScript, Python, shell, Go, or any executable available on the user's machine. Company-specific parsers are user-supplied and referenced from `portals.yml`; copy them into the gitignored `local/` directory so site-specific HTML can evolve independently from core.

## Portal Configuration

Most local parsers are company-specific: the script already knows the source URL, selectors, endpoint quirks, pagination, and normalization rules. In that common case, the scanner only needs to know which command to run:

```yaml
- name: Example Company
  careers_url: https://example.com/careers
  scan_method: local_parser
  parser:
    command: node
    script: local/example-company-jobs.js
    format: jobs-json-v1
  enabled: true
```

`args` are optional. Use them in whatever way helps the parser author: to make one script reusable across multiple companies, pass `{careers_url}` or `{company}`, enable a debug flag, store a JSON snapshot, or control any other script-specific behavior. `scan.mjs` executes the parser without shell interpolation and expands `{careers_url}` and `{company}` in parser arguments before execution.

## Where the script lives

`providers/local-parser.mjs` only runs a script that resolves **inside the repository root** — a whitelisted interpreter (`node`, `python3`, …) must take an in-repo script as its first argument, and a path that escapes the root is rejected. This is a deliberate boundary: `portals.yml` is not fully trusted on a shared or template config, so the parser command cannot point at an arbitrary binary or a file outside the checkout.

Because the script has to sit in the tree, put a parser you do not intend to contribute under a path that Git ignores, so it is never staged:

- `local/` is gitignored by default. `local/acme-jobs.mjs` is the simplest home for a one-off, company-specific parser.
- `portals.yml` is already a user-layer file (gitignored), so the `parser:` block that points at the script stays private too.

Use `scripts/parsers/` only for a parser you plan to open a PR for. `career-ops` does not bundle company-specific parser scripts, so in practice that is rare.

In a Claude Code plugin install, the repository root is the plugin cache, which Claude Code replaces on every plugin update (see [CLAUDE_PLUGIN.md](CLAUDE_PLUGIN.md)). Claude Code deletes a parser in that copy's `local/` on the next update, and the provider refuses a script in `~/career-ops-data` because it sits outside the root. For now, run custom local parsers from a git checkout. [#7152](https://github.com/career-ops-hq/career-ops/issues/7152) tracks running a parser from the data root.

## Token savings

`scan.mjs` uses **0 LLM tokens** for discovery: parsers run locally and only normalized job rows enter the pipeline.

In agent scan mode (`/career-ops scan`), Playwright and API levels send large page or JSON payloads into the model. When Level 0 succeeds, `modes/scan.md` requires skipping those levels for the same company (`local_parser_ok`).

## Stdout Contract

The parser must print one of these JSON shapes to stdout:

```json
[
  { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
]
```

```json
{
  "jobs": [
    { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
  ]
}
```

```json
{
  "results": [
    { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
  ]
}
```

`title` and `url` are required. A parser may send `name` instead of `title`, and `jobUrl`, `job_url`, `applyUrl` or `apply_url` instead of `url`; the scanner takes the first one set, in that order. `company` is optional; when omitted, the scanner uses the `tracked_companies` entry name. `location` is optional, and `locations` works as an alias. Either one can be a string, an array, or objects with a `name` or `text` field; the scanner joins a list with `, `. `postedAt` is optional — an epoch-milliseconds number or a `Date.parse`-able string (`"2026-09-08"`, an ISO timestamp); `posted_at` / `publishedAt` / `published_at` / `published_date` / `datePosted` / `date_posted` are accepted as aliases (the last is what a page's JSON-LD `JobPosting` block calls it). It feeds `--posted-after` / `--since` and the scan output's posting-date column; an unparseable value is dropped and the row is still kept. Relative URLs are resolved against `careers_url`.

The scanner keeps any other key a parser prints, such as a department, a requisition id or an occupation code, and passes it through unchanged on the job row ([#4697](https://github.com/career-ops-hq/career-ops/pull/4697)).

## Artifact Storage

The scanner only needs stdout. If a parser also writes full JSON snapshots for debugging or audit, store them under `data/parser-output/{company}/`. Generated JSON artifacts must stay out of git; `.gitkeep` placeholders are the only committed exception for preserving directory structure.

## Recipes

Optional site-specific examples live under [`docs/recipes/`](recipes/). These
recipes are documentation examples, not bundled core integrations; copy the
parser you want into `local/`, review it, and point your private `portals.yml`
entry at that local copy. The
[Ontario GO Jobs recipe](recipes/gojobs/) demonstrates a deliberately offline
workflow for HTML saved after a normal browser session; it never automates or
bypasses the site's interactive challenge.

## Failure Handling

Local parsers run before ATS API detection. If a local parser fails, `scan.mjs` looks for another provider that detects the company: a built-in ATS API such as Greenhouse, Ashby or Lever, any other provider in `providers/`, or a provider plugin. When it finds one, it scans the company through that provider and records `local parser failed, used API fallback: <error>` instead of dropping the company from the scan.

A parser the provider can't run safely (an unknown command, a missing script, or a path outside the repository root) never starts. The scanner treats the company as if it had no `parser:` block: it uses whichever other provider detects the company, or skips it.

## Agent scan (`/career-ops scan`)

`scan.mjs` already uses one provider per company (local parser only, no duplicate API pass). In full agent scan mode (`modes/scan.md`), when Level 0 succeeds for a company, the agent must **skip** Playwright (Level 1) and API (Level 2) for that company, and filter Level 3 WebSearch hits that match the same company. General portal queries (`site:jobs.ashbyhq.com`, role keywords) still run for discovery of other employers.
