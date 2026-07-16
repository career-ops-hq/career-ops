#!/usr/bin/env node
/**
 * salary-gap.mjs — Desired vs Advertised vs Actual compensation analyzer
 *
 * Salary facts are append-only observations, never mutated:
 *   { tracker#, date, type: desired|advertised|actual, amount, currency, source, note }
 *
 * Sources folded on read (one write path per fact):
 *   1. reports/{###}-*.md Machine Summary `advertised_comp`  -> advertised (source: jd)
 *   2. data/salary-observations.tsv (user-layer, append-only) -> desired/actual (+ corrections)
 *   3. config/profile.yml compensation.target_range           -> desired default (source: profile)
 *
 * Fold: per (tracker#, type), highest trust tier wins, then latest date.
 *   actual:     contract > offer-letter > recruiter-verbal > user
 *   desired:    user > profile
 *   advertised: user > recruiter-verbal > jd
 *
 * Aggregates grouped by (company, role) and per currency — no FX conversion.
 * Unparseable amounts, unrecognized sources, orphaned observations (tracker#
 * without report/tracker row), sample sizes, and staleness are reported loudly,
 * never dropped silently.
 *
 * Run: node salary-gap.mjs             (JSON)
 *      node salary-gap.mjs --summary   (human-readable)
 *      node salary-gap.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const OBS_PATH = join(CAREER_OPS, 'data/salary-observations.tsv');
const REPORTS_DIR = join(CAREER_OPS, 'reports');

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');

const TRUST = {
  actual: { contract: 3, 'offer-letter': 2, 'recruiter-verbal': 1, user: 0 },
  desired: { user: 1, profile: 0 },
  advertised: { user: 2, 'recruiter-verbal': 1, jd: 0 },
};

// --- Amount parsing ---
export function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s || s === '?' || s === '-' || /^(n\/?a|null)$/i.test(s)) return null;
  // Strip a leading currency symbol and a trailing 3-letter ISO-4217-style alpha
  // token (any case — "450k SEK", "80-90k eur"). Exactly three letters, so the
  // lone "k" magnitude suffix ("80k") is never eaten, and prose ("competitive")
  // still fails the numeric match below even after losing its last three letters.
  s = s.replace(/^[€$£¥]\s*/, '').replace(/\s*[A-Za-z]{3}\s*$/, '').trim();
  const toNum = (numStr, kFlag) => {
    const n = parseFloat(numStr.replace(/,/g, ''));
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

const VALID_TYPES = new Set(['desired', 'advertised', 'actual']);

// --- Observation log parsing (TSV) ---
// line: {tracker#}\t{YYYY-MM-DD}\t{type}\t{amount}\t{currency}\t{source}\t{note}
export function parseObservations(content) {
  const out = [];
  for (const line of String(content || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const cells = t.split('\t');
    if (cells.length < 6) continue;
    const [num, date, type, amount, currency, source, note = ''] = cells.map(c => c.trim());
    if (!VALID_TYPES.has(type)) continue;
    // blank currency cell -> UNKNOWN, so the fold's currency guard excludes it from
    // gap math ('' === '' would otherwise pass the strict-equality comparability check)
    out.push({ num, date, type, amount, currency: currency ? currency.toUpperCase() : 'UNKNOWN', source, note, parsed: parseAmount(amount) });
  }
  return out;
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
  const byNum = new Map();
  for (const o of observations) {
    if (!byNum.has(o.num)) byNum.set(o.num, []);
    byNum.get(o.num).push(o);
  }

  const applications = [];
  const orphans = [];
  const currencyMismatches = [];
  const unparseable = observations
    .filter(o => o.parsed === null && o.amount && o.amount !== '?')
    .map(o => ({ num: o.num, type: o.type, raw: o.amount }));
  // pickEffective only trusts sources in TRUST[type]'s vocabulary — anything else
  // (e.g. the `recruiter_verbal` underscore typo) must be reported, not silently
  // dropped. Report-derived obs are always `jd` and profile obs `profile`, so in
  // practice only TSV lines can land here.
  const invalidSources = observations
    .filter(o => TRUST[o.type] && !Object.hasOwn(TRUST[o.type], o.source))
    .map(o => ({ num: o.num, type: o.type, source: o.source }));

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
    if (!apps[num]) { orphans.push({ num, count: obs.length }); continue; }
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
      num, company: apps[num].company, role: apps[num].role,
      desired, advertised, actual, trail,
      advToActPct: advComparable ? pctDelta(advertised.value, actual.value) : null,
      desiredToActPct: desComparable ? pctDelta(desired.value, actual.value) : null,
    });
  }
  // apps with no observations at all but a profile desired still get the default
  for (const [num, meta] of Object.entries(apps)) {
    if (!byNum.has(num) && profileObs) {
      applications.push({
        num, company: meta.company, role: meta.role,
        desired: pickEffective('desired', [profileObs]), advertised: null, actual: null,
        trail: [], advToActPct: null, desiredToActPct: null,
      });
    }
  }
  applications.sort((a, b) => a.num.localeCompare(b.num));

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
      currencyMismatches: currencyMismatches.sort((a, b) => a.num.localeCompare(b.num)),
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

  // parseObservations
  const obs = parseObservations(OBS_FIXTURE);
  assert(obs.length === 10, `10 observations, got ${obs.length}`);
  assert(obs[0].num === '001' && obs[0].type === 'desired' && obs[0].source === 'user', 'fields mapped');
  assert(parseObservations('').length === 0, 'empty log');
  const blankCur = parseObservations('008\t2026-07-01\tactual\t91k\t\toffer-letter\tblank currency cell');
  assert(blankCur.length === 1 && blankCur[0].currency === 'UNKNOWN', 'blank currency cell -> UNKNOWN (excluded from gap math by the UNKNOWN guard)');

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

  const a1 = result.applications.find(a => a.num === '001');
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

  const a2 = result.applications.find(a => a.num === '002');
  // the later recruiter_verbal (underscore typo) 99k and toString (prototype key)
  // 120k must NOT become effective — unrecognized sources are excluded from
  // pickEffective (Object.hasOwn, not `in`) and reported instead
  assert(a2.actual.source === 'recruiter-verbal' && a2.actual.value === 88000, '002 actual from verbal 88k, typo + prototype-key sources ignored');
  assert(a2.desired.source === 'profile' && a2.desired.value === 90000, '002 desired falls back to profile');

  // cross-currency guard: advertised USD vs actual GBP, desired EUR vs actual GBP
  const a4 = result.applications.find(a => a.num === '004');
  assert(a4.advertised.currency === 'USD' && a4.actual.currency === 'GBP', '004 mixed currencies folded');
  assert(a4.advToActPct === null, `004 cross-currency adv->act pct must be null, got ${a4.advToActPct}`);
  assert(a4.desiredToActPct === null, `004 cross-currency desired->act pct must be null, got ${a4.desiredToActPct}`);
  const gbp = result.aggregates.byCurrency.GBP;
  assert(gbp.confirmed === 1 && gbp.meanAdvToActPct === null && gbp.atOrAboveAdvertised === 0 && gbp.atOrAboveDesired === 0,
    'GBP aggregates exclude cross-currency comparisons');

  // data quality
  assert(result.quality.orphans.length === 1 && result.quality.orphans[0].num === '007', 'orphan 007 reported');
  assert(result.quality.unparseable.length === 1 && result.quality.unparseable[0].raw === '9ok', 'typo 9ok reported');
  assert(result.quality.invalidSources.length === 2, `2 invalid sources reported, got ${result.quality.invalidSources.length}`);
  assert(result.quality.invalidSources.some(s => s.num === '002' && s.type === 'actual' && s.source === 'recruiter_verbal'),
    'unrecognized source recruiter_verbal reported in invalidSources');
  // prototype-key source: `'toString' in tiers` is true via Object.prototype, so an
  // `in` check would let it through and poison the trust sort — must land here instead
  assert(result.quality.invalidSources.some(s => s.num === '002' && s.type === 'actual' && s.source === 'toString'),
    'prototype-key source toString reported in invalidSources, not treated as trusted');
  // unparseable profile target must be reported, not silently dropped
  const badProfile = fold([], {}, { amount: 'competitive', currency: 'EUR' });
  assert(badProfile.quality.unparseable.some(u => u.num === '*' && u.type === 'desired' && u.raw === 'competitive' && u.source === 'profile'),
    'unparseable profile target reported');
  const mm = result.quality.currencyMismatches;
  assert(mm.length === 4, `4 currency mismatches reported, got ${mm.length}`);
  assert(mm.some(m => m.num === '004' && m.comparison === 'advertised-vs-actual' && m.currencies[0] === 'USD' && m.currencies[1] === 'GBP'),
    'advertised-vs-actual mismatch reported for 004');
  assert(mm.some(m => m.num === '004' && m.comparison === 'desired-vs-actual' && m.currencies[0] === 'EUR' && m.currencies[1] === 'GBP'),
    'desired-vs-actual mismatch reported for 004');

  // UNKNOWN guard: advertised_comp without a currency token (guess UNKNOWN) vs actual
  // logged with currency UNKNOWN — never comparable, even though the strings match
  const a5 = result.applications.find(a => a.num === '005');
  assert(a5.advertised.currency === 'UNKNOWN' && a5.actual.currency === 'UNKNOWN', '005 both sides UNKNOWN currency');
  assert(a5.advToActPct === null, `005 UNKNOWN-vs-UNKNOWN adv->act pct must be null, got ${a5.advToActPct}`);
  assert(a5.desiredToActPct === null, `005 EUR-vs-UNKNOWN desired->act pct must be null, got ${a5.desiredToActPct}`);
  assert(mm.some(m => m.num === '005' && m.comparison === 'advertised-vs-actual' && m.currencies[0] === 'UNKNOWN' && m.currencies[1] === 'UNKNOWN'),
    'UNKNOWN-vs-UNKNOWN skip reported for 005');
  assert(mm.some(m => m.num === '005' && m.comparison === 'desired-vs-actual' && m.currencies[0] === 'EUR' && m.currencies[1] === 'UNKNOWN'),
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

  console.log('salary-gap self-test OK (parser + report extraction + fold + aggregates + currency guard)');
}

