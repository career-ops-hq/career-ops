#!/usr/bin/env node
/**
 * salary-gap.mjs — Desired vs Advertised vs Actual compensation analyzer
 *
 * Salary facts are append-only observations, never mutated:
 *   { tracker#, date, type: desired|advertised|actual|stated, amount, currency, source, note, round, interviewer }
 *
 * Sources folded on read (one write path per fact):
 *   1. reports/{###}-*.md Machine Summary `advertised_comp`  -> advertised (source: jd)
 *   2. data/salary-observations.tsv (user-layer, append-only) -> desired/actual/stated (+ corrections)
 *   3. config/profile.yml compensation.target_range           -> desired default (source: profile)
 *
 * Fold: per (tracker#, type), highest trust tier wins, then latest date.
 *   actual:     contract > offer-letter > recruiter-verbal > user
 *   desired:    user > profile
 *   advertised: user > recruiter-verbal > jd
 *
 * `stated` observations are a separate, narrower-purpose log: a specific number
 * the candidate verbally committed to, in a specific interview round, to a
 * specific interviewer — so a later round doesn't accidentally contradict it.
 * They carry no trust tier and never participate in the fold/gap math above;
 * look them up with getStatedObservations() or `--stated-for <tracker#>`.
 *
 * Run: node salary-gap.mjs             (JSON)
 *      node salary-gap.mjs --summary   (human-readable)
 *      node salary-gap.mjs --stated-for <tracker#>   (prior stated-comp observations, JSON)
 *      node salary-gap.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { resolveColumns, parseTrackerRow, extractTrackerReportNumbers } from './tracker-parse.mjs';
import * as yaml from 'js-yaml';
import { isMainModule } from './lib/is-main-module.mjs';

const CAREER_OPS = getCareerOpsRoot();
const OBS_PATH = join(CAREER_OPS, 'data/salary-observations.tsv');
const REPORTS_DIR = join(CAREER_OPS, 'reports');

/**
 * Canonical form of a tracker#/report# so `29` and `029` are one key.
 *
 * Column 1 of the observation log is a tracker#, and the docs tell the user to
 * write it plainly (`29`), while report filenames are zero-padded to three
 * digits (`029-*.md`). Joining those as raw strings made padding load-bearing:
 * the same row wrote two different keys depending on how it was typed.
 *
 * Digits only, so `*` (the profile-desired pseudo-row) and anything unexpected
 * pass through untouched rather than collapsing into each other.
 *
 * @param {string|number} raw - An id as written by a human or a filename.
 * @returns {string} The id without leading zeros, or the input trimmed.
 */
export function normalizeId(raw) {
  const s = String(raw ?? '').trim();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

// Sort ids the way a reader expects: 9 before 10. Once ids are unpadded,
// localeCompare would order them lexicographically ('10' < '9'), which the
// previous zero-padded keys had hidden.
const compareIds = (a, b) => {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a.localeCompare(b);
};

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const statedForFlagIdx = args.indexOf('--stated-for');
const statedForNum = statedForFlagIdx !== -1 ? args[statedForFlagIdx + 1] : null;

const TRUST = {
  actual: { contract: 3, 'offer-letter': 2, 'recruiter-verbal': 1, user: 0 },
  desired: { user: 1, profile: 0 },
  advertised: { user: 2, 'recruiter-verbal': 1, jd: 0 },
};

/**
 * Rewrite a number's separators into a form parseFloat reads correctly.
 *
 * #3174 taught this file that a period can be thousands grouping ("35.000" is
 * 35000, not 35), which is how Spain, Germany, Italy, the Netherlands and
 * Brazil write a salary. It did that with `.replace(/,/g, '')` first, though,
 * which silently assumes the comma is ALWAYS grouping — and in every one of
 * those same markets the comma is the DECIMAL point. So the half of the
 * convention that carries cents was left folding by 1000:
 *
 *   "45.000,00"  -> strip commas -> "45.00000" -> 45      (want 45000)
 *   "120.000,00" -> strip commas -> "120.00000" -> 120    (want 120000)
 *
 * The period rule could not rescue those, because after the comma is deleted
 * the period is followed by five digits and its "exactly three" lookahead
 * fails. Which separator means what has to be decided BEFORE either is
 * touched.
 *
 * @param {string} numStr - The numeric run, currency already stripped.
 * @returns {string} The same number with `.` as its only separator.
 */
function canonicalizeSeparators(numStr) {
  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');

  // Both present: the LAST one is the decimal separator and the other is
  // grouping. True in both conventions, which is what makes it decidable —
  // "45.000,00" and "123,684.50" are the same shape written two ways, and
  // nothing else has to be guessed.
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    return numStr.split(grouping).join('').replace(decimal, '.');
  }

  // Only one separator, so its role is genuinely ambiguous and is inferred
  // from what follows it: exactly three digits and not a fourth reads as
  // grouping ("35.000", "123,684"), anything else as a decimal point ("82.5",
  // "45000,50"). This is #3174's rule, now applied to whichever separator is
  // present instead of to the period alone — the comma had no rule at all and
  // was unconditionally deleted, so "45000,50" read as 4500050.
  //
  // A three-place decimal ("1.250") stays ambiguous without knowing the
  // document's locale; reading it as grouped remains the safer default for a
  // salary field (#3174), and is now the same default in both directions.
  const sep = lastComma !== -1 ? ',' : lastDot !== -1 ? '.' : null;
  if (sep === null) return numStr;
  const grouped = new RegExp(`(\\d)\\${sep}(?=\\d{3}(?!\\d))`, 'g');
  return numStr.replace(grouped, '$1').replace(sep, '.');
}

// --- Amount parsing ---
export function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s || s === '?' || s === '-' || /^(n\/?a|null)$/i.test(s)) return null;
  // Strip currency symbols anywhere (US pay-transparency ranges often repeat the
  // symbol on both bounds: "$123,684—$254,644 USD") and a trailing 3-letter
  // ISO-4217-style alpha token (any case — "450k SEK", "80-90k eur"). Exactly
  // three letters, so the lone "k" magnitude suffix ("80k") is never eaten, and
  // prose ("competitive") still fails the numeric match below even after losing
  // its last three letters.
  s = s.replace(/[€$£¥]/g, '').replace(/\s*[A-Za-z]{3}\s*$/, '').trim();
  const toNum = (numStr, kFlag) => {
    const n = parseFloat(canonicalizeSeparators(numStr));
    return Number.isNaN(n) ? null : (kFlag ? n * 1000 : n);
  };
  const range = s.match(/^([\d.,]+)\s*(k)?\s*[-–—]\s*([\d.,]+)\s*(k)?$/i);
  if (range) {
    const lo = toNum(range[1], range[2] || range[4]); // "80-90k": k applies to both
    const hi = toNum(range[3], range[4] || range[2]);
    if (lo === null || hi === null) return null;
    const min = Math.min(lo, hi), max = Math.max(lo, hi);
    return { min, max, mid: (min + max) / 2 };
  }
  const single = s.match(/^([\d.,]+)\s*(k)?$/i);
  if (single) {
    const v = toNum(single[1], single[2]);
    return v === null ? null : { min: v, max: v, mid: v };
  }
  return null;
}

const VALID_TYPES = new Set(['desired', 'advertised', 'actual', 'stated']);

