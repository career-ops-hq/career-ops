import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';
import { extractRows, checkFreshness } from '../check-table-freshness.mjs';

console.log('\nCandidate-paid fees signal (#5448, jurisdiction lens #2026)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const tablePath = join(ROOT, 'templates', 'jurisdiction-candidate-fees.yml');
const signalPath = join(ROOT, 'modes', 'oferta-signals', '21-candidate-paid-fees.md');

check('table and signal files exist', existsSync(tablePath) && existsSync(signalPath), 'missing table or signal file');

const raw = read('templates', 'jurisdiction-candidate-fees.yml');
const doc = yaml.load(raw);
const rows = doc?.jurisdictions || {};
const on = rows['CA-ON'];
const uk = rows['UK'];

// --- table shape ---
check('table has exactly two live rows (Ontario and UK); other candidates stay comments',
  Object.keys(rows).length === 2 && Boolean(on) && Boolean(uk),
  `rows: ${Object.keys(rows).join(', ')}`);
check('Ontario row carries the verified dates',
  on?.effective === '2023-10-26' && /^\d{4}-\d{2}-\d{2}$/.test(String(on?.as_of)) && String(on?.as_of) >= '2026-10-18', `${on?.effective} / ${on?.as_of}`);
check('Ontario applies_to states the foreign-national scope and excludes citizens and PRs',
  /not a Canadian\s+citizen and not a permanent resident/.test(on?.applies_to || '')
    && /does NOT cover Canadian\s+citizens or permanent residents/.test(on?.applies_to || '')
    && /s\. 3 \(1\)/.test(on?.applies_to || '') && /immigration or foreign temporary employee program/.test(on?.applies_to || '') && !/PGWP/.test(on?.applies_to || ''),
  'foreign-national scope missing');
const ex = (on?.exceptions || []).join('\n');
check('Ontario row cites EPFNA ss. 7(1)-(3), 7.1, 8, 9 and ESA s. 74.8(1) paras 1, 2, 3, 5, 8 and s. 74.8(2)',
  ['s. 7 (1)', 's. 7 (2)', 's. 7 (3)', 's. 7.1', 's. 8 (1)', 's. 9', 's. 74.8 (1) para. 1', 'para. 2', 'para. 3', 'para. 5',
    'para. 8', 's. 74.8 (2)'].every((c) => ex.includes(c)),
  'citation missing');
check("Ontario row states the six-month limit on the agency's client hiring fee",
  /six-month period/.test(ex), 'client-hiring fee limit missing');
check('Ontario official_source URLs are the e-Laws EPFNA and ESA pages',
  on?.official_source?.url === 'https://www.ontario.ca/laws/statute/09e32'
    && (on?.official_source?.what_it_shows || '').match(/https?:\/\/[^\s)]+/g)
      ?.map((u) => u.replace(/[.,;]+$/, ''))
      .some((u) => u === 'https://www.ontario.ca/laws/statute/00e41'),
  String(on?.official_source?.url));
check('Ontario row makes no claim of a general ban for citizens or permanent residents',
  !/general (ontario )?ban/i.test((on?.applies_to || '').replace(/No general[\s\S]*$/i, '')) && /was found, so no such rule is stated/.test(on?.applies_to || ''),
  'unverified general-ban claim');
check('header documents contribution rule, never-assert rule and official-source-only requirement',
  raw.includes('CONTRIBUTION RULE') && raw.includes('NEVER-ASSERT RULE') && raw.includes('never a third-party mirror'),
  'header sections missing');
check('ILO C181, AU, SG and US are listed only as commented candidates, and UK is no longer one',
  ['ILO', 'AU', 'SG', 'US'].every((k) => new RegExp(`#\\s+- ${k}\\s*:`).test(raw))
    && !/#\s+- (GB|UK)\s*:/.test(raw)
    && ['GB', 'US', 'AU', 'SG', 'ILO'].every((k) => !(k in rows)),
  'candidate comments missing or promoted to rows');

// --- Great Britain row (#5515) ---
check('UK row is keyed like agency-licensing.yml and carries the verified dates',
  uk?.jurisdiction_name === 'United Kingdom (Great Britain)' && uk?.effective === '2010-10-01' && uk?.as_of === '2026-10-19'
    && raw.includes('s. 6(1) as substituted dates from 2004-04-06'),
  `${uk?.jurisdiction_name} / ${uk?.effective} / ${uk?.as_of}`);
