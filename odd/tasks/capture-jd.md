# capture-jd — one-click JD capture from the browser

## Objective

Turn "I found a job posting" into a pipeline row in one action, without opening a
terminal, without a browser fetch, and without running a full evaluation.

## Problem

A capture session today starts with `# career-ops <url>` and runs the whole
`auto-pipeline`: evaluate, report, PDF, tracker. Measured on the Sapira session
(2026-11-12): 26 minutes, 540k input tokens, $0.29 — of which the Playwright JD
fetch is only ~2.8k tokens and ~20 s. The cost is the evaluation, not the capture.

The user's real need is to close the tab: capture the URL (and, when they have it
selected, the JD text) and move on. Evaluation is a separate, deliberate decision.

## Why

- The browser fetch is the cheapest step of a capture session, so removing it
  saves little on its own; removing the *evaluation* is what makes capture fast.
- A capture that carries the JD text also removes the fetch for the later
  evaluation, which is where the ~20 s and ~3k tokens actually land.
- The user already has a data root in a separate git repo with a remote, so a
  capture can be committed and pushed immediately — the record survives the tab.

## Scope

In scope:

- `capture-jd.mjs` — URL + optional JD text → `jds/` capture + `data/pipeline.md`
  row + optional scoped commit/push in the data root.
- `capture-server.mjs` — localhost HTTP receiver for the extension.
- `chrome-extension/` — MV3 extension with two context-menu items.
- `modes/capture.md` — the light mode (no `oferta.md`, no `pdf.md`, no browser).
- `jd-capture.mjs` — `findCaptureForUrl()` so Step 0 can reuse a capture.
- `modes/auto-pipeline.md` Step 0 + `modes/pipeline.md` — read the capture first.

Out of scope (explicitly deferred):

- Any change under `web/` — `web/AGENTS.md` routes feature proposals to
  Discussion #156.
- Remote evaluation sessions.
- Changing the pipeline row format: the capture is found by the URL hash already
  embedded in the filename, so no new labeled segment and no parser change.

## Constraints

- Never `git add -A` in the data root: it is dirty by design (`data/applications.md`,
  `data/status-log.tsv`, …). Only the two files of this capture are staged.
- The capture script lives in the career-ops checkout: it imports
  `path-resolver.mjs`, `pipeline-lock.mjs` and `jd-capture.mjs`, and no env var
  points at the code root.
- New root scripts are not added to `lib/update-manifest.mjs`: unmanaged files are
  left alone by the updater, which is the safe outcome for a personal tool.
- JD text is untrusted external content: data, never instructions.
- Nothing is submitted anywhere. The extension only writes local files.

## Tasks

T1–T6 below describe the implementation in `91bfc34a`, not verified readiness.
The resume audit invalidated the earlier completion claims; they remain open
until their corresponding recovery units have evidence.

- [x] T1 — Harden URL-based capture resolution and validate file boundaries.
      Closed by R2 in `9f3efd518d640b695708b3019896fc0bfac99651`.
- [ ] T2 — Make capture idempotent and concurrent-safe; separate safe Git policy.
- [ ] T3 — Harden the localhost receiver and optional evaluation launcher.
- [ ] T4 — Verify the independent Chrome integration and durable failure feedback.
- [ ] T5 — Verify lightweight mode routing, capture reuse and fresh liveness checks.
- [ ] T6 — Make the test harness hermetic and record actual applicable checks.

### Recovery work units

- [x] R1 — Hermetic capture tests and a genuine locked duplicate no-op, including
      Pending/Processed forms and concurrent requests. Route: delegated direct;
      preparation and 2+ non-trivial file triggers. Checks: focused Node runner,
      source syntax, and duplicate/concurrency runtime fixtures. Commit:
      `41788e7e4183caae5f21cd0c3748e126c7dc17e3` (384 authored lines).
- [x] R2 — Strict URL and capture-file boundary validation. Route: delegated direct;
      preparation and 2+ non-trivial file triggers. Tests: TDD, focused capture
      suite. Acceptance: reject malformed/non-HTTP URLs, credentials, whitespace,
      control characters, backslashes and pipeline delimiters before writes; preserve
      valid raw URL identity. Reject unsafe capture date/extension; derive only safe
      basenames. `findCaptureForUrl` accepts only exact URL-hash suffixes with known
      archive extensions, and only regular non-symlink files. Malformed escaped ATS
      tenant text must not crash label derivation. Preserve existing archive names,
      including report prefixes and collision suffixes. Parent verified; local
      work-unit commit: pending. Keep unchecked until that commit is recorded.
