# Career Ops market search implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Portugal, Spain, Europe and international remote searches to the existing Explorer without duplicating the provider engine.

**Architecture:** Keep `scan-ats-full.mjs` as the ATS path and run `scan.mjs --dry-run --json` as the market path. Both produce `DiscoveredOffer` records, then one pure merge layer filters geography, normalizes URLs and combines origins before the existing pipeline writer sees them.

**Tech Stack:** Node.js `.mjs`, Next.js 16, React 19, TypeScript, `node:test`, existing provider registry and `js-yaml`.

**Spec:** `docs/superpowers/specs/2026-10-06-career-ops-desktop-markets-design.md`

## Global constraints

- Keep the interface and user-facing errors in Portuguese from Portugal.
- Preserve canonical identifiers, API fields and persisted states in English.
- Search runs in `--dry-run`; it must not alter the real `portals.yml`, pipeline, history or applications.
- Reuse `scan.mjs`, its provider registry, the current ATS scanner and the canonical pipeline writer.
- Default `markets` is empty so existing ATS-only searches behave as before.
- Europe means the EU, EEA, United Kingdom and Switzerland.
- A market-limited search fails closed when location is absent and counts that rejection.
- A remote board proves remote work, not worldwide candidate eligibility.
- No source requiring anti-bot evasion, hidden credentials or unapproved external writes is added.
- Tests use synthetic fixtures; live provider checks are manual verification only.

## Review focus

- A `scan.mjs` exit status of 2 with a valid receipt is a partial result, not total failure; Task 3 tests it.
- Location strings with short country codes must not match arbitrary substrings; Task 2 uses boundary-aware fixtures.
- The same posting arriving through an ATS and a board must appear once and retain both origins; Task 3 tests it.
- A missing `scan.mjs` must not block an ATS-only search, but must report market search as incomplete; Task 3 tests it.
- WTTJ without search terms must be skipped with an actionable source status, not invoked with a guessed query; Tasks 2 and 3 test it.

---

### Task 1: Machine-readable portal offers

**Files:**
- Modify: `scan.mjs`
- Modify: `tests/scan-json-receipt.test.mjs`

**Interfaces:**
- Produces: `normalizeReceiptOffer(offer): {company,title,location,postedAt,url,source,salary?}` exported from `scan.mjs`.
- Produces: optional `offers` array on `careerops.scan.receipt@1`; existing fields and exit codes remain unchanged.

- [ ] **Step 1: Write failing receipt tests**

Add a unit case for `normalizeReceiptOffer` with epoch `postedAt`, salary and missing optional fields, plus an end-to-end dry-run using the existing local-parser fixture. Assert a literal `YYYY-MM-DD` date and confirm the pipeline and history files remain absent.

- [ ] **Step 2: Run the tests and confirm the intended failure**

Run: `node --test tests/scan-json-receipt.test.mjs`

Expected: failure because `normalizeReceiptOffer` or `receipt.offers` does not exist.

- [ ] **Step 3: Add the smallest compatible receipt extension**

Export `normalizeReceiptOffer`; map `verifiedOffers` through it when emitting the receipt. Preserve `added_urls`, `added`, `errors`, `dry_run` and receipt version exactly.

- [ ] **Step 4: Verify the task and the core suite**

Run: `node --test tests/scan-json-receipt.test.mjs`

Run: `node test-all.mjs`

Expected: both exit 0.

- [ ] **Step 5: Commit**

Commit message: `feat(scan): expose dry-run offers in JSON receipt`

### Task 2: Market model, geography and ephemeral board configuration

**Files:**
- Create: `web/src/lib/market-presets.mjs`
- Create: `web/tests/lib/market-presets.test.mjs`
- Modify: `web/src/lib/explore.ts`
- Modify: `web/src/lib/core/portals-serialize.mjs`
- Modify: `web/src/lib/core/portals.ts`
- Modify: `web/tests/lib/portals-serialize.test.mjs`

