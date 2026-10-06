// fix-report-links: rewrites only the Report cell of rows whose link points at a
// missing file (#4750). Child-process CLI tests against disposable data roots;
// fictional data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixReportLinks } from '../fix-report-links.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HEADER = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];
const row = (n, company, report, extra = '') =>
  `| ${n} | 2026-07-15 | ${company} | Coordinator | 3.2/5 | Applied | ❌ | ${report} | note ${n}${extra} |`;

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-fix-links-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  return root;
}
const trackerPath = (root) => join(root, 'data', 'applications.md');
const bakPath = (root) => `${trackerPath(root)}.bak`;
const writeTracker = (root, lines, eol = '\n') => writeFileSync(trackerPath(root), lines.join(eol) + eol);
const tracker = (root) => readFileSync(trackerPath(root), 'utf-8');
function report(root, name) { writeFileSync(join(root, 'reports', name), '# Eval\n'); }
function run(root, args = [], envExtra = { CAREER_OPS_ROOT: root }) {
  const env = { ...process.env };
  for (const k of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER']) delete env[k];
  Object.assign(env, envExtra);
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'fix-report-links.mjs'), ...args], { cwd: CODE_ROOT, env, encoding: 'utf-8', timeout: 30_000 });
  assert.equal(r.error, undefined);
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const withRoot = (fn) => () => { const root = makeRoot(); try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };

const DEAD = '[1](../reports/001-acme-widgets-2026-07-15.md)';

test('dry-run lists the row and leaves the file byte-identical', withRoot((root) => {
  writeTracker(root, [...HEADER, row(1, 'Acme Widgets', DEAD)]);
  const before = tracker(root);
  const r = run(root, ['--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /#1 Acme Widgets — Coordinator: \.\.\/reports\/001-acme-widgets-2026-07-15\.md/);
  assert.match(r.out, /1 dead report link\(s\) found/);
  assert.match(r.out, /dry-run/);
  assert.equal(tracker(root), before);
  assert.equal(existsSync(bakPath(root)), false, 'dry-run takes no backup');
}));

test('real run rewrites only the dead-link cell; backup holds the original bytes', withRoot((root) => {
  report(root, '002-bolt-gadgets-2026-07-15.md');
  writeTracker(root, [
    ...HEADER,
    row(2, 'Bolt Gadgets', '[2](../reports/002-bolt-gadgets-2026-07-15.md)'),
    row(1, 'Acme Widgets', DEAD),
    row(3, 'Cog Supplies', '—'),
  ]);
  const before = tracker(root);
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 dead report link\(s\) fixed/);
  assert.match(r.out, /applications\.md\.bak/);
  assert.equal(readFileSync(bakPath(root), 'utf-8'), before);
  // Whole-file comparison: the only difference is the one cell.
  assert.equal(tracker(root), before.replace(`| ${DEAD} |`, '| — |'));
  assert.equal(tracker(root).split('\n').length, before.split('\n').length, 'row count and order unchanged');
}));

test('CRLF line endings and cell padding survive', withRoot((root) => {
  writeTracker(root, [...HEADER, row(1, 'Acme Widgets', DEAD)], '\r\n');
  const before = tracker(root);
  assert.ok(before.includes('\r\n'));
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  const after = tracker(root);
  assert.equal(after, before.replace(`| ${DEAD} |`, '| — |'));
  assert.equal(after.split('\n').length, after.split('\r\n').length, 'every LF is still part of a CRLF');
}));

test('existing report, em dash, N/A, hyphen and empty cells are left alone', withRoot((root) => {
  report(root, '001-acme-widgets-2026-07-15.md');
  writeTracker(root, [
    ...HEADER,
    row(1, 'Acme Widgets', DEAD),
    row(2, 'Bolt Gadgets', '—'),
    row(3, 'Cog Supplies', 'N/A'),
    row(4, 'Dyno Parts', '-'),
    row(5, 'Echo Tools', ''),
  ]);
  const before = tracker(root);
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /No changes needed/);
  assert.equal(tracker(root), before);
  assert.equal(existsSync(bakPath(root)), false, 'no backup when nothing changes');
}));

