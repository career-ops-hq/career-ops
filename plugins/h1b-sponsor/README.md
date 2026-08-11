# H-1B sponsor check

Job descriptions are unreliable on sponsorship. The same "sponsorship considered case by case" line appears on JDs from employers that have filed hundreds of LCAs and from employers that have never filed one. This plugin closes that gap by pulling the actual DOL filing history and returning a tier plus the counts.

## Who this is for

Career-ops users evaluating US roles who need to know whether a specific employer has real, recent sponsorship history before spending an application slot on them. Most useful when you need work authorization and cannot afford to guess.

## What it does

Given a company name, the plugin:

1. Resolves the name to a single best-matching DOL employer entity. If no candidate matches the name closely enough, the result is unknown rather than a guess.
2. Pulls the last five years of LCA and PERM records for that entity.
3. Computes a tier (see below) from filing volume, recency, GC evidence, and secondary-entity share.
4. Returns the tier plus the counts the tier was derived from.

The plugin does not source or apply to jobs. It answers one question: does the DOL data show this employer actually sponsors.

## Install and enable

The plugin ships bundled with career-ops. Enable it once per repo:

```bash
node plugins.mjs enable h1b-sponsor --confirm
```

To confirm it is active:

```bash
node plugins.mjs list
```

## CLI usage

Default output is a human-readable summary:

```bash
node plugins/h1b-sponsor/check.mjs "Acme Corp"
```

Machine-readable JSON, for scripts and for the agent:

```bash
node plugins/h1b-sponsor/check.mjs "Acme Corp" --json
```

One-line output for scripts and shell pipelines:

```bash
node plugins/h1b-sponsor/check.mjs "Acme Corp" --summary
# strong: Acme Corp - 412 LCAs, 5 PWDs, 37 PERMs, active 2020-2024
```

List every matching entity instead of checking one. A large employer files under many distinct FEINs, so a broad name returns all of them; check a specific one by passing its exact name:

```bash
node plugins/h1b-sponsor/check.mjs "Amazon" --search
# 50 of 96 matches for "Amazon" (narrow the query to see the rest):
#   820544687  Amazon.com Services LLC
#   204938068  Amazon Web Services, Inc.
#   ...
```

Bypass the disk cache and re-fetch from the API:

```bash
node plugins/h1b-sponsor/check.mjs "Acme Corp" --refresh
```

Write the cache somewhere else, which is useful for tests and throwaway runs:

```bash
node plugins/h1b-sponsor/check.mjs "Acme Corp" --cache-dir /tmp/h1b-cache
```

Responses are cached under `data/cache/h1b/` keyed by the company name passed on the command line. Two spellings of the same employer produce two cache entries. The cache file records `fetchedAt`; re-runs with the same name within the cache window return the cached payload without hitting the API.

## Agent usage

The companion skill is loaded on demand:

```bash
node plugins.mjs skill h1b-sponsor
```

That prints the how-to the agent reads before running a check during an `oferta` evaluation. The skill covers trigger conditions, per-tier interpretation, and the exact Block G bullet template.

## Auth and rate limits

The API is `https://api.surakshith.com/immigration/v1`.

- Anonymous: 30 requests per hour per (IP, ASN) pair. Enough for interactive evaluation.
- Keyed: 200 requests per hour per key. Suitable for batch runs.

Request a key yourself:

```bash
node plugins/h1b-sponsor/token.mjs request
```

It prints the token once and the `H1B_API_TOKEN=` line, and never writes any file for you. Set that variable in your shell before running the plugin:

```bash
export H1B_API_TOKEN=h1b_your_token_here
```

The CLI reads `H1B_API_TOKEN` from the environment. It does not load `.env` on its own, so put the line in `.env` only if your workflow loads that file (direnv, or `node --env-file=.env`).

A new key takes up to about 60 seconds to be recognized on every server, so a 401 in the first minute is a sign to wait and retry.

The same endpoint with curl, if you prefer:

```bash
curl -X POST https://api.surakshith.com/immigration/v1/keys/request
```

Minting is metered per address with a token bucket: 2 keys are available at once, then one more every 12 hours. If you are throttled or the endpoint is unreachable, email `sms@surakshith.com` with the repo URL you plan to use it from.

## Who runs the backend

The API at `api.surakshith.com` is operated by the plugin author (msampath). The worker is open source at https://github.com/msampath/h1b-sponsor-data, and it is built over the public US DOL disclosure files at https://www.dol.gov/agencies/eta/foreign-labor/performance.

If the API goes away or starts returning errors, the plugin fails closed: results come back `unknown`, the skill skips the Block G bullet, and nothing is fabricated. Cached results keep serving until their TTL runs out.

## Tiers

- `strong`: recent filing volume plus GC evidence, secondary-entity share under 20%.
- `moderate`: recent filings, secondary-entity share under 50%, without meeting the strong bar (no GC evidence, or a share of 20% or more).
- `staffing-shop`: majority of filings list a secondary worksite, indicating placement at client sites.
- `weak`: filings exist but are stale (most recent filing more than two calendar years back) or below the volume floor (fewer than 5 filings).
- `none`: employer resolved cleanly, zero filings in the window.
- `unknown`: the name did not resolve, or the API call failed. This is not the same as `none`.

## Data source and disclaimer

Data comes from public US Department of Labor disclosure files (LCA, PERM). The plugin does not scrape private data and does not store any personally identifying information beyond what DOL already publishes. The disk cache holds API responses only.

This is not legal or immigration advice. A tier reflects historical filings, not a company's willingness to sponsor you specifically for the role you are looking at. Talk to an immigration attorney for anything that turns on policy.

## Uninstall

Remove the plugin from the active config:

```bash
node plugins.mjs remove h1b-sponsor
```

For a bundled plugin this unregisters it and clears its consent pin; the shipped files stay in `plugins/h1b-sponsor/`, so re-adding it later just needs `node plugins.mjs enable h1b-sponsor --confirm`. To delete it entirely, remove the `plugins/h1b-sponsor/` directory. Cached responses under `data/cache/h1b/` are safe to delete at any time.
