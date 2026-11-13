/**
 * lib/gig-terms.mjs — the terms of a freelance or contract engagement, read
 * from a posting (job-engine tracks: freelance).
 *
 * A gig is priced by the hour or the day, runs for a stated length, is sold
 * by the client or through an agency, and in Germany carries a
 * Scheinselbstaendigkeit (false self-employment) risk that depends on how
 * the work is organised. A salary evaluation asks none of that. These
 * readers pull each term out of the text, with the sentence it came from, so
 * the evaluation can show its evidence.
 *
 * Deterministic and offline. Every reader returns null or 'unknown' when the
 * text does not say, and nothing here is legal or tax advice.
 */

const CUR_TOKEN = '(?:€|£|US\\$|\\$|EUR|GBP|CHF|USD|PLN|SEK|DKK|NOK|CZK|euros?|zł)';
const NUM = "\\d{1,3}(?:[.,'’ ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const SUFFIX = '(k\\b|K\\b|tsd\\.?|T€)?';
const MONEY_RE = new RegExp(
  '(' + CUR_TOKEN + ')?\\s?(' + NUM + ')\\s?' + SUFFIX + '\\s?(' + CUR_TOKEN + ')?'
  + '(?:\\s?(?:-|–|—|to|bis)\\s?(' + CUR_TOKEN + ')?\\s?(' + NUM + ')\\s?' + SUFFIX + '\\s?(' + CUR_TOKEN + ')?)?', 'gi');
const KEYWORD_RATE_RE = new RegExp('(tagessatz|tagesrate|stundensatz|day rate|daily rate|hourly rate|TJM)[^\\d\\n€£$]{0,20}(' + NUM + ')(?!\\s?(?:%|' + CUR_TOKEN + '))', 'gi');

const CURRENCY_OF = [
  ['EUR', /€|eur/i], ['GBP', /£|gbp/i], ['CHF', /chf/i], ['USD', /\$|usd/i], ['PLN', /pln|zł/i],
  ['SEK', /sek/i], ['DKK', /dkk/i], ['NOK', /nok/i], ['CZK', /czk/i],
];

const UNIT_AFTER = [
  ['hour', /^\s*(?:\/|per|pro|je|an?|par|por|p\.)?\s*(?:h\b|hr\b|hrs\b|hour|hourly|std\b|stunde|heure|hora|uur)/i],
  ['day', /^\s*(?:\/|per|pro|je|an?|par|por|p\.)?\s*(?:d\b|day|daily|tag\b|tagessatz|PT\b|jour|día|dia\b|dag\b|man[- ]?day|personentag)/i],
  ['week', /^\s*(?:\/|per|pro|je|an?)?\s*(?:week|woche|wk\b)/i],
  ['month', /^\s*(?:\/|per|pro|je|an?|par|por)?\s*(?:month|monat|mo\b|mois|mes\b|mtl|monthly)/i],
  ['year', /^\s*(?:\/|per|pro|je|an?|par|por|p\.)?\s*(?:year|yr\b|annum|annual|a\.|jahr|jährlich|an\b|año|jaar|brutto|gross)/i],
];
const UNIT_BEFORE = [
  ['hour', /(stundensatz|hourly rate|rate per hour|hourly)[^\d\n]{0,25}$/i],
  ['day', /(tagessatz|tagesrate|day rate|daily rate|tjm|rate per day)[^\d\n]{0,25}$/i],
  ['month', /(monatsgehalt|monthly salary|per month|monatlich)[^\d\n]{0,25}$/i],
  ['year', /(jahresgehalt|jahresbrutto|salary|gehalt|base pay|base salary|ote|compensation|annual|vergütung)[^\d\n]{0,30}$/i],
];
const NOT_PAY_AFTER = /^\s?(?:m\b|mm\b|mio\b|mrd\b|bn\b|b\b|million|billion|milliard|%|users|customers|funding|series|arr\b|revenue|raised|valuation|gutschein\w*|voucher|essenszuschuss|zuschuss|sachbezug|mobilitätsbudget|budget|bonus|prämie)/i;
const NOT_PAY_BEFORE = /(raised|funding|valuation|revenue|arr|umsatz|series [a-f]|backed by|budget of)\W{0,20}$/i;

