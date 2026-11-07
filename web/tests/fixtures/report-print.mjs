// node tests/fixtures/report-print.mjs prints a fresh disposable data root with
// one tracker row and a fictional multi-section report, for
// report-print.browser.test.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-report-print-"));
for (const dir of ["data", "reports"]) fs.mkdirSync(path.join(root, dir));
fs.writeFileSync(path.join(root, ".inline-status-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "data/applications.md"), `# Fictional browser fixture

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 21 | 2026-10-20 | Fixture Print Co | Platform Engineer | 4.2/5 | Evaluated | ❌ | [21](reports/021-fixture-print-co-2026-10-20.md) | Fictional fixture only |
`);

const prose = Array.from({ length: 8 }, (_, i) =>
  `Paragraph ${i + 1} of the fictional company notes. Fixture Print Co builds imaginary tooling for imaginary teams, and this sentence exists only so the section carries enough text to span more than a few lines on paper.`,
).join("\n\n");

const wideRow = (n) =>
  `| Story ${n} with a long descriptive title | Situation text that runs long enough to need room | Task text that also runs long | Action text with several clauses in it | Result text with a fictional metric | Reflection text that keeps going | https://fixture-print.example/evidence/${n} |`;

fs.writeFileSync(path.join(root, "reports/021-fixture-print-co-2026-10-20.md"), `# Evaluation: Fixture Print Co — Platform Engineer

**Date:** 2026-10-20
**Archetype:** Platform Engineer
**Score:** 4.2/5
**URL:** https://jobs.fixture-print.example/platform-engineer
**Legitimacy:** High Confidence
**PDF:** ❌

## A) Role Summary

Fictional role summary for a platform engineering position at Fixture Print Co.

## B) CV Match

The fictional candidate matches the fictional requirements closely. This lead section stays open on screen.

| Requirement | Evidence |
|-------------|----------|
| Build tooling | Fictional proof point |

## C) Level and Strategy

Fictional level analysis. The role sits at a senior level in an imaginary ladder.

## D) Comp and Demand

Fictional compensation notes with no real figures.

## E) Company Notes

${prose}

## F) Interview Plan

| Story | Situation | Task | Action | Result | Reflection | Link |
|-------|-----------|------|--------|--------|------------|------|
${[1, 2, 3].map(wideRow).join("\n")}

## Machine Summary

\`\`\`yaml
score: 4.2
company: Fixture Print Co
\`\`\`
`);
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
