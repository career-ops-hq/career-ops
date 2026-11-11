import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

// Content-contract test for the contract-stage jurisdiction passes (#3641).
// Like the other signal tests it reads the mode text and the synthetic
// fixtures; it does not run a model and adds no matcher.

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const offerPrep = read('modes', 'offer-prep.md');
const oferta = read('modes', 'oferta.md');
const signal8 = read('modes', 'oferta-signals', '08-benefits-employment-terminology-country-mismatch.md');
const signal10 = read('modes', 'oferta-signals', '10-agency-licensing-check.md');
const agencyTable = read('templates', 'agency-licensing.yml');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'offer-prep-contract-stage');

console.log('\nOffer-prep contract-stage jurisdiction passes (#3641)');

function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(`${label}: ${detail}`);
}
const all = (text, phrases) => phrases.every((p) => text.includes(p));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-token, case-insensitive match so "T4" does not match inside "T4A".
const mentions = (text, term) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, 'i').test(text);

// ---- Structure: sub-section sits in Step 2, after the sub-statutory block, before Step 3
const HEADING = '### Contract-stage jurisdiction passes (#3641)';
const iSub = offerPrep.indexOf('### Sub-statutory-terms lawyer question (#2039, reworked per #2280)');
const iNew = offerPrep.indexOf(HEADING);
const iStep2 = offerPrep.indexOf("## Step 2 — Clause walk (describe, don't judge)");
const iStep3 = offerPrep.indexOf('## Step 3 — Consistency check');
check('sub-section exists exactly once', iNew !== -1 && offerPrep.indexOf(HEADING, iNew + 1) === -1, 'missing or duplicated heading');
check(
  'sub-section is inside Step 2, after the sub-statutory block and before Step 3',
  iStep2 !== -1 && iStep2 < iSub && iSub < iNew && iNew < iStep3,
  `order is wrong (step2=${iStep2}, sub=${iSub}, new=${iNew}, step3=${iStep3})`,
);
check(
  'no new ## heading was introduced between Step 2 and Step 3',
  offerPrep.slice(iStep2 + 3, iStep3).split('\n').filter((l) => /^## /.test(l)).length === 0,
  'a ## heading appears inside Step 2',
);
const sec = iNew === -1 ? '' : offerPrep.slice(iNew, iStep3);
const secFlat = sec.replace(/\s+/g, ' ');
const secHas = (re) => re.test(secFlat);

// ---- Hard guards and Step headings are untouched in structure
const guards = offerPrep.slice(offerPrep.indexOf('## Hard guards'), offerPrep.indexOf('## Invocation'));
check(
  'hard guards section still precedes Invocation and keeps its core guards',
  guards.includes('never outputs "safe to sign"') && /No online research/.test(guards) && /Never state law from memory/.test(guards),
  'hard guards were altered or moved',
);
const headings = offerPrep.split('\n').filter((l) => /^## /.test(l));
const expected = ['## Hard guards', '## Invocation', '## Step 0', '## Step 1', '## Step 2', '## Step 3', '## Step 4', '## Step 5', '## Step 6', '## Step 7', '## Step 8'];
const pos = expected.map((h) => headings.findIndex((x) => x.startsWith(h)));
check(
  'Hard guards, Invocation and Step 0-8 headings are all present and in order',
  pos.every((p, i) => p !== -1 && (i === 0 || p > pos[i - 1])),
  'a heading is missing or reordered',
);
check(
  'the #2280 boundary is kept and no category-regulation flags table is added',
  /#2280/.test(sec) && /no category-regulation flags table/i.test(secFlat) && !/floor_categories|void_doctrine/.test(sec),
  'boundary wording missing or a flags table was reintroduced',
);

// ---- Common rules
check('runs after Step 1 jurisdiction; contract work location wins', secHas(/after the Step 1 jurisdiction is fixed/) && secHas(/work location named in the contract wins over the profile/), 'timing rule missing');
check(
  'existing tags only, no new tag, severity or ordering',
  all(sec, ['`[ask your lawyer]`', '`[differs from what you were told]`', '`[standard]`'])
    && secHas(/No new tag/) && secHas(/no severity, no ordering/),
  'tag restriction missing',
);
check('existing tables only, no new table', secHas(/Existing tables only/) && secHas(/templates\/agency-licensing\.yml/) && secHas(/adds no table/), 'table restriction missing');
check('no row means skipped silently ("no verified data")', secHas(/no row in the table a pass needs means that pass is skipped silently/) && secHas(/"no row" means "no verified data", never "no regime"/), 'no-row silence rule missing');
check('no research or fetching; resource link printed only', secHas(/nothing is fetched or searched/) && secHas(/resource link .* printed for the candidate to click/), 'no-research rule missing');
check('quotes the contract verbatim and names pattern and source', secHas(/quoted verbatim/) && secHas(/pattern's name and its source/), 'quote/source rule missing');
check('every finding ends in a lawyer question', secHas(/Every finding ends in a question for the lawyer list/), 'lawyer-question rule missing');
check(
  'absent marker produces no output; agency pass keeps its candidate-statement and via= evidence',
  secHas(/absent marker produces no output/)
    && secHas(/classification and\s+terminology passes are tripped only by text actually in the contract/)
    && secHas(/agency pass may also be tripped by the candidate's own statement or the\s+tracker `via=` field/),
  'silence rule missing or conflicts with the agency pass evidence',
);
check(
  'agency pass states no regime facts (hard guard: sole statutory-facts source) and keeps the resource link',
  secHas(/the finding states no regime facts/) && secHas(/templates\/restrictive-covenants\.yml/) && secHas(/resource link/),
  'agency pass still conflicts with the statutory-facts guard',
);

// ---- Forbidden verdict phrases appear only inside the single "never say" instruction
const verdicts = ['this is misclassification', 'this licence is missing', 'this contract is for the wrong country'];
const neverSay = sec.match(/- \*\*Wording:\*\*[\s\S]*?(?=\n- \*\*Silence)/)?.[0] ?? '';
const neverSayFlat = neverSay.replace(/\s+/g, ' ');
const outsideNeverSay = sec.replace(neverSay, '');
check(
  'verdict phrases are named only inside the "never say" instruction',
  /never say/i.test(neverSayFlat) && all(neverSayFlat, verdicts) && verdicts.every((v) => !outsideNeverSay.includes(v)),
  'a verdict phrase appears outside the "never say" instruction',
);
check(
  'no output template uses safe/risky/severity language',
  !/safe to sign|\brisky\b|🔴|🟡|🟢|⚠️/.test(sec),
  'verdict or traffic-light language found in the sub-section',
);
check('never asserts an agency is unlicensed', secHas(/never asserts that any agency is unlicensed/), 'agency non-assertion missing');

// ---- The three passes
check(
  'Pass 1 agency licensing: trigger, row requirement, lawyer question, direct-employer near-miss',
  all(sec, ['Pass 1', 'Signal 10', 'templates/agency-licensing.yml', '"on behalf of our client"', '"assignment"', '"placement"', '"client site"', '`via=`'])
    && secHas(/the Step 1 jurisdiction has a row/) && secHas(/licence status cannot be read from the contract/)
    && secHas(/employer of record/) && secHas(/direct employer's letter, even if a recruiter introduced the candidate/),
  'agency pass incomplete',
);
check(
  'Pass 2 employment classification: case A and case B',
  all(sec, ['Pass 2', 'Signal 6', '**Case A', '**Case B', '"invoice for services"', '"independent contractor"', '"consultant"', '"T4A"', '"1099"', '"labour contract"', '"employee"', '"salary"'])
    && secHas(/corroborating omission/) && secHas(/no omission is required/) && secHas(/contradiction inside one document is the signal/),
  'classification pass incomplete',
);
check(
  'case A uses the full Signal 6 omission set and requires a service-invoice context',
  secHas(/no standard\s+employment-standards phrasing/) && secHas(/statutory deductions or\s+withholding/)
    && secHas(/no\s+benefits/) && secHas(/no\s+vacation\s+or\s+PTO/) && secHas(/no\s+defined\s+end\s+date/)
    && secHas(/instruction for the candidate to invoice/) && secHas(/bare "invoice" in an expense-reimbursement or billing clause\s+is not contractor-status wording/),
  'case A omission set or invoice context incomplete',
);
check(
  'case B is called out as a change of trigger, not only of input',
  secHas(/change of \*\*trigger\*\*, not only of input/),
  'trigger-change statement missing',
);
check(
  'classification output: both phrase sets side by side, neutral line, [differs] tag, lawyer question',
  secHas(/both phrase sets side by side/) && secHas(/terms associated with both statuses/)
    && secHas(/employment or a services relationship/) && secHas(/`\[differs from what you were told\]`/) && sec.includes('`notes.md`'),
  'classification output rules missing',
);
check(
  'classification near-misses: bare "contract position"/"fixed term", fixed-term employee contract',
  secHas(/"contract position" or "fixed term" on its own/) && secHas(/fixed-term employee contract that uses employee wording throughout/),
  'classification near-misses missing',
);
check(
  'Pass 3 terminology: strong markers, co-occurrence, bare PTO and bare ESA never trip',
  all(sec, ['Pass 3', 'Signal 8', '"401(k)"', '"W-2 employment"', '"RRSP"', '"T4"'])
    && secHas(/corroborating-only marker that co-occurs with a strong marker/) && secHas(/Bare "PTO" and bare "ESA" never trip it/)
    && secHas(/Which country's employment and benefits terms govern this contract/) && secHas(/does not say which country's terms govern/),
  'terminology pass incomplete',
);
check(
  'out of scope: two pre-hire signals, any new table, no live figure',
  secHas(/pre-hire signals/) && secHas(/new legal-fact table/) && secHas(/states no live figure/),
  'scope boundary missing',
);

// ---- Source tables the passes reuse are still intact (this change must not touch them)
check(
  'Signal 6 table, Signal 8 table and agency wording list exist for the passes to reuse',
  all(oferta, ['"T4A"', '"independent contractor"', '"1099"', 'labour contract', '"contract position" alone is not enough'])
    && all(signal8, ['"401(k)"', '"W-2 employment"', '"RRSP"', '"T4"', '"PTO"', 'bare acronym "ESA"'])
    && all(signal10, ['"our client"', '"on behalf of our client"'])
    && /\n {2}CA-ON:/.test(agencyTable) && /\n {2}UK:/.test(agencyTable),
  'a reused source definition changed or is missing',
);

// ---- Fixtures
function parseFixture(name) {
  const text = readFileSync(join(FIXTURES, name), 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { name, meta, body: (m?.[2] ?? '').replace(/\s+/g, ' '), raw: text };
}
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.md')).sort().map(parseFixture);
const trips = fixtures.filter((f) => f.meta.expect?.startsWith('trips '));
const silent = fixtures.filter((f) => f.meta.expect === 'silent');
const skipped = fixtures.filter((f) => f.meta.expect === 'skipped-no-row');
check('fixture set: 3 trip, 3 silent, 1 no-row', trips.length === 3 && silent.length === 3 && skipped.length === 1, `got ${trips.length}/${silent.length}/${skipped.length}`);
check(
  'the three tripping fixtures cover one signal each, one of them case B',
  new Set(trips.map((f) => f.meta.expect)).size === 3
    && ['trips agency-licensing', 'trips employment-classification', 'trips terminology-mismatch'].every((e) => trips.some((f) => f.meta.expect === e))
    && trips.filter((f) => f.meta.case === 'B').length === 1,
  'trip fixtures do not map one-to-one onto the signals',
);
check('every fixture has an expect block and a jurisdiction', fixtures.every((f) => f.meta.expect && f.meta.jurisdiction && f.body.trim()), 'a fixture lacks front matter or body');
check(
  'fixtures carry no email, URL or phone number',
  fixtures.every((f) => !/@|https?:\/\/|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(f.raw)),
  'a fixture contains an email, URL or phone number',
);

// Marker lists, each verified to be covered by the mode text they come from.
const CONTRACTOR_TERMS = ['invoice for services', 'independent contractor', 'T4A', '1099', 'labour contract'];
// Consultant-status wording (not a consultant job title alone) must also stay out of silent fixtures.
const CONSULTANT_STATUS = /\b(as an? (independent )?consultant|consultant (status|agreement)|engaged as a consultant|self-employed)\b/i;
const TERMINOLOGY_STRONG = ['401(k)', 'W-2 employment', 'RRSP', 'T4'];
const AGENCY_WORDING = ['on behalf of our client', 'assignment', 'placement', 'client site'];
check(
  'every marker used below is covered by the term lists in the mode text',
  CONTRACTOR_TERMS.every((t) => mentions(oferta, t) && sec.includes(`"${t}"`))
    && TERMINOLOGY_STRONG.every((t) => signal8.includes(`"${t}"`) && sec.includes(`"${t}"`))
    && AGENCY_WORDING.every((t) => sec.includes(`"${t}"`))
    && signal10.includes('"on behalf of our client"')
    && ['reporting line', 'ongoing role', 'set hours', '"employee"', '"salary"'].every((t) => sec.includes(t)),
  'a marker is not covered by the referenced lists',
);
const byName = (n) => fixtures.find((f) => f.name === n);

const agency = byName('trips-agency-licensing.md');
check(
  'agency fixture carries intermediary wording and its jurisdiction has a table row',
  AGENCY_WORDING.every((t) => mentions(agency.body, t)) && new RegExp(`\\n {2}${escapeRe(agency.meta.jurisdiction)}:`).test(agencyTable),
  'agency fixture does not trip as described',
);
const caseB = byName('trips-classification-case-b.md');
check(
  'case B fixture carries both vocabularies and needs no omission',
  ['independent contractor', 'T4A', 'invoice', 'reporting to', 'set hours', 'salary', 'ongoing', 'employees'].every((t) => mentions(caseB.body, t))
    && mentions(caseB.body, 'group health plan'),
  'case B fixture does not match the case B shape',
);
const term = byName('trips-terminology-mismatch.md');
check(
  'terminology fixture is a Canadian contract with US-only strong markers',
  /Ontario/.test(term.body) && mentions(term.body, '401(k)') && mentions(term.body, 'W-2 employment'),
  'terminology fixture does not trip as described',
);

// Near-misses must be silent: no strong marker from any referenced list.
const forbiddenInSilent = [...CONTRACTOR_TERMS, ...TERMINOLOGY_STRONG, ...AGENCY_WORDING, 'on behalf of'];
for (const f of silent) {
  const hits = forbiddenInSilent.filter((t) => mentions(f.body, t));
  if (CONSULTANT_STATUS.test(f.body)) hits.push('consultant status wording');
  check(`near-miss ${f.name} contains no strong marker from the term lists`, hits.length === 0, `found: ${hits.join(', ')}`);
}
const direct = byName('silent-direct-employer-letter.md');
check('direct-employer near-miss mentions a recruiter but no intermediary wording', mentions(direct.body, 'recruiter') && AGENCY_WORDING.every((t) => !mentions(direct.body, t)), 'fixture is not a clean near-miss');
const fixedTerm = byName('silent-fixed-term-employee.md');
check('fixed-term near-miss uses "contract position" with employee wording throughout', mentions(fixedTerm.body, 'contract position') && mentions(fixedTerm.body, 'fixed term') && mentions(fixedTerm.body, 'You are an employee'), 'fixture is not a clean near-miss');
const pto = byName('silent-bare-pto-esa.md');
check('PTO/ESA near-miss has bare "PTO" and bare "ESA" only', mentions(pto.body, 'PTO') && mentions(pto.body, 'ESA') && !mentions(pto.body, 'Employment Standards Act') && !mentions(pto.body, '401(k)'), 'fixture is not a clean near-miss');
const noRow = skipped[0];
check(
  'no-row fixture is agency-mediated but its jurisdiction has no row, so the agency pass is skipped',
  AGENCY_WORDING.every((t) => mentions(noRow.body, t)) && !new RegExp(`\\n {2}${escapeRe(noRow.meta.jurisdiction)}:`).test(agencyTable),
  'no-row fixture is wrong: either not agency-mediated or the table now has a row',
);