- [ ] R3 — Explicit Git opt-in and isolation from unrelated work/index/environment.
      Route: delegated direct; preparation and 2+ non-trivial file triggers.
      Must never push real data during tests. Commit: pending.
- [ ] R4 — Receiver/authentication and safe, honest optional launcher behavior.
      Route: delegated direct; preparation and 2+ non-trivial file triggers.
      No real evaluation, paid model call or remote session is authorized.
      Commit: pending.
- [ ] R5 — Independent extension actions, durable recovery/status, and installation
      checks. Route: delegated direct; preparation and 2+ non-trivial file triggers.
      Browser installation/use needs its own explicit scope. Commit: pending.
- [ ] R6 — Upstream-core packaging and fresh-verification integration, independently
      of extension acceptance. Route: delegated direct; preparation and 2+ file
      triggers. Wait for maintainer feedback before an upstream PR. Commit: pending.

## Execution configuration

- TDD: **on**, explicitly selected by the user in the resume question. Source:
  current-session parent question answer `TDD (Recommended)`. Require observed
  RED, GREEN, then REFACTOR for behavior changes. Historical task prose and the
  mere presence of tests do not establish the mode.
- Exact focused runner: `node --test tests/capture-jd.test.mjs`.
- RDD: **off**, read from `gentle-ai review mode status`; deciding source global.
  Keep ordinary functional and independent verification; do not launch RDD.
- Delivery strategy: `ask-on-risk`; user selected **core first**, mapped to
  `chain_strategy: stacked-to-main`: independently deliverable core first, optional
  extension later (in the fork if upstream declines it). No shared integration
  branch. Preserve the existing prototype history; extract clean delivery branches
  before any PR, not by rewriting the prototype. No push/PR/merge authorized.
  Existing prototype: 1704 authored additions/deletions. R1 is its own correction
  work unit; later upstream slices must include only their own core behavior,
  tests and docs, not the extension/server history. Commit boundaries will be
  recorded below; forecast and count are evidence, not code-golf targets.
  About 400 lines per task is advisory, not a reason to remove tests or split
  behavior artificially.
- Upstream proposal: https://github.com/career-ops-hq/career-ops/issues/7007.
  Core capture targets zero model calls; an agent invoking it still costs tokens.
  Extension, Git synchronization and remote evaluation are independent follow-ups.
- Initial missing Engram task mirror recovered: the parent created observation
  #222 at `odd/capture-jd/tasks`; the worker synchronized the full task and
  verified normalized content against disk by readback. Keep this mirror current.

## Authorized scope

This worktree (`t3/selected-jd-capture-data-dir`) for code; the data root
(`D:\Repos\my-profesional-career\career-ops-personal`) only through
`capture-jd.mjs` at runtime, never by hand.

## Acceptance criteria

- `node capture-jd.mjs --url <url>` with no text adds exactly one pipeline row and
  writes no capture file.
- With text on stdin it writes `jds/{date}_{company}_{role}_{hash}.md` and the row.
- A second capture of the same URL is a no-op (`duplicate: true`), no commit.
- `--commit` stages only the capture and `data/pipeline.md`, commits, and pushes.
- The extension's first item captures; the second captures and starts an evaluation.
- `findCaptureForUrl()` returns the capture written by `capture-jd.mjs`.

## Checks

- `node --test tests/capture-jd.test.mjs`
- `node scripts/check-syntax.mjs`
- Manual: one real capture against a live posting, then `git log -1` in the data root.

## Progress

- 2026-11-12 — Feature document created. Route: delegated direct (2+ non-trivial
  files, mapping trigger fired on 4+ files read for the design).
- 2026-11-12 — T1–T6 implemented. Two defects found by the smoke test and fixed:
  a multi-tenant ATS host was read as the company (`Boards`), and repeated
  appends left a blank line between rows.
