# Discovery Drop Gates

Exact filter/drop order for every discovery flow, grounded in code. A posting
(or email, or company entry) is dropped at the first gate that rejects it —
later gates never see it.

```mermaid
flowchart TB
  subgraph EXPLORE["Explore tab"]
    direction TB
    E0["Postings / candidates"] --> E1
    subgraph E1["E1 · free ATS Scan (scan-ats-full.mjs)"]
      direction TB
      e1a["url+title present"] --> e1b["classifyPostingDate: stale → DROP"]
      e1b --> e1c["undated → DROP unless --include-undated"]
      e1c --> e1d["enrichDate attempt if provider supports it"]
      e1d --> e1e["title_filter (title_filter_full if set)"]
      e1e --> e1f["title_filter_overrides (company-scoped broaden)"]
      e1f --> e1g["location_filter: absent=pass"]
      e1g --> e1h["content_filter by_title_keyword"]
      e1h --> e1i["URL dedup vs scan-history"]
      e1i --> e1j["filterBlacklistedOffers"]
      e1j --> e1k["optional --liveness filterLive"]
      e1k --> e1l["KEPT → dry-run / pipeline"]
    end

    E0 --> E2
    subgraph E2["E2 · Portals WebSearch (Level 3)"]
      direction TB
      e2a["search_queries + scan_method:websearch"] --> e2b["agent WebSearch (tokens)"]
      e2b --> e2c["WebFetch verify liveness"]
      e2c --> e2d["discard hits from local_parser_ok cos"]
      e2e["dedup vs Levels 0–2"] --> e2f["KEPT / propose"]
      e2c --> e2e
    end

    E0 --> E3
    subgraph E3["E3 · AI Hunt (modes/hunt.md)"]
      direction TB
      e3a["freeform intent"] --> e3b["~3–6 WebSearches"]
      e3b --> e3c["WebFetch confirm posting exists"]
      e3c --> e3d["generous finder — no score/judge"]
      e3d --> e3e["dedup vs known companies/roles/URLs"]
      e3e --> e3f["KEPT → UNVERIFIED candidates"]
    end
  end

  subgraph PIPE["Pipeline tab"]
    direction TB
    P0["portal.yml entries / emails"] --> P1
    subgraph P1["P1 · Portal scan (scan.mjs)"]
      direction TB
      p1a["enabled? → false = SKIP"]
      p1b["resolveProvider: null → SKIP"]
      p1c["scan_method:websearch → agentHandoff, not scanned"]
      p1d["provider error → resolveErrors"]
      p1b --> p1e["provider.fetch jobs"]
      p1c
      p1e --> p1f["trustValidator enrichment (never drops)"]
      p1f --> p1g["blacklist (data/blacklist.md)"]
      p1g --> p1h["title_filter (pos ∩ ¬neg)"]
      p1h --> p1i["skip_tiers classifyTier"]
      p1i --> p1j["location_filter"]
      p1j --> p1k["postingAgeFilter (max_posting_age_days)"]
      p1k --> p1l["postedDateFilter (--since/--posted-after/before)"]
      p1l --> p1m["salaryFilter"]
      p1m --> p1n["content_filter"]
      p1n --> p1o["country_eligibility_filter"]
      p1o --> p1p["visa_filter"]
      p1p --> p1q["URL dedup (seenUrls)"]
      p1q --> p1r["company+role dedup (seenCompanyRoles)"]
      p1r --> p1s["cooldownFilter (re_apply_windows)"]
      p1s --> p1t["KEPT → newOffers"]
      p1t --> p1u["optional --verify liveness"]
      p1u --> p1v["cross-listing fingerprint warn (no drop)"]
      p1v --> p1w["appendToPipeline / appendToScanHistory"]
    end

    P0 --> P2
    subgraph P2["P2 · Apify (provider: apify)"]
      direction tb
      p2a["scan --company Apify"] --> p2b["dotenv loads APIFY_TOKEN"]
      p2b --> p2c["apify actor fetch"]
      p2c --> p2d["https URL + field_map only"]
      p2d --> p2e["same filter chain as P1"]
      p2e --> p2f["KEPT → pipeline"]
    end

    P0 --> P3
    subgraph P3["P3 · Pipeline direct scan entrypoints"]
      direction TB
      p3a["Portal scan / Apify buttons"] --> p3b["run-core-script → scan.mjs"]
      p3c["Explore Scan tab"] --> p3d["scan-ats-full --dry-run"]
      p3e["Portals / AI search tabs"] --> p3f["agent CLI (tokens)"]
    end
  end

  subgraph GMAIL["Gmail alerts (7th flow)"]
    direction TB
    G0["LinkedIn alert emails"] --> G1
    subgraph G1["linkedin-alerts plugin (enabled)"]
      direction TB
      g1a["OAuth token exchange"] --> g1b["Gmail query: from:jobalerts-noreply + after:{days}"]
      g1b --> g1c["extractJobsFromBody — View job marker"]
      g1c --> g1d["normalize tracking URL → canonical"]
      g1d --> g1e["dedup vs scan-history / pipeline"]
      g1e --> g1f["enrich title (optional)"]
      g1f --> g1g["KEPT → appendToPipeline"]
    end
    G0 --> G2
    subgraph G2["gmail plugin (bundled, disabled)"]
      direction TB
      g2a["Gmail label pull"] --> g2b["any URL from label"]
      g2b --> g2c["disabled in config/plugins.yml"]
    end
  end
```

