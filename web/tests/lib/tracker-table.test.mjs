import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseApplications } from '../../src/lib/tracker-table.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const markets = [
  ['DE', 'Datum', 'Firma', 'Rolle'], ['PL', 'Data', 'Firma', 'Rola'],
  ['PT', 'Data', 'Empresa', 'Vaga'], ['DA', 'Dato', 'Virksomhed', 'Rolle'],
  ['ID', 'Tanggal', 'Perusahaan', 'Role'], ['EN', 'Date', 'Company', 'Role'],
  ['ES', 'Fecha', 'Empresa', 'Puesto'],
];

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
