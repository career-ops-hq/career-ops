import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';
import { extractRows, checkFreshness } from '../check-table-freshness.mjs';

console.log('\nVacancy-status disclosure (#5420, jurisdiction lens #2026)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const tablePath = join(ROOT, 'templates', 'jurisdiction-vacancy-disclosure.yml');
const signalPath = join(ROOT, 'modes', 'oferta-signals', '19-vacancy-status-disclosure.md');

check('table and signal files exist', existsSync(tablePath) && existsSync(signalPath), 'missing table or signal file');

const raw = read('templates', 'jurisdiction-vacancy-disclosure.yml');
const doc = yaml.load(raw);
const rows = doc?.jurisdictions || {};
const on = rows['CA-ON'];

// --- table shape ---
check('table has exactly one live seed row (Ontario); candidates stay comments',
  Object.keys(rows).length === 1 && Boolean(on) && !('US-NY' in rows),
  `rows: ${Object.keys(rows).join(', ')}`);
check('Ontario row carries the verified facts',
  on?.effective === '2026-01-01'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(on?.as_of))
    && /fewer than 25 employees/.test(on?.employer_size_threshold || '')
    && /imminently available for a qualified candidate to fill/.test(on?.existing_vacancy_definition || '')
    && on?.no_duty_to_fill === true
    && /3 years/.test(on?.record_retention || '')
    && Array.isArray(on?.not_covered) && on.not_covered.length >= 4,
  'effective/as_of/threshold/definition/no_duty_to_fill/retention/not_covered incomplete');
check('Ontario official_source is the ontario.ca guide page',
  on?.official_source?.url === 'https://www.ontario.ca/document/your-guide-employment-standards-act-0/requirements-related-publicly-advertised-job',
  String(on?.official_source?.url));
check('Ontario legal_basis cites ESA s. 8.5 and O. Reg. 476/24',
  /8\.5/.test(on?.legal_basis || '') && /476\/24/.test(on?.legal_basis || ''),
  String(on?.legal_basis));
check('header documents contribution rule, never-assert rule and official-source-only requirement',
  raw.includes('CONTRIBUTION RULE') && raw.includes('NEVER-ASSERT RULE') && raw.includes('never a third-party mirror'),
  'header sections missing');
check('New York S8877 is listed only as a commented, non-law candidate',
  /#\s+- US-NY : New York S8877 \/ A6292a/.test(raw) && /Not law until signed/.test(raw),
  'candidate comment missing or not marked as not-law');

// --- freshness validator discovers it ---
const found = extractRows(doc);
check('check-table-freshness discovers the Ontario row with as_of',
  found.length === 1 && found[0].row.jurisdiction === 'CA-ON' && !found[0].missingAsOf,
  `found ${found.length}`);
const verdict = checkFreshness([{ file: 'jurisdiction-vacancy-disclosure.yml', doc }], new Date(Date.UTC(2026, 9, 17)));
check('freshly verified row produces no findings',
  verdict.rowsChecked === 1 && verdict.findings.length === 0 && verdict.warnings.length === 0,
  JSON.stringify(verdict));

// --- synthetic fixtures for the three outcomes ---
const examples = (on?.statement_language_examples || []).map((e) => e.toLowerCase());
const fixtures = {
  statesVacancy: 'Example Widgets Ltd. Customer Success Associate, Toronto. This posting is for an existing vacancy. Apply by the end of the month.',
  statesNoVacancy: 'Sample Logistics Inc. Warehouse Coordinator, Ottawa. There is no existing vacancy; we are building a talent pool for future openings.',
  silent: 'Placeholder Software Corp. Support Analyst, Hamilton. Join a friendly team. Hybrid. Competitive benefits.',
};
const matches = (text) => examples.some((e) => text.toLowerCase().includes(e));
check('fixture: JD stating an existing vacancy matches a statement example', matches(fixtures.statesVacancy), 'no example matched');
check('fixture: JD stating no existing vacancy matches a statement example', matches(fixtures.statesNoVacancy), 'no example matched');
check('fixture: silent JD matches no statement example', !matches(fixtures.silent), 'unexpected match');

// --- signal behaviour contract ---
const signal = read('modes', 'oferta-signals', '19-vacancy-status-disclosure.md');
check('signal handles all three outcomes',
  /States an existing vacancy/.test(signal) && /States it is NOT an existing vacancy/.test(signal)
    && /\(b\) Silence check/.test(signal) && /corroborating-only/.test(signal) && /never fires standalone/.test(signal),
  'outcome sections missing');
check('signal states rule and silence side by side and never asserts a violation',
  /side by side/.test(signal) && /NEVER say or imply that the employer broke the law/.test(signal)
    && /NEVER assert how many employees/.test(signal),
  'phrasing discipline missing');
const quoted = signal.split('\n').filter((l) => l.startsWith('>'));
check('report templates carry no accusatory wording',
  quoted.length >= 3 && !quoted.some((l) => /(employer|company)\s+(is|was|has|failed|did not)\s+(breaking|violat|non-?compl|fail)/i.test(l)),
  'accusatory blockquote found or templates missing');
check('signal is zero-fetch and warn-only',
  /never fetches or scrapes anything/.test(signal) && /never changes the 1-5 Global Score/.test(signal)
    && /not legal advice/.test(signal) && /\{language\.output\}/.test(signal),
  'zero-fetch / warn-only / not-legal-advice / language.output missing');
check('signal references the table and config/profile.yml',
  signal.includes('templates/jurisdiction-vacancy-disclosure.yml') && signal.includes('config/profile.yml'),
  'references missing');

// --- wiring ---
const oferta = read('modes', 'oferta.md');
check('oferta indexes Signal 19 and its file',
  oferta.includes('**19. Vacancy-Status Disclosure**. Read `modes/oferta-signals/19-vacancy-status-disclosure.md`'),
  'missing index line');
check('oferta Risk Summary carries the vacancy-status row',
  oferta.includes('| Vacancy-status disclosure |'), 'row missing');
const batch = read('batch', 'batch-prompt.md');
check('batch-prompt Machine Summary schema carries vacancy_disclosure in both templates',
  batch.split('vacancy_disclosure:').length - 1 === 2, 'key missing or not in both templates');
check('Ontario retention duty cites ESA s. 15 (7.1)',
  /15 \(7\.1\)/.test(on?.record_retention || '') && /15 \(7\.1\)/.test(on?.legal_basis || '')
    && !/not confirmed/.test(on?.record_retention || ''),
  'retention source not cited');
check('batch maps a silent posting dated before the row effective date to not_evaluated',
  /not_evaluated`? otherwise, including a silent posting dated before the row's `effective` date/.test(batch)
    && /on or after that row's `effective` date, so the silence note was actually produced/.test(batch),
  'effective-date gate missing from the vacancy_disclosure mapping');
check('templates/README documents the table',
  read('templates', 'README.md').includes('jurisdiction-vacancy-disclosure.yml'), 'README entry missing');
