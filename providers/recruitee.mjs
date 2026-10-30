// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Recruitee provider — a single-company ATS adapter for `tracked_companies:`
// entries; hits the public per-tenant offers API.
// Auto-detects from careers_url pattern `https://<slug>.recruitee.com`.
// Per-tenant subdomains are the variable part — SSRF defence uses a
// regex match on `<safe-slug>.recruitee.com` rather than a static
// allowlist.

import { htmlToText } from './_html-to-text.mjs';

const RECRUITEE_HOST_RE = /^[a-z0-9][a-z0-9-]*\.recruitee\.com$/;

function assertRecruiteeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`recruitee: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`recruitee: URL must use HTTPS: ${url}`);
  if (!RECRUITEE_HOST_RE.test(parsed.hostname)) {
    throw new Error(`recruitee: untrusted hostname "${parsed.hostname}" — must match <slug>.recruitee.com`);
  }
  return url;
}

function resolveApiUrl(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!RECRUITEE_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}/api/offers/`;
}

/**
 * The language a careers_url asks for (`?lang=xx`, Recruitee's own param), or
 * null.
 *
 * @param {any} entry
 * @returns {string|null} Lowercased, already checked against LANGUAGE_RE.
 */
function entryLanguage(entry) {
  if (typeof entry?.careers_url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(entry.careers_url);
  } catch {
    return null;
  }
  if (!RECRUITEE_HOST_RE.test(parsed.hostname)) return null;
  const language = (parsed.searchParams.get(LANGUAGE_PARAM) || '').trim().toLowerCase();
  return LANGUAGE_RE.test(language) ? language : null;
}

/** @type {Provider} */
export default {
  id: 'recruitee',

  detect(entry) {
    const apiUrl = resolveApiUrl(entry);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`recruitee: cannot derive API URL for ${entry.name}`);
    assertRecruiteeUrl(apiUrl);
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parseRecruiteeResponse(json, entry.name, {
      allLanguages: ctx?.dedupIncludeLanguage === true,
      preferredLanguageRank: typeof ctx?.preferredLanguageRank === 'function' ? ctx.preferredLanguageRank : null,
      entryLanguage: entryLanguage(entry),
    });
  },
};

// The query param a Recruitee offer page takes its rendering language from.
// Without it the page renders the offer's default language.
const LANGUAGE_PARAM = 'lang';

// A language code as Recruitee writes it in `translations` (`de`, `en`). Codes
// go into job URLs verbatim, so this gate keeps them to tag characters;
// scan.mjs canonicalizes them for comparison.
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/**
 * `url` with the language param set to `language`.
 *
 * @param {string} url - Already validated as an https URL.
 * @param {string} language - Already checked against LANGUAGE_RE.
 * @returns {string}
 */
function withLanguage(url, language) {
  const parsed = new URL(url);
  parsed.searchParams.set(LANGUAGE_PARAM, language);
  return parsed.href;
}

/**
 * The language versions of one offer, its default language first.
 *
 * `translations` maps a language code to that version's `title`,
 * `description` and `requirements`. Each version, the offer's own top-level
 * fields included, is compared by the Job text it produces (versionText): the
 * trimmed title and the plain-text description and requirements. Nothing
 * names the default language, so it is the translation whose Job text equals
 * the top-level one — the version the API serves without a language param. A
 * further translation with the same Job text as a version already returned is
 * a copy under another label, not a translation, and is skipped.
 *
 * Without `allLanguages`, the offer comes back from its top-level fields,
 * tagged with the default language when one matches, followed by the
 * translations in a preferred language (`rank` ≥ 0), so scan.mjs can keep the
 * preferred version. When no translation matches, the offer comes back once:
 * the translation in the best-ranked preferred language, else its top-level
 * fields — an untagged version next to tagged ones would leave scan.mjs
 * nothing to tell them apart by.
 *
 * With `allLanguages`, every translation comes back, the default one first;
 * when none matches the top-level fields, the translations come back in the
 * API's order, and the top-level fields, which would repeat one of them
 * untagged, are left out. An offer with no usable translation comes back once
 * from its top-level fields, with no `language`, either way.
 *
 * A careers_url language (`entryLanguage`) decides alone for that entry when
 * `allLanguages` is off: the offer comes back once, in that translation
 * wherever the offer has it, else as it would with no preferred language.
 *
 * @param {any} j - One offer.
 * @param {boolean} allLanguages
 * @param {((language: string) => number)|null} rank - ctx.preferredLanguageRank, if set.
 * @param {string|null} entryLanguage - The careers_url language, lowercased, if any.
 * @returns {Array<{title: string, description: string, language?: string}>}
 */
