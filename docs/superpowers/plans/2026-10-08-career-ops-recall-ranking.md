# Career Ops Recall, Ranking and Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make direct Career Ops search understand the requested occupation and geography, broaden one healthy zero transparently, search approved high-value sources, rank results explainably and report real coverage.

**Architecture:** Add small local occupation and geography catalogs in the web core, then build a pure `SearchPlan` for precise or broad execution. Reuse the existing ATS, market-provider, merge and stream paths; approved directed employers become ordinary ephemeral market boards rather than a second crawler. Score only after eligibility and deduplication, and preserve evidence through the existing `DiscoveredOffer` contract.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node.js `.mjs`, `node:test`, existing provider registry and Swift/AppKit/WebKit macOS wrapper.

**Spec:** `docs/superpowers/specs/2026-10-08-career-ops-recall-ranking-design.md`

## Global Constraints

- Visible copy is Portuguese from Portugal; internal identifiers and protocols remain English.
- Direct discovery is deterministic, zero-token and read-only.
- A healthy precise zero may run exactly one broad pass; partial, degraded and failed searches may not.
- Broadening is limited to catalogued occupation aliases/translations, catalogued metropolitan locations and a maximum 30-day window.
- Every broadening change and every rank component is explainable from stored evidence.
- AI-assisted search still requires the existing explicit token-confirming submit action.
- No new runtime dependency, geocoder, ESCO network call, Scrapling worker or anti-bot bypass is added.
- No login-only source or path disallowed by `robots.txt` is added; Primark Radancy is explicitly excluded.
- Metrics are optional and source-backed; never infer vacancy count, salary, contract, hours or deadline.
- Employment and Freelance filters and results remain isolated.
- Do not stop the currently installed app until a replacement build has passed all deterministic gates.
- Verification must not save, evaluate, apply, message an employer or mutate the user's Career Ops data.

## Review Focus

- An unresolved or ambiguous occupation must fall back to the original literal query instead of silently choosing a concept; Task 1 adds this test.
- Generic words such as `assistant`, `operator`, `sales` or `store` must not create cross-concept false positives; Task 1 adds negative-corpus tests.
- A precise pass that is capped, partial, timed out or drops undated postings must not trigger broadening; Task 2 adds orchestration tests.
- Source selection must not include Primark or arbitrary user URLs and must keep Auchan outside the reverse-ATS sample limit; Task 3 adds planner tests.
- Rank ties, missing dates and missing optional metrics must remain stable and honest; Task 4 adds deterministic and boundary tests.
- Switching Employment/Freelance must update the shareable URL as well as the restored state; Task 5 closes the residual URL mismatch.

---

### Task 1: Local occupation and geography intelligence

**Files:**
- Create: `web/src/lib/occupation-concepts.mjs`
- Create: `web/src/lib/occupation-match.mjs`
- Create: `web/src/lib/location-concepts.mjs`
- Create: `web/tests/lib/occupation-match.test.mjs`
- Create: `web/tests/lib/location-concepts.test.mjs`
- Modify: `web/src/lib/title-fit.mjs`
- Modify: `tests/title-fit.test.mjs`

**Interfaces:**
- Produces: `resolveOccupations(inputs: unknown): { resolved: ResolvedOccupation[]; unresolved: string[]; ambiguous: string[] }`.
- Produces: `expandOccupationTerms(inputs: unknown, languages: string[], limit?: number): { terms: string[]; occupations: ResolvedOccupation[]; omitted: string[] }`.
- Produces: `matchOccupationTitle(title: string, occupations: ResolvedOccupation[]): OccupationEvidence | null`.
- Produces: `resolveLocationInputs(inputs: unknown, phase: "precise" | "broad"): LocationResolution`.
- Preserves: literal input order and literal fallback when no concept resolves.

- [ ] **Step 1: Write failing occupation tests**

Add literal-fixture tests for:

- PT/ES/EN/FR/DE/NL labels resolving to the same concept ID;
- `Operador/a` and `Operador(a)` matching masculine and feminine titles;
- Técnico/Ajudante/Auxiliar de Farmácia matching Pharmacy Assistant and Auxiliar de Farmacia but not pharmacist-manager titles;
- Assistente de Vendas and Sales Assistant matching one concept without accepting `assistant` alone;
- Retail/loja, web/app development, chatbots and AI automation concepts;
- unresolved and ambiguous inputs retaining the original literal query;
- query expansion preserving user terms first, deduplicating and never exceeding 12 terms.

- [ ] **Step 2: Run the occupation test and verify RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/occupation-match.test.mjs`

Expected: FAIL because the modules and interfaces do not exist.

- [ ] **Step 3: Implement the compact concept catalog and matcher**

Use only versioned labels and aliases needed by the accepted use cases, with an ESCO release/source comment and stable local IDs. Reuse accent folding and Unicode token-boundary semantics already established in the project. Do not use fuzzy edit distance, embeddings, related-occupation expansion or runtime network access.

- [ ] **Step 4: Write failing location tests**

Assert that precise Lisboa accepts Lisboa/Lisbon/Lisbonne but not Amadora; broad Lisboa adds only the enumerated metropolitan municipalities and explains that scope. Add corresponding city/country aliases for Spain, United Kingdom, Switzerland, Luxembourg and Netherlands, plus remote. Unknown locations must remain literal and never gain a metro area.

- [ ] **Step 5: Run the location test and verify RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/location-concepts.test.mjs`

Expected: FAIL because `resolveLocationInputs` does not exist.

- [ ] **Step 6: Implement the geography catalog**

Keep this a pure local data module. Return exact aliases for `precise`, metro additions for `broad`, normalized markets and a human-readable expansion reason.

- [ ] **Step 7: Correct `titleFit`'s assistant regression with TDD**

Keep `Sales Assistant` against itself as a positive regression, then add the failing distinction `Sales Manager` against target `Sales Assistant`: it must become `related` at `0.5`, not `strong` at `1`. Remove `assistant` from the generic seniority set; do not repurpose `fit` for search ranking.

Run: `node --test tests/title-fit.test.mjs && cd web && node --experimental-strip-types --test tests/lib/occupation-match.test.mjs tests/lib/location-concepts.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

Stage only Task 1 files and commit: `feat(search): add occupation and location concepts`.

---

### Task 2: Precise-to-broad zero-token search ladder

**Files:**
- Create: `web/src/lib/search-plan.mjs`
- Create: `web/tests/lib/search-plan.test.mjs`
- Modify: `web/src/lib/explore.ts`
- Modify: `web/src/lib/core/scan.ts`
- Modify: `web/src/lib/core/market-scan.ts`
- Modify: `web/src/lib/market-presets.mjs`
- Modify: `web/src/app/api/explore/route.ts`
- Modify: `web/tests/lib/scan-merge.test.mjs`
- Modify: `web/tests/lib/market-presets.test.mjs`
- Modify: `web/tests/lib/market-scan.test.mjs`
- Create: `web/tests/lib/explore-search-ladder.test.mjs`

**Interfaces:**
- Consumes: Task 1 occupation and location resolvers.
- Produces: `buildSearchPlan(filters: ExploreFilters, phase: "precise" | "broad"): SearchPlan`.
- Produces: `SearchExpansion = { phase: "broad"; changes: string[]; originalSinceDays: number; effectiveSinceDays: number; termsAdded: string[]; locationsAdded: string[] }`.
- Extends: `ScanEvent` with `phaseStart` and `expansion` events.
- Changes: `runMarketDiscovery(filters, onEvent, searchPlan?)` and `buildMarketPlan(markets, terms, opportunityType, { occupationIds, locationResolution }?)`; optional final arguments preserve existing callers until Task 3 supplies directed sources.
- Preserves: existing `runDiscovery(filters, onEvent)` entry point while internally executing at most two passes.

- [ ] **Step 1: Write failing pure plan tests**

Assert that:

- precise plans keep the requested window, add only spelling/gender and same-city aliases, and preserve original terms first;
- broad plans add resolved occupation aliases/translations, metro locations and `Math.max(original, 30)` only when the original is below 30;
- unknown professions and locations stay literal;
- expansion receipts list exact differences and remain empty when nothing changes;
- negative title/location filters are unchanged.
- market classification accepts Lisboa/Lisbon/Lisbonne in precise mode and bare Amadora/Sintra/Oeiras/Cascais only in broad mode, while still rejecting foreign qualifiers.

- [ ] **Step 2: Run the pure plan test and verify RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/search-plan.test.mjs`

