# Career Ops Search Separation and Agent Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate Employment and Freelance search state completely, offer an explicit assisted-search fallback after healthy zero results, and safely compare Claude, Codex, Gemini and Cursor on the same read-only search.

**Architecture:** Keep the existing `ExploreFilters` contract and expose one active filter object, backed by two in-memory snapshots in `ExploreProvider`. Fix the two callers that incorrectly seed empty Freelance searches. Reuse the existing AI route and fencing system, adding temporary working directories and a verified Gemini plan-mode fence rather than creating a second execution path.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node.js `.mjs` modules and `node:test`, Swift/AppKit/WebKit macOS wrapper.

**Spec:** `docs/superpowers/specs/2026-10-07-career-ops-search-separation-and-agent-matrix-design.md`

## Global Constraints

- All visible copy remains Portuguese from Portugal; internal state and protocols remain English.
- Employment and Freelance never inherit each other's role, exclusion, location or market filters.
- A first-time Freelance snapshot is global and empty; do not invent Portugal, Remote or profile roles.
- Direct discovery remains zero-token and never writes to the user pipeline.
- Assisted discovery spends tokens only after the user presses the existing explicit submit button.
- Partial, degraded and failed direct scans never masquerade as healthy zero results.
- AI-search workers are read-only, run in temporary working directories and may not load mutable hooks or MCP servers.
- No scraping, new provider dependency or new credential is added.
- Do not stop the installed app at `127.0.0.1:51021` until a replacement build is verified and ready to install.
- No applications, employer messages, evaluations or pipeline saves during verification.

## Review Focus

- A URL that opens directly in Freelance must seed only Freelance and leave the later Employment snapshot intact; Task 1 adds this test.
- Repeated Employment/Freelance switches must not share mutable arrays; Task 1 adds an aliasing regression test.
- Empty Freelance searches with non-empty profile and `portals.yml` roles must keep WTTJ queries empty; Task 2 adds manual and scheduled tests.
- Healthy-zero assistance must not appear for degraded/failed scans or submit a model automatically; Task 3 adds rendering and event tests.
- An installed but unfenceable Gemini, a non-zero CLI exit and cleanup after cancellation must fail visibly without touching real data; Task 4 adds route and fencing tests.

---

### Task 1: Independent Employment and Freelance snapshots

**Files:**
- Modify: `web/src/lib/explore.ts`
- Modify: `web/src/components/explore/explore-provider.tsx`
- Modify: `web/src/components/explore/filter-builder.tsx`
- Modify: `web/src/components/explore/explorer-view.tsx`
- Modify: `web/tests/lib/explore-freelance.test.mjs`
- Modify: `web/tests/lib/explore-freelance-ui.test.mjs`

**Interfaces:**
- Produces: `OpportunitySnapshots = Record<OpportunityType, ExploreFilters>`.
- Produces: `createOpportunitySnapshots(active: ExploreFilters, employmentSeed?: ExploreFilters): OpportunitySnapshots`.
- Produces: `updateOpportunitySnapshot(snapshots: OpportunitySnapshots, next: ExploreFilters): OpportunitySnapshots`.
- Produces: `switchOpportunitySnapshot(snapshots: OpportunitySnapshots, current: ExploreFilters, target: OpportunityType): { snapshots: OpportunitySnapshots; filters: ExploreFilters }`.
- Produces: `applyOpportunityPatch(snapshots: OpportunitySnapshots, current: ExploreFilters, raw: Record<string, unknown>, merge?: boolean): { snapshots: OpportunitySnapshots; filters: ExploreFilters }`.
- Preserves: `ExploreCtx.filters`, `setFilters` and `applyPatch`; extends `initFilters(active, employmentSeed?)` with an optional seed.

- [ ] **Step 1: Write failing pure-state tests**

Add tests named:

- `first freelance snapshot is global and empty without mutating the employment seed`
- `switching twice restores independent filters without shared arrays`
- `an assistant patch that changes opportunity type uses the destination snapshot`
- `a freelance URL seeds freelance without replacing the default employment snapshot`
- `the URL round-trip contains only the active snapshot`

