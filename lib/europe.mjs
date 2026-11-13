/**
 * lib/europe.mjs — country facts the Europe track reads (job-engine tracks).
 *
 * One table, no I/O. Each row is a country a Europe-based candidate plausibly
 * targets, with the names a posting uses for it (English, local, ISO code),
 * its blocs and its pay conventions. Everything here is a convention to
 * check against the posting, never a statement about one employer.
 *
 *   payPeriods      how many monthly salaries a "monthly" figure is usually
 *                   multiplied by to reach the annual gross (13th/14th salary)
 *   minLeaveDays    statutory minimum paid leave for a 5-day week, excluding
 *                   public holidays unless noted
 */

/** @typedef {{ iso: string, name: string, aliases: string[], eu: boolean, eea: boolean, schengen: boolean, groups: string[], currency: string, payPeriods: number, payNote: string, minLeaveDays: number }} EuropeCountry */

/** @type {EuropeCountry[]} */
export const EUROPE_COUNTRIES = [
  { iso: 'DE', name: 'Germany', aliases: ['deutschland', 'bundesweit', 'allemagne', 'alemania'], eu: true, eea: true, schengen: true, groups: ['dach'], currency: 'EUR', payPeriods: 12, payNote: 'Quoted as annual gross (Jahresbrutto). A 13th salary exists only where a contract or collective agreement grants it.', minLeaveDays: 20 },
  { iso: 'AT', name: 'Austria', aliases: ['österreich', 'oesterreich', 'osterreich', 'autriche'], eu: true, eea: true, schengen: true, groups: ['dach'], currency: 'EUR', payPeriods: 14, payNote: 'Monthly gross is paid 14 times a year; postings must state the collective-agreement minimum.', minLeaveDays: 25 },
  { iso: 'CH', name: 'Switzerland', aliases: ['schweiz', 'suisse', 'svizzera', 'swiss'], eu: false, eea: false, schengen: true, groups: ['dach', 'efta'], currency: 'CHF', payPeriods: 13, payNote: 'Annual gross in CHF, commonly paid in 13 instalments. Compare after cost of living and mandatory health insurance, which the employer does not pay.', minLeaveDays: 20 },
  { iso: 'NL', name: 'Netherlands', aliases: ['the netherlands', 'nederland', 'holland', 'niederlande', 'pays-bas'], eu: true, eea: true, schengen: true, groups: ['benelux'], currency: 'EUR', payPeriods: 12, payNote: 'Monthly gross times 12 plus the 8% holiday allowance; check whether a quoted annual figure includes it.', minLeaveDays: 20 },
  { iso: 'BE', name: 'Belgium', aliases: ['belgië', 'belgie', 'belgique', 'belgien'], eu: true, eea: true, schengen: true, groups: ['benelux'], currency: 'EUR', payPeriods: 13.92, payNote: 'Monthly gross times about 13.92 (13th month plus double holiday pay); meal vouchers and a company car often replace base pay.', minLeaveDays: 20 },
  { iso: 'LU', name: 'Luxembourg', aliases: ['luxemburg'], eu: true, eea: true, schengen: true, groups: ['benelux'], currency: 'EUR', payPeriods: 12, payNote: 'Annual gross; a 13th month is common but contractual.', minLeaveDays: 26 },
  { iso: 'FR', name: 'France', aliases: ['frankreich', 'francia'], eu: true, eea: true, schengen: true, groups: [], currency: 'EUR', payPeriods: 12, payNote: 'Annual gross (brut annuel), sometimes over 13 months; RTT days and profit sharing sit outside the base figure.', minLeaveDays: 25 },
  { iso: 'ES', name: 'Spain', aliases: ['españa', 'espana', 'spanien', 'espagne'], eu: true, eea: true, schengen: true, groups: ['iberia'], currency: 'EUR', payPeriods: 14, payNote: 'Annual gross (bruto anual), paid in 12 or 14 instalments; the annual figure is the comparable one.', minLeaveDays: 22 },
  { iso: 'PT', name: 'Portugal', aliases: [], eu: true, eea: true, schengen: true, groups: ['iberia'], currency: 'EUR', payPeriods: 14, payNote: 'Monthly gross is paid 14 times a year; meal allowance is usually on top.', minLeaveDays: 22 },
  { iso: 'IT', name: 'Italy', aliases: ['italia', 'italien', 'italie'], eu: true, eea: true, schengen: true, groups: [], currency: 'EUR', payPeriods: 13, payNote: 'Annual gross (RAL) over 13 or 14 instalments depending on the collective agreement.', minLeaveDays: 20 },
  { iso: 'IE', name: 'Ireland', aliases: ['irland', 'éire'], eu: true, eea: true, schengen: false, groups: [], currency: 'EUR', payPeriods: 12, payNote: 'Annual gross; pension contribution and equity vary widely.', minLeaveDays: 20 },
  { iso: 'GB', name: 'United Kingdom', aliases: ['uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland', 'vereinigtes königreich', 'großbritannien', 'grossbritannien'], eu: false, eea: false, schengen: false, groups: [], currency: 'GBP', payPeriods: 12, payNote: 'Annual gross in GBP; the statutory 28 days of leave include bank holidays. Contracts are quoted inside or outside IR35.', minLeaveDays: 28 },
  { iso: 'SE', name: 'Sweden', aliases: ['sverige', 'schweden'], eu: true, eea: true, schengen: true, groups: ['nordics'], currency: 'SEK', payPeriods: 12, payNote: 'Quoted as monthly gross in SEK; multiply by 12.', minLeaveDays: 25 },
  { iso: 'DK', name: 'Denmark', aliases: ['danmark', 'dänemark', 'daenemark'], eu: true, eea: true, schengen: true, groups: ['nordics'], currency: 'DKK', payPeriods: 12, payNote: 'Quoted as monthly gross in DKK; pension is usually an employer contribution on top.', minLeaveDays: 25 },
  { iso: 'NO', name: 'Norway', aliases: ['norge', 'norwegen'], eu: false, eea: true, schengen: true, groups: ['nordics', 'efta'], currency: 'NOK', payPeriods: 12, payNote: 'Annual gross in NOK.', minLeaveDays: 21 },
  { iso: 'FI', name: 'Finland', aliases: ['suomi', 'finnland'], eu: true, eea: true, schengen: true, groups: ['nordics'], currency: 'EUR', payPeriods: 12.5, payNote: 'Monthly gross times 12 plus a holiday bonus of about half a month where the collective agreement grants it.', minLeaveDays: 24 },
  { iso: 'PL', name: 'Poland', aliases: ['polska', 'polen'], eu: true, eea: true, schengen: true, groups: ['cee'], currency: 'PLN', payPeriods: 12, payNote: 'Quoted monthly in PLN, and separately for an employment contract (UoP, gross) and B2B (net of VAT invoice); the two are not comparable one to one.', minLeaveDays: 20 },
  { iso: 'CZ', name: 'Czechia', aliases: ['czech republic', 'česko', 'cesko', 'tschechien'], eu: true, eea: true, schengen: true, groups: ['cee'], currency: 'CZK', payPeriods: 12, payNote: 'Quoted as monthly gross in CZK.', minLeaveDays: 20 },
  { iso: 'RO', name: 'Romania', aliases: ['românia', 'rumänien'], eu: true, eea: true, schengen: true, groups: ['cee'], currency: 'RON', payPeriods: 12, payNote: 'Often quoted as monthly net; ask which.', minLeaveDays: 20 },
  { iso: 'HU', name: 'Hungary', aliases: ['magyarország', 'ungarn'], eu: true, eea: true, schengen: true, groups: ['cee'], currency: 'HUF', payPeriods: 12, payNote: 'Quoted as monthly gross in HUF.', minLeaveDays: 20 },
  { iso: 'GR', name: 'Greece', aliases: ['griechenland', 'hellas'], eu: true, eea: true, schengen: true, groups: [], currency: 'EUR', payPeriods: 14, payNote: 'Monthly gross is paid 14 times a year in the private sector.', minLeaveDays: 20 },
  { iso: 'EE', name: 'Estonia', aliases: ['eesti', 'estland'], eu: true, eea: true, schengen: true, groups: ['baltics'], currency: 'EUR', payPeriods: 12, payNote: 'Quoted as monthly gross.', minLeaveDays: 20 },
  { iso: 'LV', name: 'Latvia', aliases: ['latvija', 'lettland'], eu: true, eea: true, schengen: true, groups: ['baltics'], currency: 'EUR', payPeriods: 12, payNote: 'Quoted as monthly gross.', minLeaveDays: 20 },
  { iso: 'LT', name: 'Lithuania', aliases: ['lietuva', 'litauen'], eu: true, eea: true, schengen: true, groups: ['baltics'], currency: 'EUR', payPeriods: 12, payNote: 'Quoted as monthly gross.', minLeaveDays: 20 },
];