Expected: FAIL because `buildSearchPlan` does not exist.

- [ ] **Step 3: Implement the smallest pure `SearchPlan` builder**

Produce effective filters plus occupation/location evidence. Cap expanded positive terms at 12 and leave all user-visible filters untouched. Feed the resolved location aliases into `classifyMarketLocation` so the market-receipt filter and the post-merge filter apply the same phase-aware geography as the temporary `allow` list.

- [ ] **Step 4: Write failing orchestration tests**

Use injected pass results rather than external HTTP to prove:

- a healthy precise zero executes one broad pass;
- precise results stop the ladder;
- partial, failed, capped, stale-dataset and dropped-undated summaries stop without broadening;
- a broad zero ends once and leaves assisted search unexecuted;
- `phaseStart` and `expansion` are emitted in order and both passes remain zero-token.

- [ ] **Step 5: Run the ladder tests and verify RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-search-ladder.test.mjs`

Expected: FAIL because discovery has only one pass.

- [ ] **Step 6: Refactor one-pass execution behind the orchestrator**

Keep ATS and market scans parallel within each pass. Pass effective filters to the existing ephemeral portals serializer and market planner. Buffer only the final pass summary needed for the health decision; continue streaming live source progress and offers.

- [ ] **Step 7: Extend the route event contract**

The route still emits a single final `done` and carries the new events without starting the AI path. Existing partial/error semantics remain authoritative. Task 5 adds persistent client consumption with the result UI.

- [ ] **Step 8: Run the discovery regression group**

Run: `cd web && node --experimental-strip-types --test tests/lib/search-plan.test.mjs tests/lib/explore-search-ladder.test.mjs tests/lib/scan-merge.test.mjs tests/lib/market-presets.test.mjs tests/lib/market-scan.test.mjs tests/lib/explore-state.test.mjs tests/lib/explore-assisted-fallback-ui.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

Stage only Task 2 files and commit: `feat(search): broaden healthy zero results`.

---

### Task 3: Localized Workday dates and directed public sources

**Files:**
- Modify: `providers/workday.mjs`
- Modify: `tests/providers/workday.test.mjs`
- Create: `web/src/lib/priority-companies.mjs`
- Modify: `web/src/lib/market-presets.mjs`
- Modify: `web/src/lib/core/portals-serialize.mjs`
- Modify: `web/tests/lib/market-presets.test.mjs`
- Modify: `web/tests/lib/market-scan.test.mjs`

**Interfaces:**
- Consumes: Task 1 resolved occupation IDs/sectors through `SearchPlan` terms.
- Produces: `priorityCompaniesFor(markets, occupationIds): MarketBoard[]` from reviewed static entries only.
- Extends: `MarketBoard` with the existing provider fields required by Workday (`careers_url` and optional `api`).
- Adds: Auchan Portugal Workday tenant `auchanportugal.wd3.myworkdayjobs.com`, site `auchan-retail`, for Portuguese retail/pharmacy concepts.

- [ ] **Step 1: Add failing localized Workday date tests**

Add fixed-clock cases for `Publicado hoje`, `Publicado ontem`, `Publicado há 2 dias`, existing English forms and unknown prose remaining undated. Add another language only when a real provider fixture proves its exact wording.

- [ ] **Step 2: Run the provider test and verify RED**

Run: `node --test tests/providers/workday.test.mjs`

Expected: FAIL for non-English relative dates.

- [ ] **Step 3: Extend the existing relative-date parser**

Normalize accents/case and parse only explicitly supported phrases. Do not guess arbitrary dates or replace unknown text with the current date.

- [ ] **Step 4: Add failing priority-source planner tests**

Assert that:

- Portugal plus a retail/pharmacy concept adds Auchan before generic market boards;
- unrelated concepts or countries do not add Auchan;
- duplicate provider/tenant entries collapse;
- the existing WTTJ/Landing.jobs/Manfred/remote plans remain intact;
- Primark is absent because `/search-jobs/` is disallowed;
- no user-supplied URL can enter the static catalog.

- [ ] **Step 5: Run market planner tests and verify RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/market-presets.test.mjs tests/lib/market-scan.test.mjs`

Expected: FAIL because priority sources are absent.

- [ ] **Step 6: Implement the static priority catalog through the existing market path**

Make priority employers ordinary `job_boards` in the ephemeral plan so they are not subject to the reverse-ATS sample cap. Preserve provider validation, SSRF protections, pacing, timeout, receipts and cleanup. Do not change the global ATS dataset or add random shuffling.

- [ ] **Step 7: Run provider and market regressions**

Run: `node --test tests/providers/workday.test.mjs tests/providers/radancy.test.mjs && cd web && node --experimental-strip-types --test tests/lib/market-presets.test.mjs tests/lib/market-scan.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

Stage only Task 3 files and commit: `feat(search): add directed market sources`.

---

### Task 4: Explainable ranking and source-backed opportunity metrics

**Files:**
- Create: `web/src/lib/opportunity-rank.mjs`
- Create: `web/tests/lib/opportunity-rank.test.mjs`
- Modify: `web/src/lib/explore.ts`
- Modify: `web/src/lib/core/scan.ts`
- Modify: `web/src/lib/core/market-merge.mjs`
- Modify: `web/tests/lib/market-merge.test.mjs`
- Modify: `scan.mjs`
- Modify: `scan-ats-full.mjs`
- Modify: `tests/scan-json-receipt.test.mjs`

**Interfaces:**
- Consumes: Task 1 occupation/location evidence and Task 2 `SearchPlan`.
- Produces: `rankOpportunity(offer, plan, observedAt): OpportunityMatch`.
- Produces: `rankOpportunities(offers, plan, observedAt): DiscoveredOffer[]` sorted by total, date, company and URL.
- Extends: `DiscoveredOffer` with optional `match`, `contractType`, `hours`, `applicationDeadline`, `vacancyCount`, `observedAt` and `availabilityEvidence`.
- Preserves: `fit` as profile compatibility and existing AI fields.

- [ ] **Step 1: Write failing rank tests with hand-derived scores**

Cover exact user phrase, same-concept alias, same city, metro, country/remote, current/old/missing date, complete/incomplete evidence, deterministic ties and no occupation match. Assert the 60/25/10/5 component ceilings and literal reason strings used by the UI.

- [ ] **Step 2: Run ranking tests and verify RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/opportunity-rank.test.mjs`

Expected: FAIL because ranking does not exist.

- [ ] **Step 3: Implement the pure scorer**

Score only eligible merged offers. Return both components and reasons. Do not use profile `fit`, an LLM or pseudo-distance in kilometres.

- [ ] **Step 4: Add failing receipt/merge preservation tests**

Assert that salary plus valid optional metrics survive the `scan.mjs` market receipt, ATS live events, ATS final JSON and deduplication; invalid/negative vacancy counts and blank strings are omitted; multiple sources remain attributed; `observedAt` is the scan timestamp and not copied into `postedAt`. Add the same URL first as a sparse live event and then as a richer final object; the richer fields must fill the existing offer rather than being discarded by `seen`.

- [ ] **Step 5: Run boundary tests and verify RED**

Run: `node --test tests/scan-json-receipt.test.mjs && cd web && node --experimental-strip-types --test tests/lib/market-merge.test.mjs`

Expected: FAIL because fields are discarded.

- [ ] **Step 6: Preserve source fields through both scan paths**

Extend existing serializers and merge fill rules only for the named optional fields. `vacancyCount` must be a positive integer explicitly supplied by the provider. Stamp `observedAt` once per discovery pass.

- [ ] **Step 7: Rank after the single merge point**

Apply ranking after ATS and market results are merged and geography-eligible, before the final summary and `done`. Include every source path, not only ATS.

- [ ] **Step 8: Run ranking and receipt regressions**

Run: `node --test tests/scan-json-receipt.test.mjs tests/title-fit.test.mjs && cd web && node --experimental-strip-types --test tests/lib/opportunity-rank.test.mjs tests/lib/market-merge.test.mjs tests/lib/scan-merge.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