Assert that the Employment fixture containing Farmácia, `iOS` and Lisboa remains byte-for-byte equivalent after switching, while first-time Freelance has empty list fields, `opportunityType: "freelance"`, `sinceDays: 7` and `limitPerAts: 150`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-freelance.test.mjs`

Expected: FAIL because the snapshot functions do not exist.

- [ ] **Step 3: Implement the pure snapshot functions**

Implement the five interfaces in `web/src/lib/explore.ts`. Clone every list field when storing or restoring a snapshot. The first Freelance snapshot derives only scalar limits and ATS defaults from `DEFAULT_FILTERS`; every semantic filter list and `markets` is empty. `applyOpportunityPatch` selects the destination snapshot before calling `parseExplorePatch` when the patch changes type.

- [ ] **Step 4: Integrate snapshots at the provider boundary**

Make `ExploreProvider` own a `useRef<OpportunitySnapshots>`. Route `setFilters`, `initFilters` and `applyPatch` through the pure helpers. A type change in `setFilters` restores the destination snapshot instead of accepting the caller's copied source fields. Keep `FilterBuilder` on its existing `onChange` contract. In `ExplorerView`, pass `seed.filters` as the optional Employment seed when the URL opens directly in Freelance.

- [ ] **Step 5: Add and run the UI wiring regression**

Extend `explore-freelance-ui.test.mjs` to assert that the type buttons still emit the selected type through `onChange` and that no extra persistent store or page is introduced.

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-freelance.test.mjs tests/lib/explore-freelance-ui.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run the URL and market regression group**

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-market-inference.test.mjs tests/lib/market-presets.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Stage only the six Task 1 files and commit: `fix(web): separate employment and freelance filters`.

---

### Task 2: Remove Employment fallbacks from empty Freelance searches

**Files:**
- Modify: `web/src/lib/core/market-scan.ts`
- Modify: `web/scripts/scheduled-jobs-runner.mjs`
- Modify: `web/tests/lib/market-scan.test.mjs`
- Modify: `web/tests/lib/scheduled-jobs-runner.test.mjs`

**Interfaces:**
- Consumes: existing `ExploreFilters.opportunityType` and `buildMarketPlan(selected, terms, opportunityType)`.
- Preserves: Employment fallback to profile or `portals.yml` roles.
- Produces: empty `queries` for empty Freelance in both manual and scheduled paths.

- [ ] **Step 1: Write the failing manual-search regression**

Add `empty freelance discovery ignores non-empty profile targets` to `market-scan.test.mjs`. Use the existing sandbox with a profile containing `Data Engineer`, capture the temporary portals file and assert `job_boards[0].wttj.queries` is `[]` and no `Data Engineer` appears.

- [ ] **Step 2: Verify the manual test is RED**

Run: `cd web && node --experimental-strip-types --test --test-name-pattern="empty freelance" tests/lib/market-scan.test.mjs`

Expected: FAIL because `loadProfileTargets()` currently seeds Freelance.

- [ ] **Step 3: Restrict the manual fallback**

In `runMarketDiscovery`, use profile targets only when `filters.opportunityType !== "freelance"`; pass `[]` for empty Freelance.

- [ ] **Step 4: Write the failing scheduled-search regression**

Add `empty saved freelance ignores employment roles from portals.yml`. Use a `portals.yml` containing `title_filter.positive: [engineer]`, execute a Freelance job with empty positives and assert both the WTTJ query list and serialized title positives are empty.

In the same fixture, assert the generated plan has no employment ATS and retains `contract_type:freelance`.

- [ ] **Step 5: Verify the scheduled test is RED**

Run: `cd web && node --experimental-strip-types --test --test-name-pattern="empty saved freelance" tests/lib/scheduled-jobs-runner.test.mjs`

Expected: FAIL because `fallbackPositive` is currently reused.

- [ ] **Step 6: Restrict the scheduled fallback**

Compute one `searchTerms` value: explicit positives; otherwise `[]` for Freelance; otherwise `fallbackPositive`. Reuse it in the title overlay, `buildMarketPlan` and market-only serialization.

- [ ] **Step 7: Run the complete discovery/scheduler group**

Run: `cd web && node --experimental-strip-types --test tests/lib/market-scan.test.mjs tests/lib/scheduled-jobs-runner.test.mjs tests/lib/market-presets.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