- 2026-11-12 — **Incident, resolved.** The first test run committed into
  `C:\Users\nessu`, a home-directory git repo that contains `%TEMP%`: the commit
  guard only checked "inside a work tree", not "is the work tree root". The six
  stray commits were removed (`git update-ref -d refs/heads/master`; that repo
  had no commits before them) and the guard now requires
  `rev-parse --show-toplevel` to equal the data root. A regression test covers it.

## Verification evidence

- `node --test tests/capture-jd.test.mjs` → 23 pass, 0 fail.
- `node scripts/check-syntax.mjs` → 1627 files passed.
- Manual: URL-only capture writes one row and no `jds/` file; with text it writes
  `jds/2026-11-12_acme_eng_731ac8396cd8e974.md`; `--find` resolves it and prints
  nothing for an unknown URL.
- Manual: `--commit --no-push` in a scratch repo produced a commit containing
  exactly `data/pipeline.md` + the capture, leaving `data/applications.md` dirty.
- `git -C C:\Users\nessu rev-list --all --count` → 0 after cleanup.

## Resume audit

- HEAD and branch verified: `91bfc34a`, `t3/selected-jd-capture-data-dir`.
- Read-only mapper found JD writes preceding deduplication, incomplete Processed
  matching, unsafe ambient Git assumptions, implicit HTTP commit/push, and
  shell-based Windows evaluation launch. No behavioral tests were run unchanged
  because their Git isolation was not proven safe.
- Previous syntax/test outcomes above are historical, not proof of readiness for
  production data. Do not merge or install based on those outcomes.
- Authorized current edits are this worktree only. Tests must use disposable
  scratch data, isolate inherited Git variables/config/hooks, and forbid real
  push/evaluation. Never modify the personal data checkout or home repository.

## R1 evidence — independently verified and committed

- 2026-11-13 — Skills resolved from the injected `work-unit-commits/SKILL.md`
  and `cognitive-doc-design/SKILL.md` paths. TDD on; RDD off. No delegation
  by the worker; the parent used a delegated writer and independent verifier.
- Harness isolated **before the first test run**: inherited `GIT_*` removed;
  global/system config and hooks disabled; explicit local scratch Git identity;
  all scratch roots under one newly created disposable directory, removed by
  the suite's after hook. No `tests/helpers.mjs`, home Git inspection, personal
  data access, real push, browser, evaluation, or dependency installation.
  Initial HTTP fixtures explicitly used `commit:false,push:false,evaluate:false`;
  the disabled-server-evaluation regression was subsequently restored below.
- RED: `node --test tests/capture-jd.test.mjs` exited 1: **24 pass, 6 fail**.
  Named failures: original bytes/mtime/file-count preservation; different
  day/labels archive count; URL-only then text no archive; numbered Processed
  row; strikethrough Processed row; concurrent distinct-text/labels/day capture.
- GREEN: same command exited 0: **30 pass, 0 fail**. Duplicate decision now
  precedes any JD write under the existing pipeline lock. A private unlocked
  helper prevents nested non-reentrant locking; exported `appendPendingRow`
  remains compatible. Duplicate results carry `capture:null` and do not commit.
- REFACTOR: normalized helper indentation and added an independent four-process
  race fixture. Final `node --test tests/capture-jd.test.mjs` exited 0:
  **31 pass, 0 fail**. Runtime fixtures prove one row and exactly the winning
  archive, unchanged original bytes/mtime, trailing-slash deduplication, and
  creation of an absent data directory through the lock's parent creation.
- `node --check capture-jd.mjs` and `node --check tests/capture-jd.test.mjs`
  both exited 0. `node scripts/check-syntax.mjs` exited 0: **1627 files passed**.
- Processed forms are sourced from `modes/pipeline.md` lines 13, 38, 69–70:
  numbered URL cells and expired strikethrough rows. No markdown-link URL form
  was documented there, so no new link grammar was invented for R1.
- Independent verification (parent-reported): a fresh general verifier ran
  **31/31 tests**, both source syntax checks, and `git diff --check`; no R1
  production blocker was found. The verifier identified weakened coverage of
  the server's disabled-evaluation guard in the capture-only fixture.
