import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseApplications } from '../../src/lib/tracker-table.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ALIASES = {
  '#': 'num',
  date: 'date',
  company: 'company',
  via: 'via',
  role: 'role',
  score: 'score',
  status: 'status',
  pdf: 'pdf',
  report: 'report',
  notes: 'notes',
};

const TRACKER = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-09-23 | Example | Agency | Frontend Engineer | 4.0/5 | Applied | ✅ | [001](../reports/001-example.md) | fixture |
`;

const markets = [
  ['DE', 'Datum', 'Firma', 'Rolle'], ['PL', 'Data', 'Firma', 'Rola'],
  ['PT', 'Data', 'Empresa', 'Vaga'], ['DA', 'Dato', 'Virksomhed', 'Rolle'],
  ['ID', 'Tanggal', 'Perusahaan', 'Role'], ['EN', 'Date', 'Company', 'Role'],
  ['ES', 'Fecha', 'Empresa', 'Puesto'],
];

test('parses header columns when the data root does not contain system files', (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-data-'));
  const systemRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-system-'));
  t.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(systemRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(systemRoot, 'tracker-aliases.json'), JSON.stringify(ALIASES));

  assert.deepEqual(parseApplications(TRACKER, dataRoot, systemRoot), [
    {
      n: '1',
      date: '2026-09-23',
      company: 'Example',
      via: 'Agency',
      role: 'Frontend Engineer',
      score: '4.0/5',
      status: 'Applied',
      pdf: '✅',
      report: '[001](../reports/001-example.md)',
      notes: 'fixture',
    },
  ]);
});

for (const [market, date, company, role] of markets) {
  test(`${market}: real shared aliases parse reordered tracker with Location and Via`, () => {
    const md = `| ${company} | Status | # | ${date} | Location | Via | ${role} | Score | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Acme | Applied | 41 | 2026-01-02 | Berlin | Example Agency | Engineer | 4.2/5 | ✅ | [41](reports/041.md) | keep this note |`;
    assert.deepEqual(parseApplications(md, root), [{
      n: '41', date: '2026-01-02', company: 'Acme', via: 'Example Agency', role: 'Engineer',
      score: '4.2/5', status: 'Applied', pdf: '✅', report: '[41](reports/041.md)', notes: 'keep this note',
    }]);
  });
}

test('headerless tracker keeps data whose cells contain localized header words', () => {
  const md = '| 41 | 2026-01-02 | Firma | Rolle | 4.2/5 | Applied | ✅ | [41](reports/041.md) | Status |';
  assert.deepEqual(parseApplications(md, root), [{
    n: '41', date: '2026-01-02', company: 'Firma', via: '', role: 'Rolle', score: '4.2/5',
    status: 'Applied', pdf: '✅', report: '[41](reports/041.md)', notes: 'Status',
  }]);
});