function languageVersions(j, allLanguages, rank, entryLanguage) {
  const top = versionText(j.title, j.description, j.requirements);
  const versionKey = (v) => JSON.stringify([v.title, v.description]);
  const translations = j.translations && typeof j.translations === 'object' ? j.translations : {};
  const entries = Object.entries(translations)
    .filter(([code, t]) => LANGUAGE_RE.test(code) && t && typeof t === 'object')
    .map(([code, t]) => ({ ...versionText(t.title, t.description, t.requirements), language: code }));
  const defaultEntry = entries.find(v => versionKey(v) === versionKey(top));
  if (!allLanguages && entryLanguage) {
    const asked = entries.find(v => v.title && v.language.toLowerCase() === entryLanguage);
    return [asked ?? (defaultEntry ? { ...top, language: defaultEntry.language } : top)];
  }
  const rankOf = (v) => (rank ? rank(v.language) : -1);
  if (!allLanguages && !defaultEntry) {
    const best = entries
      .filter(v => v.title && rankOf(v) >= 0)
      .reduce((found, v) => (found && rankOf(found) <= rankOf(v) ? found : v), null);
    return [best ?? top];
  }
  const versions = defaultEntry ? [{ ...top, language: defaultEntry.language }] : [];
  const seen = new Set(versions.map(versionKey));
  for (const version of entries) {
    if (!allLanguages && rankOf(version) < 0) continue;
    if (!version.title || seen.has(versionKey(version))) continue;
    seen.add(versionKey(version));
    versions.push(version);
  }
  return versions.length ? versions : [top];
}

/**
 * The Job text of one version: the trimmed title, and the description and
 * requirements joined, introduction first, and stripped to plain text.
 *
 * @param {unknown} title
 * @param {unknown} description
 * @param {unknown} requirements
 * @returns {{title: string, description: string}}
 */
function versionText(title, description, requirements) {
  const body = [description, requirements].filter(part => typeof part === 'string' && part.trim());
  return {
    title: typeof title === 'string' ? title.trim() : '',
    description: htmlToText(body.join('\n')),
  };
}

// Recruitee serves a shared demo/trial-account posting for tenants that
// never launched real hiring — the API still answers 200 with well-formed
// job data. Verified live against 2 unrelated tenants (adecco,
// accenture): both return the identical title "Senior Marketer (Sample)"
// with the identical description text, byte-for-byte. Recruitee itself
// stamps the "(Sample)" marker on the title, so this is the platform's own
// label for seeded content, not a heuristic guess — a real employer would
// not title a real opening "(Sample)". Known gap, left uncaught: a demo
// tenant can carry OTHER leftover postings with no "(Sample)" tag (observed:
// personio's "API Job - Berlin - Musterstr 1, 10111", accenture's generic
// "sales executive") — those have no reliable platform-provided marker and
// are not addressed here.
const RECRUITEE_SAMPLE_TITLE_RE = /\(sample\)/i;

function isRecruiteeSamplePosting(j) {
  const title = typeof j?.title === 'string' ? j.title : '';
  return RECRUITEE_SAMPLE_TITLE_RE.test(title);
}

/**
 * True when `word` appears in `text` as a whole word (case-insensitive),
 * never merely as a substring — so `city: "Paris"` is not treated as already
 * present in `name: "Parisian HQ"` (a substring check would wrongly match
 * "paris" inside "parisian" and skip appending the real city). Unicode-aware
 * boundaries (`\p{L}`/`\p{N}` lookaround, not `\b`): JS's `\b` is ASCII-only,
 * so it misfires at either edge of an accented name like "Örebro" — the
 * `u`-flagged lookaround here treats any Unicode letter/number as a "word"
 * character, matching "Zürich" correctly at both edges.
 *
 * @param {string} text
 * @param {string} word
 * @returns {boolean}
 */
function containsWholeWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * Assemble a location string for one offer.
 *
 * Recruitee's flat `location` field carries only the offer's PRIMARY place
 * even when the offer is open in more than one: a live posting was observed
 * with `location: "Zürich, Zürich, Switzerland"` while its `locations`
 * array also carried a `"remote in Germany"` entry — so a `location_filter`
 * scoped to Germany never saw that the role was open there at all. `locations`
 * holds every place as `{ name, city, country, ... }`; when it lists 2+
 * DISTINCT names, those are joined instead of trusting the flat field —
 * counted after dedup, so an array that repeats the same place twice (e.g.
 * `[{name: "Berlin, Germany"}, {name: "Berlin, Germany"}]`) still falls
 * through to the flat-field path below rather than discarding a possibly
 * richer flat `location` string in favor of a "join" of one place. Each name
 * gets its `city` and `country` appended when present and not already part of
 * the name text — checked with `containsWholeWord`, not a substring check, so
 * "Zürich, Switzerland" + city "Zürich" + country "Switzerland" does not
 * become "Zürich, Switzerland, Zürich, Switzerland", and a name like
 * "Parisian HQ" still gets city "Paris" appended rather than being mistaken
 * for already naming it. Each field is checked and appended independently, so
 * a name missing only one of the two still gets exactly that one added.
 * Deduped and joined with " · ", the separator the providers share for
 * multi-place postings (`grep -l "' · '" providers/*.mjs`), so scan.mjs's
 * location_filter sees every place a multi-location role is open to.
 *
 * Falls back to the single-place logic — explicit `location` (with the
 * top-level `country` appended when the location doesn't already name it),
 * else assembled from city/country, appending "Remote" when `remote` is true
 * — when `locations` yields 0 or 1 distinct names.
 *
 * The joined multi-place path also honors the top-level `remote` flag: it is
 * a separate signal from the named places (a "remote in Germany" entry names
 * a place AND implies remote, but "Berlin, Germany" + "Paris, France" with
 * `remote: true` implies a fully-remote role without either name saying so).
 * "Remote" is appended unless a distinct name already expresses it
 * (case-insensitive substring), so it is never duplicated.
 *
 * @param {any} j
 * @returns {string}
 */
function assembleLocation(j) {
  const names = Array.isArray(j.locations)
    ? j.locations.map(l => {
        const name = typeof l?.name === 'string' ? l.name.trim() : '';
        if (!name) return '';
        const parts = [name];
        const city = typeof l?.city === 'string' ? l.city.trim() : '';
        if (city && !containsWholeWord(name, city)) parts.push(city);
        const country = typeof l?.country === 'string' ? l.country.trim() : '';
        if (country && !containsWholeWord(name, country)) parts.push(country);
        return parts.join(', ');
      }).filter(Boolean)
    : [];
  const distinctNames = [...new Set(names)];
  if (distinctNames.length > 1) {
    const hasRemote = distinctNames.some(n => n.toLowerCase().includes('remote'));
    return j.remote && !hasRemote ? [...distinctNames, 'Remote'].join(' · ') : distinctNames.join(' · ');
  }
  const city = j.city || '';
  const country = j.country || '';
  const remote = j.remote ? 'Remote' : '';
  // The flat `location` gets the same country fold every `locations[]` entry
  // gets above — without it a primary place spelled as a city or subdivision
  // ("London, England") hides the country location_filter matches on.
  if (typeof j.location === 'string' && j.location.trim()) {
    const loc = j.location.trim();
    return typeof country === 'string' && country.trim() && !containsWholeWord(loc, country.trim())
      ? `${loc}, ${country.trim()}`
      : loc;
  }
  return [city, country, remote].filter(Boolean).join(', ');
}

// Recruitee publishes a timestamp as `YYYY-MM-DD HH:MM:SS UTC`, which is not an
// ISO 8601 string, so its components are read directly rather than left to
// Date.parse's implementation-defined handling of non-ISO input.
const RECRUITEE_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC$/;

/**
 * Epoch ms of a Recruitee timestamp, or undefined when absent, malformed, or
 * not a real calendar date and time.
 *
 * @param {unknown} value
 * @returns {number|undefined}
 */
function toEpochMs(value) {
  if (typeof value !== 'string') return undefined;
  const m = RECRUITEE_TIMESTAMP_RE.exec(value.trim());
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  // Date.UTC rolls an impossible value over (Feb 30 → Mar 2, 24:00 → the next
  // day) instead of returning NaN, so every component has to survive the round
  // trip unchanged.
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day
    || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== second
  ) return undefined;
  return ms;
}

