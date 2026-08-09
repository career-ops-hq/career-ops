# H-1B sponsor check

Job descriptions are unreliable on sponsorship. The same "sponsorship considered case by case" line appears on JDs from employers that have filed hundreds of LCAs and from employers that have never filed one. This plugin closes that gap by pulling the actual DOL filing history and returning a tier plus the counts.

## Who this is for

Career-ops users evaluating US roles who need to know whether a specific employer has real, recent sponsorship history before spending an application slot on them. Most useful when you need work authorization and cannot afford to guess.

## What it does

Given a company name, the plugin:

1. Resolves the name to one or more DOL employer entities.
2. Pulls the last five years of LCA and PERM records for those entities.
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

Bypass the disk cache and re-fetch from the API:

```bash
node plugins/h1b-sponsor/check.mjs "Acme Corp" --refresh
```

Responses are cached under `data/cache/h1b/` keyed by resolved employer. The cache file records `fetchedAt`; re-runs within the cache window return the same payload without hitting the API.

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

To request a key, email `sms@surakshith.com` with the repo URL you plan to use it from. Set the key as `H1B_API_TOKEN` in your environment; the CLI picks it up automatically.

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

## Uninstall and disable

Disable without removing:

```bash
node plugins.mjs disable h1b-sponsor
```

The plugin directory can be removed from `plugins/` if you want it gone entirely. Cached responses under `data/cache/h1b/` are safe to delete at any time.