Stage only the four Task 2 files and commit: `fix(web): keep empty freelance searches unseeded`.

---

### Task 3: Prepare assisted search after a healthy zero

**Files:**
- Modify: `web/src/lib/explore.ts`
- Modify: `web/src/components/explore/explorer-view.tsx`
- Modify: `web/tests/lib/explore-freelance.test.mjs`
- Create: `web/tests/lib/explore-assisted-fallback-ui.test.mjs`

**Interfaces:**
- Produces: `filtersToAssistedIntent(filters: ExploreFilters): string`.
- Preserves: `setMode("ai")`, `setAiIntent(intent)` and the existing `AiSearchBox` submit action.
- Does not call: `discoverAI` while preparing the fallback.

- [ ] **Step 1: Write failing intent tests**

Test Employment and Freelance fixtures plus a completely empty filter. Assert PT-PT output includes only present roles, exclusions, locations, markets and period; the empty fixture must not mention salary, seniority, remote or a country.

- [ ] **Step 2: Verify intent tests are RED**

Run: `cd web && node --experimental-strip-types --test --test-name-pattern="assisted intent" tests/lib/explore-freelance.test.mjs`

Expected: FAIL because `filtersToAssistedIntent` does not exist.

- [ ] **Step 3: Implement the smallest deterministic formatter**

Add `filtersToAssistedIntent` beside the existing URL codecs in `explore.ts` and import the existing `MARKET_LABEL` from `./explore-state.mjs`. Join only non-empty clauses; do not add a new natural-language library.

- [ ] **Step 4: Write the failing UI fallback tests**

Render `ExplorerView` with provider fixtures for `empty-current`, `empty-loose`, `degraded` and `failed`. Assert the two healthy states show `Preparar pesquisa assistida`; degraded/failed do not. Clicking the healthy action must call `setAiIntent` then `setMode("ai")`, and must not call `discoverAI`.