## Flow reference

| ID | Surface | Entry | Cost |
|----|---------|-------|------|
| **E1** | Explore → Scan | `scan-ats-full.mjs --dry-run` via `/api/explore` | free |
| **E2** | Explore → Portals | agent WebSearch over `search_queries` + `scan_method: websearch` | tokens |
| **E3** | Explore → AI search | agent freeform hunt via `modes/hunt.md` | tokens |
| **P1** | Pipeline → Portal scan | `node scan.mjs` via `run-core-script` | free |
| **P2** | Pipeline → Apify (LinkedIn) | `scan.mjs --company Apify` (provider plugin) | Apify credits |
| **P3** | Pipeline → LinkedIn alerts | `plugins.mjs run linkedin-alerts` | free (Gmail read) |
| **G** | Gmail (both plugins) | linkedin-alerts (enabled) + gmail (disabled) | free |

## E1 — `scan-ats-full.mjs` `processJobs`

Order is fixed in `processJobs` (`scan-ats-full.mjs`):

1. `url` + `title` required (missing → silent continue)
2. `classifyPostingDate(job, cutoff)`:
   - `stale` → drop always
   - `undated` → attempt `provider.enrichDate` if title+location already pass
   - still `stale` after enrich → drop
   - still `undated` and no `--include-undated` → drop (counted)
3. `titleFilter(job.title, companySlug)` — `title_filter_full` if set, else `title_filter`
4. `locationFilter(job.location, job.url, job.title)` — absent location = pass
5. `contentFilter(job.description, matchedTitleKeywords(...))`
6. Dedup via `dedupTokenFor` / `seenUrls`
7. (After sweep) `filterBlacklistedOffers` → optional `--liveness` `filterLive`

Company-level pre-filters before `processJobs`:

- `enabled: false` → skipped
- `resolveProvider` null → skipped (no ATS match for that board)
- dead-board cache (`shouldSkipDeadBoard`)
- resolver outage breaker (consecutive DNS failures)

## P1 — `scan.mjs` filter chain

Exact order in the `for (const job of jobs)` loop:

| # | Gate | Counter | Drop when |
|---|------|---------|-----------|
| 0 | Trust enrichment | — | never drops (annotates only) |
| 1 | Blacklist | `totalFilteredBlacklist` | company in `data/blacklist.md` and no `--include-blacklisted` |
| 2 | Title | `totalFilteredTitle` | fails `title_filter` (pos ∩ ¬neg) |
| 3 | Tier | `totalFilteredTier` | `skip_tiers` + `classifyTier(title)` |
| 4 | Location | `totalFilteredLocation` | fails `location_filter` (absent = pass) |
| 5 | Posting age | `totalFilteredPostingAge` | older than `max_posting_age_days` |
| 6 | Posted date | `totalFilteredPostedDate` | outside `--since` / `--posted-after` / `--posted-before` |
| 7 | Salary | `totalFilteredSalary` | fully outside `salary_filter` range |
| 8 | Content | `totalFilteredContent` | fails `content_filter` on description |
| 9 | Country eligibility | `totalFilteredCountryEligibility` | exclusionary phrase + no inclusive/candidate-country |
| 10 | Visa | `totalFilteredVisa` | fails `visa_filter` |
| 11 | URL dedup | `totalDupes` | `seenUrls.has(normalizeUrlForDedup(url))` |
| 12 | Company+role dedup | `totalDupes` | `seenCompanyRoles` / `seenCompanyRoleBases` |
| 13 | Cooldown | `totalFilteredCooldown` | within `re_apply_windows` cooldown |
| — | (post) Cross-listing | — | **warn only**, never drops |
| — | (post) `--verify` | expired/dropped/invalid | liveness / no-apply / URL-guard |

Websearch handoff: entries with `scan_method: websearch` never reach
`resolveProvider` targets — they go to `agentHandoff` and are only handled by
the Explore Portals (E2) tab or a manual agent scan.

## P2 — Apify child dotenv

- Web `POST /api/portals/run-apify` → `run-coreScript("scan", ["--company","Apify"])`
- Child inherits `process.env` via `cliChildEnv` (Next may lack `APIFY_TOKEN`)
- `scan.mjs` itself loads `dotenv` at startup from repo root → token available
  before `mergeProviderPlugins` / provider fetch
- Probe result: raw child without dotenv has no token; dotenv child does;
  `mergeProviderPlugins` registers the `apify` provider with token present

## Config knobs (current `portals.yml`)

- `title_filter`: 42 positive / 20 negative; `title_filter_full` unset
- `location_filter`: allow/block/block_hard/always_allow all empty → all pass
- `content_filter`, `country_eligibility_filter`, `visa_filter`, `salary_filter`,
  `skip_tiers`, `max_posting_age_days`, `trust_filter`: all unset → pass
- `search_queries`: 53 enabled
- `tracked_companies`: 93 enabled, 52 of which are `scan_method: websearch`
- `job_boards`: 8 enabled (board-browser / weworkremotely / RSS)

## Related

- `modes/scan.md` — agent Levels 0–3 (local parser → Playwright → ATS API → WebSearch)
- `modes/hunt.md` — freeform AI search contract
- `plugins/_engine.mjs` — plugin provider merge + scoped env
- `web/src/lib/core/scan.ts` — Explore Scan orchestrator (`--dry-run`)
- `web/src/app/api/explore/portals/route.ts` — Level 3 source list builder