// Annualization multipliers for the `salary.period` values Recruitee tenants
// publish. A period not listed here, or none at all, leaves the salary off:
// guessing a period would turn a monthly or hourly figure into a wrong annual one.
const PERIOD_MULTIPLIERS = {
  hour: 2080,
  month: 12,
  year: 1,
};

/**
 * Annualized salary of an offer, or null when it carries no usable figure.
 *
 * Recruitee returns `salary: { min, max, period, currency }` with the bounds as
 * strings (`"60000"`), either of them null, and every field null when the
 * tenant publishes no salary. A one-sided range fills the other bound from it,
 * like `ashby.mjs`'s parseCompensation.
 *
 * @param {any} salary
 * @returns {{min: number, max: number, currency: string}|null}
 */
function parseSalary(salary) {
  if (!salary || typeof salary !== 'object') return null;
  const period = typeof salary.period === 'string' ? salary.period.trim().toLowerCase() : '';
  if (!Object.hasOwn(PERIOD_MULTIPLIERS, period)) return null;
  const multiplier = PERIOD_MULTIPLIERS[/** @type {keyof typeof PERIOD_MULTIPLIERS} */ (period)];
  /** @param {unknown} v */
  const toNumber = (v) => {
    if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n * multiplier : null;
  };
  const min = toNumber(salary.min);
  const max = toNumber(salary.max);
  if (min == null && max == null) return null;
  const low = /** @type {number} */ (min ?? max);
  const high = /** @type {number} */ (max ?? min);
  const currency = typeof salary.currency === 'string' ? salary.currency.trim().toUpperCase() : '';
  return { min: Math.min(low, high), max: Math.max(low, high), currency };
}

/**
 * Parse a Recruitee /api/offers/ response. Exported for unit tests.
 *
 * Recruitee returns:
 *   { offers: [{ title, careers_url?, url?, city?, country?, remote?, location?, locations?,
 *                description?, requirements?, published_at?, salary? }] }
 *
 * - url: tries `careers_url` first, falling back to `url` when `careers_url`
 *   is absent or invalid — each candidate validated independently, so one bad
 *   field never shadows an otherwise-usable other one. Recruitee tenants
 *   commonly serve postings on their own custom domain (e.g.
 *   `careers.hostaway.com`), so this URL is NOT host-locked to
 *   `*.recruitee.com`. Unlike the API endpoint, the per-offer URL is
 *   display-only — it is written to the pipeline and scan history but never
 *   server-fetched here, so the SSRF rationale does not apply. It is sourced
 *   from the already-validated tenant API response. Requirement: a
 *   well-formed `https:` URL; when neither candidate resolves, the whole
 *   offer is dropped (see Drop rule below).
 * - location: see `assembleLocation` — joins `locations[]` when it lists 2+
 *   distinct places (appending "Remote" when `remote` is true and no place
 *   name already says so), else the explicit `location` field plus `country`
 *   when it isn't already named there, else assembled
 *   from city/country, appending "Remote" when `remote` is true.
 * - description: Recruitee's list payload embeds each offer's HTML body for
 *   free (same request — verified against a live board) in two fields:
 *   `description` (the introduction) and `requirements` (the tasks and the
 *   candidate profile, usually the longer one). Both are joined in that order
 *   and stripped to plain text here, so scan.mjs's content_filter /
 *   visa_filter see the whole posting. Omitted when neither carries a body.
 * - postedAt: `published_at` (`YYYY-MM-DD HH:MM:SS UTC`) → epoch ms; omitted
 *   when absent, malformed, or not a real calendar date and time.
 * - salary: `salary` annualized by its `period` (see parseSalary); omitted
 *   when the offer states no figure or no known period.
 * - language: the offer's default language code, read from `translations`
 *   (see languageVersions); omitted when no translation matches the
 *   top-level fields. With `allLanguages` (scan_history.dedup_include_language)
 *   each translation comes back as its own Job, the default one first, with
 *   its own title and description and the same location, date and salary;
 *   when no translation matches the top-level fields, the translations alone
 *   come back. Without it, the translations `preferredLanguageRank`
 *   (portals.yml preferred_languages) ranks come back next to the default
 *   one, or, when no translation matches, the best-ranked one alone instead of
 *   the top-level fields — unless the entry's careers_url carries `?lang=xx`,
 *   which returns that translation alone wherever the offer has it. Every Job
 *   that carries a `language` carries it as `?lang=` on its URL too, so the
 *   language versions of one offer share a dedup key in scan.mjs and are told
 *   apart by `language`. The translations ship in the same response, so no
 *   request is added.
 * - a posting Recruitee itself marks "(Sample)" in the title is dropped
 *   entirely (see isRecruiteeSamplePosting), so a tenant serving only its
 *   seeded sample posting resolves as empty rather than as a live board.
 *
 * Envelope: `offers` present as an array — an empty one is an empty board and
 * yields `[]`. Anything else (a non-object body, no `offers` key, `offers`
 * null or not an array) is not the documented shape and throws, naming what
 * came back, so a changed API surfaces as an error instead of reading as an
 * empty board forever.
 *
 * Drop rule: an offer with no usable `title`, or no resolvable absolute
 * `url`, is silently omitted, never emitted half-formed with `title: ''` or
 * `url: ''` — same convention as `parseIbmResponse` (`providers/ibm.mjs`) and
 * `parseEightfoldResponse` (`providers/eightfold.mjs`). The URL requirement
 * is load-bearing beyond the general "required field" convention: `url` is
 * this provider's own dedup key downstream (`scan.mjs`'s `normalizeUrlForDedup`
 * treats an empty string as a value like any other), so a second title-bearing,
 * URL-less offer from the same tenant would silently collapse onto the first
 * one in `seenUrls` and be dropped as a false duplicate — worse than omitting
 * both up front. A malformed entry (`null`, a primitive, anything that isn't a
 * plain object) is skipped the same way, rather than throwing and losing
 * every other offer in the response.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {{allLanguages?: boolean, preferredLanguageRank?: ((language: string) => number)|null, entryLanguage?: string|null}} [options]
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: {min: number, max: number, currency: string}, language?: string}>}
 */
