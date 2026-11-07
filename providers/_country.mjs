// @ts-check

// Shared ISO 3166-1 country-code → English-name lookup for providers whose
// payload carries a country only as a code. location_filter matches on the
// names users write ("United Kingdom", "Germany"), so a bare code never reaches
// it. Names come from Intl.DisplayNames (CLDR via Node's ICU), so a few differ
// from everyday spelling (CZ → "Czechia", TR → "Türkiye") and can shift between
// Node versions — tests should not pin those exact strings.

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Resolve a two-letter ISO country code to an English name. Returns '' for
 * anything that isn't a resolvable two-letter code.
 * @param {unknown} code
 */
export function countryName(code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return '';
  try {
    const name = regionNames.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : '';
  } catch {
    return '';
  }
}

// ISO 3166-1 alpha-3 → alpha-2. Intl.DisplayNames only accepts alpha-2, and
// some payloads (Gem's `isoCountry`: "USA", "GBR") carry alpha-3. Generated
// from the ISO 3166-1 list (249 assigned codes).
/** @type {Readonly<Record<string, string>>} */
const ALPHA3_TO_ALPHA2 = Object.freeze({
  ABW: 'AW', AFG: 'AF', AGO: 'AO', AIA: 'AI', ALA: 'AX', ALB: 'AL', AND: 'AD', ARE: 'AE',
  ARG: 'AR', ARM: 'AM', ASM: 'AS', ATA: 'AQ', ATF: 'TF', ATG: 'AG', AUS: 'AU', AUT: 'AT',
  AZE: 'AZ', BDI: 'BI', BEL: 'BE', BEN: 'BJ', BES: 'BQ', BFA: 'BF', BGD: 'BD', BGR: 'BG',
  BHR: 'BH', BHS: 'BS', BIH: 'BA', BLM: 'BL', BLR: 'BY', BLZ: 'BZ', BMU: 'BM', BOL: 'BO',
  BRA: 'BR', BRB: 'BB', BRN: 'BN', BTN: 'BT', BVT: 'BV', BWA: 'BW', CAF: 'CF', CAN: 'CA',
  CCK: 'CC', CHE: 'CH', CHL: 'CL', CHN: 'CN', CIV: 'CI', CMR: 'CM', COD: 'CD', COG: 'CG',
  COK: 'CK', COL: 'CO', COM: 'KM', CPV: 'CV', CRI: 'CR', CUB: 'CU', CUW: 'CW', CXR: 'CX',
  CYM: 'KY', CYP: 'CY', CZE: 'CZ', DEU: 'DE', DJI: 'DJ', DMA: 'DM', DNK: 'DK', DOM: 'DO',
  DZA: 'DZ', ECU: 'EC', EGY: 'EG', ERI: 'ER', ESH: 'EH', ESP: 'ES', EST: 'EE', ETH: 'ET',
  FIN: 'FI', FJI: 'FJ', FLK: 'FK', FRA: 'FR', FRO: 'FO', FSM: 'FM', GAB: 'GA', GBR: 'GB',
  GEO: 'GE', GGY: 'GG', GHA: 'GH', GIB: 'GI', GIN: 'GN', GLP: 'GP', GMB: 'GM', GNB: 'GW',
  GNQ: 'GQ', GRC: 'GR', GRD: 'GD', GRL: 'GL', GTM: 'GT', GUF: 'GF', GUM: 'GU', GUY: 'GY',
  HKG: 'HK', HMD: 'HM', HND: 'HN', HRV: 'HR', HTI: 'HT', HUN: 'HU', IDN: 'ID', IMN: 'IM',
  IND: 'IN', IOT: 'IO', IRL: 'IE', IRN: 'IR', IRQ: 'IQ', ISL: 'IS', ISR: 'IL', ITA: 'IT',
  JAM: 'JM', JEY: 'JE', JOR: 'JO', JPN: 'JP', KAZ: 'KZ', KEN: 'KE', KGZ: 'KG', KHM: 'KH',
  KIR: 'KI', KNA: 'KN', KOR: 'KR', KWT: 'KW', LAO: 'LA', LBN: 'LB', LBR: 'LR', LBY: 'LY',
  LCA: 'LC', LIE: 'LI', LKA: 'LK', LSO: 'LS', LTU: 'LT', LUX: 'LU', LVA: 'LV', MAC: 'MO',
  MAF: 'MF', MAR: 'MA', MCO: 'MC', MDA: 'MD', MDG: 'MG', MDV: 'MV', MEX: 'MX', MHL: 'MH',
  MKD: 'MK', MLI: 'ML', MLT: 'MT', MMR: 'MM', MNE: 'ME', MNG: 'MN', MNP: 'MP', MOZ: 'MZ',
  MRT: 'MR', MSR: 'MS', MTQ: 'MQ', MUS: 'MU', MWI: 'MW', MYS: 'MY', MYT: 'YT', NAM: 'NA',
  NCL: 'NC', NER: 'NE', NFK: 'NF', NGA: 'NG', NIC: 'NI', NIU: 'NU', NLD: 'NL', NOR: 'NO',
  NPL: 'NP', NRU: 'NR', NZL: 'NZ', OMN: 'OM', PAK: 'PK', PAN: 'PA', PCN: 'PN', PER: 'PE',
  PHL: 'PH', PLW: 'PW', PNG: 'PG', POL: 'PL', PRI: 'PR', PRK: 'KP', PRT: 'PT', PRY: 'PY',
  PSE: 'PS', PYF: 'PF', QAT: 'QA', REU: 'RE', ROU: 'RO', RUS: 'RU', RWA: 'RW', SAU: 'SA',
  SDN: 'SD', SEN: 'SN', SGP: 'SG', SGS: 'GS', SHN: 'SH', SJM: 'SJ', SLB: 'SB', SLE: 'SL',
  SLV: 'SV', SMR: 'SM', SOM: 'SO', SPM: 'PM', SRB: 'RS', SSD: 'SS', STP: 'ST', SUR: 'SR',
  SVK: 'SK', SVN: 'SI', SWE: 'SE', SWZ: 'SZ', SXM: 'SX', SYC: 'SC', SYR: 'SY', TCA: 'TC',
  TCD: 'TD', TGO: 'TG', THA: 'TH', TJK: 'TJ', TKL: 'TK', TKM: 'TM', TLS: 'TL', TON: 'TO',
  TTO: 'TT', TUN: 'TN', TUR: 'TR', TUV: 'TV', TWN: 'TW', TZA: 'TZ', UGA: 'UG', UKR: 'UA',
  UMI: 'UM', URY: 'UY', USA: 'US', UZB: 'UZ', VAT: 'VA', VCT: 'VC', VEN: 'VE', VGB: 'VG',
  VIR: 'VI', VNM: 'VN', VUT: 'VU', WLF: 'WF', WSM: 'WS', YEM: 'YE', ZAF: 'ZA', ZMB: 'ZM',
  ZWE: 'ZW',
});