- Parent correction and spot check (parent-reported): restored `evaluate:true`
  with server `evalEnabled:false`, while keeping `commit:false,push:false`.
  The fixture sets `CAREER_OPS_CLI` to an absolute nonexistent path under its
  disposable sandbox, so a broken guard cannot launch a real paid CLI.
  After correction, `node --test tests/capture-jd.test.mjs` exited 0:
  **31 pass, 0 fail**; `node --check capture-jd.mjs` and
  `node --check tests/capture-jd.test.mjs` exited 0;
  `node scripts/check-syntax.mjs` passed **1627 files**;
  `git diff --check` exited 0 (CRLF informational warning only).
- Native risk assessment (parent-reported): **high/unassessable** because of the
  existing untracked `.atl/` inventory. RDD remains globally off; no native
  review status/start was invoked. This is not an R1 production blocker or
  authorization to alter `.atl/`, commit, or bypass delivery slicing.
- Limitations: the two filesystem writes are serialized, not a crash-atomic
  transaction; a write failure after JD creation can leave an orphan archive.
  Git/index isolation in production, strict URL/file validation, receiver policy,
  and launcher redesign remain R2–R4. Full runner and real-data/manual checks
  were not run; dependency-dependent integration remains pending, not a pass.
- Closure (parent-reported, 2026-11-13): user selected **core first**
  (`Núcleo primero (Recommended)`); delivery remains `ask-on-risk` with
  `chain_strategy: stacked-to-main`, optional extension later/in the fork.
  Parent created and verified local work-unit commit
  `41788e7e4183caae5f21cd0c3748e126c7dc17e3` —
  `fix(capture): preserve original JD on duplicate requests`.
  Exactly `capture-jd.mjs`, `tests/capture-jd.test.mjs`, and
  `odd/tasks/capture-jd.md`: **323 additions + 61 deletions = 384 authored lines**.
  R1 is complete on the existing independent verification and parent spot checks;
  T1–T6 and R2–R6 remain pending (T2 still includes unresolved production Git policy).
  No push/PR/merge; original prototype history preserved. Parent reported only
  pre-existing untracked `.atl/` remained after the implementation commit.
- Rollback boundary: the R1 duplicate-preservation/Processed-row changes and
  hermetic regression fixtures in `capture-jd.mjs` and
  `tests/capture-jd.test.mjs` from the exact commit above, plus corresponding
  R1 task evidence/status. Preserve prototype history, unrelated `.atl/`, and
  parent delivery-policy/task edits; do not blindly discard the entire task
  document. No rollback or additional commit is authorized in this follow-up.

## R2 execution scope

- [ ] R2 — Add tests first for invalid and delimiter-breaking URLs, credentialed
      URLs, malformed percent escapes, path-injection dates/extensions, malformed
      ATS tenant escapes, and resolver false positives (hash only in the middle,
      unknown extension, directory/symlink entries). Preserve known good URL
      hashes, report-prefixed archives and `-2` collision suffixes.
- [ ] R2 — Validate once before labels, pipeline writes, capture writes or Git;
      only absolute http/https URL values with a hostname are accepted. Trim only
      outer whitespace; reject internal whitespace/control bytes, backslashes,
      pipeline `|`, credentials and malformed percent escapes. Keep the valid raw
      URL as the canonical identity; do not refetch or reserialize it.
- [ ] R2 — Restrict generated capture names to a valid real ISO date, safe slugs
      and a single extension; resolver requires the exact 16-hex identity suffix,
      a supported archive extension and a regular file (never symlink/directory).
      Malformed encoded ATS tenant text yields an empty/unknown employer, not the
      ATS vendor. JD output must refuse a pre-existing capture-file symlink before
      modifying its target or appending a pipeline row; intentional pipeline-file
      symlink handling remains unchanged.
- [ ] R2 — Parent completed the PowerShell smoke capture with a disposable
      `CAREER_OPS_DATA_DIR` and a synthetic UTF-8-no-BOM JD file; no real data root
      or clipboard access. The final user-invoked copy/paste command will read
      `Get-Clipboard -Raw`, use a disposable demo root for now and omit `--commit`.
      R2 remains unchecked until its local work-unit commit is recorded.

TDD on; exact runner `node --test tests/capture-jd.test.mjs`. Keep R2 local to this
worktree. R1 remains closed; Git/index production policy (R3), receiver (R4),
extension (R5), and upstream packaging (R6) remain separate. Do not install, use
personal data, launch an evaluation, commit until verification and next boundary
are reviewed, push, open a PR, or merge.

## R2 evidence — parent verified, local work-unit commit pending

