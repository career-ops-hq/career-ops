// #3704: shipped market headers must survive inserted/reordered columns on
// both the read path and the real headed-addition/status write paths.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectColumns, isHeaderRow, parseTrackerRow, resolveColumns, resolveTsvColumns } from '../tracker-parse.mjs';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

const markets = [
  ['de/angebot', 'Datum', 'Firma', 'Rolle'],
  ['pl/oferta', 'Data', 'Firma', 'Rola'],
  ['pt/oferta', 'Data', 'Empresa', 'Vaga'],
  ['da/oferta', 'Dato', 'Virksomhed', 'Rolle'],
  ['id/lowongan', 'Tanggal', 'Perusahaan', 'Role'],
];
const baseFields = ['num', 'date', 'company', 'role', 'score', 'status', 'pdf', 'report'];
const values = {
  num: '41', date: '2026-01-02', company: 'Acme', role: 'Engineer',
  score: '4.2/5', status: 'Applied', pdf: '✅', report: '[41](reports/041-acme.md)',
  location: 'Berlin', via: 'Example Agency', notes: 'keep this note',
};
const pipe = cells => `| ${cells.join(' | ')} |`;
function fixture(labels, fields) {
  return [pipe(fields.map(k => labels[k])), pipe(fields.map(() => '---')), pipe(fields.map(k => values[k]))];
}
function assertRow(row, fields, overrides = {}) {
  assert.ok(row, 'data row must parse');
  for (const field of fields) {
    assert.equal(String(row[field]), String(overrides[field] ?? values[field]), field);
  }
}

for (const [mode, date, company, role] of markets) {
  const labels = { num: '#', date, company, role, score: 'Score', status: 'Status', pdf: 'PDF', report: 'Report', location: 'Location', via: 'Via', notes: 'Notes' };
  const shipped = fixture(labels, baseFields);
  check(`${mode}: exact shipped header reads all eight fields`, () => {
    assert.ok(readFileSync(join(ROOT, 'modes', `${mode}.md`), 'utf8').includes(shipped[0]), 'fixture must match the shipped mode');
    assert.ok(isHeaderRow(shipped[0]));
    assertRow(parseTrackerRow(shipped[2], resolveColumns(shipped)), baseFields);
  });

  const layouts = [
    ['inserted', ['num', 'date', 'company', 'location', 'via', 'role', 'score', 'status', 'pdf', 'report', 'notes']],
    ['reordered', ['company', 'status', 'num', 'date', 'location', 'via', 'role', 'score', 'pdf', 'report', 'notes']],
  ];
  for (const [layout, fields] of layouts) {
    const lines = fixture(labels, fields);
    check(`${mode}: ${layout} Location/Via layout reads by name`, () => {
      const columns = detectColumns(lines);
      assert.ok(columns, 'localized header must not fall back to fixed positions');
      const rows = lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
      assert.equal(rows.length, 1, 'header/separator must not become applications');
      assertRow(rows[0], fields);
      assert.deepEqual(resolveTsvColumns(fields.map(k => labels[k])), {
        map: Object.fromEntries(fields.map((k, i) => [k, i])), missing: [], duplicates: [], unknown: [],
      });
    });
  }

  check(`${mode}: headed TSV merge and set-status preserve reordered cells`, () => {
    const work = mkdtempSync(join(tmpdir(), 'localized-tracker-'));
    try {
      const fields = layouts[1][1];
      const lines = fixture(labels, fields);
      const tracker = join(work, 'data', 'applications.md');
      const additions = join(work, 'additions');
      mkdirSync(join(work, 'data'));
      mkdirSync(additions);
      mkdirSync(join(work, 'reports'));
      writeFileSync(tracker, `${lines.slice(0, 2).join('\n')}\n`);
      writeFileSync(join(additions, '041-acme.tsv'), `${fields.map(k => labels[k]).join('\t')}\n${fields.map(k => values[k]).join('\t')}\n`);
      const env = {
        ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_DATA_DIR: work,
        CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: additions,
        CAREER_OPS_REPORTS: join(work, 'reports'), CAREER_OPS_TRACKER_DB: join(work, 'tracker.db'),
        CAREER_OPS_PDF_INDEX: join(work, 'data', 'pdf-index.tsv'),
        CAREER_OPS_TRACKER_LOCK: join(work, 'tracker.lock'),
      };
      execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], { env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
      const merged = readFileSync(tracker, 'utf8').split('\n');
      const columns = resolveColumns(merged);
      const rows = merged.map(line => parseTrackerRow(line, columns)).filter(Boolean);
      assert.equal(rows.length, 1);
      assertRow(rows[0], fields, { report: '[41](../reports/041-acme.md)' });
      execFileSync(NODE, [join(ROOT, 'set-status.mjs'), '41', 'Interview', '--note', 'scheduled'], { env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
      const updated = readFileSync(tracker, 'utf8').split('\n');
      assert.equal(updated[0], lines[0], 'localized header stays intact');
      const changed = updated.map(line => parseTrackerRow(line, columns)).filter(Boolean);
      assert.equal(changed.length, 1);
      for (const field of fields.filter(k => !['status', 'notes'].includes(k))) assert.equal(changed[0][field], rows[0][field], field);
      assert.equal(changed[0].status, 'Interview');
      assert.ok(changed[0].notes.includes('keep this note') && changed[0].notes.includes('scheduled'));
    } finally { rmSync(work, { recursive: true, force: true }); }
  });
}

check('German Ort from the issue reproduction is the Location column', () => {
  const lines = ['| # | Datum | Firma | Ort | Rolle | Score | Status | PDF | Report |',
    '| 41 | 2026-01-02 | Acme | Berlin | Engineer | 4.2/5 | Applied | ✅ | [41](reports/041-acme.md) |'];
  assertRow(parseTrackerRow(lines[1], resolveColumns(lines)), [...baseFields, 'location']);
});

for (const [locale, date, company, role] of [['EN', 'Date', 'Company', 'Role'], ['ES', 'Fecha', 'Empresa', 'Puesto']]) {
  check(`${locale}: existing reordered aliases remain compatible`, () => {
    const fields = ['company', 'status', 'num', 'date', 'role', 'score', 'pdf', 'report', 'notes'];
    const lines = fixture({ num: 'Num', date, company, role, score: 'Score', status: 'Status', pdf: 'Materials', report: 'Report', notes: 'Notes' }, fields);
    assertRow(parseTrackerRow(lines[2], resolveColumns(lines)), fields);
  });
}

check('headerless data and individual alias words do not qualify as a header', () => {
  const fields = [...baseFields, 'notes'];
  for (const company of ['Company', 'Firma', 'Perusahaan', 'Virksomhed']) {
    const line = pipe(fields.map(k => k === 'company' ? company : k === 'notes' ? 'Status' : values[k]));
    assert.equal(isHeaderRow(line), false);
    assert.equal(detectColumns([line]), null);
    assertRow(parseTrackerRow(line, resolveColumns([line])), fields, { company, notes: 'Status' });
  }
  assert.equal(isHeaderRow('| # | Datum | Firma | Rolle | Score | unknown | PDF | Report |'), false, 'the complete required schema remains mandatory');
});
