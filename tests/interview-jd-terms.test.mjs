// tests/interview-jd-terms.test.mjs — interview-jd-terms.mjs suggests
// content_filter.positive terms from the JDs of postings that reached an
// interview.
//
// Every fixture is invented: fictional companies ("Example Corp"), invented JD
// text, a throwaway CAREER_OPS_ROOT in the OS temp dir. No user files are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_POSITIVE, MIN_BASELINE, classifyRows, jdFromReport, rankTerms, resolveJd, smoothedLog2Lift, stripHtmlComments, termsOf,
} from '../interview-jd-terms.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'interview-jd-terms.mjs');

const TRACKER_HEAD = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
const trackerRow = (n, status) =>
  `| ${n} | 2026-01-01 | Example Corp ${n} | Analyst | 4.0/5 | ${status} | ✅ | [${n}](reports/${String(n).padStart(3, '0')}-example-${n}-2026-01-01.md) | |\n`;

const jdSection = (body) => `# Report\n\n**Score:** 4.0/5\n\n## Job Description (archived verbatim)\n\n${body}\n\n## Machine Summary\nx: 1\n`;

// ── Fixture: 10 interview rows (3 only visible through the ledger), 24 baseline ──

function buildRoot() {
  const root = mkdtempSync(join(tmpdir(), 'interview-jd-terms-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'reports'));
  mkdirSync(join(root, 'jds'));

  let tracker = TRACKER_HEAD;
  let ledger = '';
  const reportFor = (n, body) =>
    writeFileSync(join(root, 'reports', `${String(n).padStart(3, '0')}-example-${n}-2026-01-01.md`), jdSection(body));

  // 1..10 reached interview. 1-7 currently Interview/Offer, 8-10 now Rejected
  // but the ledger remembers the interview.
  for (let n = 1; n <= 10; n++) {
    const status = n <= 5 ? 'Interview' : n <= 7 ? 'Offer' : 'Rejected';
    tracker += trackerRow(n, status);
    if (n >= 8) ledger += `${n}\t2026-02-01\tApplied\tInterview\tset-status\t\n${n}\t2026-02-09\tInterview\tRejected\tset-status\t\n`;
    // Row 10's JD lives only in a jds/ capture, not in the report.
    if (n === 10) {
      writeFileSync(join(root, 'reports', '010-example-10-2026-01-01.md'), '# Report\n\n**Score:** 4.0/5\n');
      writeFileSync(join(root, 'jds', '010-example-10.txt'), 'Example Corp needs a person to run kubernetes clusters and write dashboards for the platform team.');
    } else {
      reportFor(n, `Example Corp is hiring. You will run kubernetes clusters and write dashboards for the platform team. Posting ${n}.`);
    }
  }
  // 11..34 applied, never interviewed. Two of them are only 'kubernetes'.
  for (let n = 11; n <= 34; n++) {
    tracker += trackerRow(n, n % 2 ? 'Applied' : 'Rejected');
    const extra = n <= 12 ? 'You will run kubernetes clusters.' : 'You will maintain spreadsheets and reconcile invoices.';
    reportFor(n, `Example Corp is hiring. ${extra} Posting ${n}.`);
  }
  // 35: applied, report without a JD section; 36: SKIP row must be ignored entirely.
  tracker += trackerRow(35, 'Applied');
  writeFileSync(join(root, 'reports', '035-example-35-2026-01-01.md'), '# Report\n\n**Score:** 3.0/5\n');
  tracker += trackerRow(36, 'SKIP');
  reportFor(36, 'Example Corp is hiring. Skipped posting about welding robots and kubernetes.');

  writeFileSync(join(root, 'data', 'applications.md'), tracker);
  writeFileSync(join(root, 'data', 'status-log.tsv'), ledger);
  return root;
}

function runCli(root, args = []) {
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' };
  delete env.CAREER_OPS_PORTALS;
  return execFileSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf-8', timeout: 30000 });
}

function withRoot(fn) {
  const root = buildRoot();
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

// ── Stage recovery ──

test('stage recovery: the ledger finds interviews that the current status hides', () => {
  withRoot((root) => {
    const tracker = readFileSync(join(root, 'data', 'applications.md'), 'utf-8');
    const withLedger = classifyRows(tracker, readFileSync(join(root, 'data', 'status-log.tsv'), 'utf-8'));
    assert.deepEqual(withLedger.positives.map((r) => r.num), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(withLedger.baseline.length, 25, 'applied rows 11-35; the SKIP row is outside the funnel');
    assert.ok(!withLedger.baseline.some((r) => r.num === 36));

    const withoutLedger = classifyRows(tracker, '');
    assert.deepEqual(withoutLedger.positives.map((r) => r.num), [1, 2, 3, 4, 5, 6, 7],
      'without the ledger the rejected-after-interview rows read as baseline');
  });
});

// ── JD resolution ──

test('JD resolution: report section, then jds/ text capture, else nothing', () => {
  withRoot((root) => {
    const fromReport = resolveJd(root, [1]);
    assert.equal(fromReport.source, 'report');
    assert.match(fromReport.text, /kubernetes/);

    const fromCapture = resolveJd(root, [10]);
    assert.equal(fromCapture.source, 'capture');
    assert.match(fromCapture.text, /dashboards/);

    assert.deepEqual(resolveJd(root, [35]), { text: '', source: null, pdfOnly: false }, 'no JD section and no capture');
    assert.equal(resolveJd(root, []).text, '', 'a row with no linked report has no JD');
  });
  assert.equal(jdFromReport('## Job Description (archived verbatim)\n\n<!-- paste JD here -->\n\n## Next'), '', 'placeholder is not a JD');
});

test('a PDF-only capture is flagged, not read', () => {
  const root = mkdtempSync(join(tmpdir(), 'interview-jd-terms-'));
  try {
    mkdirSync(join(root, 'jds'));
    writeFileSync(join(root, 'jds', '007-example.pdf'), 'not text');
    assert.deepEqual(resolveJd(root, [7]), { text: '', source: null, pdfOnly: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a newer PDF does not hide an older readable text capture', () => {
  const root = mkdtempSync(join(tmpdir(), 'interview-jd-terms-'));
  try {
    mkdirSync(join(root, 'jds'));
    const text = 'Platform analyst role working with dashboards, SQL reporting and stakeholder requests across teams.';
    writeFileSync(join(root, 'jds', '007-example.txt'), text);
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(root, 'jds', '007-example.txt'), old, old);
    writeFileSync(join(root, 'jds', '007-example.pdf'), 'not text');
    const r = resolveJd(root, [7]);
    assert.equal(r.source, 'capture');
    assert.match(r.text, /dashboards/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable report or capture is skipped, not fatal', () => {
  const root = mkdtempSync(join(tmpdir(), 'interview-jd-terms-'));
  try {
    mkdirSync(join(root, 'reports'));
    mkdirSync(join(root, 'jds'));
    // A directory named like a report makes readFileSync throw EISDIR.
    mkdirSync(join(root, 'reports', '009-example.md'));
    mkdirSync(join(root, 'jds', '009-example.txt'));
    assert.deepEqual(resolveJd(root, [9]), { text: '', source: null, pdfOnly: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTML comments never leak a skill, and no opener survives stripping', () => {
  assert.equal(stripHtmlComments('a <!-- b --> c').includes('<!--'), false);
  assert.equal(stripHtmlComments('x <!<!---->--> y').includes('<!--'), false);
  assert.equal(stripHtmlComments('keep <!-- never closed'), 'keep ');
  assert.equal(termsOf('Plain text role. <!-- SQL -->').has('sql'), false, 'comment-only skill is not a term');
});

// ── Statistics ──

const doc =(extra) => `Example Corp is hiring an analyst. ${extra} You will join the platform team.`;

test('minimum-support guard: below it only counts come back, no ratios', () => {
  const pos = Array.from({ length: MIN_POSITIVE - 1 }, () => doc('Needs kubernetes.'));
  const base = Array.from({ length: MIN_BASELINE }, () => doc('Needs spreadsheets.'));
  const r = rankTerms(pos, base, []);
  assert.equal(r.sufficient, false);
  assert.equal(r.positiveDocs, MIN_POSITIVE - 1);
  assert.equal(r.baselineDocs, MIN_BASELINE);
  assert.equal(r.suggestions, null);
  assert.equal(r.common, null);
  const r2 = rankTerms(Array.from({ length: MIN_POSITIVE }, () => doc('x')), base.slice(0, MIN_BASELINE - 1), []);
  assert.equal(r2.sufficient, false, 'the baseline guard applies too');
});

test('lift ordering: a term only interview JDs use outranks one both groups use', () => {
  const pos = Array.from({ length: 10 }, () => doc('Needs kubernetes and terraform.'));
  const base = [
    ...Array.from({ length: 12 }, () => doc('Needs terraform.')),
    ...Array.from({ length: 12 }, () => doc('Needs spreadsheets.')),
  ];
  const r = rankTerms(pos, base, []);
  assert.equal(r.sufficient, true);
  const order = r.suggestions.map((s) => s.term);
  assert.ok(order.indexOf('kubernetes') !== -1 && order.indexOf('terraform') !== -1);
  assert.ok(order.indexOf('kubernetes') < order.indexOf('terraform'));
  assert.ok(!order.includes('spreadsheets'), 'a term the baseline favours is never suggested');
  const k = r.suggestions.find((s) => s.term === 'kubernetes');
  assert.equal(k.lift, Math.round(smoothedLog2Lift(10, 0, 10, 24) * 100) / 100);
  assert.deepEqual([k.positiveDocs, k.baselineDocs], [10, 0]);
});

test('document frequency: repeating a term inside one JD counts once', () => {
  const t = termsOf('kubernetes kubernetes kubernetes. Kubernetes again.');
  assert.ok(t.has('kubernetes'));
  const pos = Array.from({ length: 8 }, () => 'kubernetes kubernetes kubernetes kubernetes');
  const base = Array.from({ length: 20 }, () => 'spreadsheets');
  assert.equal(rankTerms(pos, base, []).suggestions.find((s) => s.term === 'kubernetes').positiveDocs, 8);
});

test('terms already in content_filter.positive are left out, and counted', () => {
  const pos = Array.from({ length: 10 }, () => doc('Needs kubernetes and terraform.'));
  const base = Array.from({ length: 24 }, () => doc('Needs spreadsheets.'));
  const r = rankTerms(pos, base, ['Kubernetes', 'platform team']);
  const terms = r.suggestions.map((s) => s.term);
  assert.ok(!terms.includes('kubernetes'));
  assert.ok(!terms.some((t) => t.includes('kubernetes')), 'a pair containing a listed word adds nothing');
  assert.ok(terms.includes('terraform'));
  assert.ok(r.excludedAlreadyCovered > 0);
  assert.ok(r.common.length > 0, 'common terms are listed separately');
});

// ── CLI ──

test('CLI reads the fixture root, reports counts, and never writes portals.yml or the tracker', () => {
  withRoot((root) => {
    const portals = 'content_filter:\n  positive:\n    - dashboards\n';
    writeFileSync(join(root, 'portals.yml'), portals);
    const trackerBefore = readFileSync(join(root, 'data', 'applications.md'), 'utf-8');

    const json = JSON.parse(runCli(root, ['--json']));
    assert.equal(json.rows.positives.rows, 10);
    assert.equal(json.rows.positives.fromReport, 9);
    assert.equal(json.rows.positives.fromCapture, 1);
    assert.equal(json.rows.baseline.rows, 25);
    assert.equal(json.rows.baseline.noJd, 1);
    assert.equal(json.positiveDocs, 10);
    assert.equal(json.baselineDocs, 24);
    assert.equal(json.sufficient, true);
    const terms = json.suggestions.map((s) => s.term);
    assert.ok(terms.includes('kubernetes'));
    assert.ok(!terms.includes('dashboards'), 'already in content_filter.positive');
    assert.ok(!terms.includes('welding'), 'a SKIP row never contributes');
    assert.ok(json.caveats.length >= 3);

    const md = runCli(root);
    assert.match(md, /# Interview JD term suggestions/);
    assert.match(md, /Caveats/);
    assert.match(md, /\| kubernetes \|/);

    assert.equal(readFileSync(join(root, 'portals.yml'), 'utf-8'), portals, 'portals.yml untouched');
    assert.equal(readFileSync(join(root, 'data', 'applications.md'), 'utf-8'), trackerBefore, 'tracker untouched');
  });
});

test('CLI below the guard prints counts only', () => {
  const root = mkdtempSync(join(tmpdir(), 'interview-jd-terms-'));
  try {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'applications.md'), TRACKER_HEAD + trackerRow(1, 'Interview') + trackerRow(2, 'Applied'));
    const json = JSON.parse(runCli(root, ['--json']));
    assert.equal(json.sufficient, false);
    assert.equal(json.suggestions, null);
    assert.equal(json.rows.positives.rows, 1);
    assert.equal(json.rows.positives.noJd, 1);
    assert.match(runCli(root), /Not enough data for ratios/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--self-test passes without any user files', () => {
  const out = execFileSync(process.execPath, [SCRIPT, '--self-test'], { encoding: 'utf-8', timeout: 20000 });
  assert.doesNotMatch(out, /FAIL/);
});