- [ ] **Step 5: Verify UI tests are RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-assisted-fallback-ui.test.mjs`

Expected: FAIL because the secondary action is absent.

- [ ] **Step 6: Add the secondary action to healthy empty states**

Extend `EmptyState` with an optional secondary action. In `ExplorerView`, prepare the intent and switch mode for `empty-current` and `empty-loose` only. Keep the existing direct-search retry as the primary action.

- [ ] **Step 7: Run the Explore UI group**

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-freelance.test.mjs tests/lib/explore-freelance-ui.test.mjs tests/lib/explore-assisted-fallback-ui.test.mjs tests/lib/explore-state.test.mjs tests/lib/explore-error.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

Stage only the four Task 3 files and commit: `feat(web): prepare assisted search after healthy zero`.

---

### Task 4: Fence and isolate every assisted-search CLI

**Files:**
- Modify: `web/src/lib/cli-fencing.mjs`
- Modify: `web/src/app/api/explore/ai/route.ts`
- Modify: `web/tests/lib/cli-fencing.test.mjs`
- Modify: `web/tests/lib/clis-permissions.test.mjs`
- Create: `web/tests/lib/explore-ai-route.test.mjs`

**Interfaces:**
- Produces: Gemini web-search argv containing `--approval-mode plan`, `--skip-trust` and no write-enabling flag.
- Produces: a temporary working directory for every CLI invocation.
- Produces: a temporary Gemini system settings file with hooks disabled and no MCP servers enabled, passed through `GEMINI_CLI_SYSTEM_SETTINGS_PATH` while preserving the authenticated user home.
- Preserves: Claude strict MCP/tool scope, Codex read-only sandbox/output file and Cursor Ask mode.
- Produces: visible non-zero-exit diagnostics for every CLI and cleanup on close, error, cancellation and timeout.

- [ ] **Step 1: Write failing Gemini fencing tests**

Assert `fenceArgs` accepts Gemini only for `CAPS.webSearchOnly` when argv has `--approval-mode plan`, rejects `yolo`, `auto_edit`, `--yolo` and missing plan mode, and reports fencing level `full` for the verified shape.

- [ ] **Step 2: Verify fencing tests are RED**

Run: `cd web && node --experimental-strip-types --test --test-name-pattern="Gemini|gemini" tests/lib/cli-fencing.test.mjs tests/lib/clis-permissions.test.mjs`

Expected: FAIL because Gemini is absent from `FENCERS`.

- [ ] **Step 3: Add the Gemini fencer and route-specific argv**

Implement one `verifyGeminiArgs(args, capabilities)` in `cli-fencing.mjs`. Reject write-capable capabilities and write-enabling approval flags. In the AI route, build Gemini's query argv explicitly with `-p`, `--approval-mode`, `plan`, `--skip-trust` and text output; do not change the generic Gemini `CliSpec.args` used by unrelated workers. The temporary directory is the trusted workspace for this invocation, so `--skip-trust` prevents Gemini from silently replacing plan mode with its default approval mode.

- [ ] **Step 4: Write failing route integration tests with fake CLIs**

Create executable fixtures for Claude, Codex, Gemini and Cursor in a temporary PATH; the Codex fixture's `--help` response must expose the flags required by `codexFencingSupported`. For each requested ID, call `POST` and assert:

- the requested binary ran, with no CLI substitution;
- cwd is a fresh temporary directory outside the synthetic data root;
- the expected read-only flags are present;
- Gemini receives a readable temporary system settings path whose JSON disables hooks and MCP access;
- a valid offer envelope reaches the response;
- a non-zero exit produces a visible diagnostic;
- cancellation, timeout and completion remove the temporary directory;
- no sentinel in the synthetic checkout or data root changes.

- [ ] **Step 5: Verify route tests are RED**

Run: `cd web && node --experimental-strip-types --test tests/lib/explore-ai-route.test.mjs`

Expected: FAIL because non-Codex workers use `careerOpsRoot()`, Gemini lacks settings isolation and non-Codex exit codes are ignored.

- [ ] **Step 6: Generalize temporary-directory lifecycle**

Create one temporary child cwd for every CLI. Keep Codex's result file inside it. For Gemini only, create `settings.json` in that directory with `{ "hooksConfig": { "enabled": false }, "mcp": { "allowed": [] } }`, and add `GEMINI_CLI_SYSTEM_SETTINGS_PATH` to the child environment while preserving the authenticated user home. Replace Codex-only cleanup with unconditional cleanup of the invocation directory.

- [ ] **Step 7: Surface non-zero exits without leaking stderr**

On every non-zero close, emit a bounded agent-specific diagnostic if no usable final content was emitted. Do not forward raw stderr because it may contain the prompt or secrets. Keep the existing Codex metadata-only logging.

- [ ] **Step 8: Run the CLI security group**

Run: `cd web && node --experimental-strip-types --test tests/lib/cli-fencing.test.mjs tests/lib/clis-permissions.test.mjs tests/lib/clis-coverage.test.mjs tests/lib/spawn-cli.test.mjs tests/lib/cli-fallback.test.mjs tests/lib/explore-ai-route.test.mjs tests/lib/explore-ai-prompt.test.mjs tests/lib/explore-ai-dedup.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

Stage only the five Task 4 files and commit: `fix(web): isolate assisted search agents`.

---

### Task 5: Verify the complete web application before spending tokens

**Files:**
- Create evidence only: `work/search-separation-verification/`
- No product-code changes unless a failing test reopens its owning task.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: deterministic logs and a short `report.md` under the evidence directory.

- [ ] **Step 1: Run the complete web suite**

Run: `cd web && npm test`

Expected: all tests pass; the existing explicit skip may remain.

- [ ] **Step 2: Run static and production checks**

