import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../web/src/lib/run-prompts.mjs";

// Frozen snapshots of the LEGACY evaluate prompt (je vCompile null). The Envelope B
// refactor must never alter what is emitted when a jevCompile object is absent, or
// every historical worker prompt is retroactively different from what actually ran.
const LEGACY_LOCAL = "You are running the OFFICIAL career-ops job evaluation, HEADLESS, on the user's own machine. Today is 2026-10-10. Run the REAL career-ops evaluation — do NOT improvise your own scoring.\n\nA cheap deterministic ATS-screen pre-pass (TypeSafe Jev, no text generation) scored this posting 3.10/5, band \"Guarded\", core-skills present — correlating r=0.743 with the candidate's own prior evaluations. Treat it ONLY as a weak prior to confirm or overturn from the JD and the primary files. It is NOT a score, NOT a verdict, and must NEVER lower a block score on its own.\n\n1. Read modes/oferta.md and follow it EXACTLY (blocks A–F, G posting-legitimacy, and the Machine Summary). Ground the fit in THIS person: oferta.md names cv.md, config/profile.yml and modes/_profile.md as the primary sources and directs you to read them at the point of use (13/18/4 explicit references) — do not bulk-pre-read them here. Read the JD from the local file `jds/sample-company-role.md` (the `local:` prefix means: read that file directly, per modes/pipeline.md's convention — do NOT WebFetch it, it is not a URL).\n\n2. Persist the result CANONICALLY so the web and the CLI share ONE source of truth:\n   a. Reserve a report number: run `node reserve-report-num.mjs` — its stdout is a 3-digit number (e.g. 035).\n   b. Write the full report to reports/{num}-{company-slug}-2026-10-10.md  (company-slug = company lowercased, non-alphanumerics → hyphens).\n   c. Append a TSV to batch/tracker-additions/{num}-{company-slug}.tsv with THIS header row first (real tab characters, not the four-space escape):\nnum\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes\n      then ONE data row under it (values aligned to those labels; status may sit before or after score — merge-tracker resolves by header name):\n{num}\t2026-10-10\t{Company}\t{Role}\t{score}/5\t{CanonicalStatus e.g. Evaluated}\t❌\t[{num}](reports/{num}-{company-slug}-2026-10-10.md)\t{one-line note}\n   d. Merge into the tracker: run `node merge-tracker.mjs` (it dedupes by company+role+report-num, validates the status, and writes data/applications.md — NEVER edit applications.md by hand).\n   e. Release the reservation sentinel: run `node reserve-report-num.mjs --release <num>` with the number from (a). Skipping this leaks `reports/{num}-RESERVED.md` — an abandoned run's sentinel counts as an occupied report number forever, so every later evaluation is pushed one higher for a report that will never exist. modes/pipeline.md step (d) and every market mode's pipeline.md/oferta.md already require this release; this prompt did not, which is how the Airtel APM run (2026-09-28) orphaned 158 and 159.\n\n3. NEVER submit an application, fill no forms, contact no one. This is evaluation + persistence ONLY.\n\nDurable notes about the user (from their profile):\nuser is a senior backend engineer\n\n\nAfter everything above is written and merged, output EXACTLY one final line, nothing after it:\nVERDICT: {score}/5 — {reason in 12 words or fewer}\n\nPosting source: local:jds/sample-company-role.md";
const LEGACY_URL = "You are running the OFFICIAL career-ops job evaluation, HEADLESS, on the user's own machine. Today is 2026-10-10. Run the REAL career-ops evaluation — do NOT improvise your own scoring.\n\n1. Read modes/oferta.md and follow it EXACTLY (blocks A–F, G posting-legitimacy, and the Machine Summary). Ground the fit in THIS person: oferta.md names cv.md, config/profile.yml and modes/_profile.md as the primary sources and directs you to read them at the point of use (13/18/4 explicit references) — do not bulk-pre-read them here. Use WebFetch to read the posting (you are headless and this CLI (`codex`) has no Playwright MCP — doctor.mjs reports it absent — so use WebFetch and mark the report header \"Verification: unconfirmed (batch mode)\").\n\n2. Persist the result CANONICALLY so the web and the CLI share ONE source of truth:\n   a. Reserve a report number: run `node reserve-report-num.mjs` — its stdout is a 3-digit number (e.g. 035).\n   b. Write the full report to reports/{num}-{company-slug}-2026-10-10.md  (company-slug = company lowercased, non-alphanumerics → hyphens).\n   c. Append a TSV to batch/tracker-additions/{num}-{company-slug}.tsv with THIS header row first (real tab characters, not the four-space escape):\nnum\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes\n      then ONE data row under it (values aligned to those labels; status may sit before or after score — merge-tracker resolves by header name):\n{num}\t2026-10-10\t{Company}\t{Role}\t{score}/5\t{CanonicalStatus e.g. Evaluated}\t❌\t[{num}](reports/{num}-{company-slug}-2026-10-10.md)\t{one-line note}\n   d. Merge into the tracker: run `node merge-tracker.mjs` (it dedupes by company+role+report-num, validates the status, and writes data/applications.md — NEVER edit applications.md by hand).\n   e. Release the reservation sentinel: run `node reserve-report-num.mjs --release <num>` with the number from (a). Skipping this leaks `reports/{num}-RESERVED.md` — an abandoned run's sentinel counts as an occupied report number forever, so every later evaluation is pushed one higher for a report that will never exist. modes/pipeline.md step (d) and every market mode's pipeline.md/oferta.md already require this release; this prompt did not, which is how the Airtel APM run (2026-09-28) orphaned 158 and 159.\n\n3. NEVER submit an application, fill no forms, contact no one. This is evaluation + persistence ONLY.\n\nAfter everything above is written and merged, output EXACTLY one final line, nothing after it:\nVERDICT: {score}/5 — {reason in 12 words or fewer}\n\nPosting URL: https://boards.greenhouse.io/example/jobs/123";

