// @ts-check
// Shared employment-type normalization: one reading of the many ways a source
// says "contract" or "part-time" ("Contractor", "PartTime", "Full-Time",
// "freelance", "Fixed-Term") for every provider that exposes the field and for
// scan.mjs's employment_type_filter. Files prefixed with _ are never loaded as
// providers (see _registry.mjs).
//
// The values follow schema.org/JobPosting `employmentType` (FULL_TIME,
// PART_TIME, CONTRACTOR, TEMPORARY, INTERN), lower-cased and with the two
// nouns spelled as the arrangement rather than the person:
//
//   full_time | part_time | contract | temporary | internship
//
// Anything else a source can say (Himalayas' "Volunteer" and "Other",
// Remotive's "other", Lever's "Permanent", which states the term but not the
// hours) has no value here: the normalizer returns undefined and the provider
// leaves `employmentType` off the Job, the same "the source didn't say" a
// posting with no field at all gets. A guess would be worse than a gap: a
// filter that keeps contract roles must not drop a posting because it read
// "Permanent" as full-time.

/** @typedef {'full_time'|'part_time'|'contract'|'temporary'|'internship'} EmploymentType */

/**
 * Every value `employmentType` can take, most specific first. When a source
 * states more than one ("Full-time Contract", "Part-time, Temporary"), the
 * first one in this order wins: a full-time contract is a contract to someone
 * looking for (or avoiding) contracts, and the hours are the less specific
 * fact. The order is also the order the values are listed in messages.
 * @type {readonly EmploymentType[]}
 */
export const EMPLOYMENT_TYPES = Object.freeze(['internship', 'temporary', 'contract', 'part_time', 'full_time']);

// Each canonical value, with the words that state it. Matched as whole words
// on the folded text (see foldEmploymentText), so "contract" never matches
// inside "contractual obligations" text — the inputs here are short labels, not
// job descriptions, but a label like "Contract-to-hire" still has to work.
/** @type {ReadonlyArray<[EmploymentType, RegExp]>} */
const PATTERNS = [
  ['internship', /\b(?:intern|interns|internship|internships)\b/],
  ['temporary', /\b(?:temporary|temp|fixed term|short term|seasonal)\b/],
  ['contract', /\b(?:contract|contractor|contracts|freelance|freelancer|freelancing)\b/],
  ['part_time', /\b(?:part time|parttime)\b/],
  ['full_time', /\b(?:full time|fulltime)\b/],
];

/**
 * Fold a raw label into lower-case words: split camelCase ("PartTime" →
 * "part time"), and turn `-`, `_`, `/`, `,` and other punctuation into spaces.
 * @param {string} raw
 * @returns {string}
 */
