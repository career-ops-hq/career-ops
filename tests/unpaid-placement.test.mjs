import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';
import { extractRows, checkFreshness } from '../check-table-freshness.mjs';

console.log('\nUnpaid-placement signal (#5446, jurisdiction lens #2026)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const tablePath = join(ROOT, 'templates', 'jurisdiction-unpaid-placement.yml');
const signalPath = join(ROOT, 'modes', 'oferta-signals', '20-unpaid-placement.md');

check('table and signal files exist', existsSync(tablePath) && existsSync(signalPath), 'missing table or signal file');

const raw = read('templates', 'jurisdiction-unpaid-placement.yml');
const doc = yaml.load(raw);
const rows = doc?.jurisdictions || {};
const on = rows['CA-ON'];

// --- table shape ---
check('table has exactly one live seed row (Ontario); UK/US/AU/FR stay comments',
  Object.keys(rows).length === 1 && Boolean(on),
  `rows: ${Object.keys(rows).join(', ')}`);
check('Ontario row carries the verified citations',
  on?.effective === '2026-01-01'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(on?.as_of))
    && /clause \(c\)/.test(on?.applies_to || '')
    && /receives training from a person who is an employer/.test(on?.applies_to || '')
    && Array.isArray(on?.exceptions) && on.exceptions.length === 4
    && /s\. 3 \(5\) para\. 1/.test(on.exceptions[0]) && /para\. 2:/.test(on.exceptions[1])
    && /para\. 2\.1/.test(on.exceptions[2]) && /285\/01 s\. 2 \(1\) \(e\)/.test(on.exceptions[3]),
  'effective/as_of/applies_to/exceptions incomplete');
check('Ontario official_source is an ontario.ca/laws URL',
  /^https:\/\/www\.ontario\.ca\/laws\//.test(on?.official_source?.url || ''),
  String(on?.official_source?.url));
check('Ontario legal_basis cites ESA s. 1 (1), s. 3 (5) and O. Reg. 285/01',
  /s\. 1 \(1\)/.test(on?.legal_basis || '') && /s\. 3 \(5\)/.test(on?.legal_basis || '') && /285\/01/.test(on?.legal_basis || ''),
  String(on?.legal_basis));
check('header documents contribution rule, never-assert rule and official-source-only requirement',
  raw.includes('CONTRIBUTION RULE') && raw.includes('NEVER-ASSERT RULE') && raw.includes('never a third-party mirror'),
  'header sections missing');
check('UK, US, AU and FR are listed only as commented candidates',
  ['GB', 'US', 'AU', 'FR'].every((k) => new RegExp(`#\\s+- ${k}\\s*:`).test(raw)) && !('GB' in rows) && !('US' in rows),
  'candidate comments missing or promoted to rows');
check('unverified ministry six-conditions test stays out of the live row',
  !JSON.stringify(on).toLowerCase().includes('six conditions') && /six conditions/.test(raw),
  'six-conditions test leaked into the row or the not-verified note is missing');

// --- freshness validator discovers it ---
const found = extractRows(doc);
check('check-table-freshness discovers the Ontario row with as_of',
  found.length === 1 && found[0].row.jurisdiction === 'CA-ON' && !found[0].missingAsOf,
  `found ${found.length}`);
const verdict = checkFreshness([{ file: 'jurisdiction-unpaid-placement.yml', doc }], new Date(Date.UTC(2026, 9, 18)));
check('freshly verified row produces no findings',
  verdict.rowsChecked === 1 && verdict.findings.length === 0 && verdict.warnings.length === 0,
  JSON.stringify(verdict));

// --- synthetic fixtures for the cases (patterns mirror the signal's examples) ---
const unpaidRe = /\bunpaid\b|stipend[- ]only|\bvolunteer\b/i;
const schoolRe = /for course credit|co-?op placement|enrolled in an approved program/i;
const fixtures = {
  unpaid: 'Example Widgets Ltd. Marketing Intern, Toronto. This is an unpaid internship for six months.',
  stipendOnly: 'Sample Media Inc. Content Trainee, Ottawa. Stipend-only position; no salary.',
  credit: 'Placeholder University Lab. Research Assistant, Hamilton. Co-op placement through your school, for course credit.',
  silent: 'Placeholder Software Corp. Support Analyst, Hamilton. Join a friendly team. Hybrid. Competitive benefits.',
  paid: 'Example Logistics Inc. Intern, London. Paid internship, $20 per hour.',
};
check('fixture: unpaid internship matches the unpaid pattern', unpaidRe.test(fixtures.unpaid), 'no match');
check('fixture: stipend-only matches the unpaid pattern', unpaidRe.test(fixtures.stipendOnly), 'no match');
check('fixture: credit-bearing placement matches the school pattern and not the unpaid one',
  schoolRe.test(fixtures.credit) && !unpaidRe.test(fixtures.credit), 'wrong classification');
check('fixture: silent JD matches neither pattern (no output)',
  !unpaidRe.test(fixtures.silent) && !schoolRe.test(fixtures.silent), 'unexpected match');
check('fixture: paid internship matches neither pattern (no output)',
  !unpaidRe.test(fixtures.paid) && !schoolRe.test(fixtures.paid), 'unexpected match');

// --- signal behaviour contract ---
const signal = read('modes', 'oferta-signals', '20-unpaid-placement.md');
check('signal handles unpaid, school-placement and silent outcomes',
  /Posting states the role is unpaid/.test(signal) && /credit-bearing or a school placement/.test(signal)
    && /is silent about pay and says nothing about a credit-bearing or school placement/.test(signal) && /there is no silence check/.test(signal),
  'outcome sections missing');
check('signal never asserts unlawfulness or carve-out applicability',
  /NEVER say or imply that the employer broke the law/.test(signal) && /NEVER assert that a carve-out does or does not apply/.test(signal)
    && /cannot be seen from the posting/.test(signal),
  'phrasing discipline missing');
const quoted = signal.split('\n').filter((l) => l.startsWith('>'));
check('report templates carry no accusatory wording',
  quoted.length >= 2 && !quoted.some((l) => /(employer|company)\s+(is|was|has|failed|did not)\s+(breaking|violat|non-?compl|fail)/i.test(l)),
  'accusatory blockquote found or templates missing');
check('signal is zero-fetch and warn-only',
  /never fetches or scrapes anything/.test(signal) && /never changes the 1-5 Global Score/.test(signal)
    && /not legal advice/.test(signal) && /\{language\.output\}/.test(signal),
  'zero-fetch / warn-only / not-legal-advice / language.output missing');
check('signal references the table and config/profile.yml',
  signal.includes('templates/jurisdiction-unpaid-placement.yml') && signal.includes('config/profile.yml'),
  'references missing');

// --- wiring ---
const oferta = read('modes', 'oferta.md');
check('oferta indexes Signal 20 and its file',
  oferta.includes('**20. Unpaid-Placement**. Read `modes/oferta-signals/20-unpaid-placement.md`'),
  'missing index line');
check('oferta Risk Summary carries the unpaid-placement row',
  oferta.includes('| Unpaid placement |'), 'row missing');
const batch = read('batch', 'batch-prompt.md');
check('batch-prompt Machine Summary schema carries unpaid_placement in both templates',
  batch.split('unpaid_placement:').length - 1 === 2, 'key missing or not in both templates');
check('batch-prompt carries the Signal 20 rule and rendering row',
  batch.includes('20. **Unpaid-Placement**') && batch.includes('| Unpaid placement |'), 'batch rule or row missing');
check('templates/README documents the table',
  read('templates', 'README.md').includes('jurisdiction-unpaid-placement.yml'), 'README entry missing');
