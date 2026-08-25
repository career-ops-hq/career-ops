# Local Parser Cookbook

Local parsers let `scan.mjs` read SSR or static career pages without asking an agent to browse the page. The parser runs as a local command, prints normalized jobs JSON to stdout, and lets the scanner keep using the same title filtering, deduplication, and pipeline output flow.

## When To Use This

Use `scan_method: local_parser` when a company career page has stable HTML, a documented endpoint, or another deterministic source that is easier to parse locally than with Playwright. The parser can be written in JavaScript, Python, shell, Go, or any executable available on the user's machine. `career-ops` does not bundle company-specific parser scripts; users bring their own script and point `portals.yml` at it.

## Portal Configuration

Most local parsers are company-specific: the script already knows the source URL, selectors, endpoint quirks, pagination, and normalization rules. In that common case, the scanner only needs to know which command to run:

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

`args` are optional. Use them in whatever way helps the parser author: to make one script reusable across multiple companies, pass `{careers_url}` or `{company}`, enable a debug flag, store a JSON snapshot, or control any other script-specific behavior. `scan.mjs` executes the parser without shell interpolation and expands `{careers_url}` and `{company}` in parser arguments before execution.

## Token savings

`scan.mjs` uses **0 LLM tokens** for discovery: parsers run locally and only normalized job rows enter the pipeline.

In agent scan mode (`/career-ops scan`), Playwright and API niveles send large page or JSON payloads into the model. When Nivel 0 succeeds, `modes/scan.md` requires skipping those niveles for the same company (`local_parser_ok`).

Measured benchmarks (Cohere + Mobileye fixtures, `tiktoken` `cl100k_base`, Playwright vs parser vs API) live on branch `feature/local-parser-integration-tests` with `npm run test:scan-tokens` and full tables in that branch's copy of this cookbook.

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

`title` and `url` are required. `company` is optional; when omitted, the scanner uses the `tracked_companies` entry name. Relative URLs are resolved against `careers_url`.

## Artifact Storage

The scanner only needs stdout. If a parser also writes full JSON snapshots for debugging or audit, store them under `data/parser-output/{company}/`. Generated JSON artifacts must stay out of git; `.gitkeep` placeholders are the only committed exception for preserving directory structure.

## Failure Handling

Local parsers run before ATS API detection. If a local parser fails and the company has a detectable Greenhouse, Ashby, or Lever API source, `scan.mjs` records the parser failure and falls back to the API path for that company instead of dropping it from the scan.

## Agent scan (`/career-ops scan`)

`scan.mjs` already uses one provider per company (local parser only, no duplicate API pass). In full agent scan mode (`modes/scan.md`), when Nivel 0 succeeds for a company, the agent must **skip** Playwright (Nivel 1) and API (Nivel 2) for that company, and filter Nivel 3 WebSearch hits that match the same company. General portal queries (`site:jobs.ashbyhq.com`, role keywords) still run for discovery of other employers.
