// tests/check-output-names.test.mjs — the output/ filename audit (#6667).
//
// check-output-names.mjs is read-only and soft: it judges only names that
// lead with a report number and carry a date, and never exits non-zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOutputNames } from '../check-output-names.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function withTree(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-check-names-'));
  try {
    mkdirSync(join(dir, 'reports'));
    mkdirSync(join(dir, 'output'));
    writeFileSync(join(dir, 'reports', '024-zep-2026-11-07.md'), '# r\n');
    for (const f of files) writeFileSync(join(dir, 'output', f), 'x');
    return fn(join(dir, 'output'), join(dir, 'reports'), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('standard names pass', () => {
  withTree([
    '024-zep-cv-david-gitman-2026-11-07.pdf',
    '024-zep-cover-david-gitman-2026-11-07.pdf',
    '024-zep-cv-david-gitman-2026-11-07-ats.html',
  ], (out, rep) => {
    const r = checkOutputNames(out, rep);
    assert.equal(r.checked, 3);
    assert.deepEqual(r.findings, []);
  });
});

test('company part may be shorter or longer than the report slug, on a hyphen boundary', () => {
  withTree([
    '024-zep-cv-david-gitman-2026-11-07.pdf',                       // equal
    '024-zep-head-of-fde-cv-david-gitman-2026-11-07.pdf',           // role kept in the name
    '330-veeva-cv-david-gitman-2026-11-01.pdf',                     // report slug is veeva-systems
    '330-veeva-systems-cover-david-gitman-2026-11-01.pdf',          // equal
    '257-figure-technology-solutions-cv-david-gitman-2026-10-20.pdf', // report slug is figure
    '024-zeppelin-cv-david-gitman-2026-11-07.pdf',                  // not a hyphen boundary
    '330-vee-cv-david-gitman-2026-11-01.pdf',                       // not a hyphen boundary
    '330-acme-cv-david-gitman-2026-11-01.pdf',                      // different company
  ], (out, rep) => {
    writeFileSync(join(rep, '330-veeva-systems-2026-11-01.md'), '# r\n');
    writeFileSync(join(rep, '257-figure-2026-10-20.md'), '# r\n');
    const codes = Object.fromEntries(checkOutputNames(out, rep).findings.map((f) => [f.file, f.code]));
    assert.deepEqual(codes, {
      '024-zeppelin-cv-david-gitman-2026-11-07.pdf': 'slug-mismatch',
      '330-vee-cv-david-gitman-2026-11-01.pdf': 'slug-mismatch',
      '330-acme-cv-david-gitman-2026-11-01.pdf': 'slug-mismatch',
    });
  });
});

test('legacy and undated names are ignored', () => {
  withTree([
    'cv-david-gitman-zep-2026-11-07.pdf',
    'zep-engineer-cover.pdf',
    '024-zep-cv-david-gitman.html', // report-led but undated: legacy intermediate
    'notes.txt',
  ], (out, rep) => {
    const r = checkOutputNames(out, rep);
    assert.equal(r.checked, 0);
    assert.deepEqual(r.findings, []);
  });
});

test('flags slug mismatch, unknown report and unparseable names', () => {
  withTree([
    '024-acme-cv-david-gitman-2026-11-07.pdf',
    '099-zep-cv-david-gitman-2026-11-07.pdf',
    '024-zep-resume-2026-11-07.pdf',
  ], (out, rep) => {
    const codes = Object.fromEntries(checkOutputNames(out, rep).findings.map((f) => [f.file, f.code]));
    assert.equal(codes['024-acme-cv-david-gitman-2026-11-07.pdf'], 'slug-mismatch');
    assert.equal(codes['099-zep-cv-david-gitman-2026-11-07.pdf'], 'unknown-report');
    assert.equal(codes['024-zep-resume-2026-11-07.pdf'], 'not-standard');
  });
});

test('output/diagnostics/ is allowed; any other subdirectory is reported', () => {
  withTree([], (out, rep) => {
    mkdirSync(join(out, 'diagnostics'));
    writeFileSync(join(out, 'diagnostics', '024-zep-company-history.json'), '{}');
    assert.deepEqual(checkOutputNames(out, rep).findings, []);
    mkdirSync(join(out, 'scratch'));
    const r = checkOutputNames(out, rep);
    assert.deepEqual(r.findings.map((f) => [f.file, f.code]), [['scratch', 'unexpected-subdir']]);
    // report only: both directories and the file inside are untouched
    assert.deepEqual(readdirSync(out).sort(), ['diagnostics', 'scratch']);
    assert.deepEqual(readdirSync(join(out, 'diagnostics')), ['024-zep-company-history.json']);
  });
});

test('github-evidence scan outputs are the one exempt name; near-misses are flagged', () => {
  withTree([
    'github-evidence-2026-11-07.json',
    'github-evidence-2026-11-07.md',
    'github-evidence-2026-1-07.json',   // wrong date shape
    'github-evidence-2026-11-07.pdf',   // other extension
    'github-evidence-2026-11-07-ats.md', // trailing variant
    'github-evidence.json',             // no date
    'git-evidence-2026-11-07.json',     // different prefix: legacy name, ignored as before
  ], (out, rep) => {
    const r = checkOutputNames(out, rep);
    assert.deepEqual(
      r.findings.map((f) => [f.file, f.code]).sort(),
      [
        ['github-evidence-2026-1-07.json', 'not-standard'],
        ['github-evidence-2026-11-07-ats.md', 'not-standard'],
        ['github-evidence-2026-11-07.pdf', 'not-standard'],
        ['github-evidence.json', 'not-standard'],
      ],
    );
  });
});

test('a missing output directory is not an error', () => {
  withTree([], (out, rep, dir) => {
    assert.deepEqual(checkOutputNames(join(dir, 'nope'), rep), { checked: 0, findings: [] });
  });
});

test('the checker never writes to output/', () => {
  withTree(['024-acme-cv-david-gitman-2026-11-07.pdf'], (out, rep) => {
    const before = readdirSync(out).sort();
    checkOutputNames(out, rep);
    assert.deepEqual(readdirSync(out).sort(), before);
  });
});

test('CLI exits 0 even when there are findings', () => {
  withTree(['024-acme-cv-david-gitman-2026-11-07.pdf'], (_o, _r, dir) => {
    const res = spawnSync(process.execPath, ['check-output-names.mjs', '--summary'], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_ROOT: dir },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /1 of 1 report-numbered artifact/);
  });
});
