// The dashboard delegates its writes, including strict Report-cell identity,
// to the same locked writer that owns the transition ledger and follow-ups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectColumns, parseTrackerRow, resolveColumns } from '../tracker-parse.mjs';
import { analyzeFromContent } from '../followup-cadence.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n';
const ROW = '| 42 | 2026-02-01 | Example Co | Engineer | 4.2/5 | Evaluated | ❌ | [7](reports/007.md) | original |\n';

function fixture(t, content = HEADER + ROW) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-report-link-'));
  const data = join(dir, 'data');
  mkdirSync(data);
  const tracker = join(data, 'applications.md');
  writeFileSync(tracker, content);
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  return { dir, data, tracker };
}

function run(f, args = ['--report-link', '7', 'Applied']) {
  const result = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args, '--json'], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: f.dir, CAREER_OPS_TRACKER: f.tracker, CAREER_OPS_TRACKER_LOCK: '' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { ...result, json: JSON.parse(result.stdout) };
}

function unchanged(f, before) {
  assert.equal(readFileSync(f.tracker, 'utf8'), before);
  assert.equal(existsSync(join(f.data, 'status-log.tsv')), false);
  assert.equal(existsSync(join(f.data, 'follow-ups.md')), false);
}

for (const format of ['pipe', 'tabs', 'tabs-status-last', 'pipe-no-closing-delimiter', 'indented-pipe', 'indented-tabs']) {
  test(`${format}: strict report transition preserves cells and records the complete lifecycle`, t => {
    let header = HEADER;
    let row = ROW.replace('Example Co', 'Applied Materials');
    if (format === 'tabs-status-last') {
      header = '| Company | # | Date | Via | Role | Score | PDF | Report | Notes | Status |\n';
      row = '| Applied Materials | 42 | 2026-02-01 | Agency | Engineer | 4.2/5 | ❌ | [7](reports/007.md) | original | Evaluated |\n';
    }
    if (format.includes('tabs')) row = row.replaceAll(' | ', '\t');
    if (format.startsWith('indented')) {
      header = '  ' + header;
      row = '  ' + row;
    }
    if (format === 'pipe-no-closing-delimiter') row = row.replace(/ \|\n$/, '\n');
    const f = fixture(t, header + row);
    const args = ['--report-link', '7', 'Applied', '--note', 'follow-up'];
    const result = run(f, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.num, 42, 'report ID must not be treated as tracker row ID');
    assert.equal(result.json.statusLogged, true);
    assert.equal(result.json.followupSeeded.seeded, true, result.stderr);
    const expected = header + row.replace('Evaluated', 'Applied').replace('original', 'original; follow-up');
    assert.equal(readFileSync(f.tracker, 'utf8'), expected);
    const ledger = readFileSync(join(f.data, 'status-log.tsv'), 'utf8');
    assert.match(ledger, /^42\t\d{4}-\d{2}-\d{2}\tEvaluated\tApplied\tset-status\t\n$/);
    const followups = readFileSync(join(f.data, 'follow-ups.md'), 'utf8');
    assert.equal(followups.split('\n').filter(line => line.includes('next #42 ')).length, 1);
    const cadence = analyzeFromContent(expected, followups);
    assert.ok(cadence.entries.some(entry => entry.num === 42), 'follow-up cadence must still see the updated application');
    const retry = run(f, args);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(retry.json.changed, false);
    assert.equal(readFileSync(f.tracker, 'utf8'), expected);
    assert.equal(readFileSync(join(f.data, 'status-log.tsv'), 'utf8'), ledger);
    assert.equal(readFileSync(join(f.data, 'follow-ups.md'), 'utf8'), followups);
  });
}

test('strict report identity ignores references in Notes', t => {
  const decoy = ROW.replace('42', '99').replace('[7](reports/007.md)', '—').replace('original', 'see [7](reports/007-example.md)');
  const f = fixture(t, HEADER + decoy + ROW);
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.num, 42);
  assert.ok(readFileSync(f.tracker, 'utf8').includes(decoy));
});

for (const report of [
  '[7](reports/007.md) [8](reports/008.md)', '[8](reports/008.md) [7](reports/007.md)',
  '[7](reports/007.md) trailing', 'prefix [7](reports/007.md)',
  '[7](reports/007.md) [7](reports/007.md)',
]) {
  test(`strict selection refuses malformed Report cell: ${report}`, t => {
    // A valid duplicate must never cause the malformed candidate to be skipped.
    const before = HEADER + ROW.replace('[7](reports/007.md)', report) + ROW.replace('42', '99');
    const f = fixture(t, before);
    const result = run(f);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.json.code, 'malformed-report');
    unchanged(f, before);
  });
}

for (const [name, row] of [
  ['duplicate identity', ROW + ROW.replace('42', '99')],
  ['unknown current status', ROW.replace('Evaluated', '???')],
  ['empty current status', ROW.replace('Evaluated', '')],
  ['missing Notes cell', ROW.replace(' original |', '')],
  ['missing Notes cell beside a valid candidate', ROW.replace(' original |', '') + ROW.replace('42', '99')],
  ['Notes-only report', ROW.replace('[7](reports/007.md)', '—').replace('original', '[7](reports/007-example.md)')],
]) {
  test(`strict selector refuses ${name} without side effects`, t => {
    const before = HEADER + row;
    const f = fixture(t, before);
    const result = run(f, ['--report-link', '7', 'Applied', '--note', 'follow-up']);
    assert.notEqual(result.status, 0);
    unchanged(f, before);
  });
}