test('local eval: legacy prompt is byte-identical to the frozen snapshot', () => {
  const p = buildPrompt({
    kind: 'evaluate',
    input: 'local:jds/sample-company-role.md',
    memory: 'user is a senior backend engineer',
    today: '2026-10-10',
    reportNum: '012',
    cliId: 'opencode',
    hasPlaywright: true,
    jevPrior: { decision: 'available', score: 3.1, band: 'Guarded', hasCoreSkills: true },
  });
  assert.equal(p, LEGACY_LOCAL);
});

test('url eval, headless, no prior: legacy prompt is byte-identical to the frozen snapshot', () => {
  const p = buildPrompt({
    kind: 'evaluate',
    input: 'https://boards.greenhouse.io/example/jobs/123',
    today: '2026-10-10',
    hasPlaywright: false,
    cliId: 'codex',
  });
  assert.equal(p, LEGACY_URL);
});

test('legacy output is stable when the jevCompile option is simply omitted', () => {
  const base = {
    input: 'local:jds/sample-company-role.md',
    today: '2026-10-10',
    memory: 'user is a senior backend engineer',
    jevPrior: { decision: 'available', score: 3.1, band: 'Guarded', hasCoreSkills: true },
  };
  assert.equal(buildPrompt(base), LEGACY_LOCAL);
});

test('envelope B: slots file, System One facts, marker and step numbering', () => {
  const p = buildPrompt({
    kind: 'evaluate',
    input: 'local:jds/sample-company-role.md',
    today: '2026-10-10',
    memory: 'user is a senior backend engineer',
    jevPrior: { decision: 'available', score: 3.1, band: 'Guarded', hasCoreSkills: true },
    jevCompile: {
      slotsPath: '/tmp/jev-slots-012.json',
      facts: 'Block G legitimacy: Proceed with Caution | archetype: Applied AI Engineer | risk level: elevated | work authorization: unstated',
    },
  });
  assert.match(p, /free-text slots to the file \/tmp\/jev-slots-012\.json/);
  assert.match(p, /System One facts are adjudicated readings/);
  assert.match(p, /Block G legitimacy: Proceed with Caution/);
  assert.match(p, /## Machine Summary\n\n<!-- machine-summary-slot -->/);
  assert.match(p, /4\. Persist the result CANONICALLY/);
  assert.match(p, /5\. NEVER submit an application/);
  assert.match(p, /Do NOT include legitimacy_tier/);
  assert.doesNotMatch(p, /and the Machine Summary\)/);
});

test('envelope B: the shared persistence block (reports, TSV, merge, release, VERDICT) is retained', () => {
  const p = buildPrompt({
    kind: 'evaluate',
    input: 'local:jds/sample-company-role.md',
    today: '2026-10-10',
    jevCompile: { slotsPath: '/tmp/s.json', facts: 'Block G legitimacy: verified' },
  });
  assert.match(p, /node merge-tracker\.mjs/);
  assert.match(p, /node reserve-report-num\.mjs --release <num>/);
  assert.match(p, /num\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes/);
  assert.match(p, /VERDICT: \{score\}\/5/);
});