const BY_KEY = new Map();
for (const c of EUROPE_COUNTRIES) {
  BY_KEY.set(c.name.toLowerCase(), c);
  for (const a of c.aliases) BY_KEY.set(a.toLowerCase(), c);
}
const BY_ISO = new Map(EUROPE_COUNTRIES.map(c => [c.iso, c]));

/**
 * Resolve a country a user or a posting names. Names and aliases match in any
 * case; a two-letter ISO code matches only in upper case, so prose words such
 * as "it", "no", "be" and "at" are never countries. "UK" is accepted for GB.
 * @param {unknown} value
 * @returns {EuropeCountry | null}
 */
export function europeCountry(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (/^[A-Z]{2}$/.test(text)) return BY_ISO.get(text === 'UK' ? 'GB' : text) || null;
  return BY_KEY.get(text.toLowerCase()) || null;
}

/** Every name and alias, longest first, for building a matcher. */
export function europeCountryNames() {
  return [...BY_KEY.keys()].sort((a, b) => b.length - a.length);
}

/**
 * Countries where a person with this status may take a job without a new
 * permit. A convention summary, not legal advice: Switzerland admits EU/EFTA
 * citizens under the free-movement agreement (a permit is issued, not
 * sponsored), and the UK has required a visa from EU citizens since 2021.
 *
 * @param {'eu_citizen' | 'blue_card' | 'residence_permit' | 'uk_citizen' | 'needs_sponsorship'} status
 * @param {string} baseIso  ISO code of the country of residence
 * @returns {Set<string>} ISO codes
 */
export function authorizedCountries(status, baseIso) {
  if (status === 'eu_citizen') {
    return new Set(EUROPE_COUNTRIES.filter(c => c.eu || c.eea || c.iso === 'CH').map(c => c.iso));
  }
  if (status === 'uk_citizen') return new Set(['GB', 'IE']);
  if (status === 'blue_card' || status === 'residence_permit') return new Set(baseIso ? [baseIso] : []);
  return new Set();
}