test('strict selector reads legacy bold status and fills a compact empty Notes cell', t => {
  const before = HEADER + ROW.replace('Evaluated', '**Evaluated**').replace('| original |', '||');
  const f = fixture(t, before);
  const result = run(f, ['--report-link', '7', 'Interview', '--note', 'scheduled']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.tracker, 'utf8'), before.replace('**Evaluated**', 'Interview').replace('||', '| scheduled |'));
});

test('tab whitespace inside a pipe cell does not become a column separator', t => {
  const before = HEADER + ROW.replace('original', 'original\tnote');
  const f = fixture(t, before);
  const result = run(f, ['--report-link', '7', 'Interview']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.tracker, 'utf8'), before.replace('Evaluated', 'Interview'));
});

for (const format of ['tabs', 'pipe']) {
  test(`${format}: note tabs cannot shift the final Status cell`, t => {
    const header = '| # | Date | Company | Role | Score | PDF | Report | Notes | Status |\n';
    let row = '| 42 | 2026-02-01 | Example Co | Engineer | 4.2/5 | ❌ | [7](reports/007.md) | original | Evaluated |\n';
    if (format === 'tabs') row = row.replaceAll(' | ', '\t');
    const f = fixture(t, header + row);
    const note = 'first\tsecond\t\tthird';
    const storedNote = format === 'tabs' ? 'first second  third' : note;
    const args = ['--row', '42', 'Applied', '--note', note];
    const result = run(f, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.note, storedNote);
    assert.equal(result.json.statusLogged, true);
    assert.equal(result.json.followupSeeded.seeded, true, result.stderr);
    const expected = header + row.replace('Evaluated', 'Applied').replace('original', `original; ${storedNote}`);
    assert.equal(readFileSync(f.tracker, 'utf8'), expected);
    const followups = readFileSync(join(f.data, 'follow-ups.md'), 'utf8');
    assert.equal(followups.split('\n').filter(line => line.includes('next #42 ')).length, 1);
    assert.ok(analyzeFromContent(expected, followups).entries.some(entry => entry.num === 42));
    const retry = run(f, args);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(retry.json.changed, false);
    assert.equal(readFileSync(f.tracker, 'utf8'), expected);
    assert.equal(readFileSync(join(f.data, 'follow-ups.md'), 'utf8'), followups);
  });
}

test('tab headers use the same column map as tab data rows', () => {
  const header = HEADER.trimEnd().replaceAll(' | ', '\t');
  const row = ROW.trimEnd().replaceAll(' | ', '\t');
  assert.equal(detectColumns([header]), null, 'default parser must not admit layouts pipe-only writers cannot rewrite');
  assert.equal(parseTrackerRow(row), null);
  const options = { allowTabs: true, allowIndentation: true };
  const parsed = parseTrackerRow(row, resolveColumns([header, row], options), options);
  assert.equal(parsed.num, 42);
  assert.equal(parsed.status, 'Evaluated');
  assert.equal(parsed.report, '[7](reports/007.md)');
  assert.equal(parsed.notes, 'original');
});

test('pipe-only writers cannot begin rewriting tab rows through the shared parser', t => {
  const tabRow = ROW.replace('reports/007.md', 'reports/007-example.md').replaceAll(' | ', '\t');
  const otherRow = ROW.replace('42', '99').replace('[7](reports/007.md)', '[8](reports/008-other.md)');
  const before = HEADER + tabRow + otherRow;
  const f = fixture(t, before);
  const result = spawnSync(process.execPath, [join(ROOT, 'mark-pdf-ready.mjs'), '7', '--json'], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: f.dir, CAREER_OPS_TRACKER: f.tracker, CAREER_OPS_TRACKER_LOCK: '' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).code, 'not-found');
  unchanged(f, before);
});

for (const note of ['--dry-run', '--help']) {
  test(`equals-form note treats ${note} as text, never a flag`, t => {
    const f = fixture(t);
    const result = run(f, ['--report-link', '7', 'Applied', `--note=${note}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.note, note);
    assert.equal(result.json.statusLogged, true);
    assert.equal(result.json.followupSeeded.seeded, true);
    assert.equal(readFileSync(f.tracker, 'utf8'), (HEADER + ROW).replace('Evaluated', 'Applied').replace('original', `original; ${note}`));
  });
}

test('separate note flag still cannot consume --dry-run as its value', t => {
  const f = fixture(t);
  const result = run(f, ['--report-link', '7', 'Applied', '--note', '--dry-run']);
  assert.equal(result.status, 1);
  assert.equal(result.json.code, 'usage');
  unchanged(f, HEADER + ROW);
});

for (const args of [
  ['--report-link', 'bad', 'Applied'], ['--report-link', '7', '--row', '42', 'Applied'],
  ['--report-link', '7', '--report', '7', 'Applied'], ['--report-link'],
]) {
  test(`strict selector validates arguments: ${args.join(' ')}`, t => {
    const f = fixture(t);
    assert.equal(run(f, args).status, 1);
    unchanged(f, HEADER + ROW);
  });
}