check('UK applies_to protects any work-seeker whatever their immigration status and excludes Northern Ireland',
  /any work-seeker in Great\s+Britain, whatever their immigration status/.test(uk?.applies_to || '')
    && /does NOT cover Northern Ireland/.test(uk?.applies_to || ''),
  'scope missing');
const ukEx = (uk?.exceptions || []).join('\n');
check('UK row cites s. 6(1)(a)-(c), s. 6(2) and reg. 26(1)-(5) and describes Schedule 3 without listing occupations',
  ['s. 6(1)(a)', 's. 6(1)(b)', 's. 6(1)(c)', 's. 6(2)', 'reg. 26(1)', 'reg. 26(2)', 'reg. 26(3)', 'reg. 26(4)', 'reg. 26(5)', 'Schedule 3']
    .every((c) => ukEx.includes(c))
    && /entertainment and modelling occupations/.test(ukEx) && !/walk-ons?/i.test(ukEx),
  'citation missing or occupation list copied');
check('UK official_source is the s. 6 page and what_it_shows names the reg. 26 URL',
  uk?.official_source?.url === 'https://www.legislation.gov.uk/ukpga/1973/35/section/6'
    && (uk?.official_source?.what_it_shows || '').match(/https?:\/\/[^\s)]+/g)?.map((u) => u.replace(/[.,;]+$/, ''))
      .some((u) => u === 'https://www.legislation.gov.uk/uksi/2003/3319/regulation/26'),
  String(uk?.official_source?.url));

// --- freshness validator discovers it ---
const found = extractRows(doc);
check('check-table-freshness discovers the Ontario and UK rows with as_of',
  found.length === 2 && ['CA-ON', 'UK'].every((k) => found.some((f) => f.row.jurisdiction === k && !f.missingAsOf)),
  `found ${found.length}`);
const verdict = checkFreshness([{ file: 'jurisdiction-candidate-fees.yml', doc }], new Date(Date.UTC(2026, 9, 19)));
check('freshly verified rows produce no findings',
  verdict.rowsChecked === 2 && verdict.findings.length === 0 && verdict.warnings.length === 0,
  JSON.stringify(verdict));

// --- synthetic fixtures for the four cases in the issue ---
// feeRe and thirdPartyRe are illustrative stand-ins for the documented decision table in
// modes/oferta-signals/21-candidate-paid-fees.md. Signal 21 itself is agent-judged (meaning, not
// keywords), so these fixtures pin the documented classification, not the agent's behaviour.
// Mirrors the signal's examples: a fee paid TO the employer/agency as a
// condition of the job triggers; a credential bought from a third party does not.
const feeRe = /(training|onboarding|processing|administration|background[- ]check) fee|(pay|payable|remit)[^.]{0,40}(deposit|fee)|\bdeposit\b[^.]{0,40}(required|before)|(purchase|buy)[^.]{0,30}(uniform|equipment)[^.]{0,40}(from us|through us|before (you )?start)/i;
const thirdPartyRe = /(must|should) (hold|have|obtain)[^.]{0,60}(certificate|licen[cs]e|record check)[^.]{0,60}(police|red cross|st\.? john|issued by|from a)/i;
const fixtures = {
  feeDemanded: 'Sample Staffing Inc. Warehouse Associate, Mississauga. A $250 onboarding fee is payable to Sample Staffing before your first shift.',
  thirdParty: 'Placeholder Care Ltd. Support Worker, Hamilton. You must hold a valid first-aid certificate issued by the Red Cross, and a police record check ordered from your local police service.',
  noFee: 'Example Widgets Ltd. Support Analyst, London. Join a friendly team. Hybrid. Competitive benefits and employer-paid training.',
  ukFeeDemanded: 'Sample Recruitment Ltd. Office Administrator, Manchester. A GBP 200 processing fee is payable to Sample Recruitment before we put your CV forward.',
  noRowJurisdiction: 'Example Jobs Pty. Customer Agent, Perth. You will be asked to pay a training fee to our agent to secure the position.',
};
check('fixture 1: fee demanded matches the trigger pattern', feeRe.test(fixtures.feeDemanded), 'no match');
check('fixture 2: third-party credential produces no trigger',
  !feeRe.test(fixtures.thirdParty) && thirdPartyRe.test(fixtures.thirdParty), 'wrong classification');
