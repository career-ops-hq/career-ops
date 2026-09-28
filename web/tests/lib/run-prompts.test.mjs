// run-prompts.test.mjs — the evaluate prompt is a TSV writer (#3517) and the
// pdf prompt carries the no-Write envelope contract (#2185). Lives under
// web/tests/lib so test-all.mjs's #2185 gate discovers it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";
import { CV_ENVELOPE_INSTRUCTION } from "../../src/lib/cv-envelope.mjs";

test("evaluate prompt shows exactly one header + one data tab line", () => {
  const prompt = buildPrompt({
    kind: "evaluate",
    input: "https://example.com/jobs/2",
    memory: "",
    today: "2026-02-02",
  });
  const tabLines = prompt.split("\n").filter((l) => l.includes("\t"));
  assert.equal(tabLines.length, 2, `expected 2 tab lines, got ${tabLines.length}`);
  const header = tabLines[0].trim().split("\t");
  const data = tabLines[1].trim().split("\t");
  assert.equal(data.length, header.length, "data row width must match header");
  for (const label of ["num", "date", "company", "role", "status", "score", "pdf", "report"]) {
    assert.ok(header.includes(label), `header missing ${label}: ${JSON.stringify(header)}`);
  }
});

test("evaluate prompt embeds the posting URL and VERDICT line", () => {
  const prompt = buildPrompt({
    kind: "evaluate",
    input: "https://example.com/jobs/2",
    today: "2026-02-02",
  });
  assert.match(prompt, /Posting URL: https:\/\/example\.com\/jobs\/2/);
  assert.match(prompt, /VERDICT:/);
});

test("local: JD is read from disk, not WebFetched", () => {
  const prompt = buildPrompt({
    kind: "evaluate",
    input: "local:jds/foo.md",
    today: "2026-02-02",
  });
  assert.match(prompt, /local file `jds\/foo\.md`/);
  assert.doesNotMatch(prompt, /Use WebFetch to read the posting/);
});

test("pdf prompt carries the write-scope envelope contract (#2185)", () => {
  const prompt = buildPrompt({ kind: "pdf", input: "135", reportNum: "144", today: "2026-02-02" });
  assert.ok(prompt.includes(CV_ENVELOPE_INSTRUCTION));
  assert.match(prompt, /<<cv-html>>/);
  assert.match(prompt, /NO Write, Edit/);
  assert.match(prompt, /generate-pdf\.mjs/);
  assert.match(prompt, /reports\/144-/);
});

test("research and cover emit a VERDICT line", () => {
  for (const kind of ["research", "cover", "fix-portal"]) {
    const prompt = buildPrompt({ kind, input: "https://example.com/x", today: "2026-02-02" });
    assert.match(prompt, /VERDICT:/, `${kind} prompt missing VERDICT`);
  }
});

test("memory block is appended only when non-empty", () => {
  const withMem = buildPrompt({ kind: "evaluate", input: "u", memory: "prefers remote", today: "2026-02-02" });
  const without = buildPrompt({ kind: "evaluate", input: "u", memory: "  ", today: "2026-02-02" });
  assert.ok(withMem.includes("prefers remote"));
  assert.ok(!without.includes("Durable notes"));
});

test("evaluate prompt releases the reservation sentinel it claims", () => {
  // A leaked sentinel counts as an occupied report number forever, so every
  // later evaluation is pushed one higher for a report that will never exist.
  // The Airtel APM run (2026-09-28) orphaned 158 and 159 this way when its
  // SIGTERM budget expired mid-report. modes/pipeline.md step (d) and every
  // market mode's pipeline.md/oferta.md already require the release.
  const prompt = buildPrompt({ kind: "evaluate", input: "u", today: "2026-02-02" });
  assert.match(prompt, /reserve-report-num\.mjs --release/);
  // It must come after the claim, or the release targets a number never reserved.
  assert.ok(
    prompt.indexOf("--release") > prompt.indexOf("node reserve-report-num.mjs`"),
    "release step must follow the reservation claim",
  );
});

test("every kind's SIGTERM budget clears the report write, not just pdf", () => {
  // The inversion that caused the Airtel failure: evaluate — which emits a
  // ~40 KB report in one write call — had 285 s while the heavier pdf kind had
  // 720 s. Assert the budgets by reading the route source, and assert they stay
  // under maxDuration so the two can never drift into a platform timeout.
  const src = readFileSync(new URL("../../src/app/api/run/route.ts", import.meta.url), "utf-8");
  const budgets = { evaluate: null, pdf: null };
  for (const kind of Object.keys(budgets)) {
    const m = src.match(new RegExp(`${kind}:\\s*([\\d_]+)`));
    assert.ok(m, `route.ts has no ${kind} entry in KILL_MS_BY_KIND`);
    budgets[kind] = Number(m[1].replace(/_/g, ""));
  }
  const maxDuration = Number((src.match(/maxDuration\s*=\s*(\d+)/) || [])[1]);
  assert.ok(maxDuration, "route.ts must declare maxDuration");
  for (const [kind, ms] of Object.entries(budgets)) {
    assert.ok(ms >= 720_000, `${kind} budget ${ms}ms is too small to finish a report write`);
    assert.ok(ms < maxDuration * 1000, `${kind} budget ${ms}ms must stay under maxDuration`);
  }
});