export function parseRecruiteeResponse(json, companyName, { allLanguages = false, preferredLanguageRank = null, entryLanguage = null } = {}) {
  const offers = json && typeof json === 'object' && Array.isArray(json.offers) ? json.offers : null;
  if (!offers) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`recruitee: unexpected response — expected offers[], got: [${got}]`);
  }
  const out = [];
  for (const j of offers) {
    if (!j || typeof j !== 'object') continue;
    if (isRecruiteeSamplePosting(j)) continue;
    const title = typeof j.title === 'string' ? j.title.trim() : '';
    if (!title) continue;

    // Resolve offer URL. Recruitee tenants commonly publish postings on their
    // own custom domain (e.g. careers.hostaway.com), so the per-offer URL is
    // NOT host-locked to *.recruitee.com — it is display-only (recorded in the
    // pipeline/history, never server-fetched here) and comes from the already-
    // validated tenant API response. Require a well-formed https: URL. Tries
    // `careers_url` first (preferred), falling back to `url` when
    // `careers_url` is absent, non-https, or malformed — each candidate is
    // validated independently, so one bad field doesn't drop an otherwise-
    // usable offer whose other field resolves fine. Only when NEITHER
    // candidate resolves is the offer dropped.
    let url = '';
    for (const candidate of [j.careers_url, j.url]) {
      if (typeof candidate !== 'string' || !candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'https:') {
          url = parsed.href;
          break;
        }
      } catch {
        // malformed URL → try the next candidate
      }
    }
    if (!url) continue;

    const location = assembleLocation(j);
    const postedAt = toEpochMs(j.published_at);
    const salary = parseSalary(j.salary);

    for (const version of languageVersions(j, allLanguages, preferredLanguageRank, entryLanguage)) {
      out.push({
        title: version.title,
        url: version.language ? withLanguage(url, version.language) : url,
        location,
        company: companyName,
        ...(version.description ? { description: version.description } : {}),
        ...(postedAt !== undefined ? { postedAt } : {}),
        ...(salary ? { salary } : {}),
        ...(version.language ? { language: version.language } : {}),
      });
    }
  }
  return out;
}