- 2026-11-13 — Route: delegated direct; preparation and 2+ non-trivial file
  triggers. `skill_resolution: paths-injected`: read exactly
  `C:\Users\nessu\.agents\skills\work-unit-commits\SKILL.md` and
  `C:\Users\nessu\.agents\skills\cognitive-doc-design\SKILL.md` before work.
  No further delegation, SDD, RDD or native review. TDD on; delivery remains
  **core first**, `ask-on-risk` / `stacked-to-main`. No commit authorization.
- Read this complete task and full Engram observation **#222** before source
  edits. Reconciliation: disk already contained the current R2 acceptance/scope;
  #222 still ended at the earlier scoping next step. Disk was authoritative, and
  the complete mirror is refreshed after this implementation, not used to erase
  those newer scope instructions. Branch/HEAD verified locally:
  `t3/selected-jd-capture-data-dir`, `760f2134b32d81ded616792b285c2a10d36ce1fe`.
- Tests were appended before production edits. Initial RED exited 1:
  **31 pass, 6 fail**. One raw-row preservation assertion expected an extra space;
  corrected that test expectation before production changes. Authoritative RED,
  same runner, exited 1: **32 pass, 5 fail**. Exact failing tests:
  - `invalid capture URLs are refused before any filesystem or Git activity`
  - `captureName rejects impossible dates and unsupported or unsafe extensions`
  - `findCaptureForUrl only resolves a hash suffix and known archive extensions`
  - `findCaptureForUrl ignores directories and symlink captures`
  - `malformed percent-encoded ATS tenant does not throw during label derivation`
- First GREEN: `node --test tests/capture-jd.test.mjs` exited 0:
  **37 pass, 0 fail, 0 skipped**. Shared URL validation now runs before label
  derivation or writes/Git, retaining the trimmed raw URL rather than serializing
  it. Name generation rejects impossible ISO dates and unsafe/unsupported
  extensions before creating directories. ATS tenant decoding falls back safely.
- Boundary-expansion TDD: added empty-authority and collision-index cases before
  refining production code. RED exited 1: **37 pass, 2 fail**; failing tests were
  `invalid capture URLs are refused before any filesystem or Git activity` and
  `findCaptureForUrl only resolves a hash suffix and known archive extensions`.
  Empty authority (triple slash) and unsupported `-1` collision suffix were then
  rejected. GREEN exited 0: **39 pass, 0 fail, 0 skipped**.
- REFACTOR: shared extension allow-list, hoisted identity-suffix regex and simplified
  regular-file candidate metadata; separated directory/symlink cases and added
  invalid-URL lookup evidence. Final focused runner exited 0:
  **40 pass, 0 fail, 0 skipped**. The symlink fixture actually ran on Windows.
  Runtime coverage uses only new disposable scratch roots: invalid URLs never
  reach the label getter or create the root; raw case/port/escape/fragment identity
  survives; report-prefixed `-2.pdf` archives resolve; middle/extended hashes,
  unsupported extensions, directories and symlinks do not. Existing hermetic
  local Git/HTTP fixtures remain unchanged; no real data, push or evaluation.
- Exact foreground checks: `node --check capture-jd.mjs`,
  `node --check jd-capture.mjs`, `node --check tests/capture-jd.test.mjs` all
  exited 0. `node scripts/check-syntax.mjs` exited 0: **1627 .mjs files passed**.
  `git diff --check` exited 0; CRLF-to-LF informational warning only.
  No full suite: dependency-dependent integration is pending; no dependencies
  were installed. No browser, clipboard, remote access, standalone server or
  additional evaluation/smoke command was run by this worker.
- Rollback boundary: only the R2 URL/name validation, ATS decode fallback and
  URL-resolver file checks in `capture-jd.mjs` / `jd-capture.mjs`, the appended
  R2 regressions and symlink import in `tests/capture-jd.test.mjs`, and this R2
  evidence. Preserve R1 behavior/history, the parent's existing task scope edits,
  all other files and the pre-existing `.atl/`. No rollback or commit performed.
- Limitations unchanged: two writes are not crash-atomic; production Git/index
  policy and receiver/launcher behavior remain R3/R4. Resolver checks a file at
  lookup time, not against a later filesystem replacement. R2 is now parent
  verified but remains unchecked until commit; T1 may be marked only after that
  commit is recorded. T2–T6/R3–R6 remain open; no broader readiness claim.