// --- Real sources ---
const REPORT_FILE_RE = /^(\d{3})-.*-(\d{4}-\d{2}-\d{2})\.md$/;

function collectSources() {
  const apps = {};
  const observations = [];

  if (existsSync(REPORTS_DIR)) {
    for (const file of readdirSync(REPORTS_DIR)) {
      const m = file.match(REPORT_FILE_RE);
      if (!m) continue;
      const [, num, date] = m;
      let content;
      try { content = readFileSync(join(REPORTS_DIR, file), 'utf-8'); } catch { continue; }
      const r = reportToObservation(content, num, date);
      if (r) {
        apps[num] = { company: r.company, role: r.role };
        if (r.observation) observations.push(r.observation);
      } else {
        // report exists but has no Machine Summary (legacy) — still a valid
        // tracker row, so log observations against it are NOT orphans
        apps[num] = { company: null, role: null };
      }
    }
  }

  if (existsSync(OBS_PATH)) {
    observations.push(...parseObservations(readFileSync(OBS_PATH, 'utf-8')));
  }

  return { apps, observations };
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
    console.log(`  ⚠ ${quality.orphans.length} orphaned tracker#${quality.orphans.length === 1 ? '' : 's'} (observations without a matching report — renumbering/dedup can strand them):`);
    for (const o of quality.orphans) console.log(`      #${o.num} (${o.count} observation${o.count === 1 ? '' : 's'})`);
  } else {
    console.log('  orphaned observations: none');
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

  const { apps, observations } = collectSources();
  const result = fold(observations, apps, loadProfileDesired());

  if (summaryMode) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