/**
 * Resolve a two- or three-letter ISO 3166-1 country code to an English name.
 * Returns '' for anything else, including an unassigned code.
 * @param {unknown} code
 */
export function countryNameFromIso(code) {
  if (typeof code !== 'string') return '';
  const c = code.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return Object.hasOwn(ALPHA3_TO_ALPHA2, c) ? countryName(ALPHA3_TO_ALPHA2[c]) : '';
  return countryName(c);
}

/** Opt-in conditional workplace geography. Missing evidence stays out of Inbox.
 * This is a deterministic admission gate, not a claim that employment/visa or
 * working-hours eligibility has been verified. Country restrictions in provider
 * metadata and explicit eligibility clauses narrow broad remote-region labels.
 */

const fold = (v) => typeof v === 'string' ? v.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim() : '';
const list = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(fold) : [];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (s) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(s)}(?![\\p{L}\\p{N}])`, 'u');
const has = (text, values) => values.some(v => word(v).test(text));
const COUNTRY_NAMES = [];
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b), name = countryName(code);
  if (name && name !== 'Unknown Region' && !['EU', 'EZ', 'UN'].includes(code)) COUNTRY_NAMES.push({ code, name: fold(name), match: word(fold(name)) });
}
const COUNTRY_ALIASES = [
  ['US', 'usa'], ['US', 'u.s.'], ['US', 'u.s.a.'], ['US', 'united states of america'],
  ['GB', 'uk'], ['GB', 'u.k.'], ['GB', 'great britain'], ['GB', 'england'],
  ['ES', 'espana'], ['ES', 'esp'],
].map(([code, name]) => ({ code, name, match: word(name) }));
const PROSE_WORD_CODES = new Set(['in', 'as', 'at', 'be', 'is', 'it', 'no', 'so', 'to', 'do', 'me', 'my', 'am']);
const countries = (text, codes = false) => {
  const found = new Set([...COUNTRY_NAMES, ...COUNTRY_ALIASES].filter(c => c.match.test(text)).map(c => c.code));
  if (codes) for (const token of text.split(/[,;/|()\s-]+/)) {
    if (/^[a-z]{2,3}$/.test(token) && !PROSE_WORD_CODES.has(token)) {
      const name = fold(countryNameFromIso(token));
      const c = COUNTRY_NAMES.find(c => c.name === name);
      if (c) found.add(c.code);
    }
  }
  return found;
};
// Config country lists and structured applicant-country fields have an exact
// country token, unlike prose where "in", "it" or "no" are ordinary words.
// Resolve those tokens before applying the prose ambiguity guard.
const countryValue = value => fold(countryNameFromIso(value)) || value;

// CLDR also names subdivisions, aggregates and pseudo-regions. Limit this
// classifier to the existing assigned ISO countries/territories plus Kosovo
// (XK), without changing the workplace policy's shared country vocabulary.
const COUNTRY_KEYWORD_CODES = new Set([...Object.values(ALPHA3_TO_ALPHA2), 'XK']);

/** Exact country name, alias or ISO token in a config list, not a city or region.
 * @param {unknown} value
 */
export function isCountryKeyword(value) {
  const name = countryValue(fold(value));
  return COUNTRY_NAMES.some(country => COUNTRY_KEYWORD_CODES.has(country.code) && country.name === name)
    || COUNTRY_ALIASES.some(country => country.name === name);
}

const REMOTE = /\b(?:remote|work from (?:home|anywhere)|distributed)\b/;
// Mirror scan.mjs's titleSignalsRemote marker: "Remote Sensing" describes a
// discipline, not a work arrangement. The policy must not convert an office
// job outside onsite_locations into an eligible country-wide remote role.
const REMOTE_TITLE = /(?<![a-z])remote(?=$|\s*[^a-z\s]|\s+in\b)/;
const NOT_REMOTE = /\b(?:non|not|no)[^a-z]*remote\b/;
const OFFICE = /\b(?:hybrid|on[ -]?site|in[ -]?office|office[ -]?based)\b/;
const plain = (v) => fold(v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

function excludedHome(text, homes) {
  return homes.some(h => [
    `(?:excluding|except|excludes|not(?: available| eligible| supported| open)?(?: in| from)?|no candidates from)\\s+${escape(h)}(?![\\p{L}\\p{N}])`,
    `(?<![\\p{L}\\p{N}])${escape(h)}(?:[ -]based)?(?:\\s+(?:candidates|applicants|residents))?\\s+(?:(?:is|are)\\s+)?(?:excluded|not (?:eligible|supported|available|included))`,
  ].some(pattern => new RegExp(pattern, 'u').test(text)));
}

// Country-bearing structured eligibility is authoritative, unlike an office
// address mentioned somewhere in a description. Only known fields are read.
function requirementText(offer) {
  const flatten = (v) => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === 'object' ? ['name', 'country', 'addressCountry'].flatMap(k => flatten(v[k])) : [];
  return ['applicantLocationRequirements', 'eligibleCountries', 'allowedCountries', 'remoteCountries', 'hiringCountries', 'countriesAllowed'].flatMap(k => flatten(offer?.[k])).map(countryValue).join('; ');
}

/** Only provider geography evidence needed by the same gate after discovery. */
export function captureWorkplaceEvidence(offer) {
  const evidence = {};
  for (const key of ['description', 'workplaceType', 'workplace_type', 'workArrangement', 'isRemote', 'applicantLocationRequirements', 'eligibleCountries', 'allowedCountries', 'remoteCountries', 'hiringCountries', 'countriesAllowed']) {
    if (offer?.[key] !== undefined) evidence[key] = offer[key];
  }
  return evidence;
}

/** Existing malformed user config must not silently disable an admission gate.
 * The web's synchronous config copier mirrors this shape check behind a parity
 * test; scanner/policy execution always stays in the core.
 */
export function workplacePolicyFromConfig(config) {
  const mapping = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };
  if (!mapping(config)) throw new Error('portals.yml must contain a YAML mapping');
  if (config.location_filter === undefined) return undefined;
  if (!mapping(config.location_filter)) throw new Error('location_filter must be an object');
  const policy = config.location_filter.workplace_policy;
  if (policy !== undefined && !mapping(policy)) throw new Error('location_filter.workplace_policy must be an object');
  return policy;
}

export function buildWorkplacePolicy(policy) {
  if (policy === undefined) return () => ({ eligible: true, reason: 'policy_absent' });
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('location_filter.workplace_policy must be an object');
  for (const key of ['onsite_locations', 'onsite_countries', 'remote_countries', 'remote_regions']) {
    if (policy[key] != null && !Array.isArray(policy[key])) throw new Error(`workplace_policy.${key} must be a list`);
  }
  const onsite = list(policy.onsite_locations), home = list(policy.remote_countries), regions = list(policy.remote_regions);
  if (!onsite.length || !home.length) throw new Error('workplace_policy requires onsite_locations and remote_countries lists');
  const homeCodes = new Set(home.flatMap(v => [...countries(countryValue(v), true)]));
  if (!homeCodes.size) throw new Error('workplace_policy.remote_countries must name a country or ISO country code');
  const supportsHome = (text) => [...countries(text, true)].some(c => homeCodes.has(c));
  // Description prose uses names/aliases only: ordinary "us", "by" or "id"
  // must not become eligibility evidence. Structured fields still accept ISO.
  const supportsHomeProse = (text) => [...countries(text)].some(c => homeCodes.has(c));
  const timezoneCodes = ['et', 'pt', 'mt', 'ct', 'est', 'pst', 'cst', 'mst', 'edt', 'pdt', 'cdt', 'mdt', 'cet', 'cest', 'gmt', 'utc'];
  const timezoneNames = [...new Set([...regions, ...COUNTRY_NAMES.flatMap(c => [c.name, c.code.toLowerCase()]), ...COUNTRY_ALIASES.map(c => c.name), ...timezoneCodes])].sort((a, b) => b.length - a.length);
  const timezonePhrase = new RegExp(`(?<![\\p{L}\\p{N}])(?:${timezoneNames.map(escape).join('|')})(?:[- ]compatible)? (?:working hours|time[ -]?zones?|hours|overlap)\\b`, 'gu');
  const overlapPhrase = new RegExp(`\\b(?:overlap(?: (?:until|with))?|hours(?: (?:in|until))?) +(?:\\d{1,2}(?::\\d{2})? *(?:am|pm)? *)?(?:${timezoneCodes.join('|')})\\b`, 'gu');
  const geographyText = text => text.replace(timezonePhrase, ' ').replace(overlapPhrase, ' ');
  const geographyNames = [...new Set([...COUNTRY_NAMES, ...COUNTRY_ALIASES].map(c => c.name).concat(regions, onsite))].sort((a, b) => b.length - a.length);
  const geographyAtom = new RegExp(`^(?:the +)?(${geographyNames.map(escape).join('|')}|[a-z]{2,3})(?![\\p{L}\\p{N}])`, 'u');
  // Read the geography immediately attached to a worker-location phrase, plus
  // genuine country alternatives. Stop before unrelated duties/office mentions.
  const geographyTarget = (text, { allowAmbiguousCodes = true } = {}) => {
    let rest = geographyText(text).trim().replace(/^(?:(?:a|an|any) (?:eligible )?country (?:in|within) |(?:a|an|any) )/, '')
      .replace(/^(?:and )?around /, ''), region = false, local = false;
    const codes = new Set();
    while (rest) {
      const match = rest.match(geographyAtom);
      if (!match) break;
      const token = match[1], tail = rest.slice(match[0].length);
      // AND may be followed by a worker qualification in an explicit location
      // requirement. General "work in and with ..." prose is not that evidence.
      if (token === 'and' && !/^\s*(?:$|[,/]|(?:and|or|only)\b)/.test(tail)
        && !(allowAmbiguousCodes && /^\s+with\b/.test(tail))) break;
      const found = countries(countryValue(token), true);
      if (!found.size && !has(token, regions) && !has(token, onsite)) break;
      // "IT systems" is not Italy. A bounded geographic token such as
      // "based in IT" can resolve the same ISO code without admitting prose.
      if (PROSE_WORD_CODES.has(token) && (!allowAmbiguousCodes || (/^\s+[a-z]/.test(tail) && !/^\s+(?:only|and|or)\b/.test(tail)))) break;
      for (const code of found) codes.add(code);
      region ||= has(token, regions);
      local ||= has(token, onsite);
      const separator = tail.match(/^\s*(?:,|\/|\band\b|\bor\b)\s*/);
      if (!separator) break;
      rest = tail.slice(separator[0].length);
    }
    return { codes, region, local };
  };
  const explicitHomeGeography = text => [...geographyText(text).matchAll(/\b(based|located|reside|live|work remotely|work remote|remote work|remote role|work from home|work)\s+(?:in|from|within)\s+([^.!?;\n]+)/g)]
    .some(match => [...geographyTarget(match[2], { allowAmbiguousCodes: /^(?:based|located|reside|live)$/.test(match[1]) }).codes].some(c => homeCodes.has(c)));
  const supportsHomeGeography = text => supportsHomeProse(geographyText(text)) || explicitHomeGeography(text);
  // Only immediate, explicit geography qualifiers are grammar here. Do not
  // scan through considered/reviewed prose to discover a country elsewhere.
  const eligibilityTargetText = text => text.trim().replace(/^(?:(?:currently|only)\s+|(?:restricted|limited|open)\s+(?:only\s+)?to\s+|(?:allowed|permitted|available)\s+(?:only\s+)?(?:in|from)\s+)+/, '');
  // Preserve commas only within an explicit, country-only eligibility list.
  // Unknown tails and independent restrictions remain separate clauses.
  const completeCountryList = text => {
    let rest = text.trim();
    while (rest) {
      const match = rest.match(geographyAtom);
      if (!match || !countries(countryValue(match[1]), true).size) return false;
      const tail = rest.slice(match[0].length);
      if (!tail.trim()) return true;
      const separator = tail.match(/^\s*(?:,|\/|\band\b|\bor\b)\s*/);
      if (!separator) return false;
      rest = tail.slice(separator[0].length);
    }
    return false;
  };
  const descriptionClauses = text => text.split(/[.!?;\n]+|\s+(?:but|however)\s+/).flatMap(sentence => {
    const clauses = [];
    let eligibleList = false;
    for (const part of sentence.split(/,|\s+and\s+(?=(?:eligible (?:countries|locations) are\b|must\b|(?:candidates?|applicants?|residents?) (?:must|need to)\b))/)) {
      let continuation = part;
      if (eligibleList) {
        const coordinated = part.replace(/^\s*(?:and|or)\s+/, '');
        if (coordinated !== part && completeCountryList(coordinated)) continuation = coordinated;
      }
      if (eligibleList && completeCountryList(continuation)) clauses[clauses.length - 1] += ',' + continuation;
      else {
        clauses.push(part);
        const list = [...part.matchAll(/\beligible (?:countries|locations) are\s+/g)].at(-1);
        eligibleList = !!list && completeCountryList(eligibilityTargetText(part.slice(list.index + list[0].length)));
      }
    }
    return clauses;
  });
  const restricted = (text, codes = false) => {
    const found = countries(text, codes);
    return found.size > 0 && ![...found].some(c => homeCodes.has(c));
  };
  const onsiteCountries = list(policy.onsite_countries);
  const localCountries = onsiteCountries.length ? onsiteCountries : home;
  const localCodes = new Set(localCountries.flatMap(v => [...countries(countryValue(v), true)]));
  if (!localCodes.size) throw new Error('workplace_policy.onsite_countries must name a country or ISO country code');
  const homeAliases = [...home.map(countryValue), ...COUNTRY_NAMES.filter(c => homeCodes.has(c.code)).flatMap(c => PROSE_WORD_CODES.has(c.code.toLowerCase()) ? [c.name] : [c.name, c.code.toLowerCase()]), ...COUNTRY_ALIASES.filter(c => homeCodes.has(c.code)).map(c => c.name)];
  const foreignOnly = [...COUNTRY_NAMES, ...COUNTRY_ALIASES].filter(c => !homeCodes.has(c.code)).map(country => new RegExp(`(?<![\\p{L}\\p{N}])${escape(country.name)}(?:[ -]based)?(?:\\s+(?:candidates|applicants|residents))?\\s*[- ]?only\\b`, 'u'));
  return (location, title = '', offer = {}) => {
    if (offer.geographyEvidence && typeof offer.geographyEvidence === 'object' && !Array.isArray(offer.geographyEvidence)) offer = { ...offer, ...offer.geographyEvidence };
    const loc = fold(location), heading = fold(title), description = plain(offer.description);
    const meta = fold(requirementText(offer));
    const workplace = fold(offer.workplaceType || offer.workplace_type || offer.workArrangement);
    const all = `${loc}. ${heading}. ${meta}. ${description}`;
    const fail = reason => ({ eligible: false, reason });
    if (excludedHome(all, homeAliases)) return fail('candidate_country_excluded');
    // An explicitly exclusive foreign country cannot be rescued by a mention
    // of Spain elsewhere in the same field ("Spain / UK only").
    if (foreignOnly.some(pattern => pattern.test(all))) return fail('exclusive_foreign_country');
    if (meta && !supportsHome(meta) && (restricted(meta, true) || !has(meta, regions))) return fail('metadata_country_restricted');
    for (const sentence of description.split(/[.!?\n]+/)) {
      if (!/\bmust (?:be |currently )?(?:based|located|reside|live)\b/.test(sentence)) continue;
      for (const match of sentence.matchAll(/[,;]\s*([^,;]{1,60}?)\s+only\b/g)) {
        const narrower = match[1];
        const explicitCode = /^[a-z]{2,3}$/.test(narrower.trim()) && supportsHome(countryValue(narrower.trim())) && supportsHomeGeography(sentence);
        if (!supportsHomeProse(narrower) && !explicitCode && !has(narrower, regions) && !has(narrower, onsite)) return fail('description_locality_restricted');
      }
    }
    // Narrow eligibility clauses, not arbitrary country mentions. A company
    // describing its London office must not erase a worldwide-remote listing.
    for (const clause of descriptionClauses(description)) {
      if (/\b(?:hybrid|on[ -]?site|in[ -]?office|office[ -]?based) (?:role|position)(?: is)? (?:based |located )?in\b/.test(clause) && !has(clause, onsite)) return fail('description_onsite_restricted');
      if (!/\b(?:only|must (?:be |currently )?(?:based|located|reside|live)|(?:candidates?|applicants?|residents?) (?:must|need to)|restricted to|eligible (?:countries|locations)|hiring (?:only )?in|open (?:only )?to)\b/.test(clause)) continue;
      const targetCountries = new Set(), workerClause = geographyText(clause);
      for (const match of workerClause.matchAll(/\bmust (?:be |currently )?(?:based|located|reside|live) (?:in|within)\s+/g)) {
        const required = geographyTarget(workerClause.slice(match.index + match[0].length));
        if (required.codes.size && ![...required.codes].some(c => homeCodes.has(c))) return fail('description_country_restricted');
        if (!required.codes.size && !required.region && !required.local) return fail('description_location_restricted');
        for (const code of required.codes) targetCountries.add(code);
      }
      // Each explicit eligibility list is another restriction, not a union
      // with earlier worker-location alternatives in the same clause.
      for (const match of workerClause.matchAll(/\beligible (?:countries|locations) are\s+/g)) {
        const required = geographyTarget(eligibilityTargetText(workerClause.slice(match.index + match[0].length))).codes;
        if (!required.size) continue;
        if (![...required].some(c => homeCodes.has(c))) return fail('description_country_restricted');
        for (const code of required) targetCountries.add(code);
      }
      // An actual home-compatible target may mix ISO and country names. Only
      // those parsed alternatives qualify; foreign evidence elsewhere keeps
      // the existing generic veto, and every separate mandatory target is read.
      if (restricted(clause) && ![...countries(clause)].every(c => targetCountries.has(c))) return fail('description_country_restricted');
      if (/\bmust (?:be |currently )?(?:based|located|reside|live)(?: in| within)?\b/.test(clause)
        && !supportsHomeGeography(clause) && !has(clause, regions) && !has(clause, onsite)) return fail('description_location_restricted');
      // A mandatory commute elsewhere is also narrower than a remote tag.
      if (/\b(?:hybrid|on[ -]?site|in[ -]?office|office[ -]?based)\b/.test(clause) && !has(clause, onsite)) return fail('description_onsite_restricted');
    }
    const structuredOffice = OFFICE.test(loc) || OFFICE.test(workplace) || OFFICE.test(heading);
    const remote = !structuredOffice && !NOT_REMOTE.test(loc) && !NOT_REMOTE.test(heading)
      && (REMOTE.test(loc) || workplace === 'remote' || offer.isRemote === true || (!workplace && REMOTE_TITLE.test(heading)));
    if (!remote) {
      if (!has(loc, onsite)) return fail(loc ? 'onsite_outside_allowed_locations' : 'location_unknown');
      const found = countries(loc, true);
      if (found.size && ![...found].some(c => localCodes.has(c))) return fail('onsite_country_restricted');
      return { eligible: true, reason: 'onsite_location_allowed' };
    }
    // Explicit structured countries narrow a covering region. Europe + UK-only
    // never implies Spain. Multiple genuine eligible countries including Spain
    // are allowed. No timezone token is an eligibility signal.
    const geoLoc = geographyText(loc);
    const locationCountries = countries(geoLoc, true);
    if (locationCountries.size && ![...locationCountries].some(c => homeCodes.has(c))) return fail('remote_country_restricted');
    const remoteDescription = description.split(/[.!?;\n]+/).some(clause => /\b(?:work remotely|work remote|remote work|remote role|work from home|work from)\b/.test(clause) && supportsHomeGeography(clause));
    const conditionalRegion = description.split(/[.!?;\n]+/).some(clause => REMOTE.test(clause) && has(clause, regions)
      && /\bwhere (?:we|the company|the employer) (?:have|has) (?:a |an |our )?hiring presence\b/.test(clause));
    if (conditionalRegion && !supportsHome(geoLoc) && !supportsHome(meta) && !explicitHomeGeography(description)) return fail('remote_eligibility_unconfirmed');
    if (supportsHome(geoLoc) || has(geoLoc, regions) || (meta && (supportsHome(meta) || has(meta, regions))) || remoteDescription) return { eligible: true, reason: 'remote_region_allowed' };
    return fail(loc ? 'remote_eligibility_unconfirmed' : 'location_unknown');
  };
}
