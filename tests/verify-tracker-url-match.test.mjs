// tests/verify-tracker-url-match.test.mjs — verify-tracker-url-match.mjs
// checks that a tracker row's URL cell and its linked report's `**URL:**`
// header describe the same posting (audit candidate C-001, F-004).
//
// verify-pipeline's Check 3 only proves the report FILE exists and Check 9
// compares URLs BETWEEN reports for the same company+role — nothing compares
// the row's own URL cell against the report it links. Two reports can point at
// different postings while their tracker rows reference them correctly by
// number, and every existing check stays green.
//
// The mismatch rule follows AGENTS.md's URL identity rule: a URL mismatch
// proves two different postings ONLY while both sides are employer-controlled.
// An aggregator (LinkedIn, Indeed, ...) re-lists one requisition under its own
// URL, so a mismatch with an aggregator on either side is never flagged; the
// same applies to a one-sided language param (`?language=en` on one side only).
//
// Run:  node --test tests/verify-tracker-url-match.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { extractReportUrlToken, classifyPair } =
  await import(pathToFileURL(join(ROOT, 'verify-tracker-url-match.mjs')).href);

// ---------------------------------------------------------------------------
// extractReportUrlToken — same extraction rule as verify-pipeline's Check 9
// and merge-tracker's resolveReportUrl: `**URL:**` matched anywhere on the
// line (the documented header is INLINE), `\S+` cannot cross a newline, and
// `N/A` is a token that classifies to "no key", never to a comparable value.
// ---------------------------------------------------------------------------

test('extracts the token from an inline report header', () => {
  const content = '# Report 042\n\n**Score:** 4.1/5 | **URL:** https://boards.example.com/jobs/123 | **PDF:** ✅\n';
  assert.equal(extractReportUrlToken(content), 'https://boards.example.com/jobs/123');
});

test('N/A and placeholder headers are tokens, not keys', () => {
  assert.equal(extractReportUrlToken('**URL:** N/A'), 'N/A');
  assert.equal(extractReportUrlToken('**URL:** —'), '—');
});

test('no header means no token', () => {
  assert.equal(extractReportUrlToken('# Report\n\nNo header here'), '');
  // An empty header cannot capture the NEXT line's text.
  assert.equal(extractReportUrlToken('**URL:**\n**Score:** 4/5'), '');
});

// ---------------------------------------------------------------------------
// classifyPair — the mismatch gate.
// ---------------------------------------------------------------------------

test('same posting under different tracking params / scheme / trailing slash matches', () => {
  assert.equal(
    classifyPair('http://boards.example.com/jobs/123/', 'https://boards.example.com/jobs/123?utm_source=x').verdict,
    'match',
  );
});

test('two distinct employer-controlled URLs are a mismatch', () => {
  const r = classifyPair('https://ats.example.com/jobs/111', 'https://ats.example.com/jobs/222');
  assert.equal(r.verdict, 'mismatch');
});

test('an aggregator on either side is never proof — skipped, not flagged', () => {
  const r = classifyPair('https://www.linkedin.com/jobs/view/12345', 'https://ats.example.com/jobs/111');
  assert.equal(r.verdict, 'skip');
  assert.equal(r.reason, 'aggregator');
});

test('a one-sided language param is not proof of two postings — skipped', () => {
  const r = classifyPair('https://ats.example.com/jobs/111', 'https://ats.example.com/jobs/111?language=en');
  assert.equal(r.verdict, 'skip');
  assert.equal(r.reason, 'one-sided-language');
});

test('missing keys are skips with distinct reasons, never matches', () => {
  assert.deepEqual(
    { ...classifyPair('', 'https://ats.example.com/jobs/111') },
    { verdict: 'skip', reason: 'row-url-missing' },
  );
  assert.deepEqual(
    { ...classifyPair('https://ats.example.com/jobs/111', 'N/A') },
    { verdict: 'skip', reason: 'report-url-missing' },
  );
});

// ---------------------------------------------------------------------------
// CLI end-to-end — exit 1 with a named mismatch, exit 0 when consistent.
// ---------------------------------------------------------------------------

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|------|-----|',
  '',
].join('\n');

const REPORTS_DIR_NAME = 'reports';

/** Build a temp data root with one row linking one report carrying reportUrl. */
function workspace(num, rowUrl, reportUrl) {
  const root = mkdtempSync(join(tmpdir(), 'cops-urlmatch-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, REPORTS_DIR_NAME), { recursive: true });
  const reportFile = `${REPORTS_DIR_NAME}/${String(num).padStart(3, '0')}-acme-engineer-2026-10-27.md`;
  writeFileSync(join(root, 'data', 'applications.md'),
    TRACKER.replace(/\n$/, `\n| ${num} | 2026-10-27 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [${num}](../${reportFile}) | note | ${rowUrl} |\n`));
  writeFileSync(join(root, reportFile),
    `# Acme — Engineer\n\n**Score:** 4.0/5 | **URL:** ${reportUrl} | **PDF:** ❌\n`);
  return root;
}

function runCheck(root) {
  const res = spawnSync(process.execPath, [join(ROOT, 'verify-tracker-url-match.mjs'), '--json'], {
    encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAREER_OPS_ROOT: root },
  });
  return { code: res.status, out: String(res.stdout ?? ''), err: String(res.stderr ?? '') };
}

test('CLI: mismatched employer URLs exit 1 and name the row and report', (t) => {
  const root = workspace(1, 'https://ats.example.com/jobs/111', 'https://ats.example.com/jobs/222');
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });
  const { code, out } = runCheck(root);
  assert.equal(code, 1, `expected exit 1, got ${code}: ${out}`);
  const json = JSON.parse(out);
  assert.equal(json.mismatches.length, 1);
  assert.equal(json.mismatches[0].num, 1);
  assert.match(json.mismatches[0].reportFile, /001-acme-engineer/);
  assert.equal(json.ok, false);
});

test('CLI: consistent URLs exit 0 with ok: true', (t) => {
  const root = workspace(2, 'https://ats.example.com/jobs/111', 'https://ats.example.com/jobs/111?utm_source=mail');
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });
  const { code, out } = runCheck(root);
  assert.equal(code, 0, `expected exit 0, got ${code}: ${out}`);
  const json = JSON.parse(out);
  assert.equal(json.mismatches.length, 0);
  assert.equal(json.ok, true);
});

test('CLI: aggregator mismatch is skipped, not flagged (exit 0)', (t) => {
  const root = workspace(3, 'https://www.linkedin.com/jobs/view/999', 'https://ats.example.com/jobs/111');
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });
  const { code, out } = runCheck(root);
  assert.equal(code, 0, `expected exit 0, got ${code}: ${out}`);
  const json = JSON.parse(out);
  assert.equal(json.mismatches.length, 0);
  assert.ok((json.skipped.aggregator ?? 0) >= 1, `expected an aggregator skip, got ${JSON.stringify(json.skipped)}`);
});