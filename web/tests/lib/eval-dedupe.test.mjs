// eval-dedupe — the "a finished posting must leave the pipeline" layer.
// Regression for 2026-09-28: evaluated postings stayed `- [ ]` in pipeline.md,
// so a re-click spawned a brand-new worker (Airtel: report 164 next to 160;
// Nians: live re-run while report 161 existed). markInboxDone ends the row's
// lifecycle; findExistingEvaluation makes the duplicate a zero-token "already
// evaluated #N" instead of another full evaluation.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizePostingUrl,
  findExistingEvaluation,
  markInboxDone,
} from "../../src/lib/core/eval-dedupe.ts";

const JD_A = `# Airtel Associate Product Manager
We are looking for a product manager to own analytics-driven features.
Must-have: SQL, product analytics, stakeholder management.`;

function fixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-dedupe-"));
}

function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function pipeline(rows) {
  return rows.map(([mark, cell]) => `- [${mark}] ${cell} | Company | Role`).join("\n") + "\n";
}

test("normalizePostingUrl strips tracking noise but keeps meaningful query ids", () => {
  const a = "https://boards.greenhouse.io/google/jobs/88214?gh_jid=88214&utm_source=linkedin&utm_campaign=x";
  const b = "https://boards.greenhouse.io/google/jobs/88214?utm_campaign=x&gh_jid=88214#fragment";
  assert.equal(normalizePostingUrl(a), normalizePostingUrl(b), "tracking params + fragment must not split a match");
  assert.ok(normalizePostingUrl(a).includes("gh_jid=88214"), "ATS ids must survive");
  assert.equal(normalizePostingUrl("local:jds/pasted-A.md"), "local:jds/pasted-A.md", "local refs pass through");
});

test("markInboxDone flips the matching pending row and is idempotent", () => {
  const root = fixtureRoot();
  write(root, "data/pipeline.md", pipeline([
    [" ", "https://boards.greenhouse.io/google/jobs/88214?gh_jid=88214&utm_source=in"],
    [" ", "local:jds/pasted-airtel.md"],
    [" ", "local:jds/pasted-other.md"],
  ]));

  const flipped = markInboxDone(root, "https://boards.greenhouse.io/google/jobs/88214?utm_campaign=z&gh_jid=88214");
  assert.equal(flipped, 1, "URL input matching a row by normalized URL must flip exactly one");

  const flippedPath = markInboxDone(root, "local:jds/pasted-airtel.md");
  assert.equal(flippedPath, 1, "local:jds input must flip its row");

  const md = fs.readFileSync(path.join(root, "data", "pipeline.md"), "utf8");
  assert.match(md, /- \[x\] .*gh_jid=88214/, "URL row now done");
  assert.match(md, /- \[x\] local:jds\/pasted-airtel\.md/, "path row now done");
  assert.match(md, /- \[ \] local:jds\/pasted-other\.md/, "unrelated row untouched");

  assert.equal(markInboxDone(root, "local:jds/pasted-airtel.md"), 0, "second flip of the same row is a no-op");
  const untouched = fs.readFileSync(path.join(root, "data", "pipeline.md"), "utf8");
  assert.match(untouched, /- \[x\] local:jds\/pasted-airtel\.md/, "no-op call left the row done");
});

test("markInboxDone no-ops on an unknown input (file untouched)", () => {
  const root = fixtureRoot();
  write(root, "data/pipeline.md", pipeline([[" ", "local:jds/other.md"]]));
  const before = fs.readFileSync(path.join(root, "data", "pipeline.md"), "utf8");
  assert.equal(markInboxDone(root, "local:jds/never-seen.md"), 0);
  assert.equal(fs.readFileSync(path.join(root, "data", "pipeline.md"), "utf8"), before);
});

test("findExistingEvaluation resolves a URL input against report URL headers (best = earliest)", () => {
  const root = fixtureRoot();
  write(root, "reports/009-google-2026-09-20.md", `# Report 9\n\n**URL:** https://boards.greenhouse.io/google/jobs/88214?utm_campaign=old&gh_jid=88214\n\n## Job Description\nold text\n`);
  write(root, "reports/003-google-2026-09-18.md", `# Report 3\n\n**URL:** https://boards.greenhouse.io/google/jobs/88214?gh_jid=88214\n\n## Job Description\nolder text\n`);

  const found = findExistingEvaluation(root, "https://boards.greenhouse.io/google/jobs/88214?utm_source=new&utm_medium=x&gh_jid=88214");
  assert.equal(found, 3, "report URL matched after normalization, earliest report wins");
});

test("findExistingEvaluation resolves a local:jds input via the report's own URL cell", () => {
  const root = fixtureRoot();
  write(root, "jds/pasted-airtel.md", JD_A);
  write(root, "reports/157-airtel-2026-09-28.md", `# Report 157\n\n**URL:** local:jds/pasted-airtel.md\n\n## Job Description\n${JD_A}\n`);

  assert.equal(findExistingEvaluation(root, "local:jds/pasted-airtel.md"), 157);
});

test("findExistingEvaluation catches a repaste (new filename, same JD text) by content hash", () => {
  const root = fixtureRoot();
  write(root, "jds/pasted-airtel.md", JD_A);
  // Formatting-only variant: same words, new double-spacing + case, timestamped name.
  write(root, "jds/pasted-airtel-repaste-2.md", `${JD_A.replace(/\n/g, "\n\n").toUpperCase()}\n`);
  write(root, "reports/157-airtel-2026-09-28.md", `# Report 157\n\n**URL:** local:jds/pasted-airtel.md\n\n## Job Description (archived verbatim)\n${JD_A}\n`);

  // The repaste has a DIFFERENT filename → no header match; only the archived JD
  // content can tie it to report 157.
  assert.equal(findExistingEvaluation(root, "local:jds/pasted-airtel-repaste-2.md"), 157);
});

test("findExistingEvaluation returns null when nothing evaluated the input (and ignores RESERVED)", () => {
  const root = fixtureRoot();
  write(root, "reports/165-RESERVED.md", `**URL:** https://corp.com/jobs/1\n`);
  write(root, "reports/001-unrelated-2026-09-01.md", `# Report 1\n\n**URL:** https://other.com/jobs/9\n\n## Job Description\nzzz\n`);
  assert.equal(findExistingEvaluation(root, "https://corp.com/jobs/1"), null, "a RESERVED sentinel is not a report");
  assert.equal(findExistingEvaluation(root, "https://missing.com/jobs/5"), null);
  assert.equal(findExistingEvaluation(root, "local:jds/nope.md"), null);
});