// --- Observation log parsing (TSV) ---
// line: {tracker#}\t{YYYY-MM-DD}\t{type}\t{amount}\t{currency}\t{source}\t{note}\t{round}\t{interviewer}
// `round`/`interviewer` are two OPTIONAL trailing columns, meaningful only for
// type `stated` (which round, and to whom, the number was said). Appended after
// `note` rather than reordering the existing 7 columns, so every pre-existing
// row in the append-only log — which has no idea these columns exist — keeps
// parsing exactly as before (round/interviewer both default to '').
export function parseObservations(content) {
  const out = [];
  for (const line of String(content || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const cells = t.split('\t');
    if (cells.length < 6) continue;
    const [num, date, type, amount, currency, source, note = '', round = '', interviewer = ''] = cells.map(c => c.trim());
    if (!VALID_TYPES.has(type)) continue;
    // blank currency cell -> UNKNOWN, so the fold's currency guard excludes it from
    // gap math ('' === '' would otherwise pass the strict-equality comparability check)
    out.push({ num, date, type, amount, currency: currency ? currency.toUpperCase() : 'UNKNOWN', source, note, round, interviewer, parsed: parseAmount(amount) });
  }
  return out;
}

// --- Stated-comp lookup ---
// Returns prior `stated` observations for a tracker#, oldest first, so a later
// round can be reminded of exactly what was already said and to whom. Deliberately
// NOT folded/trust-ranked like desired/advertised/actual — every prior statement
// stays visible (a candidate needs the full trail, not just the "best" one).
export function getStatedObservations(observations, num) {
  const want = normalizeId(num);
  return observations
    .filter(o => o.type === 'stated' && normalizeId(o.num) === want)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Like analyze-patterns.mjs:110 but WITHOUT `json`: analyze-patterns feeds the fence
// body to a real YAML parser (JSON is a YAML subset, so json fences parse fine there),
// while yamlStr below only extracts `key: value` lines — a json fence would "match"
// and silently yield null company/role/advertised_comp. Rejecting it outright means
// the report falls back to the legacy no-Machine-Summary path instead.
const FENCE_RE = /##\s*Machine Summary\s*\n+```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/i;
const yamlStr = (body, key) => {
  const m = body.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  const v = m[1].trim().replace(/^["']|["']$/g, '');
  return v === 'null' || v === '' ? null : v;
};

// --- Report-derived advertised observations ---
// Extracts advertised_comp + company + role from one report's Machine Summary.
// num/date come from the filename ({###}-{slug}-{YYYY-MM-DD}.md).
export function reportToObservation(content, num, date) {
  const fence = String(content || '').match(FENCE_RE);
  if (!fence) return null;
  const body = fence[1];
  const company = yamlStr(body, 'company');
  const role = yamlStr(body, 'role');
  const adv = yamlStr(body, 'advertised_comp');
  // Currency = first standalone UPPERCASE 3-letter token, case-SENSITIVE on
  // purpose: lowercase 3-letter English words in sloppy values ("per", "and")
  // must not register as currencies. Tradeoff: a lowercase "100k eur" yields
  // UNKNOWN (excluded from gap math, surfaced in currencyMismatches) — acceptable;
  // a corrective TSV observation with an explicit currency overrides it.
  const currencyGuess = adv ? (adv.match(/\b[A-Z]{3}\b/)?.[0] ?? 'UNKNOWN') : null;
  return {
    company, role,
    observation: adv === null ? null : {
      num, date, type: 'advertised', amount: adv, currency: currencyGuess,
      source: 'jd', note: 'from report Machine Summary', parsed: parseAmount(adv),
    },
  };
}

const pctDelta = (from, to) => ((to - from) / from) * 100;
const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function pickEffective(type, candidates) {
  const tiers = TRUST[type];
  // Object.hasOwn, not `in`: a TSV source like "toString" would pass an `in`
  // check via Object.prototype and poison the trust sort with a function value.
  const usable = candidates.filter(o => o.type === type && o.parsed !== null && Object.hasOwn(tiers, o.source));
  if (!usable.length) return null;
  usable.sort((a, b) => (tiers[b.source] - tiers[a.source]) || (a.date < b.date ? 1 : -1));
  const top = usable[0];
  return { value: top.parsed.mid, source: top.source, date: top.date, currency: top.currency, raw: top.amount };
}

// --- Fold + aggregates ---
export function fold(observations, apps, profileDesired) {
  // Both sides of the join are canonicalised, so a row written `29` and a row
  // written `029` fold into one application instead of two keys, one of which
  // silently matched a different row's report (#4351).
  const appsByNum = new Map(Object.entries(apps ?? {}).map(([k, v]) => [normalizeId(k), v]));
  const byNum = new Map();
  for (const o of observations) {
    const key = normalizeId(o.num);
    if (!byNum.has(key)) byNum.set(key, []);
    byNum.get(key).push(o);
  }

  const applications = [];
  const orphans = [];
  const currencyMismatches = [];
  const unparseable = observations
    .filter(o => o.parsed === null && o.amount && o.amount !== '?')
    .map(o => ({ num: normalizeId(o.num), type: o.type, raw: o.amount }));
  // pickEffective only trusts sources in TRUST[type]'s vocabulary — anything else
  // (e.g. the `recruiter_verbal` underscore typo) must be reported, not silently
  // dropped. Report-derived obs are always `jd` and profile obs `profile`, so in
  // practice only TSV lines can land here.
  const invalidSources = observations
    .filter(o => TRUST[o.type] && !Object.hasOwn(TRUST[o.type], o.source))
    .map(o => ({ num: normalizeId(o.num), type: o.type, source: o.source }));

  const profileObs = profileDesired?.amount ? {
    num: '*', date: '0000-00-00', type: 'desired', amount: profileDesired.amount,
    currency: (profileDesired.currency || 'UNKNOWN').toUpperCase(), source: 'profile', note: '', parsed: parseAmount(profileDesired.amount),
  } : null;
  // a garbage profile target (e.g. "competitive") would otherwise vanish silently:
  // quality.unparseable above is built from TSV/report observations only
  if (profileObs && profileObs.parsed === null && profileObs.amount !== '?') {
    unparseable.push({ num: '*', type: 'desired', raw: profileObs.amount, source: 'profile' });
  }

  for (const [num, obs] of byNum) {
    const meta = appsByNum.get(num);
    if (!meta) { orphans.push({ num, count: obs.length }); continue; }
    const trail = [...obs].sort((a, b) => (a.date < b.date ? -1 : 1));
    const desired = pickEffective('desired', profileObs ? [...obs, profileObs] : obs);
    const advertised = pickEffective('advertised', obs);
    const actual = pickEffective('actual', obs);
    // Gap pcts only compare like currencies — no FX conversion, so a cross-currency
    // pct would be meaningless. Gap math requires a PROVEN shared currency: strict
    // string equality AND neither side UNKNOWN (two UNKNOWNs could be different real
    // currencies, so UNKNOWN is never comparable — not even with itself). Skips are
    // reported in quality.currencyMismatches, never dropped silently.
    const advComparable = advertised && actual && advertised.currency === actual.currency && advertised.currency !== 'UNKNOWN';
    const desComparable = desired && actual && desired.currency === actual.currency && desired.currency !== 'UNKNOWN';
    if (advertised && actual && !advComparable) currencyMismatches.push({ num, comparison: 'advertised-vs-actual', currencies: [advertised.currency, actual.currency] });
    if (desired && actual && !desComparable) currencyMismatches.push({ num, comparison: 'desired-vs-actual', currencies: [desired.currency, actual.currency] });
    applications.push({
      num, company: meta.company, role: meta.role,
      desired, advertised, actual, trail,
      advToActPct: advComparable ? pctDelta(advertised.value, actual.value) : null,
      desiredToActPct: desComparable ? pctDelta(desired.value, actual.value) : null,
    });
  }
  // apps with no observations at all but a profile desired still get the default
  for (const [num, meta] of appsByNum) {
    if (!byNum.has(num) && profileObs) {
      applications.push({
        num, company: meta.company, role: meta.role,
        desired: pickEffective('desired', [profileObs]), advertised: null, actual: null,
        trail: [], advToActPct: null, desiredToActPct: null,
      });
    }
  }
  applications.sort((a, b) => compareIds(a.num, b.num));

  const byCurrency = {};
  const byCompanyRole = {};
  const today = applications.flatMap(a => a.trail.map(t => t.date)).sort().pop() ?? null;
  for (const a of applications) {
    if (!a.actual) continue;
    const cur = a.actual.currency || 'UNKNOWN';
    byCurrency[cur] ??= { confirmed: 0, advGaps: [], atOrAboveAdvertised: 0, atOrAboveDesired: 0, newestActual: null };
    const agg = byCurrency[cur];
    agg.confirmed += 1;
    agg.newestActual = [agg.newestActual, a.actual.date].filter(Boolean).sort().pop();
    // pct !== null implies both sides exist AND currencies match (see fold above),
    // so cross-currency pairs are excluded from gap lists and at/above counts alike.
    if (a.advToActPct !== null) {
      agg.advGaps.push(a.advToActPct);
      if (a.actual.value >= a.advertised.value) agg.atOrAboveAdvertised += 1;
    }
    if (a.desiredToActPct !== null && a.actual.value >= a.desired.value) agg.atOrAboveDesired += 1;

    // Legacy reports (no Machine Summary) fold with null company/role — without
    // a fallback every legacy row would collapse into one shared "null|null"
    // bucket. Key those per application instead, with display fields that render
    // meaningfully in printSummary.
    const legacy = !a.company && !a.role;
    const key = legacy ? `#${a.num}` : `${a.company}|${a.role}`;
    byCompanyRole[key] ??= legacy
      ? { company: `report #${a.num}`, role: '(no Machine Summary)', confirmed: 0, advToActPcts: [] }
      : { company: a.company, role: a.role, confirmed: 0, advToActPcts: [] };
    byCompanyRole[key].confirmed += 1;
    if (a.advToActPct !== null) byCompanyRole[key].advToActPcts.push(a.advToActPct);
  }
  for (const agg of Object.values(byCurrency)) {
    agg.meanAdvToActPct = agg.advGaps.length ? agg.advGaps.reduce((s, v) => s + v, 0) / agg.advGaps.length : null;
    agg.medianAdvToActPct = agg.advGaps.length ? median(agg.advGaps) : null;
    delete agg.advGaps;
  }

  return {
    applications,
    aggregates: { byCurrency, byCompanyRole },
    quality: {
      orphans, unparseable, invalidSources,
      currencyMismatches: currencyMismatches.sort((a, b) => compareIds(a.num, b.num)),
      withoutActual: applications.filter(a => !a.actual).length, latestObservation: today,
    },
  };
}

// --- Self-test ---
const OBS_FIXTURE = [
  '001\t2026-06-20\tdesired\t95k\tEUR\tuser\tstated in eval chat',
  '001\t2026-06-28\tactual\t90k\tEUR\trecruiter-verbal\tscreen call',
  '001\t2026-07-03\tactual\t84k\tEUR\toffer-letter\t',
  '001\t2026-07-05\tactual\t86k\tEUR\tcontract\tsigned',
  '002\t2026-06-25\tactual\t88k\tEUR\trecruiter-verbal\t',
  '002\t2026-06-29\tactual\t99k\tEUR\trecruiter_verbal\tunderscore typo on purpose',
  '002\t2026-06-30\tactual\t120k\tEUR\ttoString\tprototype key on purpose',
  '007\t2026-06-25\tactual\t70k\tEUR\trecruiter-verbal\torphan - no report',
  '003\t2026-06-26\tactual\t9ok\tUSD\trecruiter-verbal\ttypo on purpose',
  '005\t2026-07-01\tactual\t92k\tUNKNOWN\toffer-letter\tcurrency not stated',
].join('\n');

const REPORT_FIXTURE_001 = `# Eval: Acme — ML Eng

## Machine Summary

\`\`\`yaml
company: "Acme"
role: "ML Eng"
score: 4.2
advertised_comp: "80-90k EUR"
\`\`\`
`;
const REPORT_FIXTURE_002 = `# Eval: Globex — Data Eng

## Machine Summary

\`\`\`yaml
company: "Globex"
role: "Data Eng"
score: 3.9
advertised_comp: "100k EUR"
\`\`\`
`;
const REPORT_FIXTURE_004 = `# Eval: Umbrella — AI Eng

## Machine Summary

\`\`\`yaml
company: "Umbrella"
role: "AI Eng"
score: 4.1
advertised_comp: "100k USD"
\`\`\`
`;
const REPORT_FIXTURE_005 = `# Eval: Hooli — AI Lead

## Machine Summary

\`\`\`yaml
company: "Hooli"
role: "AI Lead"
score: 3.8
advertised_comp: "95k"
\`\`\`
`;
const REPORT_FIXTURE_003 = `# Eval: Initech — Platform

## Machine Summary

\`\`\`yaml
company: "Initech"
role: "Platform"
score: 4.0
advertised_comp: null
\`\`\`
`;

// #4351: a report whose number (029) collides with a DIFFERENT tracker row's
// number (29). Acme is report 029, linked from tracker row 1; tracker row 29 is
// Globex and has no report.
const REPORT_FIXTURE_4351_029 = `# Eval: Acme — Staff Engineer

## Machine Summary

\`\`\`yaml
company: "Acme"
role: "Staff Engineer"
advertised_comp: "100k EUR"
\`\`\`
`;

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) { console.error(`SELF-TEST FAIL: ${msg}`); process.exit(1); }
  };

  // parseAmount
  assert(parseAmount('84k')?.mid === 84000, '84k -> 84000');
  assert(parseAmount('84000')?.mid === 84000, 'plain number');
  assert(parseAmount('80-90k')?.mid === 85000, 'range with trailing k');
  assert(parseAmount('80k-90k')?.min === 80000, 'range with both k');
  assert(parseAmount('$80k')?.mid === 80000, 'leading currency symbol tolerated');
  assert(parseAmount('82.5k')?.mid === 82500, 'decimal k');
  assert(parseAmount('90-80k')?.min === 80000, 'reversed range normalized');
  assert(parseAmount('?') === null, '? -> null');
  assert(parseAmount('') === null, 'blank -> null');
  assert(parseAmount('competitive') === null, 'prose -> null');
  assert(parseAmount('9ok') === null, 'typo -> null');
  assert(parseAmount('450k SEK')?.mid === 450000, 'generic trailing ISO token stripped (450k SEK)');
  assert(parseAmount('80-90k eur')?.mid === 85000, 'lowercase trailing ISO token stripped');
  assert(parseAmount('$123,684—$254,644 USD')?.mid === 189164, 'US range, symbol on both bounds, em dash');
  assert(parseAmount('$123,684-$254,644 USD')?.mid === 189164, 'US range, symbol on both bounds, hyphen');
  assert(parseAmount('€80,000-€90,000')?.min === 80000, 'EUR range, symbol on both bounds');
  assert(parseAmount('$150,000')?.mid === 150000, 'single value with symbol still works');
  assert(parseAmount('€35.000 - €45.000')?.min === 35000 && parseAmount('€35.000 - €45.000')?.max === 45000, 'period-grouped range (#3174)');
  assert(parseAmount('40.000')?.mid === 40000, 'period-grouped single value (#3174)');
  assert(parseAmount('35.000 - 55.000')?.mid === 45000, 'period-grouped range, no currency symbol (#3174)');

  // Decimal comma — the other half of the same convention (#3174 stripped every
  // comma before deciding, so these folded by 1000).
  assert(parseAmount('€45.000,00')?.mid === 45000, 'period grouping + comma decimal');
  assert(parseAmount('120.000,00 EUR')?.mid === 120000, 'period grouping + comma decimal, trailing ISO token');
  assert(parseAmount('45.000,50')?.mid === 45000.5, 'comma decimal keeps its cents');
  assert(parseAmount('45000,50')?.mid === 45000.5, 'lone comma with two following digits is a decimal point');
  assert(parseAmount('82,5k')?.mid === 82500, 'decimal k written with a comma');
  assert(parseAmount('€1.250.000,75')?.mid === 1250000.75, 'two grouping periods + comma decimal');
  assert(parseAmount('€40.000,00 - €55.000,00')?.mid === 47500, 'range, both bounds with comma decimals');
  // ...and the US shape it must not have broken to get there.
  assert(parseAmount('$123,684.50')?.mid === 123684.5, 'comma grouping + period decimal');
  assert(parseAmount('1,250')?.mid === 1250, 'lone comma with exactly three following digits stays grouping');

  // parseObservations
  const obs = parseObservations(OBS_FIXTURE);
  assert(obs.length === 10, `10 observations, got ${obs.length}`);
  assert(obs[0].num === '001' && obs[0].type === 'desired' && obs[0].source === 'user', 'fields mapped');
  assert(parseObservations('').length === 0, 'empty log');
  const blankCur = parseObservations('008\t2026-07-01\tactual\t91k\t\toffer-letter\tblank currency cell');
  assert(blankCur.length === 1 && blankCur[0].currency === 'UNKNOWN', 'blank currency cell -> UNKNOWN (excluded from gap math by the UNKNOWN guard)');

  // backward compatibility: pre-existing rows (7 cells, no round/interviewer) still parse
  assert(obs[0].round === '' && obs[0].interviewer === '', 'legacy 7-column row -> round/interviewer default to empty string');

  // stated type: round + interviewer parse correctly on the 8th/9th columns
  const statedFixture = [
    '020\t2026-07-01\tstated\t90-95k\tCAD\tuser\ttold recruiter our range\tprescreen\tJane Recruiter',
    '020\t2026-07-08\tstated\t92k\tCAD\tuser\tconfirmed same number in panel\tpanel\tJohn Manager',
    '021\t2026-07-02\tstated\t80k\tCAD\tuser\t', // no round/interviewer at all — still valid stated obs
  ].join('\n');
  const statedObs = parseObservations(statedFixture);
  assert(statedObs.length === 3, `3 stated observations, got ${statedObs.length}`);
  assert(statedObs[0].type === 'stated' && statedObs[0].round === 'prescreen' && statedObs[0].interviewer === 'Jane Recruiter',
    'stated observation carries round + interviewer');
  assert(statedObs[2].round === '' && statedObs[2].interviewer === '', 'stated observation without round/interviewer defaults to empty string');

  // getStatedObservations: lookup by tracker#, oldest first, other tracker#s excluded
  const lookup020 = getStatedObservations(statedObs, '020');
  assert(lookup020.length === 2, `2 prior stated observations for 020, got ${lookup020.length}`);
  assert(lookup020[0].interviewer === 'Jane Recruiter' && lookup020[1].interviewer === 'John Manager',
    'stated lookup returns oldest first');
  assert(getStatedObservations(statedObs, '021').length === 1, '021 lookup isolated from 020');
  assert(getStatedObservations(statedObs, '999').length === 0, 'no stated observations for untracked num -> empty array');

  // reportToObservation
  const r1 = reportToObservation(REPORT_FIXTURE_001, '001', '2026-06-20');
  assert(r1.company === 'Acme' && r1.role === 'ML Eng', 'report company/role');
  assert(r1.observation.type === 'advertised' && r1.observation.source === 'jd', 'report -> advertised obs');
  assert(r1.observation.parsed.mid === 85000, 'advertised_comp parsed');
  assert(reportToObservation(REPORT_FIXTURE_003, '003', '2026-06-26').observation === null, 'null advertised_comp -> no obs');
  assert(reportToObservation('no machine summary', '009', '2026-06-01') === null, 'no fence -> null');
  const jsonReport = '# Eval: JsonCo — Eng\n\n## Machine Summary\n\n```json\n{"company": "JsonCo", "role": "Eng", "advertised_comp": "100k EUR"}\n```\n';
  assert(reportToObservation(jsonReport, '010', '2026-06-30') === null, 'json fence rejected (yamlStr cannot extract from JSON — see FENCE_RE comment)');
  // generic ISO detection: any uppercase 3-letter token, not a hardcoded allowlist
  const plnReport = '# Eval: PlnCo — Eng\n\n## Machine Summary\n\n```yaml\ncompany: "PlnCo"\nrole: "Eng"\nadvertised_comp: "450-500k PLN"\n```\n';
  const rPln = reportToObservation(plnReport, '011', '2026-07-01');
  assert(rPln.observation.currency === 'PLN' && rPln.observation.parsed.min === 450000, 'non-allowlist currency PLN detected, amount parsed');
  // case-SENSITIVE detection: lowercase "eur" is UNKNOWN (see currencyGuess comment)
  const lowerReport = '# Eval: LowCo — Eng\n\n## Machine Summary\n\n```yaml\ncompany: "LowCo"\nrole: "Eng"\nadvertised_comp: "100k eur"\n```\n';
  const rLow = reportToObservation(lowerReport, '012', '2026-07-01');
  assert(rLow.observation.currency === 'UNKNOWN' && rLow.observation.parsed.mid === 100000, 'lowercase currency token -> UNKNOWN, amount still parsed');

  // fold — golden test
  const apps = {
    '001': { company: 'Acme', role: 'ML Eng' },
    '002': { company: 'Globex', role: 'Data Eng' },
    '003': { company: 'Initech', role: 'Platform' },
    '004': { company: 'Umbrella', role: 'AI Eng' },
    '005': { company: 'Hooli', role: 'AI Lead' },
  };
  const reportObs = [
    { num: '001', ...reportToObservation(REPORT_FIXTURE_001, '001', '2026-06-20').observation },
    { num: '002', ...reportToObservation(REPORT_FIXTURE_002, '002', '2026-06-25').observation },
    { num: '004', ...reportToObservation(REPORT_FIXTURE_004, '004', '2026-06-27').observation },
    { num: '005', ...reportToObservation(REPORT_FIXTURE_005, '005', '2026-06-28').observation },
  ];
  // cross-currency fixture: advertised USD (report) + actual GBP + desired EUR (profile)
  const crossCurrencyObs = parseObservations('004\t2026-06-30\tactual\t88k\tGBP\toffer-letter\tcross-currency on purpose');
  const result = fold([...obs, ...reportObs, ...crossCurrencyObs], apps, { amount: '90k', currency: 'EUR' });

  // Ids in folded output are canonical (#4351): the fixture writes the padded
  // form a user would type, and the join resolves it, so lookups go through
  // normalizeId rather than hardcoding the unpadded result.
  const a1 = result.applications.find(a => a.num === normalizeId('001'));
  // trust precedence: contract 86k (2026-07-05) wins over offer-letter 84k even though
  // BOTH lose to nothing — and specifically contract beats recruiter-verbal 90k
  assert(a1.actual.value === 86000 && a1.actual.source === 'contract', '001 actual = contract 86k');
  assert(a1.desired.value === 95000 && a1.desired.source === 'user', '001 desired = user 95k');
  assert(a1.advertised.value === 85000 && a1.advertised.source === 'jd', '001 advertised = jd 85k');
  // gaps: adv 85000 -> act 86000 = +1.18% ; desired 95000 -> act 86000 = -9.47%
  assert(Math.abs(a1.advToActPct - 1.18) < 0.01, `001 adv->act, got ${a1.advToActPct}`);
  assert(Math.abs(a1.desiredToActPct - (-9.47)) < 0.01, `001 desired->act, got ${a1.desiredToActPct}`);
  // trajectory preserved
  assert(a1.trail.filter(t => t.type === 'actual').length === 3, '001 keeps full actual trail');

  const a2 = result.applications.find(a => a.num === normalizeId('002'));
  // the later recruiter_verbal (underscore typo) 99k and toString (prototype key)
  // 120k must NOT become effective — unrecognized sources are excluded from
  // pickEffective (Object.hasOwn, not `in`) and reported instead
  assert(a2.actual.source === 'recruiter-verbal' && a2.actual.value === 88000, '002 actual from verbal 88k, typo + prototype-key sources ignored');
  assert(a2.desired.source === 'profile' && a2.desired.value === 90000, '002 desired falls back to profile');

  // cross-currency guard: advertised USD vs actual GBP, desired EUR vs actual GBP
  const a4 = result.applications.find(a => a.num === normalizeId('004'));
  assert(a4.advertised.currency === 'USD' && a4.actual.currency === 'GBP', '004 mixed currencies folded');
  assert(a4.advToActPct === null, `004 cross-currency adv->act pct must be null, got ${a4.advToActPct}`);
  assert(a4.desiredToActPct === null, `004 cross-currency desired->act pct must be null, got ${a4.desiredToActPct}`);
  const gbp = result.aggregates.byCurrency.GBP;
  assert(gbp.confirmed === 1 && gbp.meanAdvToActPct === null && gbp.atOrAboveAdvertised === 0 && gbp.atOrAboveDesired === 0,
    'GBP aggregates exclude cross-currency comparisons');

  // data quality
  assert(result.quality.orphans.length === 1 && result.quality.orphans[0].num === normalizeId('007'), 'orphan 007 reported');
  assert(result.quality.unparseable.length === 1 && result.quality.unparseable[0].raw === '9ok', 'typo 9ok reported');
  assert(result.quality.invalidSources.length === 2, `2 invalid sources reported, got ${result.quality.invalidSources.length}`);
  assert(result.quality.invalidSources.some(s => s.num === normalizeId('002') && s.type === 'actual' && s.source === 'recruiter_verbal'),
    'unrecognized source recruiter_verbal reported in invalidSources');
  // prototype-key source: `'toString' in tiers` is true via Object.prototype, so an
  // `in` check would let it through and poison the trust sort — must land here instead
  assert(result.quality.invalidSources.some(s => s.num === normalizeId('002') && s.type === 'actual' && s.source === 'toString'),
    'prototype-key source toString reported in invalidSources, not treated as trusted');
  // unparseable profile target must be reported, not silently dropped
  const badProfile = fold([], {}, { amount: 'competitive', currency: 'EUR' });
  assert(badProfile.quality.unparseable.some(u => u.num === '*' && u.type === 'desired' && u.raw === 'competitive' && u.source === 'profile'),
    'unparseable profile target reported');
  const mm = result.quality.currencyMismatches;
  assert(mm.length === 4, `4 currency mismatches reported, got ${mm.length}`);
  assert(mm.some(m => m.num === normalizeId('004') && m.comparison === 'advertised-vs-actual' && m.currencies[0] === 'USD' && m.currencies[1] === 'GBP'),
    'advertised-vs-actual mismatch reported for 004');
  assert(mm.some(m => m.num === normalizeId('004') && m.comparison === 'desired-vs-actual' && m.currencies[0] === 'EUR' && m.currencies[1] === 'GBP'),
    'desired-vs-actual mismatch reported for 004');

  // UNKNOWN guard: advertised_comp without a currency token (guess UNKNOWN) vs actual
  // logged with currency UNKNOWN — never comparable, even though the strings match
  const a5 = result.applications.find(a => a.num === normalizeId('005'));
  assert(a5.advertised.currency === 'UNKNOWN' && a5.actual.currency === 'UNKNOWN', '005 both sides UNKNOWN currency');
  assert(a5.advToActPct === null, `005 UNKNOWN-vs-UNKNOWN adv->act pct must be null, got ${a5.advToActPct}`);
  assert(a5.desiredToActPct === null, `005 EUR-vs-UNKNOWN desired->act pct must be null, got ${a5.desiredToActPct}`);
  assert(mm.some(m => m.num === normalizeId('005') && m.comparison === 'advertised-vs-actual' && m.currencies[0] === 'UNKNOWN' && m.currencies[1] === 'UNKNOWN'),
    'UNKNOWN-vs-UNKNOWN skip reported for 005');
  assert(mm.some(m => m.num === normalizeId('005') && m.comparison === 'desired-vs-actual' && m.currencies[0] === 'EUR' && m.currencies[1] === 'UNKNOWN'),
    'known-vs-UNKNOWN skip reported for 005');
  const unk = result.aggregates.byCurrency.UNKNOWN;
  assert(unk.confirmed === 1 && unk.meanAdvToActPct === null && unk.atOrAboveAdvertised === 0 && unk.atOrAboveDesired === 0,
    'UNKNOWN bucket carries confirmed count only — no gap math from unproven currency');

  // aggregates (EUR: 001 +1.18%, 002 -12%) grouped per currency
  const eur = result.aggregates.byCurrency.EUR;
  assert(eur.confirmed === 2, 'EUR two confirmed actuals');
  assert(Math.abs(eur.meanAdvToActPct - (-5.41)) < 0.01, `EUR mean, got ${eur.meanAdvToActPct}`);
  assert(eur.atOrAboveAdvertised === 1, 'EUR one at/above advertised');
  assert(eur.atOrAboveDesired === 0, 'EUR none at/above desired');
  // (company, role) grouping exists
  assert(result.aggregates.byCompanyRole['Acme|ML Eng'].confirmed === 1, 'company+role grouping');

  // legacy reports (no Machine Summary -> null company/role) must NOT collapse
  // into a single shared "null|null" bucket — each keys per application
  const legacyApps = { '101': { company: null, role: null }, '102': { company: null, role: null } };
  const legacyObs = parseObservations([
    '101\t2026-07-01\tactual\t80k\tEUR\toffer-letter\tlegacy report',
    '102\t2026-07-02\tactual\t85k\tEUR\tcontract\tlegacy report',
  ].join('\n'));
  const legacy = fold(legacyObs, legacyApps, null);
  const legacyKeys = Object.keys(legacy.aggregates.byCompanyRole);
  assert(!legacyKeys.includes('null|null'), 'no null|null bucket for legacy reports');
  assert(legacyKeys.includes('#101') && legacyKeys.includes('#102'), `legacy apps get per-application buckets, got ${legacyKeys.join(',')}`);
  assert(legacy.aggregates.byCompanyRole['#101'].confirmed === 1 && legacy.aggregates.byCompanyRole['#102'].confirmed === 1,
    'each legacy bucket counts its own confirmed actual');
  assert(legacy.aggregates.byCompanyRole['#101'].company === 'report #101' && legacy.aggregates.byCompanyRole['#101'].role !== null,
    'legacy bucket display fields render without null');

  // --- #4351: column 1 is a tracker#, and the join honours it ---

  // normalizeId: padding is not identity, and non-numeric ids pass through
  assert(normalizeId('029') === '29' && normalizeId('29') === '29', 'padded and plain ids canonicalize together');
  assert(normalizeId(29) === '29', 'numeric input accepted');
  assert(normalizeId('*') === '*' && normalizeId('') === '', 'non-numeric ids pass through untouched');
  assert(normalizeId('0') === '0', 'zero survives normalization');

  // The scenario from #4351: tracker row 1 links report 029 (Acme); tracker row
  // 29 (Globex) is recruiter-sourced and has no report at all.
  const trackerRows = [
    { num: '1', company: 'Acme', role: 'Staff Engineer', report: '[029](../reports/029-acme-2026-01-01.md)', notes: '' },
    { num: '29', company: 'Globex', role: 'Principal Engineer', report: '', notes: 'recruiter-sourced' },
  ];
  const reportsByNum = new Map([
    ['29', reportToObservation(REPORT_FIXTURE_4351_029, '029', '2026-01-01')],
  ]);
  const mapped = mapTrackerToApps(trackerRows, reportsByNum);

  assert(mapped.apps['29'].company === 'Globex', 'a report-less tracker row still resolves, from the row itself');
  assert(mapped.apps['1'].company === 'Acme', 'a row that links a report keeps its own company');
  // The report's advertised figure belongs to the row that links it (row 1), not
  // to the row that happens to share the report's number (row 29).
  const advOn1 = mapped.observations.filter(o => o.num === '1' && o.type === 'advertised');
  assert(advOn1.length === 1 && advOn1[0].parsed.mid === 100000, "report 029's advertised figure attaches to tracker row 1");
  assert(!mapped.observations.some(o => o.num === '29' && o.type === 'advertised'), 'nothing from report 029 leaks onto tracker row 29');
  assert(mapped.ambiguousIds.length === 1 && mapped.ambiguousIds[0].num === '29' && mapped.ambiguousIds[0].linkedBy === '1',
    'the id that means two different applications is reported, not silently resolved');

  // Both spellings of the tracker# land on Globex, and neither reaches Acme.
  for (const written of ['29', '029']) {
    const obs = parseObservations(`${written}\t2026-01-05\tactual\t150k\tEUR\trecruiter-verbal\tGlobex`);
    const folded = fold(obs, mapped.apps, null);
    const globex = folded.applications.find(a => a.num === '29');
    const acme = folded.applications.find(a => a.num === '1');
    assert(folded.quality.orphans.length === 0, `tracker# written as "${written}" is not an orphan`);
    assert(globex && globex.company === 'Globex' && globex.actual.value === 150000,
      `tracker# written as "${written}" folds onto Globex`);
    assert(!acme || acme.actual === null, `tracker# written as "${written}" never puts Globex's figure on Acme`);
  }

  // A report the tracker does not link keeps its own id (rule 2), but a row that
  // owns that id wins (rule 3 resolves to the row, which rule 2 must not undo).
  const unlinked = mapTrackerToApps(
    [{ num: '4', company: 'Initech', role: 'Platform', report: '', notes: '' }],
    new Map([['9', reportToObservation(REPORT_FIXTURE_001, '009', '2026-06-20')]]),
  );
  assert(unlinked.apps['9']?.company === 'Acme', 'an unlinked report still registers under its own number');
  assert(unlinked.apps['4']?.company === 'Initech', 'tracker rows survive alongside unlinked reports');
  const claimed = mapTrackerToApps(
    [{ num: '9', company: 'RowNine', role: 'Eng', report: '', notes: '' }],
    new Map([['9', reportToObservation(REPORT_FIXTURE_001, '009', '2026-06-20')]]),
  );
  assert(claimed.apps['9'].company === 'RowNine', 'a tracker row keeps an id an unlinked report also claims');

  // Ids sort the way a reader expects once they are unpadded (9 before 10).
  const sortRows = [10, 9, 1].map(n => ({ num: String(n), company: `C${n}`, role: 'R', report: '', notes: '' }));
  const sortObs = parseObservations([10, 9, 1].map(n => `${n}\t2026-01-0${1}\tactual\t1k\tEUR\tcontract\t`).join('\n'));
  const sorted = fold(sortObs, mapTrackerToApps(sortRows, new Map()).apps, null);
  assert(sorted.applications.map(a => a.num).join(',') === '1,9,10', `unpadded ids sort numerically, got ${sorted.applications.map(a => a.num).join(',')}`);

  // A report linked from two tracker rows (a repost / duplicate row) is one
  // application's figure, not two: it attaches to the first row only, and the
  // other row is reported rather than silently receiving a copy (#4368 review).
  const dupRows = [
    { num: '1', company: 'Acme', role: 'Eng', report: '[5](../reports/005-acme-2026-01-01.md)', notes: '' },
    { num: '2', company: 'Acme', role: 'Eng (repost)', report: '[5](../reports/005-acme-2026-01-01.md)', notes: '' },
  ];
  const dup = mapTrackerToApps(dupRows, new Map([['5', reportToObservation(REPORT_FIXTURE_4351_029, '005', '2026-01-01')]]));
  const dupAdv = dup.observations.filter(o => o.type === 'advertised');
  assert(dupAdv.length === 1 && dupAdv[0].num === '1', `a shared report's figure attaches once, to the first row; got ${dupAdv.map(o => o.num).join(',') || 'none'}`);
  assert(dup.sharedReports.length === 1 && dup.sharedReports[0].report === '5' && dup.sharedReports[0].owner === '1'
    && dup.sharedReports[0].alsoLinkedBy.join(',') === '2', 'the second linking row is reported in sharedReports');
  assert(dup.apps['2']?.company === 'Acme', 'the second row is still an application in its own right');
  const dupFolded = fold(dup.observations, dup.apps, null);
  assert(dupFolded.applications.filter(a => a.advertised).length === 1, 'one posting is never counted as two advertised figures in the fold');
  assert(mapped.sharedReports.length === 0, 'a report linked from exactly one row is not reported as shared');

  // The ambiguous-id remediation names each entry's own owner. Two ids owned by
  // two different rows must not both be told to re-point at the first one.
  const multiAmbig = fold([], { '7': { company: 'X', role: 'R' }, '9': { company: 'Y', role: 'R' } }, null);
  multiAmbig.quality.ambiguousIds = [{ num: '7', linkedBy: '3' }, { num: '9', linkedBy: '4' }];
  multiAmbig.quality.sharedReports = [];
  const printed = [];
  const realLog = console.log;
  console.log = (...parts) => { printed.push(parts.join(' ')); };
  try { printSummary(multiAmbig); } finally { console.log = realLog; }
  const line7 = printed.find(l => l.includes('#7: tracker row #7'));
  const line9 = printed.find(l => l.includes('#9: tracker row #9'));
  assert(line7 && line7.includes('re-point it to #3') && !line7.includes('#4'), `#7's remediation names row #3 only, got: ${line7}`);
  assert(line9 && line9.includes('re-point it to #4') && !line9.includes('#3'), `#9's remediation names row #4, not the first entry's row, got: ${line9}`);
  assert(!printed.some(l => /re-point it at tracker row/.test(l)), 'no single shared remediation line pointing every id at one row');

  // --stated-for tolerates either spelling (mirror of the fold join)
  const statedPad = parseObservations('029\t2026-07-01\tstated\t90k\tCAD\tuser\t\tpanel\tJane');
  assert(getStatedObservations(statedPad, '29').length === 1, 'stated lookup by plain id finds a padded row');
  assert(getStatedObservations(parseObservations('29\t2026-07-01\tstated\t90k\tCAD\tuser\t'), '029').length === 1,
    'stated lookup by padded id finds a plain row');

  console.log('salary-gap self-test OK (parser + report extraction + fold + aggregates + currency guard)');
}

// --- Real sources ---
const REPORT_FILE_RE = /^(\d{3})-.*-(\d{4}-\d{2}-\d{2})\.md$/;

/**
 * Resolve applications from tracker rows, reaching each row's report through
 * its Report link — the same way `set-status.mjs`, `outcome.mjs` and
 * `check-jd-archive.mjs` already do it.
 *
 * Column 1 of `salary-observations.tsv` is documented as a tracker#, but this
 * file used to build its application map from `reports/NNN-*.md` filenames, so
 * it was really joining on report#. Those are two independent counters that
 * "diverge permanently once any row exists without a report" (set-status.mjs),
 * which had three consequences (#4351): a report-less row could never match and
 * every observation on it was called an orphan; and once an id was padded to
 * silence that orphan, the figure attached to whichever report happened to carry
 * the same number — a different company, with no warning.
 *
 * Identity rules, in order:
 *   1. A tracker row owns its own id. Company and role come from the row, so a
 *      recruiter-sourced or backfilled row with no report folds like any other.
 *   2. A report the tracker does not link still registers under its own number,
 *      but only if no tracker row already claims that id. This keeps working for
 *      logs written before the tracker carried Report links, without letting a
 *      report re-take an id that belongs to a row.
 *   3. A collision — report R exists, a tracker row is also numbered R, and
 *      that report belongs to a different row — resolves to the tracker row and
 *      is reported in `quality.ambiguousIds`, because a log written under the old
 *      report#-join semantics means something different now and that should be
 *      visible rather than silent.
 *   4. A report linked from more than one tracker row (a repost, a duplicate
 *      row) belongs to the first row in tracker order. Only that row receives its
 *      advertised figure, so one posting is never counted as two applications;
 *      every other linking row is named in `quality.sharedReports`.
 *
 * @param {object[]} rows - Parsed tracker rows from `parseTrackerRow`.
 * @param {Map<string,object>} reportsByNum - Normalised report# -> `reportToObservation` result.
 * @returns {{apps: object, observations: object[], ambiguousIds: object[], sharedReports: object[]}}
 */
export function mapTrackerToApps(rows, reportsByNum) {
  const apps = {};
  const observations = [];
  const linkedBy = new Map(); // report# -> tracker# that links it FIRST (its owner)
  const alsoLinkedBy = new Map(); // report# -> later tracker#s that link the same report

  for (const row of rows ?? []) {
    const id = normalizeId(row?.num);
    if (!/^\d+$/.test(id)) continue;
    let company = row.company || null;
    let role = row.role || null;
    for (const rep of extractTrackerReportNumbers(row.report, row.notes).map(normalizeId)) {
      const report = reportsByNum.get(rep);
      if (!linkedBy.has(rep)) linkedBy.set(rep, id);
      // A report belongs to one application. When a later row links a report an
      // earlier row already owns (a repost, or a duplicate row), attaching its
      // figure again would count one posting as two applications in every
      // aggregate. The first row in tracker order keeps it; the rest are reported.
      const owner = linkedBy.get(rep);
      if (owner !== id) {
        if (!alsoLinkedBy.has(rep)) alsoLinkedBy.set(rep, []);
        if (!alsoLinkedBy.get(rep).includes(id)) alsoLinkedBy.get(rep).push(id);
      }
      if (!report) continue;
      // A legacy report (no Machine Summary) yields null company/role; only fill
      // a gap the tracker row left, never overwrite what the row states.
      if (!company) company = report.company || null;
      if (!role) role = report.role || null;
      if (report.observation && owner === id) observations.push({ ...report.observation, num: id });
    }
    apps[id] = { company: company || null, role: role || null };
  }

  // Rule 2: reports no row links keep their own id, unless a row owns it.
  for (const [rep, report] of reportsByNum) {
    if (linkedBy.has(rep) || Object.hasOwn(apps, rep)) continue;
    apps[rep] = { company: report.company || null, role: report.role || null };
    if (report.observation) observations.push({ ...report.observation, num: rep });
  }

  // Rule 3: surface ids whose meaning changes between the two join semantics.
  const ambiguousIds = [];
  for (const [rep, owner] of linkedBy) {
    if (owner !== rep && Object.hasOwn(apps, rep)) ambiguousIds.push({ num: rep, linkedBy: owner });
  }

  // Rule 4: a report linked from more than one row. Its figure went to the owner
  // only; name every other row so the duplicate is visible, not silently dropped.
  const sharedReports = [...alsoLinkedBy]
    .map(([report, others]) => ({ report, owner: linkedBy.get(report), alsoLinkedBy: others.sort(compareIds) }))
    .sort((a, b) => compareIds(a.report, b.report));

  return {
    apps, observations,
    ambiguousIds: ambiguousIds.sort((a, b) => compareIds(a.num, b.num)),
    sharedReports,
  };
}

function readReportsByNum() {
  const reportsByNum = new Map();
  if (!existsSync(REPORTS_DIR)) return reportsByNum;
  for (const file of readdirSync(REPORTS_DIR)) {
    const m = file.match(REPORT_FILE_RE);
    if (!m) continue;
    const [, num, date] = m;
    let content;
    try { content = readFileSync(join(REPORTS_DIR, file), 'utf-8'); } catch { continue; }
    const r = reportToObservation(content, num, date);
    // A report with no Machine Summary is still a real application, so it
    // registers with null company/role rather than being dropped.
    reportsByNum.set(normalizeId(num), r ?? { company: null, role: null, observation: null });
  }
  return reportsByNum;
}

function readTrackerRows() {
  let trackerPath;
  try { trackerPath = resolveTrackerPath(CAREER_OPS); } catch { return null; }
  if (!trackerPath || !existsSync(trackerPath)) return null;
  let lines;
  try { lines = readFileSync(trackerPath, 'utf-8').split('\n'); } catch { return null; }
  const colmap = resolveColumns(lines);
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) rows.push(row);
  }
  return rows;
}

