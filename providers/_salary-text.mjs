// @ts-check
// Shared free-text salary parsing: one reading of an amount or range string
// ("80-90k", "$123,684—$254,644 USD", "45.000,00") for every caller that turns
// written compensation into numbers — salary-gap.mjs's observation log and the
// providers whose payload carries salary only as free text. Files prefixed
// with _ are never loaded as providers (see _registry.mjs).

/**
 * Rewrite a number's separators into a form parseFloat reads correctly.
 *
 * Both separators mean different things in different markets: Spain, Germany,
 * Italy, the Netherlands and Brazil group thousands with a period ("35.000" is
 * 35000) and write cents after a comma ("45.000,00" is 45000), the US and UK
 * the other way round. Which separator means what has to be decided BEFORE
 * either is touched — deleting every comma first turns "45.000,00" into
 * "45.00000", which reads as 45.
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
  // "45000,50").
  //
  // A three-place decimal ("1.250") stays ambiguous without knowing the
  // document's locale; reading it as grouped remains the safer default for a
  // salary field, in both directions.
  const sep = lastComma !== -1 ? ',' : lastDot !== -1 ? '.' : null;
  if (sep === null) return numStr;
  const grouped = new RegExp(`(\\d)\\${sep}(?=\\d{3}(?!\\d))`, 'g');
  return numStr.replace(grouped, '$1').replace(sep, '.');
}

const ISO_4217_CODES = new Set(Intl.supportedValuesOf('currency'));

/**
 * Whether a token is an ISO-4217 currency code, in any case ("USD", "eur").
 *
 * @param {unknown} token
 * @returns {boolean}
 */
export function isCurrencyCode(token) {
  return ISO_4217_CODES.has(String(token ?? '').toUpperCase());
}

/**
 * Parse a written amount or range into numbers. Annual suffixes and currency
 * tokens are stripped, never interpreted: the currency is the caller's to
 * read, and a non-annual period ("/hr", "per month") leaves the string
 * unparseable, so it returns null rather than a figure in the wrong unit.
 *
 * @param {unknown} raw
 * @returns {{min: number, max: number, mid: number} | null}
 */
export function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s || s === '?' || s === '-' || /^(n\/?a|null)$/i.test(s)) return null;
  // Decided on the whole string, before any label, bullet suffix or note is
  // cut away: "Monthly salary: 5,000 USD" and "5,000 USD • per month" lose
  // their period with the text around the number, and would read as annual.
  const period = compensationPeriod(s);
  if (period && period !== 'annual') return null;
  // Strings copied verbatim from a JD carry a leading label ("Annual Salary
  // Range: $165,000 - $190,000") and a trailing bullet suffix ("$204.4K -
  // $352K • Offers Equity"). Both are dropped before anything below reads the
  // number, so the separator logic only ever sees the amount itself. Only a
  // colon BEFORE the first digit is a label: one after it belongs to a note
  // ("$150,000 (note: negotiable)"), and cutting there would drop the amount.
  const firstDigit = s.search(/\d/);
  const labelColon = firstDigit === -1 ? -1 : s.lastIndexOf(':', firstDigit);
  if (labelColon !== -1) s = s.slice(labelColon + 1).trim();
  s = s.split('•')[0].trim();
  // A trailing parenthetical with no digits is a note ("(note: negotiable)",
  // "(Spain)"), never part of the figure.
  s = s.replace(/\s*\([^()\d]*\)\s*$/, '').trim();
  // Keep period recognition separate from amount parsing, but allow an explicit
  // annual suffix to coexist with the numeric value.
  // It may appear on either side of a trailing currency token ("60k CAD per
  // year" or "60k per year CAD"), so strip annual/currency/annual in that
  // order. Other periods remain unparseable because callers must annualize them
  // from the JD's own inputs before treating them as annual gross.
  const stripAnnual = (value) => value.replace(/\s*(?:\/\s*(?:year|yr)|per\s+(?:year|annum)|annual(?:ly)?|yearly)\s*$/i, '').trim();
  s = stripAnnual(s);
  // Strip currency symbols anywhere (US pay-transparency ranges often repeat the
  // symbol on both bounds: "$123,684—$254,644 USD") and a trailing ISO-4217
  // code (any case — "450k SEK", "80-90k eur"). Only a real code is stripped:
  // any three letters would turn "100k tax" into 100k, a qualifier read as
  // salary data. A three-letter token also never eats the lone "k" magnitude
  // suffix ("80k").
  s = s.replace(/[€$£¥]/g, '')
    .replace(/\s*([A-Za-z]{3})\s*$/, (token, code) => (isCurrencyCode(code) ? '' : token))
    .trim();
  s = stripAnnual(s);
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

/**
 * The pay period a compensation string names, or null when it names none.
 *
 * @param {unknown} raw
 * @returns {'annual' | 'monthly' | 'weekly' | 'daily' | 'hourly' | null}
 */
export function compensationPeriod(raw) {
  const value = String(raw ?? '');
  if (/(?:\/\s*(?:year|yr)\b|\bper\s+(?:year|annum)\b|\bannual(?:ly)?\b|\byearly\b)/i.test(value)) return 'annual';
  if (/(?:\/\s*(?:month|mo)\b|\bper\s+month\b|\bmonthly\b)/i.test(value)) return 'monthly';
  if (/(?:\/\s*(?:week|wk)\b|\bper\s+week\b|\bweekly\b)/i.test(value)) return 'weekly';
  if (/(?:\/\s*day\b|\bper\s+day\b|\bdaily\b)/i.test(value)) return 'daily';
  if (/(?:\/\s*(?:hour|hr)\b|\bper\s+hour\b|\bhourly\b)/i.test(value)) return 'hourly';
  return null;
}

// Symbols that name exactly one currency. `$` does not (USD, CAD, AUD…).
const CURRENCY_SYMBOLS = /** @type {Record<string, string>} */ ({ '€': 'EUR', '£': 'GBP' });
const CURRENCY_CODE_RE = /(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g;

/**
 * The currency a compensation string names: its one upper-case three-letter
 * code ("USD"), else its one unambiguous symbol (€, £). `undefined` when it
 * names none, a bare `$` included, so the caller may fall back to another
 * source; `''` when it names more than one, so no fallback overrides the text.
 *
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function compensationCurrency(raw) {
  const text = String(raw ?? '');
  const codes = new Set(text.match(CURRENCY_CODE_RE) || []);
  const symbols = new Set([...text].map((c) => CURRENCY_SYMBOLS[c]).filter(Boolean));
  if (codes.size === 1) return [...codes][0];
  if (codes.size === 0 && symbols.size === 1) return [...symbols][0];
  if (codes.size === 0 && symbols.size === 0) return undefined;
  return '';
}

/**
 * parseAmount() for an annual figure whose string may repeat its currency
 * code after each bound ("65.000 EUR-75.000 EUR"). null when the string names
 * a non-annual period ("$20-25/hr", "5.000 EUR per month") or no amount.
 *
 * @param {unknown} raw
 * @returns {{min: number, max: number, mid: number} | null}
 */
export function parseAnnualCompensation(raw) {
  const text = String(raw ?? '');
  const period = compensationPeriod(text);
  if (period && period !== 'annual') return null;
  return parseAmount(text.replace(CURRENCY_CODE_RE, ' ').replace(/\s+/g, ' '));
}