Stage only Task 4 files and commit: `feat(search): rank opportunities with evidence`.

---

### Task 5: Proximity, expansion and coverage interface

**Files:**
- Modify: `web/src/components/explore/explore-provider.tsx`
- Modify: `web/src/components/explore/results-list.tsx`
- Modify: `web/src/components/explore/discovery-card.tsx`
- Modify: `web/src/components/explore/discovering-state.tsx`
- Modify: `web/src/lib/explore-state.mjs`
- Modify: `web/tests/lib/explore-state.test.mjs`
- Modify: `web/tests/lib/explore-freelance-ui.test.mjs`
- Create: `web/tests/lib/explore-ranking-ui.test.mjs`

**Interfaces:**
- Consumes: Tasks 2 and 4 stream events and `DiscoveredOffer.match`.
- Produces: result sort `match | fresh | company`, default `match` for direct search.
- Produces: persistent per-opportunity-type search receipt containing phase, expansion and completed source states.
- Preserves: AI result behavior, saved/pipeline actions and Employment/Freelance result isolation.

- [ ] **Step 1: Write failing UI/state tests**

Assert that:

- direct results default to Proximidade and rank ties are stable;
- AI results retain their existing behavior;
- cards display a compact score band and the first reasons without presenting it as the A–F evaluation;
- optional metrics render only when present;
- broad results show `Pesquisa alargada` plus exact changes;
- source coverage remains visible after completion with returned counts/states;
- switching Employment/Freelance restores each mode's own results, expansion and sources.
- switching Employment/Freelance immediately rewrites the URL to the active snapshot and reload preserves that active type.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-ranking-ui.test.mjs tests/lib/explore-state.test.mjs tests/lib/explore-freelance.test.mjs tests/lib/explore-freelance-ui.test.mjs`

Expected: FAIL because ranking/expansion UI is absent.

- [ ] **Step 3: Add the minimum result controls and card evidence**

Add `Proximidade` beside `Recentes` and `Empresa`. Use plain language such as `Muito próxima`, `Próxima` and `Possível`, while retaining the numeric total in accessible/title detail for debugging. Show source-backed fields as short facts, never empty labels.

- [ ] **Step 4: Persist the expansion and coverage receipt by opportunity type**

Extend the existing result snapshot rather than creating a new store. A type switch restores one complete result state; reset clears only the active type.

- [ ] **Step 5: Run the complete Explore regression group**

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-ranking-ui.test.mjs tests/lib/explore-state.test.mjs tests/lib/explore-freelance.test.mjs tests/lib/explore-freelance-ui.test.mjs tests/lib/explore-assisted-fallback-ui.test.mjs tests/lib/explore-error.test.mjs tests/lib/market-scan.test.mjs tests/lib/market-merge.test.mjs tests/lib/scan-merge.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Stage only Task 5 files and commit: `feat(web): explain search ranking and coverage`.

---

### Task 6: Complete deterministic, live and native verification

**Files:**
- Modify: `docs/contexto/task.md`
- Modify: `docs/contexto/memory.md`
- Create evidence only: `work/recall-ranking-verification/`
- No product-code changes unless a failed check reopens its owning task.

**Interfaces:**
- Consumes: Tasks 1–5 and the already-fixed independent result snapshots.
- Produces: `work/recall-ranking-verification/report.md` with commands, exit codes, live source evidence, app identity and residual limitations.

- [ ] **Step 1: Run focused deterministic suites**

Run the exact focused commands from Tasks 1–5 again from a clean process. Record pass/fail totals and do not reuse earlier output.

- [ ] **Step 2: Run the complete root and web gates**

Run: `node test-all.mjs`

Run: `cd web && npm test && npm run typecheck && BUILD_DIST=.next-recall-ranking npm run build`

Expected: root zero failures; web zero failures apart from an already-documented explicit skip; typecheck/build exit 0.

- [ ] **Step 3: Probe approved public sources without writes**

Run bounded provider probes for Auchan Workday and current WTTJ markets. Confirm `robots.txt`, HTTP success, parsed titles, locations and dates. Record Primark as intentionally excluded. Never add a source merely because the probe can bypass its policy.

- [ ] **Step 4: Exercise real search flows against synthetic data**

Use a synthetic `CAREER_OPS_DATA_DIR` and a production server on a free loopback port. First run a deterministic fixture-backed end-to-end case that must return a ranked Lisboa retail/pharmacy result and exercise the precise-to-broad transition. Then test live sources separately:

- Lisboa retail/pharmacy against approved public sources, recording a concrete result when currently published and otherwise proving an honest healthy zero or incomplete state without weakening the deterministic acceptance;
- remote websites/apps/chatbots/AI automation;
- a healthy broad zero that prepares but does not execute assisted search;
- a partial source run that never broadens automatically;
- Employment/Freelance switches restoring separate filters and results;
- no pipeline, CV, application or settings mutation.

- [ ] **Step 5: Run visual and accessibility inspection**

Inspect the real result cards at desktop and narrow-window widths: ranking order, long titles, expansion receipt, source failures, metrics, keyboard focus, contrast and screen-reader labels. Save final screenshots only.

- [ ] **Step 6: Build and verify the native candidate without replacing the live app**

Build the wrapper into `work/recall-ranking-verification/candidate/Career Ops.app` using the existing `macos/build-app.sh`, current checkout, canonical Node and synthetic data. Verify Swift core/UI checks, plist, strict codesign, executable hash and bundle checkout path. Record the approved `.next-recall-ranking/BUILD_ID`; the candidate may not claim runtime identity until Step 7 activates that exact build.

- [ ] **Step 7: Install only after candidate gates pass**

After every candidate gate passes, terminate only the current Career Ops process. Move the existing `web/.next` to a recoverable backup under this task's `work/` evidence, atomically activate `.next-recall-ranking` as `web/.next`, and install/relaunch the verified wrapper. Confirm `/api/version` and the served `BUILD_ID` equal the approved artefact before repeating the core Employment/Freelance and broad-search UI flows. Roll back the saved `.next` and previous app if launch validation fails. Do not terminate unrelated localhost servers.

- [ ] **Step 8: Update project context and commit**

Record the final behavior, live-source limitations, test totals, installed SHA/BUILD_ID and any ruled deferrals in `task.md` and `memory.md`.

Stage only both context files and commit: `docs: record recall and ranking verification`.

---

### Task 7: Whole-branch review and finish gate

**Files:**
- Evidence only: the Superpowers SDD workspace and `work/recall-ranking-verification/`.
- No product-code changes except one reviewed fix wave if the whole-branch reviewer finds issues.

**Interfaces:**
- Consumes: all task commits, reports and ledger rulings.
- Produces: clean whole-branch review or explicit residual findings with rulings and evidence.

- [ ] **Step 1: Generate the whole-branch review package**

Use the branch merge-base and current HEAD, include the spec, this plan, task reports and ledger deferred findings.

- [ ] **Step 2: Dispatch the most capable final reviewer**

Require both spec compliance and code quality. The reviewer must inspect the complete diff and the verification report, with special attention to false positives, broadening health gates, source policy, metric provenance and cross-mode state.

- [ ] **Step 3: Apply one fix wave if required**

Send all Critical/Important findings to one implementer, rerun covering tests and perform one scoped re-review. Record every ruling and residual.

- [ ] **Step 4: Repeat final verification after any fix**

At minimum rerun the affected focused suite, full web test/typecheck/build and root `test-all.mjs`. Rebuild/reinstall the native app if production code changed after the native candidate.

- [ ] **Step 5: Finish without external integration**

Keep the named branch and worktree intact. Do not merge, push, publish or delete the worktree without a separate explicit integration choice.
