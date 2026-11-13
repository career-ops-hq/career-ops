/**
 * lib/remote-fit.mjs — where a posting lets you work from, against where you
 * are (job-engine tracks: remote).
 *
 * "Remote" on a posting says how the work is done, not who may do it. A role
 * tagged "Remote (US only)", or one that wants Pacific business hours, is not
 * open to someone living in Europe, and a title filter cannot see that. This
 * module reads the title, the location field and the description and returns
 * one verdict:
 *
 *   match     remote, and the stated scope covers your region (or the role is
 *             hybrid/on-site somewhere you said you accept)
 *   partial   workable with a compromise the user should see (hybrid when the
 *             preference is remote-first, a thin time-zone overlap)
 *   mismatch  a stated restriction rules you out: another region only, a
 *             required far time zone, on-site when you want remote
 *   unknown   the posting does not say; never guessed into a mismatch
 *
 * Deterministic and offline. It is a conservative reader of common wording,
 * not an interpreter of every sentence: an unrecognised restriction comes
 * back as unknown, and the evaluation mode reads the posting itself.
 */

import { EUROPE_COUNTRIES, europeCountry, europeCountryNames } from './europe.mjs';

export const REMOTE_PREFERENCES = ['remote_only', 'remote_first', 'hybrid_ok', 'any'];

const MAX_TEXT = 40000;
const WORKDAY_HOURS = 9;

const escapeRe = s => s.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
const NOT_LETTER_BEFORE = '(?<![\\p{L}])';
const NOT_LETTER_AFTER = '(?![\\p{L}])';
const COUNTRY_RE = new RegExp(NOT_LETTER_BEFORE + '(' + europeCountryNames().map(escapeRe).join('|') + ')' + NOT_LETTER_AFTER, 'giu');
const ISO_IN_LOCATION_RE = new RegExp('(?:^|[,(/|\\-–]\\s*)(' + EUROPE_COUNTRIES.map(c => c.iso).join('|') + '|UK)(?=\\s*(?:$|[),/|]))', 'g');

// Regions a posting scopes remote work to. Upper-case abbreviations are
// matched case-sensitively so "us", "eu" inside prose never count.
const REGION_PATTERNS = [
  ['worldwide', /\b(world[- ]?wide|globally|global remote|remote global|work from anywhere|anywhere in the world|any ?where(?!\s+in\b)|weltweit|location[- ]independent|any location|all countries)\b/gi],
  ['worldwide', /\bGlobal\b|\bWorldwide\b/g],
  ['emea', /\bEMEA\b/g],
  ['europe', /(?<![\p{L}])(europe(?:an)?|europa|europaweit|eu[- ]wide|european union|european economic area)(?![\p{L}])/giu],
  ['europe', /\b(EU|EEA|EWR)\b/g],
  ['dach', /\bDACH\b|\bD-A-CH\b/g],
  ['nordics', /\b(nordics?|scandinavia)\b/gi],
  ['benelux', /\bbenelux\b/gi],
  ['us', /\b(united states(?: of america)?|u\.s\.a\.?|u\.s\.|usa|stateside)(?![\p{L}])/gi],
  ['us', /\bUS\b(?!\s?\$|D\b)/g],
  ['canada', /\bcanad(?:a|ian)\b/gi],
  ['north_america', /\b(north america|NORAM|NAMER)\b/gi],
  ['americas', /\b(the americas|AMER)\b/g],
  ['latam', /\b(latam|latin america|south america)\b/gi],
  ['apac', /\b(APAC|asia[- ]pacific|southeast asia)\b/gi],
  ['mena', /\b(MENA|middle east)\b/gi],
  ['africa', /\bafrica\b/gi],
  ['other', /\b(india|australia|new zealand|brazil|mexico|japan|singapore|israel|philippines|argentina|colombia|south africa|nigeria|china|turkey|ukraine|serbia|uae|united arab emirates|pakistan|vietnam|indonesia|south korea|egypt|kenya)\b/gi],
];

// DE and MT are left out: after a comma they are Germany and Malta far more
// often than Delaware and Montana for the people this track serves.
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_PLACE_RE = new RegExp(',\\s*(?:' + US_STATES + ')\\b|\\b(San Francisco|New York|NYC|Seattle|Austin|Boston|Chicago|Los Angeles|Denver|Atlanta|Bay Area|Silicon Valley|Palo Alto|Mountain View|Washington,? D\\.?C\\.?)\\b', 'g');

