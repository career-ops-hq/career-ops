// run-prompts-verification.test.mjs — the evaluate prompt's verification branch
// and its context budget.
//
// P0: the prompt used to hardcode "Playwright is unavailable" for EVERY CLI. That
// is backwards for opencode, which doctor.mjs reports as HAVING @playwright/mcp —
// so the one CLI that can verify a posting was told to skip verification, and 42
// reports in reports/ carry the unconfirmed header as a result.
//
// P1: the prompt used to bulk-pre-read cv.md + config/profile.yml +
// modes/_profile.md on top of a 186 KB context. modes/oferta.md already names
// those three as primary sources and directs reading them at the point of use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";

const base = { kind: "evaluate", input: "https://example.com/jobs/2", today: "2026-02-02" };

test("with Playwright available the worker is told to verify, and how", () => {
  const p = buildPrompt({ ...base, cliId: "opencode", hasPlaywright: true });
  assert.match(p, /browser_navigate/);
  assert.match(p, /browser_snapshot/);
  assert.match(p, /Verification: verified via Playwright/);
  assert.doesNotMatch(
    p,
    /unconfirmed \(batch mode\)/,
    "a Playwright-capable CLI must not be steered to the unconfirmed header",
  );
});

test("a confirmed-dead posting stops the run instead of producing a phantom report", () => {
  const p = buildPrompt({ ...base, cliId: "opencode", hasPlaywright: true });
  assert.match(p, /DEAD/);
  assert.match(p, /write NO report/);
});

test("without Playwright the WebFetch fallback and its header are preserved verbatim", () => {
  // 42 existing reports and the pipeline/apply liveness-sweep greps key on this
  // exact string. It must not drift.
  const p = buildPrompt({ ...base, cliId: "claude", hasPlaywright: false });
  assert.match(p, /Verification: unconfirmed \(batch mode\)/);
  assert.match(p, /WebFetch/);
  assert.doesNotMatch(p, /browser_navigate/);
});

test("hasPlaywright defaults to the conservative branch", () => {
  const p = buildPrompt(base);
  assert.match(p, /unconfirmed \(batch mode\)/, "an unknown CLI must not be told to claim a verification");
});

test("the unavailable branch names the CLI so the card explains itself", () => {
  assert.match(buildPrompt({ ...base, cliId: "claude", hasPlaywright: false }), /`claude`/);
});

test("P1: the redundant bulk pre-read is gone", () => {
  const p = buildPrompt({ ...base, cliId: "opencode", hasPlaywright: true });
  assert.doesNotMatch(
    p,
    /read cv\.md, config\/profile\.yml and modes\/_profile\.md/,
    "oferta.md already directs these reads; pre-reading doubles them into the prompt",
  );
  assert.match(p, /do not bulk-pre-read/, "the omission must be explicit, not a silent drop");
});

test("P1: the prompt still points at modes/oferta.md as the single source of truth", () => {
  const p = buildPrompt({ ...base, cliId: "opencode", hasPlaywright: true });
  assert.match(p, /Read modes\/oferta\.md and follow it EXACTLY/);
});

test("P1 removes bytes without removing the TSV writer contract", () => {
  const p = buildPrompt({ ...base, cliId: "opencode", hasPlaywright: true });
  const tabLines = p.split("\n").filter((l) => l.includes("\t"));
  assert.equal(tabLines.length, 2, "the tracker-additions header + data row must survive");
});

test("a local: capture is never sent to Playwright or WebFetch", () => {
  const p = buildPrompt({ kind: "evaluate", input: "local:jds/145-x.md", today: "2026-02-02", hasPlaywright: true });
  assert.match(p, /read that file directly/);
  assert.doesNotMatch(p, /browser_navigate/);
  assert.doesNotMatch(p, /unconfirmed \(batch mode\)/);
});

test("the Jev prior is injected only when the gate actually answered", () => {
  const withPrior = buildPrompt({
    ...base,
    cliId: "opencode",
    hasPlaywright: true,
    jevPrior: { decision: "available", score: 3.42, band: "mid", hasCoreSkills: true },
  });
  assert.match(withPrior, /3\.42\/5/);
  assert.match(withPrior, /band "mid"/);
  assert.match(withPrior, /core-skills present/);
});

test("the prior is fenced as advisory and may never move a block score", () => {
  const p = buildPrompt({
    ...base,
    cliId: "opencode",
    hasPlaywright: true,
    jevPrior: { decision: "available", score: 1.6, band: "low", hasCoreSkills: false },
  });
  assert.match(p, /weak prior/);
  assert.match(p, /NOT a score, NOT a verdict/);
  assert.match(p, /must NEVER lower a block score on its own/);
});

test("an unavailable or absent gate adds nothing to the prompt", () => {
  for (const jevPrior of [null, undefined, { decision: "unavailable", reason: "gate failed: HTTP 401" }]) {
    const p = buildPrompt({ ...base, cliId: "opencode", hasPlaywright: true, jevPrior });
    assert.doesNotMatch(p, /Jev|ats_pass_probability/, "a failed gate must leave no trace in the prompt");
  }
});

test("a low band does not become an instruction to reject the role", () => {
  const p = buildPrompt({
    ...base,
    cliId: "opencode",
    hasPlaywright: true,
    jevPrior: { decision: "available", score: 1.59, band: "low", hasCoreSkills: false },
  });
  // Word-bounded: the prompt legitimately contains "Skipping this leaks
  // reports/{num}-RESERVED.md" (report-number reservation), which is unrelated.
  assert.doesNotMatch(p, /\bABORT\b|\bSTATUS: ABORT\b|do not evaluate|skip this (role|posting|listing)|discard/i);
});

test("non-evaluate kinds are unaffected by the new options", () => {
  for (const kind of ["pdf", "cover", "fix-portal", "research"]) {
    const p = buildPrompt({ kind, input: "12", today: "2026-02-02", cliId: "opencode", hasPlaywright: true });
    assert.doesNotMatch(p, /browser_navigate/, `${kind} must not gain a Playwright directive`);
  }
});