**Interfaces:**
- Produces: `MarketId = "portugal" | "spain" | "europe" | "remote"` and `ExploreFilters.markets: MarketId[]`.
- Produces: `MARKET_IDS`, `cleanMarkets(value)`, `encodeMarkets(markets)`, `decodeMarkets(value)`, `buildMarketPlan(markets, terms)` and `classifyMarketLocation(offer, plan)` from `market-presets.mjs`.
- Produces: `writeTempPortals(filters, jobBoards, strictLocation)` and compatible `serializePortals` support for `job_boards` and `location_filter.strict`.

- [ ] **Step 1: Write failing model and serialization tests**

Cover default empty markets through the pure codec, duplicate removal, all four source matrices, WTTJ term fallback contract, EU/EEA/UK/CH acceptance, boundary-safe PT/ES matching, remote-source handling and the `missing-location` outcome. Extend the YAML test with literal board objects, nested WTTJ queries and `strict: true`. Typecheck covers the `ExploreFilters` wiring.

- [ ] **Step 2: Run the focused tests and confirm the intended failures**

Run: `cd web && node --test tests/lib/market-presets.test.mjs tests/lib/portals-serialize.test.mjs`

Expected: failure because the market API and board serialization do not exist.

- [ ] **Step 3: Implement the market model and codecs**

Add `markets` to defaults, patches and URL parameters. Keep market sources separate from ATS sources. `buildMarketPlan` returns deduplicated board entries, the selected location policy and skipped-source reasons. Use the existing positive terms; the caller supplies profile terms only when positives are empty.

- [ ] **Step 4: Extend the ephemeral serializer**

Serialize only the selected boards and filters. Quote every user-derived scalar, include `strict: true` for market-limited runs and keep the existing no-market byte shape compatible.

- [ ] **Step 5: Verify focused tests and typecheck**

Run: `cd web && node --test tests/lib/market-presets.test.mjs tests/lib/portals-serialize.test.mjs`

Run: `cd web && npm run typecheck`

Expected: both exit 0.

- [ ] **Step 6: Commit**

Commit message: `feat(web): define market search presets`

### Task 3: Market scanner, partial results and cross-source merge

**Files:**
- Create: `web/src/lib/core/market-merge.mjs`
- Create: `web/src/lib/core/market-scan.ts`
- Create: `web/tests/lib/market-merge.test.mjs`
- Create: `web/tests/lib/market-scan.test.mjs`
- Modify: `web/src/lib/core/scan.ts`
- Modify: `web/src/lib/core/portals.ts`
- Modify: `web/src/lib/explore.ts`
- Modify: `web/src/app/api/explore/route.ts`

**Interfaces:**
- Produces: `runMarketDiscovery(filters, onEvent): Promise<MarketRun>` where `MarketRun` carries offers, source states and missing-location count.
- Produces: `mergeDiscoveredOffers(atsOffers, marketOffers): DiscoveredOffer[]`, using `normalizeUrl` and retaining `sources: string[]`.
- Extends `ScanEvent` with generic source start, completion and failure events; the terminal event contract remains NDJSON.

- [ ] **Step 1: Write failing merge and runner-contract tests**

Use synthetic receipts to cover success, exit 2 with offers and errors, malformed JSON, timeout, every source failing, one source failing, missing `scan.mjs`, missing location and duplicate ATS/market URLs. Assert direct employer or ATS URLs win when equivalent, non-empty fields fill gaps and origins remain ordered without duplicates.

- [ ] **Step 2: Run the focused tests and confirm the intended failures**

Run: `cd web && node --test tests/lib/market-merge.test.mjs tests/lib/market-scan.test.mjs`

Expected: failure because the merge functions do not exist.

- [ ] **Step 3: Implement the pure merge layer**

Normalize receipt dates and salaries into `DiscoveredOffer`, apply `classifyMarketLocation`, count missing locations and merge by the existing canonical URL key.

- [ ] **Step 4: Implement the market child process**

