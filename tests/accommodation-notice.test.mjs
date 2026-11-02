import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';
import { extractRows, checkFreshness } from '../check-table-freshness.mjs';

console.log('\nAccommodation-notice signal (#5449, jurisdiction lens #2026)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const tablePath = join(ROOT, 'templates', 'jurisdiction-accommodation-notice.yml');
const signalPath = join(ROOT, 'modes', 'oferta-signals', '22-accommodation-notice.md');
check('table and signal files exist', existsSync(tablePath) && existsSync(signalPath), 'missing table or signal file');

const raw = read('templates', 'jurisdiction-accommodation-notice.yml');
const doc = yaml.load(raw);
const rows = doc?.jurisdictions || {};
const on = rows['CA-ON'];

// --- table shape ---
check('table has exactly one live seed row (Ontario); Manitoba and US stay comments',
  Object.keys(rows).length === 1 && Boolean(on), `rows: ${Object.keys(rows).join(', ')}`);
check('Ontario row carries the verified citations',
  /^\d{4}-\d{2}-\d{2}$/.test(String(on?.as_of)) && String(on?.as_of) >= '2026-10-18'
    && on?.official_source?.url === 'https://www.ontario.ca/laws/regulation/110191'
    && /^s\. 22:/.test(on?.requires?.general || '') && /s\. 23 \(1\)/.test(on?.requires?.assessment || '')
    && /s\. 23 \(2\)/.test(on?.requires?.assessment || '') && /^s\. 24:/.test(on?.requires?.offer || '')
    && /ss\. 20, 21, 22, 23 \(1\)-\(2\) and 24/.test(on?.legal_basis || ''),
  'as_of / official_source / requires / legal_basis incomplete');
check('Ontario applies_to says applicability depends on employer type and size and lists the s. 21 dates',
  /depends on the employer's type and size/.test(on?.applies_to || '')
    && ['2013-01-01', '2014-01-01', '2015-01-01', '2016-01-01', '2017-01-01'].every((d) => (on?.applies_to || '').includes(d)),
  String(on?.applies_to));
check('row cites no employee-count threshold',
  !/\b\d+\s+or more employees\b|fewer than \d+|\b\d+\+ employees\b/i.test(JSON.stringify(on)), 'threshold leaked into the row');
check('header documents contribution rule, never-assert rule and official-source-only requirement',
  raw.includes('CONTRIBUTION RULE') && raw.includes('NEVER-ASSERT RULE') && raw.includes('never a third-party mirror'),
  'header sections missing');
check('Manitoba and US Section 503 are listed only as commented candidates',
  /#\s+- CA-MB\s*:/.test(raw) && /#\s+- US \(federal contractors\)\s*:/.test(raw) && !('CA-MB' in rows) && !('US' in rows),
  'candidate comments missing or promoted to rows');

// --- freshness validator discovers it ---
const found = extractRows(doc);
check('check-table-freshness discovers the Ontario row with as_of',
  found.length === 1 && found[0].row.jurisdiction === 'CA-ON' && !found[0].missingAsOf, `found ${found.length}`);
const verdict = checkFreshness([{ file: 'jurisdiction-accommodation-notice.yml', doc }], new Date(Date.UTC(2026, 9, 18)));
check('freshly verified row produces no findings',
  verdict.rowsChecked === 1 && verdict.findings.length === 0 && verdict.warnings.length === 0, JSON.stringify(verdict));

// --- synthetic fixtures: a small model of the signal's decision table ---
// `evaluate` models the rules documented in modes/oferta-signals/22-accommodation-notice.md.
// It is not the production implementation (Signal 22 is agent-judged); these fixtures pin the
// documented decision table, not the agent's behaviour.
const statesRe = /accommodations? (is|are) available/i;
function evaluate({ jd, postingDate = '2026-10-01', jurisdiction = 'CA-ON', invited = false }) {
  const row = rows[jurisdiction];
  const states = statesRe.test(jd);
  const out = [];
  if (states) out.push('statement');
  else if (row && row.effective <= postingDate) out.push('silence');
  if (invited) out.push('stage-hint'); // independent of (a) and (b); generic line when there is no row
  return JSON.stringify(out);
}
const withStatement = 'Example Widgets Ltd. Analyst, Toronto. Accommodations are available on request during the recruitment process.';
const silent = 'Placeholder Software Corp. Support Analyst, Hamilton. Join a friendly team. Hybrid. Competitive benefits.';
check('fixture: statement present gives the statement note and no silence note',
  evaluate({ jd: withStatement }) === '["statement"]', evaluate({ jd: withStatement }));
check('fixture: statement absent gives the corroborating silence note only',
  evaluate({ jd: silent }) === '["silence"]', evaluate({ jd: silent }));
check('fixture: assessment-stage hint fires even when the posting is silent (silence rule must not swallow it)',
  evaluate({ jd: silent, invited: true }) === '["silence","stage-hint"]', evaluate({ jd: silent, invited: true }));
check('fixture: assessment-stage hint fires alongside a stated accommodation',
  evaluate({ jd: withStatement, invited: true }) === '["statement","stage-hint"]', evaluate({ jd: withStatement, invited: true }));
check('fixture: no jurisdiction row gives no silence note but still the generic stage hint',
  evaluate({ jd: silent, jurisdiction: 'XX', invited: true }) === '["stage-hint"]', evaluate({ jd: silent, jurisdiction: 'XX', invited: true }));
check('fixture: no jurisdiction row and no invitation gives nothing',
  evaluate({ jd: silent, jurisdiction: 'XX' }) === '[]', evaluate({ jd: silent, jurisdiction: 'XX' }));
check('fixture: no jurisdiction row still allows the presence note',
  evaluate({ jd: withStatement, jurisdiction: 'XX' }) === '["statement"]', evaluate({ jd: withStatement, jurisdiction: 'XX' }));

// --- signal behaviour contract ---
const signal = read('modes', 'oferta-signals', '22-accommodation-notice.md');
check('signal defines presence, corroborating silence and stage hint as independent checks',
  /Three independent checks/.test(signal) && /never suppresses another/.test(signal)
    && /corroborating-only, never fires standalone/.test(signal) && /runs whether or not \(a\) or \(b\) fired/.test(signal),
  'check structure missing');
check('stage hint never asks about or infers health or disability',
  /never ask about, infer or comment on the candidate's health/.test(signal)
    && /never ask whether they need an accommodation/.test(signal), 'stage-hint guard missing');
check('silence needs a jurisdiction row; the stage hint runs without one as a generic line only',
  /No table row → this check says nothing/.test(signal)
    && /whether or not a table row exists/.test(signal) && /give only the generic line/.test(signal)
    && /add no jurisdiction-specific detail/.test(signal), 'conditional wording missing');
check('signal never asserts non-compliance or coverage',
  /NEVER say or imply that the employer broke the law/.test(signal) && /NEVER assert that the employer is an obligated organization/.test(signal)
    && /depends on its type and size/.test(signal), 'phrasing discipline missing');
const quoted = signal.split('\n').filter((l) => l.startsWith('>'));
check('report templates carry no accusatory wording',
  quoted.length === 3 && !quoted.some((l) => /(employer|company)\s+(is|was|has|failed|did not)\s+(breaking|violat|non-?compl|fail)/i.test(l)),
  'accusatory blockquote found or templates missing');
check('signal is zero-fetch and warn-only',
  /never fetches or scrapes anything/.test(signal) && /never changes the 1-5 Global Score/.test(signal)
    && /not legal advice/.test(signal) && /\{language\.output\}/.test(signal), 'zero-fetch / warn-only / not-legal-advice / language.output missing');
check('signal references the table and config/profile.yml',
  signal.includes('templates/jurisdiction-accommodation-notice.yml') && signal.includes('config/profile.yml'), 'references missing');

// --- wiring ---
const oferta = read('modes', 'oferta.md');
check('oferta indexes Signal 22 and its file',
  oferta.includes('**22. Accommodation-Notice**. Read `modes/oferta-signals/22-accommodation-notice.md`'), 'missing index line');
check('oferta Risk Summary carries the accommodation-notice row', oferta.includes('| Accommodation notice |'), 'row missing');
const batch = read('batch', 'batch-prompt.md');
check('batch-prompt Machine Summary schema carries accommodation_notice in both templates',
  batch.split('accommodation_notice:').length - 1 === 2, 'key missing or not in both templates');
check('batch-prompt carries the Signal 22 rule and rendering row',
  batch.includes('22. **Accommodation-Notice**') && batch.includes('| Accommodation notice |'), 'batch rule or row missing');
check('templates/README documents the table',
  read('templates', 'README.md').includes('jurisdiction-accommodation-notice.yml'), 'README entry missing');