function collectSources() {
  const reportsByNum = readReportsByNum();
  const rows = readTrackerRows();
  const observations = [];
  let apps = {};
  let ambiguousIds = [];
  let sharedReports = [];

  if (rows) {
    const mapped = mapTrackerToApps(rows, reportsByNum);
    apps = mapped.apps;
    observations.push(...mapped.observations);
    ambiguousIds = mapped.ambiguousIds;
    sharedReports = mapped.sharedReports;
  } else {
    // No readable tracker: fall back to report filenames, which is what this
    // file did before #4351. An install without applications.md keeps working.
    for (const [num, report] of reportsByNum) {
      apps[num] = { company: report.company || null, role: report.role || null };
      if (report.observation) observations.push({ ...report.observation, num });
    }
  }

  if (existsSync(OBS_PATH)) {
    observations.push(...parseObservations(readFileSync(OBS_PATH, 'utf-8')));
  }

  return { apps, observations, ambiguousIds, sharedReports };
}

function loadProfileDesired() {
  const profilePath = join(CAREER_OPS, 'config/profile.yml');
  if (!existsSync(profilePath)) return null;
  try {
    const profile = yaml.load(readFileSync(profilePath, 'utf-8'));
    const comp = profile?.compensation;
    if (!comp?.target_range) return null;
    return { amount: String(comp.target_range), currency: comp.currency ? String(comp.currency) : null };
  } catch {
    return null; // unreadable profile is a non-event here; doctor.mjs owns that complaint
  }
}

