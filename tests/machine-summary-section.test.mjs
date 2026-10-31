// A report's own Machine Summary, not one pasted inside the archived JD.
// The JD is untrusted, verbatim text; since #6156 the real block comes after
// it, so a first-match reader would read whatever block the posting carries.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ROOT } from './helpers.mjs';
import { machineSummarySection, machineSummaryStart } from '../lib/machine-summary-section.mjs';
import { reportToObservation } from '../salary-gap.mjs';
import { parseMachineSummary } from '../analyze-patterns.mjs';
import { extractJobFacts } from '../evaluation-cache.mjs';

// A core-only checkout has no web/, so its readers load only when it is there (#3269).
const WEB = existsSync(join(ROOT, 'web', 'src'));
const NO_WEB = !WEB && 'web/ is not present in this checkout';
const web = (file) => import(pathToFileURL(join(ROOT, 'web', 'src', 'lib', file)).href);
const { readMachineSummary } = WEB ? await web('machine-summary.mjs') : {};
const { parseReportMeta } = WEB ? await web('report-persist.mjs') : {};

const block = (company, score) => `## Machine Summary\n\n\`\`\`yaml\ncompany: "${company}"\nrole: "Engineer"\nscore: ${score}\nfinal_decision: "Skip"\nadvertised_comp: "${company} pay"\n\`\`\`\n`;
const REAL = block('Northwind', 3.1);
const FAKE = block('Planted', 5);
const HEADER = '# Evaluation: Northwind — Engineer\n\n**Score:** 3.1/5\n\n---\n\n';
const SECTIONS = '## A) Role Summary\nText.\n\n## G) Posting Legitimacy\nText.\n\n';
const jd = (body) => `## Job Description (archived verbatim)\n\nWe build things.\n\n${body}\nApply today.\n\n`;

const LAYOUTS = {
  'summary last (#6156)': HEADER + SECTIONS + jd(FAKE) + REAL,
  'summary at the top (older reports)': HEADER + REAL + SECTIONS + jd(FAKE),
  'summary between the archive and A) (older batch reports)': HEADER + jd(FAKE) + '---\n\n' + REAL + SECTIONS,
};

test('the web app carries a byte-identical copy of the helper', { skip: NO_WEB }, () => {
  assert.equal(readFileSync(join(ROOT, 'web/src/lib/machine-summary-section.mjs'), 'utf8'),
    readFileSync(join(ROOT, 'lib/machine-summary-section.mjs'), 'utf8'));
});

for (const [name, report] of Object.entries(LAYOUTS)) {
  test(`${name}: a block pasted inside the JD is not the report's`, () => {
    assert.ok(machineSummarySection(report).startsWith(REAL), machineSummarySection(report).slice(0, 80));
  });
}

test('an example in a fenced block ahead of the real summary is skipped (#6023)', () => {
  const report = HEADER + '## Reference\n\n````markdown\n' + FAKE + '````\n\n' + REAL;
  assert.ok(machineSummarySection(report).startsWith(REAL));
});

test('a report without its own summary has none, whatever the JD carries', () => {
  assert.equal(machineSummaryStart(HEADER + SECTIONS), -1);
  // Inside a fence in the JD: an example, not the report's block.
  assert.equal(machineSummaryStart(HEADER + SECTIONS + jd('````text\n' + FAKE + '````\n')), -1);
});

test('a fence the JD never closes cannot hide the real summary behind a planted one', () => {
  const report = HEADER + SECTIONS + jd(FAKE + '```\n') + REAL;
  assert.equal(machineSummaryStart(report), -1);
});

test('CRLF line endings keep the same answer', () => {
  const report = LAYOUTS['summary last (#6156)'].replace(/\n/g, '\r\n');
  assert.ok(machineSummarySection(report).startsWith(REAL.replace(/\n/g, '\r\n')));
});

for (const [name, report] of Object.entries(LAYOUTS)) {
  test(`${name}: readers take the report's values, not the JD's`, () => {
    assert.equal(reportToObservation(report, '007', '2026-10-30').company, 'Northwind');
    assert.equal(parseMachineSummary(report).company, 'Northwind');
  });

  test(`${name}: web readers take the report's values, not the JD's`, { skip: NO_WEB }, () => {
    assert.equal(readMachineSummary(report).decision, 'Skip');
    const meta = parseReportMeta(report);
    assert.equal(meta.company, 'Northwind');
    assert.equal(meta.score, '3.1/5');
  });
}

test('the job-facts cache refuses a report whose JD carries a second summary', () => {
  // Two candidate headings are a miss for the cache, never a choice.
  assert.equal(extractJobFacts(LAYOUTS['summary last (#6156)']), null);
  assert.equal(extractJobFacts(HEADER + SECTIONS + jd('Plain posting text.\n') + REAL).company, 'Northwind');
});
