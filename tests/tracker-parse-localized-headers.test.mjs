// tests/tracker-parse-localized-headers.test.mjs — localized tracker headers
// shipped by mode docs should resolve by header name, not fall back to legacy.
import { pass, fail } from './helpers.mjs';
import { detectColumns, resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';

console.log('\ntracker-parse localized header detection');

const SHIPPED_HEADERS = [
  { mode: 'de', header: '| # | Datum | Firma | Rolle | Score | Status | PDF | Report |' },
  { mode: 'pl', header: '| # | Data | Firma | Rola | Score | Status | PDF | Report |' },
  { mode: 'pt', header: '| # | Data | Empresa | Vaga | Score | Status | PDF | Report |' },
  { mode: 'da', header: '| # | Dato | Virksomhed | Rolle | Score | Status | PDF | Report |' },
  { mode: 'id', header: '| # | Tanggal | Perusahaan | Role | Score | Status | PDF | Report |' },
];

for (const { mode, header } of SHIPPED_HEADERS) {
  const map = detectColumns([header]);
  if (map && map.num != null && map.company != null && map.role != null && map.score != null && map.status != null) {
    pass(`${mode} shipped header resolves all required columns`);
  } else {
    fail(`${mode} shipped header did not resolve required columns (got ${JSON.stringify(map)})`);
  }
}

{
  const lines = [
    '| # | Datum | Firma | Ort | Rolle | Score | Status | PDF | Report | Notes |',
    '|---|-------|-------|-----|-------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-01-01 | Acme | Berlin | Engineer | 4.2/5 | Applied | ❌ | [1](r.md) | note |',
  ];
  const row = parseTrackerRow(lines[2], resolveColumns(lines));
  if (row && row.role === 'Engineer' && row.score === '4.2/5' && row.status === 'Applied') {
    pass('de localized header + inserted location keeps role/score/status aligned');
  } else {
    fail(`de localized header + location shifted columns: ${JSON.stringify(row)}`);
  }
}