function parseNumber(raw, suffix) {
  let s = raw.replace(/['’ ]/g, '');
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    const decimal = dot > comma ? '.' : ',';
    s = s.split(decimal === '.' ? ',' : '.').join('').replace(decimal, '.');
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? '.' : ',';
    const tail = s.slice(s.lastIndexOf(sep) + 1);
    // "65.000" and "1,200" are thousands; "95,50" and "1.5" are decimals.
    s = tail.length === 3 ? s.split(sep).join('') : s.replace(sep, '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return suffix ? n * 1000 : n;
}

function currencyOf(token) {
  if (!token) return null;
  const hit = CURRENCY_OF.find(([, re]) => re.test(token));
  return hit ? hit[0] : null;
}

function unitFor(text, start, end, max) {
  const after = text.slice(end, end + 30);
  const before = text.slice(Math.max(0, start - 45), start);
  for (const [unit, re] of UNIT_AFTER) if (re.test(after)) return { unit, inferred: false };
  for (const [unit, re] of UNIT_BEFORE) if (re.test(before)) return { unit, inferred: false };
  if (max < 250) return { unit: 'hour', inferred: true };
  if (max <= 2500) return { unit: 'day', inferred: true };
  if (max >= 15000) return { unit: 'year', inferred: true };
  return { unit: 'unknown', inferred: true };
}

/**
 * Every pay figure a text states: an amount or a range, its currency and the
 * period it is quoted for. A figure with no currency counts only behind a rate
 * keyword ("Tagessatz: 800"). When the text gives no period, it is inferred
 * from the size of the number and marked inferredUnit.
 *
 * @param {string} text
 * @returns {Array<{ min: number, max: number, currency: string | null, unit: 'hour' | 'day' | 'week' | 'month' | 'year' | 'unknown', inferredUnit: boolean, raw: string }>}
 */
export function parseRates(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  const taken = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const currency = currencyOf(m[1]) || currencyOf(m[4]) || currencyOf(m[5]) || currencyOf(m[8]);
    if (!currency) continue;
    const end = m.index + m[0].length;
    if (NOT_PAY_AFTER.test(text.slice(end, end + 12)) || NOT_PAY_BEFORE.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
    const a = parseNumber(m[2], m[3] || (m[6] && m[7]));
    const b = m[6] ? parseNumber(m[6], m[7]) : a;
    if (a === null || b === null || Math.max(a, b) < 5) continue;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    const { unit, inferred } = unitFor(text, m.index, end, max);
    out.push({ min, max, currency, unit, inferredUnit: inferred, raw: m[0].trim() });
    taken.push([m.index, end]);
  }
  for (const m of text.matchAll(KEYWORD_RATE_RE)) {
    const at = m.index + m[0].length - m[2].length;
    if (taken.some(([s, e]) => at >= s && at < e)) continue;
    const n = parseNumber(m[2], '');
    if (n === null || n < 5) continue;
    const unit = /stunden|hourly/i.test(m[1]) ? 'hour' : 'day';
    out.push({ min: n, max: n, currency: null, unit, inferredUnit: false, raw: m[0].trim() });
  }
  return out;
}

/** The figure an engagement is priced at: the first hourly or daily one, else null. */
export function pickGigRate(rates) {
  return rates.find(r => (r.unit === 'hour' || r.unit === 'day') && !r.inferredUnit)
    || rates.find(r => r.unit === 'hour' || r.unit === 'day') || null;
}

/** The figure a salaried role is priced at: the first annual one, else a monthly one, else null. */
export function pickSalary(rates) {
  return rates.find(r => r.unit === 'year' && !r.inferredUnit) || rates.find(r => r.unit === 'year')
    // A monthly figure under 400 is a benefit (a voucher, an allowance), not a salary.
    || rates.find(r => r.unit === 'month' && r.max >= 400) || null;
}

/**
 * A pay figure as a day rate. An annual or monthly figure is divided over the
 * billable days of a year, which is what a salary is worth per working day,
 * not what a freelancer should charge for it.
 */
export function toDayRate(rate, { hoursPerDay = 8, billableDaysPerYear = 220 } = {}) {
  if (!rate) return null;
  const factor = {
    hour: hoursPerDay, day: 1, week: 1 / 5, month: 12 / billableDaysPerYear, year: 1 / billableDaysPerYear,
  }[rate.unit];
  if (!factor) return null;
  return { min: Math.round(rate.min * factor), max: Math.round(rate.max * factor), currency: rate.currency };
}

/**
 * Convert with the user's own static rates (how much of the base currency
 * one unit of another buys). No network: an unlisted currency returns null.
 */
export function convertAmount(amount, from, to, fx = {}) {
  if (!from || !to || from === to) return amount;
  const rate = Number(fx[from]);
  return Number.isFinite(rate) && rate > 0 ? Math.round(amount * rate) : null;
}

/**
 * Compare an offered rate with the user's own target and floor, both as day
 * rates. With neither set the verdict is 'no_floor': the figure is shown as
 * information and nothing is ruled out on pay.
 *
 * @param {ReturnType<typeof pickGigRate>} rate
 * @param {{ target?: number | null, minimum?: number | null, currency?: string }} wanted
 * @param {{ hoursPerDay?: number, billableDaysPerYear?: number, fx?: Record<string, number> }} [opts]
 */
export function compareRate(rate, wanted = {}, opts = {}) {
  const day = toDayRate(rate, opts);
  if (!day) return { verdict: 'unknown', dayRate: null, reason: 'The posting states no rate.' };
  const base = wanted.currency || day.currency;
  const offeredCurrency = day.currency || base;
  const min = convertAmount(day.min, offeredCurrency, base, opts.fx);
  const max = convertAmount(day.max, offeredCurrency, base, opts.fx);
  if (min === null || max === null) {
    return { verdict: 'unknown', dayRate: day, reason: 'The rate is in ' + offeredCurrency + ' and no conversion to ' + base + ' is configured.' };
  }
  const dayRate = { min, max, currency: base, converted: offeredCurrency !== base, assumedCurrency: !day.currency };
  const target = Number.isFinite(wanted.target) ? wanted.target : null;
  const minimum = Number.isFinite(wanted.minimum) ? wanted.minimum : null;
  if (target === null && minimum === null) return { verdict: 'no_floor', dayRate, reason: 'No target or minimum rate is configured, so pay is shown and never blocks.' };
  if (minimum !== null && max < minimum) return { verdict: 'below_minimum', dayRate, reason: 'Tops out at ' + max + ' ' + base + '/day, below your minimum of ' + minimum + '.' };
  if (target !== null && min >= target) return { verdict: 'above_target', dayRate, reason: 'Starts at ' + min + ' ' + base + '/day, at or above your target of ' + target + '.' };
  if (target !== null && max >= target) return { verdict: 'meets_target', dayRate, reason: 'Reaches ' + max + ' ' + base + '/day, which covers your target of ' + target + '.' };
  return { verdict: 'between', dayRate, reason: 'Up to ' + max + ' ' + base + '/day: above your minimum, below your target.' };
}

/**
 * The day rate at which freelancing pays what a salaried offer costs its
 * employer: the salary plus employer on-costs, spread over the days a
 * freelancer can actually bill. A rule of thumb for comparing the two tracks.
 */
export function salaryEquivalentDayRate(annualSalary, { billableDaysPerYear = 200, onCostFactor = 1.3 } = {}) {
  if (!Number.isFinite(annualSalary) || annualSalary <= 0) return null;
  return Math.round((annualSalary * onCostFactor) / billableDaysPerYear);
}

const FREELANCE_CUES = [
  /\bfreelanc\w*/i, /\bfreiberuf\w*/i, /\bfreie[rn]? mitarbeit\w*/i, /\bselbst(?:st)?ändig\w*/i, /\bindependent contractor\b/i,
  /\bcontractor\b/i, /\bB2B\b/, /\bstatement of work\b/i, /\bSOW\b/, /\bday rate\b/i, /\bdaily rate\b/i, /\btagessatz\b/i, /\bstundensatz\b/i,
  /\bprojektvertrag\b/i, /\bprojektlaufzeit\b/i, /\bauf projektbasis\b/i, /\b(?:inside|outside) IR35\b/i, /\bcorp[- ]to[- ]corp\b/i, /\bC2C\b/,
  /\bZZP\b/, /\bportage salarial\b/i, /\bindépendant\b/i, /\bautónomo\b/i, /\binterim(?:s)?[- ]?(?:manager|mandat|projekt)\w*/i, /\bprojekteinsatz\b/i,
  /\bprojektanfrage\b/i, /\bcontract[- ]to[- ]hire\b/i, /\b1099\b/, /\bseeking freelancer\b/i,
];
const EMPLOYMENT_CUES = [
  /\bfestanstellung\b/i, /\bunbefristet\w*/i, /\bpermanent (?:position|role|contract|employment)\b/i, /\bfull[- ]time employ\w+/i, /\bCDI\b/,
  /\barbeitsvertrag\b/i, /\bemployment contract\b/i, /\b\d{2} (?:tage|days) (?:urlaub|vacation|holiday|annual leave)\b/i, /\bbetriebliche altersvorsorge\b/i,
  /\bpaid time off\b/i, /\bstock options\b/i, /\bequity\b/i, /\bW-?2\b/, /\bpension (?:scheme|plan|contribution)\b/i, /\b13\. (?:monats)?gehalt\b/i,
];
const FIXED_TERM_CUES = [/\bbefristet\w*/i, /\bfixed[- ]term\b/i, /\bCDD\b/, /\btemporary (?:contract|position|employment)\b/i, /\bmaternity cover\b/i, /\belternzeitvertretung\b/i];
const TEMP_AGENCY_CUES = [/\barbeitnehmerüberlassung\b/i, /\bANÜ\b/, /\bzeitarbeit\b/i, /\btemp(?:orary)? agency work\b/i, /\bPAYE (?:umbrella|contract)\b/i, /\bumbrella company\b/i];
const EOR_CUES = [/\bemployer of record\b/i, /\bEOR\b/, /\bhired (?:through|via) (?:deel|remote\.com|remote|oyster|rippling|papaya|globalization partners|g-p)\b/i, /\b(?:via|through) (?:our )?(?:deel|oyster|remote\.com)\b/i];

function cueHits(text, cues) {
  const hits = [];
  for (const re of cues) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/**
 * How the posting hires: 'freelance' (self-employed, invoicing), 'employment'
 * (permanent), 'fixed_term' (employed, with an end date), 'temp_agency'
 * (employed by an agency and lent out: Arbeitnehmerueberlassung, umbrella),
 * 'eor' (employed through an employer of record) or 'unknown'.
 *
 * A source that only lists freelance projects can pass sourceHint.
 */
export function detectEngagement(text, { title = '', sourceHint = null } = {}) {
  const all = (title + '\n' + (typeof text === 'string' ? text : '')).slice(0, 40000);
  const freelance = cueHits(all, FREELANCE_CUES);
  const employment = cueHits(all, EMPLOYMENT_CUES);
  const fixed = cueHits(all, FIXED_TERM_CUES);
  const temp = cueHits(all, TEMP_AGENCY_CUES);
  const eor = cueHits(all, EOR_CUES);
  let type = 'unknown';
  if (temp.length && temp.length >= freelance.length) type = 'temp_agency';
  else if (freelance.length > employment.length || (freelance.length && cueHits(title, FREELANCE_CUES).length)) type = 'freelance';
  else if (eor.length) type = 'eor';
  else if (fixed.length) type = 'fixed_term';
  else if (employment.length) type = 'employment';
  else if (freelance.length) type = 'freelance';
  if (type === 'unknown' && sourceHint) type = sourceHint;
  return { type, evidence: { freelance, employment, fixedTerm: fixed, tempAgency: temp, eor } };
}

const MONTHS_RE = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to|bis)\s*(\d{1,2})\s*\+?\s*)?[- ]?(months?|monate?n?|mois|meses|maanden|mo\b|weeks?|wochen?|years?|jahre?n?)/i;
const LENGTH_CUE_RE = /\b(duration|laufzeit|dauer|length|contract\w*|freelance\w*|projekt\w*|engagement|initial(?:ly)?|term|zeitraum|durée|duración|einsatz\w*|assignment|for (?:a period of|an initial))\b/i;
const EXTENSION_RE = /\b(verlängerung\w*|extension|extend\w*|renewal|renewable|prolongation|option auf|long[- ]term|langfristig\w*|open[- ]ended|ongoing|contract[- ]to[- ]hire|rolling contract)\b/i;
const NO_EXTENSION_RE = /\b(no extension|keine verlängerung|fixed end|without extension|one[- ]off|einmalig\w*)\b/i;
const START_RE = /\b(?:start(?:date|termin|ing)?|beginn|ab)\s*[:\-]?\s*(asap|sofort|ab sofort|immediately|\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|mär|apr|ma[iy]|jun|jul|aug|sep|o[ck]t|nov|de[cz])\w*\.? \d{4}|Q[1-4] \d{4})/i;
const UTILISATION_RE = /\b(\d{2,3})\s?%(?!\s*(?:remote|home[- ]?office|onsite|on-site|vor ort))\s*(?:auslastung|utili[sz]ation|capacity|workload|pensum)?|\b(\d)\s*(?:-\s*\d\s*)?(?:days?|tage)\s*(?:per|a|pro|\/|die)\s*(?:week|woche)\b|\b(\d{2})\s*(?:hours?|h|std\.?|stunden)\s*(?:per|a|pro|\/|die)\s*(?:week|woche)\b|\b(full[- ]time|part[- ]time|vollzeit|teilzeit)\b/i;

/**
 * Contract length, extension prospects, start and utilisation, each with the
 * sentence it came from. Lengths are in months.
 */
export function parseContractTerms(text) {
  const out = { months: null, extension: 'not_stated', start: null, utilisation: null, evidence: [] };
  if (typeof text !== 'string' || !text) return out;
  const lines = text.slice(0, 40000).split(/(?<=[.!?])\s+|\n+|[•;]/).map(s => s.trim()).filter(Boolean);
  for (const s of lines) {
    if (!out.months && LENGTH_CUE_RE.test(s)) {
      const m = s.match(MONTHS_RE);
      if (m) {
        const scale = /week|woche/i.test(m[3]) ? 12 / 52 : /year|jahr/i.test(m[3]) ? 12 : 1;
        const a = Number(m[1]) * scale;
        const b = m[2] ? Number(m[2]) * scale : a;
        out.months = { min: Math.round(Math.min(a, b) * 10) / 10, max: Math.round(Math.max(a, b) * 10) / 10, openEnded: /\+/.test(m[0]) };
        out.evidence.push(s.slice(0, 160));
      }
    }
    if (out.extension === 'not_stated') {
      if (NO_EXTENSION_RE.test(s)) { out.extension = 'none'; out.evidence.push(s.slice(0, 160)); }
      else if (EXTENSION_RE.test(s)) { out.extension = 'stated'; out.evidence.push(s.slice(0, 160)); }
    }
    if (!out.start) {
      const m = s.match(START_RE);
      if (m) out.start = m[1];
    }
    const named = !out.utilisation && s.match(/(?:auslastung|utili[sz]ation|capacity|workload|pensum)\s*:?\s*(\d{2,3})\s?%/i);
    if (named) out.utilisation = { percent: Number(named[1]), raw: named[0].trim() };
    if (!out.utilisation && /auslastung|utili[sz]ation|capacity|workload|pensum|week|woche|full[- ]time|part[- ]time|vollzeit|teilzeit/i.test(s)) {
      const m = s.match(UTILISATION_RE);
      if (m) {
        if (m[1] && /auslastung|utili[sz]ation|capacity|workload|pensum/i.test(s)) out.utilisation = { percent: Number(m[1]), raw: m[0].trim() };
        else if (m[2]) out.utilisation = { percent: Math.min(100, Number(m[2]) * 20), raw: m[0].trim() };
        else if (m[3]) out.utilisation = { percent: Math.min(100, Math.round(Number(m[3]) / 40 * 100)), raw: m[0].trim() };
        // Part-time names no share: the percentage stays open instead of a guessed 50.
        else if (m[4]) out.utilisation = { percent: /full|voll/i.test(m[4]) ? 100 : null, raw: m[4] };
      }
    }
  }
  return out;
}

const AGENCIES = ['hays', 'gulp', 'randstad', 'solcom', 'etengo', 'computer futures', 'michael page', 'page personnel', 'robert half', 'harvey nash', 'darwin recruitment', 'experis', 'westhouse', 'krongaard', 'sthree', 'progressive recruitment', 'akkodis', 'modis', 'ferchau', 'adecco', 'manpower', 'reed', 'huxley', 'real staffing', 'nigel frank', 'oscar', 'understanding recruitment', 'amoria bond', 'hager', 'top itservices', 'questax', 'emagine', 'freelance.de', 'malt', 'toptal', 'braintrust', 'uplink', 'expertlead', 'comatch', 'lemon.io', 'turing', 'andela', 'a-team', 'gigster', 'upwork'];
const AGENCY_CUE_RE = /\b(our client|my client|for a client|on behalf of (?:our|a) client|unser(?:e[nmrs]?)? (?:kunde\w*|mandant\w*|auftraggeber\w*)|für (?:einen|unseren) (?:kunden|endkunden)|im auftrag|endkunde\w*|end client|we are recruiting for|personalberatung|personaldienstleist\w+|recruitment (?:agency|consultancy)|staffing (?:agency|firm)|talent network|marketplace)\b/i;
const DIRECT_CUE_RE = /\b(direktbeauftragung|direct contract|direktvertrag|kein(?:e)? (?:agentur|vermittler)|no agenc(?:y|ies)|direkt beim (?:kunden|endkunden)|we are (?:a|an) [^.\n]{0,40}(?:startup|company|team) (?:building|working))\b/i;

/** Who the contract would be with: 'agency', 'direct' or 'unknown'. */
export function detectIntermediary(text, company = '') {
  const body = typeof text === 'string' ? text.slice(0, 40000) : '';
  const name = String(company || '').toLowerCase();
  const agencyName = AGENCIES.find(a => name.split(/[^a-z0-9.\-]+/).join(' ').includes(a));
  const cue = body.match(AGENCY_CUE_RE);
  const direct = body.match(DIRECT_CUE_RE);
  if (direct && !agencyName) return { via: 'direct', evidence: [direct[0]] };
  if (agencyName || cue) return { via: 'agency', evidence: [agencyName ? 'posted by ' + company : null, cue ? cue[0] : null].filter(Boolean) };
  return { via: 'unknown', evidence: [] };
}

const PAYMENT_RE = /\b(?:zahlungsziel|payment terms?|payment within|zahlbar (?:innerhalb|binnen)|net|netto|invoice[sd]? (?:paid )?(?:within|in))\D{0,15}(\d{1,3})\s*(?:tage?n?|days?|d\b)?|\b(\d{1,3})\s*(?:tage?|days?)\s*(?:netto|net|zahlungsziel|payment terms?)\b|\bnet[- ]?(\d{2,3})\b/i;
const PAYMENT_RHYTHM_RE = /\b(paid|payment|invoic\w+|abrechnung|rechnungsstellung)\s+(weekly|bi-?weekly|monthly|wöchentlich|monatlich|upon completion|on delivery|per milestone|nach meilensteinen)\b/i;

/** Payment terms: days until an invoice is paid, and the invoicing rhythm. */
export function parsePaymentTerms(text) {
  if (typeof text !== 'string' || !text) return { days: null, rhythm: null, raw: null };
  const m = text.match(PAYMENT_RE);
  const r = text.match(PAYMENT_RHYTHM_RE);
  const days = m ? Number(m[1] || m[2] || m[3]) : null;
  return { days: Number.isFinite(days) && days > 0 && days <= 180 ? days : null, rhythm: r ? r[2].toLowerCase() : null, raw: m ? m[0].trim() : r ? r[0].trim() : null };
}

// Indicators the Deutsche Rentenversicherung weighs when it decides whether a
// contractor is in fact an employee (§ 7 SGB IV: bound by instructions and
// integrated into the client's organisation). No single one decides it.
const SCHEIN_INDICATORS = [
  ['instructions', 'Works under the client\'s instructions', /\b(weisungsgebunden\w*|nach weisung|reports? (?:directly )?to|berichtet an|unter (?:der )?leitung|line manager|disziplinarisch)\b/i],
  ['integration', 'Integrated into the client\'s team and processes', /\b(teil des teams|in (?:das|unser|ein) (?:bestehende[sn]? )?team (?:eingebunden|integriert)|integriert in|embedded in (?:the|our|an? existing) team|als teil unseres teams|join (?:our|the) (?:scrum|agile|product|engineering) team|daily stand-?ups?|team events)\b/i],
  ['fixed_hours', 'Fixed working hours or core hours set by the client', /\b(feste arbeitszeiten|kernarbeitszeit\w*|fixed (?:working )?hours|core hours|9[- ]?(?:to|bis|-)[- ]?(?:5|17)|anwesenheitspflicht)\b/i],
  ['onsite', 'Must work at the client\'s premises', /\b(100 ?% vor ort|ausschließlich vor ort|präsenzpflicht|on-?site (?:presence )?(?:is )?(?:required|mandatory)|fully on-?site|five days (?:a|per) week (?:in|at) (?:the|our) office|vor[- ]ort[- ]einsatz (?:erforderlich|zwingend))\b/i],
  ['client_equipment', 'Uses the client\'s equipment, accounts or email address', /\b(firmenlaptop|laptop wird gestellt|equipment (?:is |will be )?provided|company (?:laptop|email|e-mail)|kunden[- ]?laptop|client[- ]provided (?:laptop|hardware|equipment))\b/i],
  ['exclusive', 'Full-time for one client, leaving no room for others', /\b(100 ?% auslastung|vollzeit\w*|full[- ]time|40 ?(?:h|std\.?|stunden|hours)(?: ?\/ ?| per | pro | a )(?:woche|week)|ausschließlich für|exclusively for|5 (?:tage|days) (?:pro|per|a|die) (?:woche|week))\b/i],
  ['leave', 'Holiday or absence must be agreed with the client', /\b(urlaubsabsprache|urlaub (?:ist |muss )?(?:abzustimmen|abgestimmt)|holiday (?:must be |to be )?approved|abwesenheiten? (?:sind |ist )?abzustimmen)\b/i],
];
const SCHEIN_MITIGATIONS = [
  ['own_schedule', 'Free to choose working hours and place', /\b(freie zeiteinteilung|flexible zeiteinteilung|set your own (?:hours|schedule)|work when(?:ever)? you (?:want|like)|asynchron\w*|async(?:hronous)?[- ]first|freie (?:orts|arbeitsort)wahl)\b/i],
  ['deliverable', 'Paid for a defined deliverable (Werkvertrag, fixed scope, milestones)', /\b(werkvertrag|fixed[- ]price|festpreis|milestones?|meilensteine?n?|deliverables?|defined scope|arbeitspaket\w*|work packages?)\b/i],
  ['own_tools', 'Uses own equipment and methods', /\b(eigene(?:s|n)? (?:equipment|laptop|betriebsmittel|hardware)|own (?:equipment|laptop|hardware|tools)|bring your own)\b/i],
  ['part_time', 'Part-time, leaving room for other clients', /\b(teilzeit|part[- ]time|[1-3] (?:tage|days) (?:pro|per|a|die) (?:woche|week)|[2-6]0 ?% auslastung|nebenberuflich)\b/i],
  ['status_check', 'Mentions a status determination or compliance check', /\b(statusfeststellung\w*|clearingverfahren|compliance[- ]check|scheinselbst(?:st)?ändigkeit)\b/i],
];

/**
 * Scheinselbstaendigkeit indicators in a German engagement. Returns the
 * indicators and mitigating facts found, and a coarse risk level:
 *
 *   high      three or more indicators outweighing the mitigations
 *   elevated  one or two indicators, or a full-time engagement of a year or more
 *   low       mitigations and no indicators
 *   unknown   the text says too little
 *
 * A reading aid for the evaluation, not a legal assessment: the real test
 * looks at how the work is actually done, and only a Statusfeststellung by
 * the Deutsche Rentenversicherung settles it.
 */
export function assessScheinselbstaendigkeit(text, { months = null, utilisationPercent = null } = {}) {
  const body = typeof text === 'string' ? text.slice(0, 40000) : '';
  const indicators = [];
  const mitigations = [];
  for (const [id, label, re] of SCHEIN_INDICATORS) {
    const m = body.match(re);
    if (m) indicators.push({ id, label, evidence: m[0] });
  }
  for (const [id, label, re] of SCHEIN_MITIGATIONS) {
    const m = body.match(re);
    if (m) mitigations.push({ id, label, evidence: m[0] });
  }
  const longFullTime = months !== null && months >= 12 && (utilisationPercent === null || utilisationPercent >= 80);
  if (longFullTime) indicators.push({ id: 'duration', label: 'A year or more at or near full time with one client', evidence: months + ' months' });
  const net = indicators.length - Math.min(mitigations.length, 2);
  let risk = 'unknown';
  if (indicators.length >= 3 && net >= 2) risk = 'high';
  else if (indicators.length >= 1) risk = 'elevated';
  else if (mitigations.length >= 1) risk = 'low';
  return { risk, indicators, mitigations };
}