function foldEmploymentText(raw) {
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Normalize a source's employment-type label (or list of labels) to one
 * canonical value.
 *
 * Accepts a string or an array of strings (schema.org JSON-LD allows both).
 * Already-canonical values pass through unchanged, so calling it twice is
 * safe: scan.mjs normalizes again what a local parser emitted raw.
 *
 * @example
 *   normalizeEmploymentType('Contractor')   // 'contract'   (Himalayas)
 *   normalizeEmploymentType('PartTime')     // 'part_time'  (Ashby)
 *   normalizeEmploymentType('Full-Time')    // 'full_time'  (We Work Remotely)
 *   normalizeEmploymentType('freelance')    // 'contract'   (Remotive)
 *   normalizeEmploymentType('Fixed-Term')   // 'temporary'  (Lever)
 *   normalizeEmploymentType('Full-time Contract') // 'contract'
 *   normalizeEmploymentType('Permanent')    // undefined — states the term, not the type
 *
 * @param {unknown} raw - the source's value: a label, an array of labels, or anything else.
 * @returns {EmploymentType | undefined} the canonical value, or undefined when
 *   the input is empty, not a string, or names no type this module knows.
 */
export function normalizeEmploymentType(raw) {
  const labels = Array.isArray(raw) ? raw : [raw];
  const text = labels
    .filter((v) => typeof v === 'string' && v.trim() !== '')
    .map((v) => foldEmploymentText(/** @type {string} */ (v)))
    .join(' ');
  if (!text) return undefined;
  for (const [type, pattern] of PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return undefined;
}

/**
 * `{ employmentType }` when `raw` normalizes to a known type, else `{}`: spread
 * into a Job literal so the key is absent, not `undefined`, when the source
 * didn't say (`...employmentTypeField(j.employmentType)`).
 * @param {unknown} raw - the source's value, as for {@link normalizeEmploymentType}.
 * @returns {{ employmentType?: EmploymentType }}
 */
export function employmentTypeField(raw) {
  const employmentType = normalizeEmploymentType(raw);
  return employmentType ? { employmentType } : {};
}

/**
 * Whether `value` is one of {@link EMPLOYMENT_TYPES}, exactly as written.
 * Used to validate config, where a near miss ("contractor", "part-time") must
 * be reported rather than normalized silently.
 * @param {unknown} value
 * @returns {value is EmploymentType}
 */
export function isEmploymentType(value) {
  return typeof value === 'string' && /** @type {readonly string[]} */ (EMPLOYMENT_TYPES).includes(value);
}

/**
 * @typedef {object} EmploymentTypeFilterConfig
 * @property {ReadonlySet<EmploymentType>} allow  The types a posting may have.
 * @property {boolean} includeUnknown  Whether a posting whose source states no
 *   type passes. Default true.
 */

/**
 * Parse portals.yml's `employment_type_filter` block. The one reading of it,
 * shared by scan.mjs (which exits on an error before any network call) and
 * validate-portals.mjs (which reports it), so the two cannot disagree about
 * what is valid.
 *
 *   employment_type_filter:
 *     allow: [contract, part_time]   # required, non-empty, values from EMPLOYMENT_TYPES
 *     include_unknown: true          # optional, default true
 *
 * A value outside EMPLOYMENT_TYPES is an error rather than a warning: a typo
 * such as "contractor" would otherwise leave `allow` narrower than written and
 * drop every contract posting while the config looks right.
 *
 * @param {unknown} block - the raw `employment_type_filter` value.
 * @returns {EmploymentTypeFilterConfig | null} null when the block is absent.
 * @throws {Error} with a message naming the offending key when the block is malformed.
 */
export function parseEmploymentTypeFilterConfig(block) {
  if (block === undefined || block === null) return null;
  if (typeof block !== 'object' || Array.isArray(block)) {
    throw new Error('employment_type_filter must be an object with an `allow` list');
  }
  const cfg = /** @type {Record<string, unknown>} */ (block);
  for (const key of Object.keys(cfg)) {
    if (key !== 'allow' && key !== 'include_unknown') {
      throw new Error(`employment_type_filter: unknown key "${key}" (expected allow, include_unknown)`);
    }
  }
  const { allow, include_unknown: includeUnknown } = cfg;
  if (!Array.isArray(allow) || allow.length === 0) {
    throw new Error(`employment_type_filter.allow must be a non-empty list of: ${EMPLOYMENT_TYPES.join(', ')}`);
  }
  const bad = allow.filter((v) => !isEmploymentType(v));
  if (bad.length > 0) {
    const hints = bad.map((v) => {
      const near = normalizeEmploymentType(v);
      return near ? `${JSON.stringify(v)} (did you mean "${near}"?)` : JSON.stringify(v);
    });
    throw new Error(`employment_type_filter.allow has unknown value(s) ${hints.join(', ')}; expected: ${EMPLOYMENT_TYPES.join(', ')}`);
  }
  if (includeUnknown !== undefined && typeof includeUnknown !== 'boolean') {
    throw new Error('employment_type_filter.include_unknown must be true or false');
  }
  return {
    allow: new Set(/** @type {EmploymentType[]} */ (allow)),
    includeUnknown: includeUnknown !== false,
  };
}