Spawn `scan.mjs --dry-run --json --since <days>` without a shell, pass the ephemeral portals path through `CAREER_OPS_PORTALS`, parse a valid receipt even when exit status is 2, enforce the existing scan timeout and clean up the temporary file in `finally`.

- [ ] **Step 5: Join ATS and market discovery**

Run both paths concurrently only when their selections are non-empty. An absent core scanner affects only its own path. Emit partial status when a child fails or a source reports an error; emit failure only when no selected path produces a valid result.

- [ ] **Step 6: Verify focused and web suites**

Run: `cd web && node --test tests/lib/market-merge.test.mjs tests/lib/market-scan.test.mjs tests/lib/scan-merge.test.mjs`

Run: `cd web && npm test && npm run typecheck`

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

Commit message: `feat(web): join ATS and market discovery`

### Task 4: Market controls and result provenance

**Files:**
- Modify: `web/src/components/explore/filter-builder.tsx`
- Modify: `web/src/components/explore/explore-provider.tsx`
- Modify: `web/src/components/explore/discovering-state.tsx`
- Modify: `web/src/components/explore/discovery-card.tsx`
- Modify: `web/src/components/explore/results-list.tsx`
- Create: `web/src/lib/explore-state.mjs`
- Create: `web/tests/lib/explore-state.test.mjs`

**Interfaces:**
- Consumes: `ExploreFilters.markets`, generic source events and `DiscoveredOffer.sources` from Tasks 2 and 3.
- Produces: separate market controls, source progress, partial/failure copy and visible provenance.

- [ ] **Step 1: Add failing consumer-level assertions to the pure state helper**

Define `summarizeDiscoveryState(sourceStates, offerCount)` in `explore-state.mjs`. Assert complete, partial, all-failed and zero-healthy-results outcomes without testing React internals.

- [ ] **Step 2: Run the focused test and confirm the intended failure**

Run: `cd web && node --test tests/lib/explore-state.test.mjs`

Expected: failure on the missing state behavior.

- [ ] **Step 3: Add market controls and source states**

Render four accessible chips under a `Mercados` label, independent of ATS chips. Show provider progress by its public label. Keep 44px mobile targets and visible keyboard focus.

- [ ] **Step 4: Show provenance and honest unknowns**

Show all origins, `Data não indicada` when necessary and `Países elegíveis não indicados` for remote offers without published eligibility. Do not call partial results complete and do not show a healthy empty-state when every source failed.

- [ ] **Step 5: Verify tests, typecheck and build**

Run: `cd web && npm test && npm run typecheck && npm run build`

Expected: exit 0 with no failed tests or TypeScript errors.

- [ ] **Step 6: Commit**

Commit message: `feat(web): add market search controls and provenance`

### Task 5: Market search end-to-end verification and project record

**Files:**
- Modify: `docs/contexto/task.md`
- Modify: `docs/contexto/memory.md`

**Interfaces:**
- Consumes: completed market search through the production Next build.
- Produces: dated record of verified behavior, failures encountered and deliberate limits.

- [ ] **Step 1: Start the production build against a synthetic data root**

Use a temporary directory, never the real application tracker. Start on a free loopback port and retain the server log.

- [ ] **Step 2: Exercise the complete browser flow**

Verify ATS-only compatibility, each market selector, combined markets, add-to-pipeline confirmation and mobile layout at 390 by 844. Use the live providers only as a manual check of the complete UI path. Confirm partial failure, total failure and zero healthy results through the synthetic runner and state-helper tests, not by mutating live sources. Confirm the browser console has no errors.

- [ ] **Step 3: Run the complete automated gate**

Run: `node test-all.mjs`

Run: `cd web && npm test && npm run typecheck && npm run build`

Expected: every command exits 0.

- [ ] **Step 4: Update context and commit**

Record exact test counts, commands, manual paths and known limitations in `task.md` and `memory.md`.

Commit message: `docs(project): record market search verification`
