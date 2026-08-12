// tests/openrouter-tracker-tsv.test.mjs — an openrouter-produced tracker-addition
// TSV must merge into applications.md.
//
// openrouter-runner wrote a "num\tdate\t…\n" HEADER line ahead of the data row.
// merge-tracker.mjs reads the whole addition file as ONE record (no line split),
// so with a header present parts[4]/parts[5] are the literal "status"/"score",
// resolveScoreStatus returns null, and EVERY openrouter evaluation was skipped
// with "cannot tell score from status". AGENTS.md specifies the file as a single
// 9-column data line. This test merges the exact line openrouter emits and
// asserts the row lands, and guards the source against reintroducing the header.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nopenrouter-runner.mjs — tracker-addition TSV merges (no header row)');

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

// The exact shape openrouter-runner writes (openrouter-runner.mjs `tsvLine`):
// num, date, company, "(see report)", status, score, pdf, report-link, notes.
const num = 35, today = '2026-08-09', slug = 'acme-corp';
const company = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const link = `[0${num}](reports/0${num}-${slug}-${today}.md)`;
const dataLine = `${num}\t${today}\t${company}\t(see report)\tEvaluated\t4.0/5\t❌\t${link}\t\n`;

const work = mkdtempSync(join(tmpdir(), 'cops-or-tsv-'));
try {
  const tracker = join(work, 'applications.md');
  const addsDir = join(work, 'adds');
  mkdirSync(addsDir, { recursive: true });
  writeFileSync(tracker, TRACKER_HEADER);
  writeFileSync(join(addsDir, `or-0${num}-${slug}.tsv`), dataLine);

  let output = '';
  try {
    output = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir },
    });
  } catch (e) {
    output = String(e.stdout ?? '') + String(e.stderr ?? '');
  }

  const merged = readFileSync(tracker, 'utf-8');
  const row = merged.split('\n').find((l) => /^\|\s*35\s*\|/.test(l));
  if (row && /Acme Corp/.test(row) && /Evaluated/.test(row) && /4\.0\/5/.test(row)) {
    pass('openrouter TSV row merged into the tracker with score + status intact');
  } else {
    fail(`row not merged. output: ${output.trim().split('\n').pop()} | tracker row: ${row ?? '(none)'}`);
  }

  // Root-cause demonstration: the OLD header-prefixed content is skipped, not
  // merged — a second isolated run with the header in front of the same row.
  const work2 = mkdtempSync(join(tmpdir(), 'cops-or-hdr-'));
  try {
    const t2 = join(work2, 'applications.md');
    const a2 = join(work2, 'adds');
    mkdirSync(a2, { recursive: true });
    writeFileSync(t2, TRACKER_HEADER);
    writeFileSync(join(a2, `or-0${num}-${slug}.tsv`), `num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n${dataLine}`);
    let out2 = '';
    try {
      out2 = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
        encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CAREER_OPS_TRACKER: t2, CAREER_OPS_ADDITIONS: a2 },
      });
    } catch (e) { out2 = String(e.stdout ?? '') + String(e.stderr ?? ''); }
    const merged2 = readFileSync(t2, 'utf-8');
    if (!/^\|\s*35\s*\|/m.test(merged2)) pass('header-prefixed TSV is correctly skipped (the original bug)');
    else fail('header-prefixed TSV merged unexpectedly — the root-cause assumption is wrong');
  } finally {
    try { rmSync(work2, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // Guard: the source must not prepend a header to the tracker-addition write.
  const src = readFileSync(join(ROOT, 'openrouter-runner.mjs'), 'utf-8');
  if (/num\\tdate\\tcompany\\trole\\tstatus/.test(src)) {
    fail('openrouter-runner.mjs still writes a header row into the tracker-addition TSV');
  } else {
    pass('openrouter-runner.mjs writes only the data line (no header)');
  }
} finally {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
}