Run: `cd web && npm run typecheck && npm run build`

Expected: both exit 0.

- [ ] **Step 3: Run the root gate**

Run: `node test-all.mjs`

Expected: zero failures; known warnings must be named in the report.

- [ ] **Step 4: Start an isolated production instance**

Use a synthetic `CAREER_OPS_ROOT`, the current checkout as `CAREER_OPS_CODE_ROOT`, and a free loopback port. Preserve the installed app and its process. Record the server PID, port and root in `work/search-separation-verification/report.md`.

- [ ] **Step 5: Exercise the browser flow**

Verify:

- seeded Employment → first Freelance is empty;
- edit Freelance → Employment restores → Freelance restores;
- direct healthy zero shows the assisted preparation action;
- preparation fills the query and does not start an agent;
- degraded and failed fixtures do not show that action;
- one direct search ends as a healthy zero and another returns at least one live result when the public sources permit it; if no source returns a live result, record the external limitation instead of fabricating a pass;
- save/search controls remain usable at 390 × 844 and desktop width;
- no console error and no write under the real data root.

Capture only the final decisive screenshots and the browser-console result.

- [ ] **Step 6: Stop the isolated server only**

Terminate the PID started in Step 4. Confirm `http://127.0.0.1:51021/` still returns HTTP 200.

---

### Task 6: Run the real four-agent matrix and replace the installed app

**Files:**
- Create evidence only: `work/agent-matrix/`
- Modify after verified results: `docs/contexto/task.md`
- Modify after verified results: `docs/contexto/memory.md`

**Interfaces:**
- Consumes: verified `/api/explore/ai`, existing `check-liveness.mjs`, synthetic data root and the exact query from the spec.
- Produces: `work/agent-matrix/report.md` with one row per requested CLI and measured values only.

- [ ] **Step 1: Confirm four identities without model calls**

Record versions and authenticated status for Claude, Codex, Gemini and Cursor. Confirm the route resolves each requested ID without substitution. If Gemini's installed version does not expose verified plan mode, mark it blocked and do not invoke it.

- [ ] **Step 2: Run the identical query sequentially**

For each safe CLI, use the same synthetic root and exact spec query. Run one agent at a time. Record HTTP/exit outcome, duration, valid envelopes and raw candidate count. Never save, evaluate or apply.

- [ ] **Step 3: Validate and deduplicate URLs**

Normalize candidates with the existing parser/dedup path. Check liveness using `check-liveness.mjs --no-fallback` or its supported read-only equivalent. Record complete fields, unique live URLs, tokens and cost only when the CLI reports them.

- [ ] **Step 4: Write the comparison report**

For each requested CLI, distinguish `passed`, `failed` or `blocked by safety`. Use `N/D` for unavailable duration, token or cost fields. Include source diversity and the failure reason without copying prompts, auth data or full stderr.

- [ ] **Step 5: Build and verify the macOS bundle**

Run the established `macos/build-app.sh` flow into a fresh directory under `work/`, then run Swift core tests, plist checks and ad-hoc codesign verification. Do not overwrite the installed app yet.

- [ ] **Step 6: Install atomically and test launch**

Only after Steps 1–5 are green, close the current Career Ops app, preserve the previous verified bundle inside the build workspace, install the new bundle to `~/Applications/Career Ops.app`, launch it and confirm the new local URL returns HTTP 200. Verify one Employment/Freelance switch and the assisted-preparation flow in the installed app.

- [ ] **Step 7: Update project context and commit**

Record exact tests, matrix outcomes, blocked agents, installed revision, BUILD_ID, listener and the no-application/no-write boundary in `docs/contexto/task.md` and `docs/contexto/memory.md`.

Stage only those two documentation files and commit: `docs: record search separation verification`.

- [ ] **Step 8: Request final whole-branch review**

Review the full range from `59c03e8d` to HEAD for spec compliance, security, test quality and unintended changes. Resolve Critical or Important findings, rerun affected checks, then use `superpowers:finishing-a-development-branch` without pushing or merging.
