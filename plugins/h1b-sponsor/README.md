# H-1B sponsor check

Job descriptions are unreliable on sponsorship. The same "sponsorship considered case by case" line appears on JDs from employers that have filed hundreds of LCAs and from employers that have never filed one. This plugin closes that gap by pulling the actual DOL filing history and returning a tier plus the counts.

## Who this is for

Career-ops users evaluating US roles who need to know whether a specific employer has real, recent sponsorship history before spending an application slot on them. Most useful when you need work authorization and cannot afford to guess.

## What it does

Given a company name, the plugin:

1. Resolves the name to a single best-matching DOL employer entity. If no candidate matches the name closely enough, the result is unknown rather than a guess.
2. Pulls that entity's LCA and PERM records, built from DOL's FY2020 through FY2026-Q3 disclosure files.
3. Computes a tier (see below) from filing volume, recency, GC evidence, and secondary-entity share.
4. Returns the tier plus the counts the tier was derived from.

The plugin does not source or apply to jobs. It answers one question: does the DOL data show this employer actually sponsors.

## Where the lookup happens

Locally, by default. The plugin reads a downloaded index of the DOL data from disk; nothing about the query leaves your machine.

That is the point rather than a detail. A sponsorship lookup discloses two things about you: that you need a visa, and which employers you are considering. Sending that to a server means someone else holds it. So the default path has no server in it at all.

An HTTP backend still exists and is described further down. It runs when you have named an endpoint yourself in `H1B_API_BASE`, which is the only way it ever runs. With no index and no endpoint, the check reports `unknown` and tells you how to install the index. It never picks a host for you.

## Install and enable

The plugin ships bundled with career-ops. Enable it once per repo:

```bash
node plugins.mjs enable h1b-sponsor --confirm
```

To confirm it is active:

```bash
node plugins.mjs list
```