const REMOTE_WORD = 'remote(?:ly)?|home[- ]?office|work(?:ing)? from home|wfh|telework\\w*|télétravail|teletrabajo|remoto|mobiles? arbeiten|ortsunabhängig';
const REMOTE_WORD_RE = new RegExp(REMOTE_WORD, 'i');
const HEADER_REMOTE_RE = new RegExp(NOT_LETTER_BEFORE + '(' + REMOTE_WORD + '|distributed|anywhere)' + NOT_LETTER_AFTER, 'iu');
const HEADER_HYBRID_RE = /(?<![\p{L}])(hybrid\w*|hybride|h[ií]brido)(?![\p{L}])/iu;
const HEADER_ONSITE_RE = /(?<![\p{L}])(on-?site|in[- ]office|in[- ]person|office[- ]based|vor ort|präsenz\w*|présentiel|presencial)(?![\p{L}])/iu;

const BODY_NO_REMOTE_RE = /\b(no remote|not (?:a )?remote|non[- ]remote|remote (?:work )?is not (?:possible|available|an option)|kein(?:e)? (?:remote|home[- ]?office)|remote nicht möglich|this (?:role|position) is (?:fully |100% )?(?:on-?site|in[- ]office|office[- ]based)|(?:fully|100 ?%|five days|5 days)[^.\n]{0,20}(?:on-?site|in (?:the |our )?office)|100 ?% vor ort)\b/i;
const BODY_HYBRID_RE = /\bhybrid(?:e|es|er)?[- ](?:work\w*|role|position|model\w*|set-?up|schedule|arrangement|policy|remote|arbeit\w*|team)\b|\bhybrid\b[^.\n]{0,40}\b(?:office|days?|week|on-?site|vor ort|büro|tage?)\b|\b(?:office|büro|on-?site)\b[^.\n]{0,40}\bhybrid\b|\b\d\s*(?:(?:-|–|to|bis)\s*\d\s*)?(?:days?|tage?|x)\s*(?:per|a|pro|\/|in der|each)?\s*(?:week|woche|month|monat)[^.\n]{0,30}(?:in (?:the |our )?office|on-?site|im büro|vor ort)|\b(?:in (?:the |our )?office|on-?site|im büro|vor ort)[^.\n]{0,30}\b\d\s*(?:(?:-|–|to|bis)\s*\d\s*)?(?:days?|tage?|x)\s*(?:per|a|pro|\/|in der|each)?\s*(?:week|woche|month|monat)/i;
const BODY_REMOTE_RE = /\b(?:fully|100 ?%|completely|entirely|permanent(?:ly)?)[- ]remote\b|\bremote[- ](?:first|only|friendly)\b|\bremote (?:position|role|job|work|working|opportunity|team|company|contract|möglich|within|in|from|across|anywhere)\b|\bwork(?:ing)? remotely\b|\bwork(?:ing)? from (?:home|anywhere)\b|\b(?:this is a|we are a|we're a) (?:fully )?(?:remote|distributed)\b|\b100 ?% (?:home[- ]?office|remote)\b|\bremote\s*[(:\-–]|\b(?:orts|standort)unabhängig\w*|\b(?:location|work location|standort|arbeitsort|einsatzort|ort)\s*:\s*(?:100 ?% |fully )?remote\b/i;
const BODY_PRESENCE_DAYS_RE = /\bpräsenztage?n?\b/i;
const BODY_ONSITE_RE = /\b(on-?site (?:role|position|presence|work)|office[- ]based|in[- ]person (?:role|position)|präsenzpflicht|presence in (?:the|our) office is required)\b/i;

const ONSITE_DAYS_RE = /\b(\d)\s*(?:(?:-|–|to|bis)\s*(\d)\s*)?(?:days?|tage?|x)\s*(?:per|a|pro|\/|in der|each)?\s*(week|woche|month|monat)\b/i;

// A sentence that restricts who may hold the role, rather than describing the
// company. "Our HQ is in the US" names a region and restricts nobody.
const OBLIGATION_RE = /\b(must|need(?:s)? to|require[sd]?|requirement|have to|has to|should|only|exclusively|strictly|you are|you're|you will be|you'll be|candidates?|applicants?|open to|eligible|eligibility|we (?:can |are able to )?(?:only )?hir(?:e|ing)|available (?:only )?(?:in|to)|limited to|restricted to|wohnsitz|ansässig|bewerber\w*)\b/i;
const PLACE_VERB_RE = /\b(based|located|locat(?:ion|ed)|resid\w+|live|living|domiciled|work(?:ing)? from|authori[sz]ed to work|right to work|legally (?:authori[sz]ed|entitled|able)|hir(?:e|ing) in|within|wohnsitz|ansässig)\b/i;
const EXCLUSION_RE = /\b(cannot|can't|can ?not|unable to|not able to|do not|don't|does not|doesn't|won't|will not|not currently|no longer|excluding|except|other than|outside(?: of)?)\b/i;
const EXCLUSION_OBJECT_RE = /\b(hir\w+|employ\w*|support\w*|accept\w*|consider\w*|excluding|except|outside)\b/i;
const ONLY_RE = /\b(only|exclusively|strictly)\b/i;

const WORD_ZONES = [
  ['PT', -8, /\b(pacific(?: standard| daylight)? time|pacific time ?zone|pacific hours|west coast hours)\b/i],
  ['MT', -7, /\bmountain(?: standard| daylight)? time\b/i],
  ['CT', -6, /\bcentral(?: standard| daylight)? time\b/i],
  ['ET', -5, /\b(eastern(?: standard| daylight)? time|eastern time ?zone|east coast hours|new york (?:time|hours))\b/i],
  ['US', -6, /\b(?:US|U\.S\.|North American|American)[- ](?:time ?zones?|business hours|working hours|work hours|hours|timezones?)\b/],
  ['US', -6, /\b(?:time ?zones?|business hours|working hours)\s+(?:in|of|within)\s+(?:the\s+)?(?:US|U\.S\.|United States|North America|Americas)\b/],
  ['CET', 1, /\b(central european(?: summer)? time|european (?:time ?zones?|business hours|working hours|hours)|EU (?:time ?zones?|business hours|hours)|europe(?:an)? time|mitteleuropäische zeit)\b/i],
  ['UK', 0, /\b(UK (?:hours|time|business hours|working hours)|london (?:time|hours)|greenwich mean time)\b/i],
  ['IST', 5.5, /\bindia(?:n)? standard time\b/i],
  ['SGT', 8, /\bsingapore (?:time|hours)\b/i],
  ['AEST', 10, /\baustralian eastern(?: standard)? time\b/i],
];
const ABBR_ZONES = [
  ['PT', -8, /\b(PST|PDT)\b/], ['MT', -7, /\b(MST|MDT)\b/], ['CT', -6, /\b(CST|CDT)\b/], ['ET', -5, /\b(EST|EDT)\b/],
  ['CET', 1, /\b(CET|CEST|MEZ|MESZ)\b/], ['UK', 0, /\b(GMT|BST|WET)\b(?!\s*[+\-−]\s*\d)/], ['EET', 2, /\bEET\b/],
  ['IST', 5.5, /\bIST\b/], ['SGT', 8, /\bSGT\b/], ['JST', 9, /\bJST\b/], ['AEST', 10, /\b(AEST|AEDT)\b/],
];
// Two-letter US zones collide with Portugal, part-time, Montana and plain
// words, so they count only beside a clock time or a zone noun.
const SHORT_ZONE_RE = /(?:\d\s*(?:am|pm|a\.m\.|p\.m\.)|\d:\d\d)\s*\(?(ET|PT|CT|MT)\b|\b(ET|PT|CT|MT)\s+(?:time ?zone|hours|business hours|working hours)\b/;
const SHORT_OFFSETS = { ET: -5, CT: -6, MT: -7, PT: -8 };
const UTC_OFFSET_RE = /\b(?:UTC|GMT)\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?/g;
const ZONE_CUE_RE = /\b(work(?:ing|s)?|available|availability|overlap\w*|hours|schedule|shift|based|located|operat\w+|align\w*|within|cover(?:age|ing)?|core hours|time ?zones?|must|required?|between)\b/i;
const OVERLAP_RE = /\b(?:at least |minimum (?:of )?|min\.? )?(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?(?:hours?|hrs?|h)\s+(?:of\s+)?(?:daily\s+|working[- ]hours?\s+|time ?zone\s+)?overlap|\boverlap(?:ping)?\s+(?:of\s+)?(?:at least\s+)?(\d{1,2})\s*\+?\s*(?:hours?|hrs?|h)\b/i;

/** Standard-time UTC offset in hours for an IANA zone, an abbreviation or a number; null when unknown. */
export function utcOffsetHours(timeZone) {
  if (typeof timeZone === 'number' && Number.isFinite(timeZone)) return timeZone;
  if (typeof timeZone !== 'string' || !timeZone.trim()) return null;
  const text = timeZone.trim();
  const direct = text.match(/^(?:UTC|GMT)?\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?$/i);
  if (direct) return (direct[1] === '+' ? 1 : -1) * (Number(direct[2]) + Number(direct[3] || 0) / 60);
  const abbr = ABBR_ZONES.find(([, , re]) => re.test(text.toUpperCase()));
  if (abbr) return abbr[1];
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: text, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(Date.UTC(2026, 0, 15, 12))).find(p => p.type === 'timeZoneName');
    const m = part && part.value.match(/GMT(?:([+\-−])(\d{1,2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return m[1] ? (m[1] === '+' ? 1 : -1) * (Number(m[2]) + Number(m[3] || 0) / 60) : 0;
  } catch {
    return null;
  }
}

function sentences(text) {
  // "U.S. Pacific time" is one phrase, not a sentence end.
  return text.slice(0, MAX_TEXT).replace(/\bU\.S\.(?:A\.)?/g, 'US').replace(/\bU\.K\./g, 'UK').split(/(?<=[.!?])\s+|\n+|[•;]/).map(s => s.trim()).filter(Boolean);
}

const clip = s => (s.length > 160 ? s.slice(0, 157) + '...' : s);

/**
 * Every region or country a piece of text names. With isoCodes, ISO country
 * codes and US "City, ST" forms count too: right for a location field, wrong
 * for prose.
 * @returns {Array<{ id: string, index: number, raw: string }>}
 */
export function findRegions(text, { isoCodes = false } = {}) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  for (const [id, re] of REGION_PATTERNS) {
    for (const m of text.matchAll(re)) out.push({ id: id === 'other' ? 'other:' + m[0].toLowerCase() : id, index: m.index, raw: m[0] });
  }
  for (const m of text.matchAll(COUNTRY_RE)) {
    const c = europeCountry(m[1]);
    if (c) out.push({ id: c.iso, index: m.index, raw: m[0] });
  }
  if (isoCodes) {
    for (const m of text.matchAll(ISO_IN_LOCATION_RE)) {
      const c = europeCountry(m[1]);
      if (c) out.push({ id: c.iso, index: m.index, raw: m[1] });
    }
    for (const m of text.matchAll(US_PLACE_RE)) out.push({ id: 'us', index: m.index, raw: m[0].replace(/^,\s*/, '') });
  }
  return out;
}

function homeCoverage(home) {
  const country = europeCountry(home.country);
  const covered = new Set(['worldwide']);
  const accepted = new Set();
  if (country) {
    covered.add('europe').add('emea').add(country.iso);
    for (const g of country.groups) covered.add(g);
    accepted.add(country.iso);
  } else if (home.region === 'europe') {
    covered.add('europe').add('emea');
  }
  for (const name of home.acceptCountries || []) {
    const c = europeCountry(name);
    if (c) { covered.add(c.iso); accepted.add(c.iso); }
  }
  return { covered, accepted, anyCountry: home.acceptAnyCountry === true };
}

// "Remote 60%", "40% onsite": a stated share under 100% is hybrid work, whatever
// word it is attached to.
const PARTIAL_SHARE_RE = /(?:remote|home[- ]?office|onsite|on-site|vor ort)\s*[(:]?\s*(\d{1,3})\s*%|(\d{1,3})\s*%\s*(?:remote|home[- ]?office|onsite|on-site|vor ort)/i;

function detectArrangement(header, body) {
  const bodyHybrid = BODY_HYBRID_RE.exec(body);
  const bodyNoRemote = BODY_NO_REMOTE_RE.exec(body);
  if (HEADER_HYBRID_RE.test(header)) return { arrangement: 'hybrid' };
  const share = PARTIAL_SHARE_RE.exec(header);
  if (share) {
    const percent = Number(share[1] ?? share[2]);
    if (percent > 0 && percent < 100) return { arrangement: 'hybrid' };
  }
  if (HEADER_REMOTE_RE.test(header)) {
    if (bodyNoRemote) return { arrangement: 'onsite', geoMismatch: bodyNoRemote[0] };
    if (bodyHybrid) return { arrangement: 'hybrid', geoMismatch: bodyHybrid[0] };
    return { arrangement: 'remote' };
  }
  if (HEADER_ONSITE_RE.test(header)) return { arrangement: 'onsite' };
  if (bodyNoRemote) return { arrangement: 'onsite' };
  if (bodyHybrid || BODY_PRESENCE_DAYS_RE.test(body)) return { arrangement: 'hybrid' };
  if (BODY_REMOTE_RE.test(body)) return { arrangement: 'remote' };
  if (BODY_ONSITE_RE.test(body)) return { arrangement: 'onsite' };
  return { arrangement: 'unspecified' };
}

function onsiteDaysPerMonth(body) {
  for (const s of sentences(body)) {
    if (!/office|on-?site|büro|vor ort|in[- ]person/i.test(s)) continue;
    const m = s.match(ONSITE_DAYS_RE);
    if (!m) continue;
    const days = Number(m[2] || m[1]);
    return /week|woche/i.test(m[3]) ? Math.round(days * 4.33) : days;
  }
  return null;
}

function readScope(title, location, body) {
  const regions = new Set();
  const excluded = new Set();
  const evidence = [];
  let exclusive = false;
  const add = (hits, text, strict) => {
    if (!hits.length) return;
    for (const h of hits) regions.add(h.id);
    if (strict) exclusive = true;
    evidence.push(clip(text));
  };

  if (location) add(findRegions(location, { isoCodes: true }), location, ONLY_RE.test(location));
  if (title) {
    const bracketed = [...title.matchAll(/[(\[]([^)\]]{2,60})[)\]]/g)].map(m => m[1]);
    const tail = title.split(/\s[-–|]\s/).slice(1);
    for (const part of [...bracketed, ...tail]) add(findRegions(part, { isoCodes: true }), title, ONLY_RE.test(part));
  }
  for (const s of sentences(body)) {
    const hits = findRegions(s);
    if (!hits.length) continue;
    const remoteAt = s.search(REMOTE_WORD_RE);
    const nearRemote = remoteAt >= 0 && hits.some(h => Math.abs(h.index - remoteAt) <= 60);
    const obliges = OBLIGATION_RE.test(s) && PLACE_VERB_RE.test(s);
    const onlyClause = hits.some(h => new RegExp(escapeRe(h.raw) + '[- ]?(?:based\\s+)?(?:only|residents?|citizens? only)\\b|\\bonly\\b[^.\\n]{0,30}' + escapeRe(h.raw), 'i').test(s));
    const excludes = EXCLUSION_RE.test(s) && EXCLUSION_OBJECT_RE.test(s) && !onlyClause;
    if (!nearRemote && !obliges && !onlyClause && !excludes) continue;
    if (excludes) {
      for (const h of hits) excluded.add(h.id);
      evidence.push(clip(s));
      continue;
    }
    add(hits, s, onlyClause || obliges);
  }
  return { regions, excluded, evidence, exclusive };
}

const TZ_RANK = { ok: 0, partial: 1, mismatch: 2 };

function readTimeZones(body, homeOffset) {
  const zones = [];
  const evidence = [];
  let requiredOverlap = null;
  let worst = null;
  for (const s of sentences(body)) {
    const found = [];
    for (const [id, offset, re] of WORD_ZONES) if (re.test(s)) found.push({ id, offset });
    for (const [id, offset, re] of ABBR_ZONES) if (re.test(s)) found.push({ id, offset });
    const short = s.match(SHORT_ZONE_RE);
    if (short) { const id = short[1] || short[2]; found.push({ id, offset: SHORT_OFFSETS[id] }); }
    for (const m of s.matchAll(UTC_OFFSET_RE)) {
      const offset = (m[1] === '+' ? 1 : -1) * (Number(m[2]) + Number(m[3] || 0) / 60);
      found.push({ id: 'UTC' + (offset >= 0 ? '+' : '') + offset, offset });
    }
    if (!found.length || !ZONE_CUE_RE.test(s)) continue;
    for (const z of found) if (!zones.some(x => x.id === z.id)) zones.push(z);
    evidence.push(clip(s));
    const overlap = s.match(OVERLAP_RE);
    const need = overlap ? Number(overlap[1] || overlap[2]) : null;
    if (need !== null) requiredOverlap = Math.max(requiredOverlap ?? 0, need);
    if (homeOffset === null) continue;
    // A sentence naming several zones ("EST to CET", "UTC-5 through UTC+2")
    // describes a band: anyone inside it qualifies, and otherwise the
    // closest zone is the one that counts.
    const offsets = found.map(z => z.offset);
    const inside = offsets.length > 1 && homeOffset >= Math.min(...offsets) && homeOffset <= Math.max(...offsets);
    const available = inside ? WORKDAY_HOURS : Math.max(...offsets.map(o => Math.max(0, WORKDAY_HOURS - Math.abs(homeOffset - o))));
    const verdict = need !== null
      ? (need <= available ? 'ok' : need <= available + 2 ? 'partial' : 'mismatch')
      : (available >= 6 ? 'ok' : available >= 4 ? 'partial' : 'mismatch');
    if (!worst || TZ_RANK[verdict] > TZ_RANK[worst.verdict]) worst = { verdict, available };
  }
  return {
    zones,
    requiredOverlapHours: requiredOverlap,
    availableOverlapHours: worst ? worst.available : null,
    verdict: zones.length === 0 ? 'none' : homeOffset === null ? 'unknown' : worst.verdict,
    evidence,
  };
}

const describe = ids => [...new Set(ids)].map(id => (id.startsWith('other:') ? id.slice(6) : id)).join(', ');

/**
 * @param {{ title?: string, location?: string, description?: string }} posting
 * @param {{
 *   preference?: 'remote_only' | 'remote_first' | 'hybrid_ok' | 'any',
 *   country?: string,            // where the candidate lives
 *   region?: 'europe',           // fallback when the country is not in lib/europe.mjs
 *   acceptCountries?: string[],  // further countries a country-restricted remote or hybrid role may name
 *   acceptAnyCountry?: boolean,  // true: a hybrid or on-site role abroad is not a mismatch by place alone
 *   hybridCities?: string[],     // cities where hybrid or on-site is acceptable
 *   maxOnsiteDaysPerMonth?: number,
 *   timezone?: string | number,  // IANA name or UTC offset
 * }} [home]
 */
export function classifyRemoteFit(posting, home = {}) {
  const title = typeof posting?.title === 'string' ? posting.title : '';
  const location = typeof posting?.location === 'string' ? posting.location : '';
  const body = typeof posting?.description === 'string' ? posting.description : '';
  const preference = REMOTE_PREFERENCES.includes(home.preference) ? home.preference : 'remote_first';
  const { covered, accepted, anyCountry } = homeCoverage(home);
  const homeOffset = utcOffsetHours(home.timezone);

  const arr = detectArrangement(title + ' | ' + location, body);
  const scope = readScope(title, location, body);
  const tz = readTimeZones(body, homeOffset);
  const days = arr.arrangement === 'remote' ? null : onsiteDaysPerMonth(body);
  const reasons = [];

  const coveredHits = [...scope.regions].filter(id => covered.has(id));
  const homeExcluded = [...scope.excluded].some(id => accepted.has(id) || (id === 'europe' && covered.has('europe')));
  let region = 'unknown';
  if (homeExcluded) region = 'excludes';
  else if (coveredHits.length) region = 'covers';
  else if (scope.regions.size) region = 'excludes';

  const cities = (home.hybridCities || []).map(c => String(c).trim().toLowerCase()).filter(Boolean);
  const cityHit = cities.find(c => location.toLowerCase().includes(c) || title.toLowerCase().includes(c));
  const placeIds = findRegions(location + ' ' + title, { isoCodes: true }).map(h => h.id);
  const placeAccepted = placeIds.some(id => accepted.has(id));
  const placeElsewhere = placeIds.length > 0 && !placeAccepted && !anyCountry;

  let verdict;
  if (arr.arrangement === 'remote') {
    if (region === 'excludes') {
      verdict = 'mismatch';
      reasons.push(homeExcluded
        ? 'The posting excludes your country or region (' + describe(scope.excluded) + ').'
        : 'Remote, but scoped to ' + describe(scope.regions) + ', which does not include where you live.');
    } else if (region === 'covers') {
      verdict = 'match';
      reasons.push('Remote, and the stated scope covers you (' + describe(coveredHits) + ').');
    } else {
      verdict = 'unknown';
      reasons.push('Remote, but the posting names no country or region you can work from. Check before applying.');
    }
  } else if (arr.arrangement === 'hybrid' || arr.arrangement === 'onsite') {
    const label = arr.arrangement === 'hybrid' ? 'Hybrid' : 'On-site';
    if (preference === 'remote_only') {
      verdict = 'mismatch';
      reasons.push(label + ' role, and your preference is remote only.');
    } else if (placeElsewhere && !cityHit) {
      verdict = 'mismatch';
      reasons.push(label + ' in ' + describe(placeIds) + ', which is not a place you listed.');
    } else if (arr.arrangement === 'onsite') {
      if (preference === 'any' && (cityHit || placeAccepted || anyCountry)) {
        verdict = 'match';
        reasons.push('On-site in a place you accept.');
      } else if (preference === 'hybrid_ok' && cityHit) {
        verdict = 'partial';
        reasons.push('On-site in ' + cityHit + ', a city you listed; your preference is hybrid at most.');
      } else if (preference === 'any') {
        verdict = 'unknown';
        reasons.push('On-site; the posting names no place I can check against your list.');
      } else {
        verdict = 'mismatch';
        reasons.push('On-site role, and your preference is ' + preference.replace('_', ' ') + '.');
      }
    } else {
      const tooManyDays = days !== null && Number.isFinite(home.maxOnsiteDaysPerMonth) && days > home.maxOnsiteDaysPerMonth;
      if (tooManyDays) {
        verdict = preference === 'remote_first' ? 'mismatch' : 'partial';
        reasons.push('Hybrid with about ' + days + ' office days a month, above your limit of ' + home.maxOnsiteDaysPerMonth + '.');
      } else if (cityHit) {
        verdict = preference === 'remote_first' ? 'partial' : 'match';
        reasons.push('Hybrid in ' + cityHit + ', a city you listed.');
      } else if (preference === 'remote_first') {
        verdict = cities.length ? 'mismatch' : 'partial';
        reasons.push(cities.length ? 'Hybrid in a city you did not list.' : 'Hybrid role; your preference is remote first.');
      } else if (placeAccepted || (anyCountry && placeIds.length)) {
        verdict = 'partial';
        reasons.push('Hybrid in a country you accept, in a city you did not list. Check the commute or the move.');
      } else {
        verdict = 'unknown';
        reasons.push('Hybrid; the posting names no place I can check against your list.');
      }
    }
  } else if (region === 'excludes' && scope.exclusive) {
    verdict = 'mismatch';
    reasons.push('The posting restricts candidates to ' + describe(scope.regions) + '.');
  } else {
    verdict = 'unknown';
    reasons.push('The posting does not say whether the role is remote.');
  }

  const zoneNames = tz.zones.map(z => z.id).join('/');
  if (tz.verdict === 'mismatch') {
    verdict = 'mismatch';
    reasons.push('Requires working hours in ' + zoneNames + (tz.requiredOverlapHours
      ? ': ' + tz.requiredOverlapHours + ' h of overlap asked, about ' + tz.availableOverlapHours + ' h available from your time zone.'
      : ', which leaves about ' + tz.availableOverlapHours + ' h of a normal working day from your time zone.'));
  } else if (tz.verdict === 'partial') {
    if (verdict === 'match' || verdict === 'unknown') verdict = 'partial';
    reasons.push('Time-zone overlap with ' + zoneNames + ' is thin: about ' + tz.availableOverlapHours + ' h of a normal working day.');
  } else if (tz.verdict === 'ok' && verdict === 'unknown' && arr.arrangement === 'remote' && tz.zones.some(z => Math.abs(z.offset - homeOffset) <= 2)) {
    verdict = 'match';
    reasons.push('Remote, and the stated working hours (' + zoneNames + ') are in your time zone.');
  }

  if (arr.geoMismatch) reasons.push('The location field says remote, but the description says "' + arr.geoMismatch + '".');

  return {
    verdict,
    preference,
    arrangement: arr.arrangement,
    onsiteDaysPerMonth: days,
    geoMismatch: Boolean(arr.geoMismatch),
    scope: { regions: [...scope.regions], excluded: [...scope.excluded], exclusive: scope.exclusive, evidence: scope.evidence.slice(0, 5) },
    timezone: { zones: tz.zones, requiredOverlapHours: tz.requiredOverlapHours, availableOverlapHours: tz.availableOverlapHours, verdict: tz.verdict, evidence: tz.evidence.slice(0, 3) },
    reasons,
  };
}