check('fixture 3: no fee mentioned produces no trigger (employer-paid benefit is not a fee)',
  !feeRe.test(fixtures.noFee), 'unexpected match');
check('fixture UK: a processing fee in a Great Britain posting matches the trigger and the UK row covers every work-seeker',
  feeRe.test(fixtures.ukFeeDemanded) && Boolean(uk) && /whatever their immigration status/.test(uk?.applies_to || ''),
  'wrong classification');
check('fixture 4: fee demanded in a jurisdiction with no row still matches, and no AU row exists (scam-pattern note only)',
  feeRe.test(fixtures.noRowJurisdiction) && !('AU-WA' in rows) && !('AU' in rows), 'wrong classification');

// --- signal behaviour contract ---
const signal = read('modes', 'oferta-signals', '21-candidate-paid-fees.md');
check('signal handles fee-demanded, silent, third-party and no-row outcomes',
  /Posting or message asks the candidate to pay/.test(signal) && /Anything else: say nothing/.test(signal)
    && /licence or credential bought from a third party/.test(signal) && /has no table row, append only the scam-pattern part/.test(signal)
    && /there is no silence check/.test(signal),
  'outcome sections missing');
check('signal is table-driven: a row that protects every work-seeker may say so, no Ontario-only rule text',
  /protects every work-seeker \(Great Britain\)/.test(signal) && /rows for Ontario and Great Britain/.test(signal)
    && !/Ontario: foreign nationals under EPFNA/.test(signal),
  'table-driven wording missing');
check('signal never says a fee is unlawful for citizens or PRs and never accuses',
  /never say it is unlawful for a Canadian citizen or permanent resident/.test(signal)
    && /NEVER say or imply that the employer or agency broke the law/.test(signal)
    && /Never accuse a named employer or agency/.test(signal),
  'phrasing discipline missing');
const quoted = signal.split('\n').filter((l) => l.startsWith('>'));
check('report template says up-front payment is a scam pattern and not covered status is stated plainly',
  quoted.length === 1 && /recognised scam pattern regardless of the law/.test(quoted[0])
    && /not covered by that rule/.test(quoted[0]) && /not legal advice/.test(quoted[0]),
  'blockquote incomplete');
check('report template carries no accusatory wording',
  !quoted.some((l) => /(employer|company|agency)\s+(is|was|has|failed|did not)\s+(breaking|violat|non-?compl|fail)/i.test(l)),
  'accusatory blockquote found');
check('signal cross-references Signal 10 (Agency Licensing) and Signal 6 (Employment Classification)',
  /Agency Licensing Check \(Signal 10\)/.test(signal) && /Employment Classification Risk signal \(Signal 6\)/.test(signal),
  'cross-references missing');
check('signal is zero-fetch and warn-only',
  /never fetches or scrapes anything/.test(signal) && /never changes the 1-5 Global Score/.test(signal)
    && /not legal advice/.test(signal) && /\{language\.output\}/.test(signal),
  'zero-fetch / warn-only / not-legal-advice / language.output missing');
check('signal references the table and config/profile.yml',
  signal.includes('templates/jurisdiction-candidate-fees.yml') && signal.includes('config/profile.yml'),
  'references missing');

// --- wiring ---
const oferta = read('modes', 'oferta.md');
check('oferta indexes Signal 21 and its file',
  oferta.includes('**21. Candidate-Paid Fees**. Read `modes/oferta-signals/21-candidate-paid-fees.md`'),
  'missing index line');
check('oferta Risk Summary carries the candidate-paid fee row (rule and block example)',
  oferta.includes('| Candidate-paid fee | Candidate-paid fees signal') && oferta.includes('| Candidate-paid fee | ℹ️ asks candidate to pay'),
  'row missing');
const batch = read('batch', 'batch-prompt.md');
check('batch-prompt Machine Summary schema carries candidate_fees in both templates',
  batch.split('candidate_fees: "{states_fee | not_evaluated}"').length - 1 === 2, 'key missing or not in both templates');
check('batch-prompt carries the Signal 21 rule and rendering row',
  batch.includes('21. **Candidate-Paid Fees**') && batch.includes('| Candidate-paid fee |'), 'batch rule or row missing');
check('templates/README documents the table',
  read('templates', 'README.md').includes('jurisdiction-candidate-fees.yml'), 'README entry missing');
