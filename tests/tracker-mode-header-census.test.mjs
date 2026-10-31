// A mode that shows a tracker header in its own language is telling the agent
// what to write. A label the shared alias table does not know leaves that
// tracker unreadable: no header resolves, the legacy nine-column layout refuses
// the eight-cell rows, and stats reports 0 while set-status exits on "no data
// rows". #3931 fixed five languages from a hand-written list and missed three,
// so this one reads the headers from modes/ instead.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { listTree } from '../lib/walk-tree.mjs';
import { detectColumns } from '../tracker-parse.mjs';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

// A tracker table is the one that opens on `#` and carries a PDF column. The
// pipeline shortlists do too, but they are narrower than any tracker.
const isTrackerHeader = (line) => {
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim().toLowerCase());
  return cells[0] === '#' && cells.length >= 8 && cells.includes('pdf');
};

const shipped = listTree(join(ROOT, 'modes'), { match: /\.md$/ })
  .flatMap((path) => readFileSync(path, 'utf8').split('\n')
    .filter(isTrackerHeader)
    .map((header) => ({ mode: relative(join(ROOT, 'modes'), path).split(sep).join('/'), header })));

ok('the census finds the shipped tracker headers', () => {
  const modes = new Set(shipped.map((entry) => entry.mode));
  assert.ok(shipped.length >= 20, `only ${shipped.length} headers`);
  for (const mode of ['oferta.md', 'de/angebot.md', 'fr/offre.md', 'it/annuncio.md', 'tr/tracker.md']) {
    assert.ok(modes.has(mode), `${mode} not found`);
  }
});

for (const { mode, header } of shipped) {
  ok(`${mode}: ${header}`, () => {
    const columns = detectColumns([header]);
    assert.ok(columns, 'no column map: a tracker with this header reads as empty');
    const labels = header.split('|').slice(1, -1).map((cell) => cell.trim());
    for (const [i, label] of labels.entries()) {
      assert.ok(Object.values(columns).includes(i + 1), `"${label}" is not a known label`);
    }
  });
}

const FULL_ENV = ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_FOLLOWUPS', 'CAREER_OPS_REPORTS', 'CAREER_OPS_CV',
  'CAREER_OPS_JDS', 'CAREER_OPS_ADDITIONS'];

function withTracker(header, fn) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-mode-header-'));
  mkdirSync(join(root, 'data'));
  const width = header.split('|').length - 2;
  const row = ['1', '2026-10-01', 'Acme', 'Data Engineer', '4.2/5', 'Evaluated', '❌', '[1](../reports/001-acme-2026-10-01.md)'];
  const lines = [header, `|${'---|'.repeat(width)}`, `| ${row.join(' | ')}${' | note'.repeat(width - row.length)} |`];
  writeFileSync(join(root, 'data', 'applications.md'), ['# Applications Tracker', '', ...lines, ''].join('\n'));
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  for (const name of FULL_ENV) env[name] = '';
  try { fn({ root, env }); } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const mode of ['fr/offre.md', 'it/annuncio.md', 'tr/tracker.md']) {
  const { header } = shipped.find((entry) => entry.mode === mode);
  ok(`${mode}: stats and set-status read a tracker with this header`, () => {
    withTracker(header, ({ root, env }) => {
      const stats = JSON.parse(execFileSync(NODE, [join(ROOT, 'stats.mjs')], { encoding: 'utf8', env, cwd: root }));
      assert.equal(stats.tracker.total, 1);
      const set = spawnSync(NODE, [join(ROOT, 'set-status.mjs'), '1', 'Applied'], { encoding: 'utf8', env, cwd: root });
      assert.equal(set.status, 0, set.stderr || set.stdout);
      assert.match(readFileSync(join(root, 'data', 'applications.md'), 'utf8'), /\| Applied \|/);
    });
  });
}