test('a link to a directory is treated as broken', withRoot((root) => {
  writeTracker(root, [...HEADER, row(1, 'Acme Widgets', '[1](../reports/)')]);
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(tracker(root), /\| — \|/);
  assert.doesNotMatch(tracker(root), /\.\.\/reports\//);
}));

test('an uninspectable report target is preserved and reported separately', withRoot((root) => {
  const lines = [...HEADER, row(1, 'Acme Widgets', DEAD)];
  const result = fixReportLinks(lines, join(root, 'data'), root, {
    stat(path) {
      const error = new Error(`permission denied: ${path}`);
      error.code = 'EACCES';
      throw error;
    },
  });
  assert.deepEqual(result.lines, lines, 'an inconclusive inspection cannot erase the link');
  assert.equal(result.changed.length, 0);
  assert.equal(result.inspectionErrors.length, 1);
  assert.equal(result.inspectionErrors[0].link, '../reports/001-acme-widgets-2026-07-15.md');
  assert.equal(result.inspectionErrors[0].errors.length, 2);
  assert.ok(result.inspectionErrors[0].errors.every(({ error }) => error.code === 'EACCES'));
}));

test('legacy root-relative link resolves from the data root', withRoot((root) => {
  report(root, '001-acme-widgets-2026-07-15.md');
  writeTracker(root, [
    ...HEADER,
    row(1, 'Acme Widgets', '[1](reports/001-acme-widgets-2026-07-15.md)'),
    row(2, 'Bolt Gadgets', '[2](reports/002-bolt-gadgets-2026-07-15.md)'),
  ]);
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /#2 Bolt Gadgets/);
  assert.doesNotMatch(r.out, /#1 Acme Widgets/);
  const after = tracker(root);
  assert.match(after, /\[1\]\(reports\/001-acme-widgets-2026-07-15\.md\)/);
  assert.doesNotMatch(after, /002-bolt-gadgets/);
}));

test('a cell with extra text or several links is skipped and reported, not rewritten', withRoot((root) => {
  const twoLinks = `${DEAD} [alt](../reports/gone.md)`;
  const withText = `see ${DEAD}`;
  writeTracker(root, [...HEADER, row(1, 'Acme Widgets', withText), row(2, 'Bolt Gadgets', twoLinks)]);
  const before = tracker(root);
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /2 row\(s\) skipped, please check by hand/);
  assert.match(r.out, /#1 .*Acme Widgets/);
  assert.match(r.out, /#2 .*Bolt Gadgets/);
  assert.match(r.out, /0 dead report link\(s\) fixed/);
  assert.equal(tracker(root), before);
}));

test('a live first link cannot hide a dead later link from manual review', withRoot((root) => {
  report(root, '001-acme-widgets-2026-07-15.md');
  const mixed = `${DEAD} [missing](../reports/missing.md)`;
  writeTracker(root, [...HEADER, row(1, 'Acme Widgets', mixed)]);
  const before = tracker(root);
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 row\(s\) skipped, please check by hand/);
  assert.match(r.out, /missing\.md/);
  assert.equal(tracker(root), before, 'ambiguous multi-link cell is never rewritten');
}));

test('idempotent: a second run changes nothing and says so', withRoot((root) => {
  writeTracker(root, [...HEADER, row(1, 'Acme Widgets', DEAD)]);
  assert.equal(run(root).status, 0);
  const afterFirst = tracker(root);
  const second = run(root);
  assert.equal(second.status, 0, second.out);
  assert.match(second.out, /0 dead report link\(s\) fixed/);
  assert.match(second.out, /No changes needed/);
  assert.equal(tracker(root), afterFirst);
}));

test('unknown flag is rejected; --help prints usage', withRoot((root) => {
  writeTracker(root, [...HEADER, row(1, 'Acme Widgets', DEAD)]);
  const before = tracker(root);
  const bad = run(root, ['--dryrun']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.out, /--dryrun/);
  assert.equal(tracker(root), before, 'a mistyped flag must not fall through to a live run');
  const help = run(root, ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.out, /Usage: node fix-report-links\.mjs/);
}));

test('extra Via/URL columns: the Report column is found by header name', withRoot((root) => {
  writeFileSync(trackerPath(root), [
    '| # | Date | Company | Role | Score | Status | PDF | Via | Report | Notes | URL |',
    '|---|------|---------|------|-------|--------|-----|-----|--------|-------|-----|',
    `| 1 | 2026-07-15 | Acme Widgets | Coordinator | 3.2/5 | Applied | ❌ | Hays | ${DEAD} | n | https://example.com/1 |`,
    '',
  ].join('\n'));
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.equal(tracker(root).split('\n')[2],
    '| 1 | 2026-07-15 | Acme Widgets | Coordinator | 3.2/5 | Applied | ❌ | Hays | — | n | https://example.com/1 |');
}));

test('aliased header names still locate the Report column', withRoot((root) => {
  writeFileSync(trackerPath(root), [
    '| # | Fecha | Empresa | Puesto | Score | Estado | PDF | Informe | Notas |',
    '|---|-------|---------|--------|-------|--------|-----|---------|-------|',
    row(1, 'Acme Widgets', DEAD),
    '',
  ].join('\n'));
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(tracker(root), /\| — \| note 1 \|/);
}));

test('tracker with no Report column: nothing to do, exit 0, file untouched', withRoot((root) => {
  const lines = [
    '| # | Date | Company | Role | Score | Status | Notes |',
    '|---|------|---------|------|-------|--------|-------|',
    `| 1 | 2026-07-15 | Acme Widgets | Coordinator | 3.2/5 | Applied | ${DEAD} |`,
    '',
  ].join('\n');
  writeFileSync(trackerPath(root), lines);
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /no Report column/);
  assert.equal(tracker(root), lines);
  assert.equal(existsSync(bakPath(root)), false);
}));

test('no tracker file: exit 0 with a message', withRoot((root) => {
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /No applications\.md found/);
}));