// --- Output ---
const fmtVal = (v) => (v >= 1000 && v % 500 === 0 ? `${v / 1000}k` : String(v));
const fmtEff = (e) => (e ? `${fmtVal(e.value)} ${e.currency || ''} (${e.source}, ${e.date})`.replace('  ', ' ') : '—');
const fmtPct = (p) => (p === null || p === undefined ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`);
const daysOld = (date) => Math.max(0, Math.round((Date.now() - Date.parse(date)) / 86400000));

function printSummary(result) {
  const { applications, aggregates, quality } = result;

  console.log('\nSALARY GAP — desired / advertised / actual\n');

  if (!applications.length) {
    console.log('  No compensation observations yet.');
    console.log('  Sources: reports/*.md Machine Summary `advertised_comp`,');
    console.log('  data/salary-observations.tsv, config/profile.yml compensation.target_range.');
  } else {
    console.log('  Per application:');
    for (const a of applications) {
      const who = [a.company, a.role].filter(Boolean).join(' — ') || '(unknown company/role)';
      console.log(`  #${a.num} ${who}`);
      console.log(`      desired    ${fmtEff(a.desired)}`);
      console.log(`      advertised ${fmtEff(a.advertised)}`);
      console.log(`      actual     ${fmtEff(a.actual)}`);
      if (a.advToActPct !== null || a.desiredToActPct !== null) {
        console.log(`      gap: advertised→actual ${fmtPct(a.advToActPct)}, desired→actual ${fmtPct(a.desiredToActPct)}`);
      }
    }

    const currencies = Object.entries(aggregates.byCurrency);
    if (currencies.length) {
      console.log('\n  Aggregates (per currency — no FX conversion):');
      for (const [cur, agg] of currencies) {
        console.log(`  ${cur}: mean advertised→actual ${fmtPct(agg.meanAdvToActPct)}, median ${fmtPct(agg.medianAdvToActPct)}, at/above advertised ${agg.atOrAboveAdvertised}, at/above desired ${agg.atOrAboveDesired}`);
      }
    }
    const companyRoles = Object.entries(aggregates.byCompanyRole);
    if (companyRoles.length) {
      console.log('\n  By (company, role):');
      for (const [, agg] of companyRoles) {
        const gaps = agg.advToActPcts.length ? `, advertised→actual ${agg.advToActPcts.map(fmtPct).join(' / ')}` : '';
        console.log(`  ${agg.company} — ${agg.role}: ${agg.confirmed} confirmed actual${agg.confirmed === 1 ? '' : 's'}${gaps}`);
      }
    }
  }

  // Data quality — always printed, never smoothed over
  console.log('\n  Data quality:');
  if (quality.unparseable.length) {
    console.log(`  ⚠ ${quality.unparseable.length} unparseable amount${quality.unparseable.length === 1 ? '' : 's'} (excluded from all math):`);
    for (const u of quality.unparseable) console.log(`      #${u.num} ${u.type}: "${u.raw}"`);
  } else {
    console.log('  unparseable amounts: none');
  }
  if (quality.invalidSources.length) {
    console.log(`  ⚠ ${quality.invalidSources.length} observation${quality.invalidSources.length === 1 ? '' : 's'} with unrecognized source (excluded from effective values — check for typos, e.g. recruiter_verbal vs recruiter-verbal):`);
    for (const s of quality.invalidSources) console.log(`      #${s.num} ${s.type}: source "${s.source}"`);
  } else {
    console.log('  unrecognized sources: none');
  }
  if (quality.orphans.length) {
    console.log(`  ⚠ ${quality.orphans.length} orphaned tracker#${quality.orphans.length === 1 ? '' : 's'} (no tracker row carries that number — renumbering/dedup can strand them):`);
    for (const o of quality.orphans) console.log(`      #${o.num} (${o.count} observation${o.count === 1 ? '' : 's'})`);
  } else {
    console.log('  orphaned observations: none');
  }
  if (quality.ambiguousIds?.length) {
    console.log(`  ⚠ ${quality.ambiguousIds.length} id${quality.ambiguousIds.length === 1 ? '' : 's'} mean${quality.ambiguousIds.length === 1 ? 's' : ''} two different applications (column 1 is a tracker#, so these resolve to the tracker row):`);
    // Remediation is per entry: each ambiguous id can belong to a different row,
    // so one shared "re-point it at row N" line would send users to the wrong row.
    for (const a of quality.ambiguousIds) {
      console.log(`      #${a.num}: tracker row #${a.num}, but report ${a.num} belongs to tracker row #${a.linkedBy} — if an older observation on #${a.num} meant the report, re-point it to #${a.linkedBy}`);
    }
  }
  if (quality.sharedReports?.length) {
    console.log(`  ⚠ ${quality.sharedReports.length} report${quality.sharedReports.length === 1 ? ' is' : 's are'} linked from more than one tracker row (its advertised figure is counted once, on the first row):`);
    for (const s of quality.sharedReports) {
      console.log(`      report ${s.report}: counted on #${s.owner}, also linked from ${s.alsoLinkedBy.map(n => `#${n}`).join(', ')}`);
    }
  }
  if (quality.currencyMismatches.length) {
    console.log(`  ⚠ ${quality.currencyMismatches.length} cross-currency comparison${quality.currencyMismatches.length === 1 ? '' : 's'} skipped (no FX conversion — excluded from all gap math):`);
    for (const m of quality.currencyMismatches) console.log(`      #${m.num} ${m.comparison}: ${m.currencies[0]} vs ${m.currencies[1]}`);
  } else {
    console.log('  cross-currency comparisons skipped: none');
  }
  const currencies = Object.entries(result.aggregates.byCurrency);
  if (currencies.length) {
    for (const [cur, agg] of currencies) {
      console.log(`  ${cur}: n=${agg.confirmed} confirmed actual${agg.confirmed === 1 ? '' : 's'}, newest ${agg.newestActual} (${daysOld(agg.newestActual)} days old)`);
    }
  } else {
    console.log('  confirmed actuals: none in any currency');
  }
  console.log(`  applications without a confirmed actual: ${quality.withoutActual} of ${applications.length}`);
  console.log('');
}

function main() {
  if (selfTestMode) { selfTest(); return; }

  if (statedForFlagIdx !== -1) {
    if (!statedForNum) {
      console.error('Usage: node salary-gap.mjs --stated-for <tracker#>');
      process.exit(1);
    }
    const { observations } = collectSources();
    const stated = getStatedObservations(observations, statedForNum);
    console.log(JSON.stringify({ num: statedForNum, stated }, null, 2));
    return;
  }

  const { apps, observations, ambiguousIds, sharedReports } = collectSources();
  const result = fold(observations, apps, loadProfileDesired());
  result.quality.ambiguousIds = ambiguousIds ?? [];
  result.quality.sharedReports = sharedReports ?? [];

  if (summaryMode) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