Then install the index (about 8 MiB, downloaded from the data repo's GitHub releases):

```bash
node plugins/h1b-sponsor/install-h1b-index.mjs
```

The installer reads a small pointer file the release publishes, `index-latest.json`, which names the current quarter's index file and its sha256. The download is checked against that digest before it is moved into place, so a truncated or substituted file is never what a lookup reads. It lands in `data/h1b/`, which is already gitignored.

Both assets live under a permanent `index-latest` release tag whose contents are replaced each quarter, rather than under GitHub's "latest release" path, which resolves to the newest release of any kind in the data repo and would start pointing at the wrong thing the day that repo cuts a code release.

`data/h1b/` holds the index and nothing else. It is deliberately separate from `data/cache/h1b/`, where the lookup cache lives: everything in the cache tree is disposable, and the index is an 8 MiB download you chose to install.

### Refreshing

DOL publishes new disclosure data quarterly. Pull the current build over the old one:

```bash
node plugins/h1b-sponsor/install-h1b-index.mjs --force
```

`--force` is required to replace an existing index, so a re-run cannot quietly change the numbers under you. Cached answers are stamped with the index they came from, so a refresh invalidates them rather than mixing builds. The installer prints the build it installed and records it in `index.ndjson.gz.meta.json` next to the index, so you can tell which quarter you are on without downloading anything. `--tag <release>` reads the pointer from a different release tag, for a pinned quarter or a fork.

Installing is the one thing here that touches the network, and it only happens when you run that command. Nothing installs or refreshes on its own.

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

The LCA number there is what the employer filed. How many of those filings came back certified is in the JSON envelope as `totals.n_certified`, which is null when the backend does not report it; the summary form stays one line and leaves it out.

List matching entities instead of checking one. A large employer files under many distinct FEINs, and the listing shows one page of matches at a time, so a broad name shows the first page and the full count. Narrow the query to reach entities past the page cap, then check a specific one by passing its exact name:

```bash
node plugins/h1b-sponsor/check.mjs "Amazon" --search
# 50 of 97 matches for "Amazon" (narrow the query to see the rest):
#   820544687  Amazon.com Services LLC
#   204938068  Amazon Web Services, Inc.
#   ...
```

`--search` does not return the same set on both backends. Locally it lists every entity whose normalized name *contains* the query, ordered by the same filed plus PWD plus PERM sum that ranks resolution; the HTTP endpoint serves prefix buckets keyed on the leading characters of the normalized name, so it misses a mid-name match the local contains test keeps and can surface a shared-prefix neighbour the local test excludes. The single-entity check that `--search` exists to feed applies the same matching rules either way; the residual difference is the endpoint's 50-result page, which can hide a long low-volume name that the local full scan still sees.

Bypass the disk cache and look the employer up again:

```bash
node plugins/h1b-sponsor/check.mjs "Acme Corp" --refresh
```

Write the cache somewhere else, which is useful for tests and throwaway runs:

```bash
node plugins/h1b-sponsor/check.mjs "Acme Corp" --cache-dir /tmp/h1b-cache
```

Answers are cached under `data/cache/h1b/` keyed by the company name passed on the command line. Two spellings of the same employer produce two cache entries. The cache file records `fetchedAt`; re-runs with the same name within the cache window return the cached payload without re-reading the index.

The index is a single compressed file with no seek structure, so a lookup streams it, and every lookup reads all of it. About 2 seconds on the shipped 335k-employer build, hit or miss, against a floor of roughly 1 second for decompressing the file with no work on top.

Nothing can exit early, in either direction. A miss cannot, because the file is ordered by the publisher's normalizer rather than the one this plugin matches with, so running past the query alphabetically proves nothing about what is still ahead. A hit cannot either, because a match found part-way through can still be beaten further down: distinct employers share a name constantly (`Amazon.com Services LLC` appears eight times across casing and punctuation variants, with 1 and 92,132 LCAs among them), and the answer is the one that actually files, which is only known once the file has been read. `--search` reads it all for the same reason.

`H1B_INDEX_PATH` points the plugin at an index somewhere else, for a copy shared between checkouts or kept on another volume:

```bash
export H1B_INDEX_PATH=/opt/h1b/index.ndjson.gz
```

## Agent usage

The companion skill is loaded on demand:

```bash
node plugins.mjs skill h1b-sponsor
```

That prints the how-to the agent reads before running a check during an `oferta` evaluation. The skill covers trigger conditions, per-tier interpretation, and the exact Block G bullet template.

## The HTTP backend, if you want one

A remote endpoint is opt-in, not the default. It runs when `H1B_API_BASE` names an endpoint, and only then. Set it to your own instance, or to the author's:

```bash
export H1B_API_BASE=https://api.surakshith.com/immigration/v1
```

The dataset is public DOL disclosure data and the worker that serves it is open source at https://github.com/msampath/h1b-sponsor-data, so a private instance answers the same questions from the same source. `api.surakshith.com` is operated by the plugin author (msampath); it is one option among them, and no longer the one you get by not choosing.

If the endpoint goes away or errors, the plugin fails closed: results come back `unknown`, the skill skips the Block G bullet, and nothing is fabricated.

Rate limits on the author's instance are 30 requests per hour per (IP, ASN) anonymously and 200 per hour with a key. A check costs at most two requests. Mint a key with `node plugins/h1b-sponsor/token.mjs request`; it prints the token and the `H1B_API_TOKEN=` line once and writes no file for you, since where a durable credential lives is your call. A new key can take about a minute to work on every server, so a 401 in that window means wait and retry. Minting is metered per address: 2 keys at once, then one more every 12 hours.

Notes on configuring an endpoint:

- The URL must be https. Loopback (`http://localhost:8787/...`) is allowed so you can develop against a local worker.
- The redirect guard follows whatever you configure: a response that redirects off your configured host is refused, so a private endpoint does not widen where requests can go.
- `H1B_API_BASE` wins over an installed index. Setting it is a deliberate act, so it is honoured: an index on disk no longer overrides it silently. Unset the variable to go back to the local index; leave it unset and the index is what answers.
- `manifest.json` lists `allowedHosts`, but that field is advisory: the engine applies it only to plugins that call through its own fetch, and these CLIs call `fetch` directly, so editing it changes nothing about where requests go. Leave it alone. Editing a bundled plugin's manifest also trips the engine's tamper check and makes it ask for consent again.
- A bad value fails the command that needed it rather than quietly falling back to anything, because silently sending these queries somewhere the user did not choose is the whole outcome worth avoiding. Setting the variable to an empty string counts as a bad value, since that is what a typo'd shell expansion or a blank `.env` line produces.
- The endpoint is read from the environment only. career-ops has per-plugin settings in `config/plugins.yml`, but these CLIs run standalone and do not read them, so a `base` key there would be ignored.
- A key is issued by one instance and means nothing to another. Unset `H1B_API_TOKEN` when you switch, and mint a new one against the endpoint you moved to.
- Cached answers record what produced them, an endpoint or an index build, so switching between them never serves you the other's numbers.

## Tiers

- `strong`: recent filing volume plus GC evidence, secondary-entity share under 20%.
- `moderate`: recent filings, secondary-entity share under 50%, without meeting the strong bar (no GC evidence, or a share of 20% or more).
- `staffing-shop`: majority of filings list a secondary worksite, indicating placement at client sites.
- `weak`: filings exist but are stale (most recent filing more than two calendar years back) or below the volume floor (fewer than 5 LCA, PWD, and PERM records combined).
- `none`: employer resolved cleanly, zero LCA filings and zero PWD or PERM records in the window.
- `unknown`: the name did not resolve, the lookup failed, or no backend was available. This is not the same as `none`.

Every tier counts filings, not certifications. Filing an LCA is the employer's own act of willingness to sponsor, while a certification, a denial, or a withdrawal is what happened to that filing afterwards: USCIS decides a denial, and a withdrawal usually means the candidate took another offer or the req was cancelled, so neither says anything about whether this employer sponsors. Both numbers are reported, `totals.n_lca` for what was filed and `totals.n_certified` for what was certified, and only the first one feeds the tier.

## Data source and disclaimer

Data comes from public US Department of Labor disclosure files (LCA, PERM), published at https://www.dol.gov/agencies/eta/foreign-labor/performance. The plugin does not scrape private data and does not store any personally identifying information beyond what DOL already publishes. The disk cache holds lookup results only.

This is not legal or immigration advice. A tier reflects historical filings, not a company's willingness to sponsor you specifically for the role you are looking at. Talk to an immigration attorney for anything that turns on policy.

## Uninstall

Remove the plugin from the active config:

```bash
node plugins.mjs remove h1b-sponsor
```

For a bundled plugin this unregisters it and clears its consent pin; the shipped files stay in `plugins/h1b-sponsor/`, so re-adding it later just needs `node plugins.mjs enable h1b-sponsor --confirm`. To delete it entirely, remove the `plugins/h1b-sponsor/` directory. Everything under `data/cache/h1b/` is safe to delete at any time; those are cached answers and the next lookup rebuilds them. Deleting `data/h1b/` removes the index, which means downloading it again.