test('data-root override works with cwd = code root (tracker read and written under CAREER_OPS_ROOT)', withRoot((root) => {
  writeTracker(root, [...HEADER, row(1, 'Acme Widgets', '[1](reports/gone.md)')]);
  const r = run(root, [], { CAREER_OPS_ROOT: root });
  assert.equal(r.status, 0, r.out);
  assert.match(tracker(root), /\| — \|/);
  assert.ok(existsSync(bakPath(root)), 'backup sits next to the data-root tracker');
}));

test('CAREER_OPS_TRACKER override is honored', withRoot((root) => {
  const custom = join(root, 'elsewhere.md');
  writeFileSync(custom, [...HEADER, row(1, 'Acme Widgets', '[1](../reports/gone.md)'), ''].join('\n'));
  const r = run(root, [], { CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: custom });
  assert.equal(r.status, 0, r.out);
  assert.match(readFileSync(custom, 'utf-8'), /\| — \|/);
}));

test('a symlinked CAREER_OPS_TRACKER: the backup sits beside the real file and holds its original bytes', withRoot((root) => {
  // CodeRabbit (PR #4751): copying the link path would put the .bak beside the
  // link; the backup must follow the transaction's canonical path instead.
  const realDir = join(root, 'real');
  mkdirSync(realDir);
  const real = join(realDir, 'applications.md');
  const original = [...HEADER, row(1, 'Acme Widgets', '[1](../reports/gone.md)'), ''].join('\n');
  writeFileSync(real, original);
  const linkDir = join(root, 'linked');
  mkdirSync(linkDir);
  const link = join(linkDir, 'applications.md');
  try { symlinkSync(real, link); } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') return; // symlinks need privileges on some Windows setups
    throw e;
  }
  const r = run(root, [], { CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: link });
  assert.equal(r.status, 0, r.out);
  assert.match(readFileSync(real, 'utf-8'), /\| — \|/, 'the real file was rewritten');
  assert.equal(readFileSync(`${real}.bak`, 'utf-8'), original, 'backup beside the real file, original bytes');
  assert.equal(existsSync(`${link}.bak`), false, 'no backup beside the link');
}));
