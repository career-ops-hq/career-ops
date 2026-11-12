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

- [x] T1 — `findCaptureForUrl()` in `jd-capture.mjs`, matching the
      `sha256(url)[0:16]` identity `archive-posting.mjs` already writes.
- [x] T2 — `capture-jd.mjs`: capture file, pipeline row, dedup, scoped commit/push.
- [x] T3 — `capture-server.mjs`: token-guarded localhost receiver, CORS for the
      extension, optional detached evaluation.
- [x] T4 — `chrome-extension/`: manifest, service worker, three context menus,
      options page for the token.
- [x] T5 — `modes/capture.md` + Step 0 capture reuse in `auto-pipeline.md` and
      `pipeline.md`, mode registered in `SKILL.md`.
- [x] T6 — `tests/capture-jd.test.mjs` + `package.json` scripts.

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

## Next step

Merge into the checkout the user actually runs (`D:\Repos\career-ops`), then load
the extension unpacked and do one real capture against a live posting.