## R2 bounded follow-up — output symlinks and unknown employer

- Parent structural-read findings (not RDD): a pre-existing JD output symlink
  could redirect `atomicWrite` outside `jds/`; malformed tenant fallback invented
  the ATS vendor as employer. Parent reported native risk **medium**, four paths /
  343 changed lines before this correction. RDD stays off; no native review run.
- Tests first: `node --test tests/capture-jd.test.mjs` exited 1:
  **40 pass, 2 fail, 0 skipped**. Exact failures:
  `JD output refuses a pre-existing symlink without changing its target or pipeline`
  (the disposable outside-jds target was overwritten), and
  `malformed percent-encoded ATS tenant does not throw during label derivation`
  (`Greenhouse` was returned instead of empty). All fixtures remained disposable.
- GREEN: same runner exited 0: **42 pass, 0 fail, 0 skipped**. Both new symlink
  fixtures actually ran. JD writes now opt out of symlink following with a clear
  refusal before temp-file creation or pipeline append, under the unchanged lock.
  Target bytes/mtime, pipeline bytes, output symlink and jds inventory stay intact.
  Pipeline atomic writes retain their intentional default symlink semantics.
  An undecodable ATS tenant now returns empty/unknown, never the vendor label.
- REFACTOR: documented the narrowly scoped atomic-write option; no lock, race,
  Git, server, extension or general label-heuristic redesign. All three explicit
  `node --check` commands exited 0; repository syntax passed **1627 .mjs files**;
  `git diff --check` exited 0 (CRLF informational warning only). No full suite,
  installations, personal data, remote activity or evaluation.
- Rollback adds only this output symlink opt-out, malformed-tenant return and
  associated tests/evidence to the existing R2 boundary. No hostile OS TOCTOU or
  parent-directory redesign is claimed. R2 remains unchecked; no commit performed.

## R2 parent verification — accepted, pending local work-unit commit

- Parent-reported structural and spot verification accepted both bounded
  corrections. Fresh parent checks: `node --test tests/capture-jd.test.mjs` →
  **42 pass, 0 fail, 0 skipped**; all three `node --check` commands exited 0;
  `node scripts/check-syntax.mjs` → **1627 files passed**; `git diff --check` → 0.
- Native risk assessment succeeded at **medium**, excluding only the known
  pre-existing untracked `.atl/` inventory by its exact hash. RDD remains globally
  **off**; no review and no fresh independent verifier were launched. Writer
  self-verification plus parent structural and spot checks satisfy the medium/off
  gate. This is parent verification, not a fabricated independent-verifier pass.
- Parent-reported synthetic PowerShell smoke used a newly created disposable
  `CAREER_OPS_DATA_DIR`, a UTF-8-no-BOM synthetic JD file and an `example.test` URL
  with query/fragment, without `--commit`. First capture: **94 ms**; UTF-8
  roundtrip: **true**; `--find`: **exact match**; repeated capture:
  **duplicateNoOp true**; Pending rows: **1**; `committed:false,pushed:false`.
  Parent restored the prior process data-root environment and deleted only the
  disposable data. No clipboard read/write, browser, network, real data or
  evaluation was involved. Context7 official PowerShell documentation checked
  `Get-Clipboard -Raw`; the final demo command reads clipboard only when invoked
  by the user and still uses a disposable data root. No script was created here.
- Coherent R2 change at the accepted code boundary: **436 changed lines**, including
  task evidence. Source, tests and docs are retained without cosmetic trimming;
  this count predates the present bookkeeping-only additions. Future upstream
  extraction is a separate core-first delivery step, not authorization to publish.
- R2 is verified, not committed. Keep R2 unchecked until the local work-unit
  commit is recorded; T1 may be marked only at that point. No other broad task
  is complete. Parent-directory symlinks, hostile OS TOCTOU and crash atomicity
  are not covered. The dependency-dependent full suite remains pending.

## Next step

Obtain explicit authorization for the local R2 work-unit commit and record its
identity before closing R2 or T1. R3 production Git hardening is next before any
real-data use; R4–R6 and future upstream extraction remain separate. No commit,
push, PR, merge, real-data access or optional extension work is authorized by
this documentation-only follow-up.
