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

- [ ] T1 — Harden URL-based capture resolution and validate file boundaries.
- [ ] T2 — Make capture idempotent and concurrent-safe; separate safe Git policy.
- [ ] T3 — Harden the localhost receiver and optional evaluation launcher.
- [ ] T4 — Verify the independent Chrome integration and durable failure feedback.
- [ ] T5 — Verify lightweight mode routing, capture reuse and fresh liveness checks.
- [ ] T6 — Make the test harness hermetic and record actual applicable checks.

### Recovery work units

- [ ] R1 — Hermetic capture tests and a genuine locked duplicate no-op, including
      Pending/Processed forms and concurrent requests. Route: delegated direct;
      preparation and 2+ non-trivial file triggers. Checks: focused Node runner,
      source syntax, and duplicate/concurrency runtime fixtures. Commit: pending.
- [ ] R2 — Strict URL and capture-file boundary validation. Route: delegated direct;
      preparation and 2+ non-trivial file triggers. Acceptance/checks to be scoped
      before implementation. Commit: pending.
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

## R1 evidence — independently verified, pending commit decision

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
- Rollback: reverse only the R1 changes in `capture-jd.mjs`,
  `tests/capture-jd.test.mjs`, and this evidence/next-step section. Preserve the
  parent's existing task edits and unrelated `.atl/`. No commit was created;
  human delivery-slicing decision and work-unit commit remain required.
  R1 stays unchecked solely for that delivery boundary, not missing verification.

## Next step

Decide delivery slicing before authorizing a work-unit commit; no commit is
currently permitted. Independent verification and parent spot checks are complete.
R1 and all T1–T6 remain unchecked; proceed to separately scoped R2–R6 only
after parent coordination. Do not install the extension, merge into another
checkout, touch real personal data, or publish changes.
