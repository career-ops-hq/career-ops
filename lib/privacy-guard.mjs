/**
 * privacy-guard.mjs — centralized PII privacy guard for outbound LLM requests.
 *
 * WHAT IT IS FOR
 * --------------
 * career-ops sends CV text, profile data and job descriptions to external LLM
 * providers. This module is the single policy object that decides whether a
 * fully-built request is allowed to leave the machine. It is enforced at the
 * outbound request boundary (see `lib/llm-outbound.mjs` and
 * `lib/pii-interceptor.mjs`), never at prompt-construction time, so a caller
 * cannot accidentally send a request the guard would have blocked.
 *
 * TWO TIERS OF PROTECTION
 * -----------------------
 * 1. CONFIGURED PROTECTED VALUES — exact values the user has declared sensitive
 *    in `config/privacy.yml` (email, phone, address, portfolio URLs, salary,
 *    and any free-form custom strings). These are normalized before comparison
 *    so spelling variants still match (see `normalizeValue`).
 * 2. AUTOMATICALLY DETECTED PII — recognizable patterns (email addresses, phone
 *    numbers, social/profile URLs) found anywhere in the request. Only the
 *    pattern kinds the user enables are detected. When no config/privacy.yml
 *    exists, auto-detection is opt-in (off by default) so third-party job
 *    postings containing recruiter emails or phone numbers are not blocked.
 *
 * Ordinary professional information — skills, employers, dates, education,
 * achievements, the job description itself — is NOT matched by either tier
 * unless the user explicitly configures those strings. The policy is explicit:
 * nothing is blocked merely for being personal.
 *
 * FAIL-CLOSED
 * -----------
 * The guard distinguishes "I inspected the payload and found nothing" from "I
 * could not inspect the payload". The latter (unreadable/unserializable
 * request, unreadable config that is present but broken) raises instead of
 * returning a pass, so a request is never sent on the strength of a check that
 * did not actually run. The one deliberate exception is a config file that is
 * simply ABSENT: that is a documented, safe state meaning "no configured
 * values", and it is reported as such rather than treated as a failure.
 *
 * NO VALUE LEAKAGE
 * ----------------
 * A blocked request raises `PrivacyGuardError` (or the legacy `PiiGuardError`
 * alias). The message names the CATEGORY of what was found — never the value,
 * never a fragment, length or hash of it. Neither the error nor any diagnostic
 * this module emits contains the matched text.
 *
 * LIMITATIONS (documented, not hidden)
 * ------------------------------------
 * - Pattern detection is heuristic. It catches recognizable emails/phones/URLs;
 *   it does NOT catch indirect, encoded, obfuscated, base64'd, spelled-out, or
 *   paraphrased PII, aliases, or values the user did not configure.
 * - A configured value shorter than the length floors is not guarded, because
 *   guarding it would block ordinary prose (see MIN_TEXT_LEN / MIN_DIGITS_*).
 *   Store money as absolute annual amounts so they stay guardable.
 * - Enforcement only exists on the request paths that actually call the guard.
 *   It is not a guarantee of anonymity, only a check at the boundary.
 *
 * Design reference: the `PIIGuard` class in the `hunter` project
 * (`src/llm.py`, `tests/test_pii_guard.py`), adapted to career-ops' Node/ESM
 * architecture, extended with pattern detection and fail-closed config
 * handling. Not copied — the layering, error taxonomy, config surface and
 * enforcement points here are career-ops' own.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYaml } from './yaml-document.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The category name used in errors and diagnostics. Deliberately closed: an
 * error must not echo user input, so the only thing it ever interpolates is one
 * of these constants plus a count.
 */
export const CATEGORY = Object.freeze({
  CONFIGURED_TEXT: 'configured protected value',
  CONFIGURED_NUMBER: 'configured protected number',
  EMAIL: 'email address',
  PHONE: 'phone number',
  PROFILE_URL: 'personal profile URL',
});

/**
 * A blocked request. Distinct from a network or config error so callers (and
 * tests) can tell "policy refused this" from "the request was malformed".
 *
 * `category` is a CATEGORY constant. `hits` is the number of distinct protected
 * values found — a count, never the values.
 */
export class PrivacyGuardError extends Error {
  constructor(category, { hits = 1, detail = '' } = {}) {
    const suffix = hits > 1 ? ` (${hits} matches)` : '';
    super(
      `Privacy guard blocked an outbound LLM request: it contains a ${category}${suffix}. ` +
        `${detail ? detail + ' ' : ''}` +
        'Nothing was sent. Remove or generalize the value, or (only if you understand the ' +
        'risk) adjust config/privacy.yml.'
    );
    this.name = 'PrivacyGuardError';
    this.code = 'PRIVACY_GUARD_BLOCKED';
    this.category = category;
    this.hits = hits;
    this.safeToSend = false;
  }
}

/**
 * Legacy alias. The earlier redaction flow imports `PiiGuard` / the token API;
 * both names resolve to the same class so the two generations of the guard
 * cannot diverge.
 */
export const PiiGuardError = PrivacyGuardError;

/** A config file that is present but cannot be used. Never thrown for "absent". */
export class PrivacyConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrivacyConfigError';
    this.code = 'PRIVACY_GUARD_CONFIG';
  }
}

/**
 * Floors that keep ordinary prose from being blocked.
 *
 * A protected value shorter than these is not guarded: a 2-character "value"
 * would match inside unrelated words, and guarding a bare 3-digit number would
 * refuse every posting that mentions a team size. Hunter arrived at the same
 * shape (`MIN_TEXT_LEN = 5`, `MIN_DIGITS_SUBSTR = 7`, `MIN_DIGITS_RUN = 5`) and
 * the numbers are kept because the reasoning transfers directly.
 */
export const MIN_TEXT_LEN = 5;
export const MIN_DIGITS_SUBSTR = 7;
export const MIN_DIGITS_RUN = 5;

/** Strip everything that is not a digit. */
function digitsOf(value) {
  return String(value).replace(/\D/g, '');
}

/**
 * Is this string mostly a number? Used to route a configured value to the
 * numeric comparison path (digits only) instead of the text path, so a phone
 * written `+91 98765 43210` still matches `9876543210`.
 */
function looksNumeric(raw) {
  const digits = digitsOf(raw);
  if (!digits) return false;
  const nonSpace = raw.replace(/\s/g, '');
  return digits.length >= nonSpace.length * 0.6;
}

/**
 * Normalize a configured value the way comparison expects it.
 *
 * Returns `null` when the value is too short/generic to be guardable — the
 * caller drops it rather than guarding something that would false-positive.
 *
 * @param {unknown} value
 * @returns {{kind: 'text'|'digit_str'|'digit_run', key: string}|null}
 */
export function normalizeValue(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const digits = digitsOf(raw);

  // Numeric-looking values compare as digits.
  if (typeof value === 'number' || looksNumeric(raw)) {
    if (digits.length >= MIN_DIGITS_SUBSTR) {
      // A phone with a country code also matches its national number.
      return { kind: 'digit_str', key: digits };
    }
    if (digits.length >= MIN_DIGITS_RUN) return { kind: 'digit_run', key: digits };
    return null; // too short to identify anyone
  }

  if (raw.length >= MIN_TEXT_LEN) return { kind: 'text', key: raw.toLowerCase() };
  return null;
}

/**
 * Extra keys to guard when a configured value is a URL: the bare handle is
 * identifying on its own ("linkedin.com/in/jane-example" implies "jane-example").
 *
 * For recognized profile hosts (LinkedIn, GitHub, GitLab, etc.) the last
 * non-empty path segment is the personal handle and is derived as a guarded
 * key. For all other hosts the normalized hostname is derived instead —
 * guarding a generic path segment like "portfolio" or "projects" from an
 * arbitrary site would cause false positives on unrelated prose.
 *
 * Accepts both the scheme'd and bare forms — a value without `https://` is
 * prefixed before parsing. Returns `[]` for anything that is not a URL, so the
 * caller can invoke it unconditionally.
 *
 * @param {string} raw
 * @returns {string[]}
 */

/** Hosts whose last path segment is a personal handle. */
const PROFILE_HOSTS = new Set([
  'linkedin.com',
  'github.com',
  'gitlab.com',
  'twitter.com',
  'x.com',
  'medium.com',
  'behance.net',
  'dribbble.com',
  'instagram.com',
  'dev.to',
]);

function derivedKeys(raw) {
  const out = [];
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    // "jane@gmail.com" parses as user-info + host; the host is not a secret.
    if (url.username || url.password) return out;
    // Strip leading "www." for host comparison, and normalize LinkedIn country subdomains.
    const host = url.hostname
      .replace(/^www\./, '')
      .replace(/^[a-z]{2,3}\.(?=linkedin\.com$)/, '')
      .toLowerCase();
    if (PROFILE_HOSTS.has(host)) {
      // Known profile host: the last path segment is a personal handle.
      const handle = url.pathname.replace(/\/+$/, '').split('/').pop();
      if (handle && handle.length >= MIN_TEXT_LEN) out.push(handle.toLowerCase());
    } else {
      // Unknown host: guard the hostname, not a generic path segment.
      if (host.length >= MIN_TEXT_LEN) out.push(host);
    }
  } catch {
    /* not a URL — nothing extra to derive */
  }
  return out;
}

/**
 * Recursively collect every non-null scalar out of a parsed config tree.
 *
 * Generic tree-walker: it does NOT filter booleans. A caller that needs
 * boolean-free scalars (the config reader, for consistent entry numbering)
 * filters them itself.
 *
 * @param {unknown} node
 * @param {unknown[]} [out]
 * @returns {unknown[]}
 */
export function flattenScalars(node, out = []) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const item of node) flattenScalars(item, out);
    return out;
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node)) flattenScalars(value, out);
    return out;
  }
  out.push(node);
  return out;
}

/**
 * Default auto-detection policy. When no configuration exists, pattern detection
 * is opt-in (disabled by default) so third-party job postings containing
 * recruiter emails or phone numbers are not blocked during evaluation.
 */
const DEFAULT_AUTO_DETECT = Object.freeze({ email: false, phone: false, profile_url: false });

/**
 * The detection patterns, one entry per CATEGORY constant.
 *
 * Each is anchored to a recognizable shape rather than a broad digit run, so
 * `2026-10-20` or `25 LPA` do not read as a phone. The regexes are created per
 * call so they carry no shared `lastIndex` between requests.
 */
function patterns() {
  return [
    {
      category: CATEGORY.EMAIL,
      key: 'email',
      // Local@domain.tld — requires a dot in the domain so "user@host" in prose
      // is not treated as an address.
      regex: /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi,
    },
    {
      category: CATEGORY.PHONE,
      key: 'phone',
      // International or national formats with separators. Bounded length keeps
      // dates, years, ids and bare amounts out. Deliberately conservative: it
      // wants a leading + or a separator group, so a plain 10-digit blob that
      // is really an ID does not trip it.
      regex:
        /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{3,4}(?!\d)|(?:\+\d{1,3}[\s.-]?)\d{6,11}(?!\d)/g,
    },
    {
      category: CATEGORY.PROFILE_URL,
      key: 'profile_url',
      // Personal profile URLs, not company/job pages.
      regex:
        /https?:\/\/(?:[a-z0-9-]+\.)?(?:linkedin\.com\/(?:in|pub)\/[\w%.-]+|github\.com\/[\w.-]+|gitlab\.com\/[\w.-]+|twitter\.com\/[\w.-]+|x\.com\/[\w.-]+|medium\.com\/@[\w.-]+|behance\.net\/[\w.-]+|dribbble\.com\/[\w.-]+)/gi,
    },
  ];
}

/**
 * Serialize an arbitrary request payload to a single string for inspection.
 *
 * Strings pass through unchanged. Everything else is JSON-stringified, which is
 * what the network layer would transmit anyway. `undefined` fields are dropped
 * by JSON, `BigInt`/cycles throw — the caller treats a throw as fail-closed.
 *
 * UNINSPECTABLE BODIES ARE REFUSED, NOT CLEARED.
 * ----------------------------------------------
 * `JSON.stringify` returns `"{}"` for several shapes `fetch` accepts as a body
 * — a `ReadableStream`, `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`.
 * The guard would then "inspect" two bytes and clear a request whose real
 * content it never read, which is exactly the fail-open the module promises not
 * to have. Those shapes carry their content in internal slots JSON cannot see,
 * so there is no faithful text form to scan and the only honest answer is to
 * refuse. A caller that genuinely has one of these must read it to text itself
 * and pass the string.
 *
 * @param {unknown} payload
 * @returns {string}
 * @throws {TypeError} When the payload's shape cannot be read as text.
 */
export function serializePayload(payload) {
  if (typeof payload === 'string') return payload;
  if (isUninspectableBody(payload)) {
    throw new TypeError(
      `privacy guard: a ${Object.prototype.toString.call(payload).slice(8, -1)} body ` +
        'cannot be inspected as text and is refused rather than assumed clean'
    );
  }
  // A Buffer / typed array holds bytes whose text is invisible to the default
  // JSON view (`{"type":"Buffer","data":[74,111,...]}`), so a secret inside one
  // would never match a substring. Decode it to UTF-8 first — this is what the
  // network would carry, and it is the only form the patterns can read.
  if (isBinaryView(payload)) {
    return decodeBinaryView(payload);
  }
  return JSON.stringify(replaceBinaryViews(payload));
}

/**
 * Decode a binary view (Buffer / typed array) to UTF-8 text.
 *
 * Uses `TextDecoder` rather than `Buffer`, because this module is also loaded
 * by browser-side callers where `Buffer` is not defined.
 *
 * @param {Uint8Array} view
 * @returns {string}
 */
function decodeBinaryView(view) {
  const bytes =
    view instanceof Uint8Array && view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
      ? view
      : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Is this a raw binary view (Buffer or a typed array) whose text is hidden by
 * its default JSON representation?
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
function isBinaryView(payload) {
  return (
    payload instanceof Uint8Array ||
    payload instanceof Int8Array ||
    payload instanceof Uint8ClampedArray
  );
}

/**
 * Recursively replace binary views inside a JSON-able payload with their UTF-8
 * text, so a Buffer nested in a request object is scanned as text rather than
 * as a byte table.
 *
 * @param {unknown} node
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
function replaceBinaryViews(node, seen = new WeakSet()) {
  if (node === null || typeof node !== 'object') return node;
  if (isBinaryView(node)) return decodeBinaryView(node);
  if (seen.has(node)) return node; // cycle: JSON.stringify will throw as before
  seen.add(node);
  if (Array.isArray(node)) return node.map((item) => replaceBinaryViews(item, seen));
  const out = {};
  for (const [key, value] of Object.entries(node)) out[key] = replaceBinaryViews(value, seen);
  return out;
}

/**
 * Shapes `fetch` accepts as a body whose content JSON cannot see.
 *
 * Detected structurally (duck-typed) rather than by `instanceof`, because the
 * caller's realm may be a different one from this module's — a cross-realm
 * `FormData` still fails `instanceof` here but is still uninspectable.
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
function isUninspectableBody(payload) {
  if (payload === null || typeof payload !== 'object') return false;
  if (typeof ReadableStream !== 'undefined' && payload instanceof ReadableStream) return true;
  // Duck-type the rest: a stream-like body (has getReader), or one of the
  // multipart/urlencoded/binary containers that stringify to {}.
  if (typeof payload.getReader === 'function') return true;
  const tag = Object.prototype.toString.call(payload);
  return (
    tag === '[object FormData]' ||
    tag === '[object URLSearchParams]' ||
    tag === '[object Blob]' ||
    tag === '[object File]' ||
    tag === '[object ArrayBuffer]' ||
    tag === '[object SharedArrayBuffer]' ||
    tag === '[object DataView]'
  );
}

/**
 * The guard.
 *
 * Construct directly for tests, or use `loadPrivacyGuard()` /
 * `getDefaultGuard()` for the process-wide instance.
 */
export class PrivacyGuard {
  /**
   * @param {object} [options]
   * @param {unknown[]} [options.values] Configured protected values (already flattened).
   * @param {string[]} [options.valueKeys] YAML key path per value, e.g.
   *   `protected.salary.current_base`. Used in block errors so a finding names a
   *   line the user can find; falls back to a position label when absent.
   * @param {{email?: boolean, phone?: boolean, profile_url?: boolean}} [options.autoDetect]
   * @param {boolean} [options.enabled] When false the guard allows everything (explicit opt-out).
   * @param {string} [options.source] Where the values came from, for diagnostics.
   */
  constructor({ values = [], valueKeys = [], autoDetect = {}, enabled = true, source = 'inline' } = {}) {
    this.enabled = enabled !== false;
    this.source = source;
    this.autoDetect = { ...DEFAULT_AUTO_DETECT, ...autoDetect };

    /** @type {Set<string>} lowercased text keys */
    this.textValues = new Set();
    /** @type {Set<string>} digit strings (phone / long numbers) */
    this.digitStrings = new Set();
    /** @type {Set<string>} short whole-number runs (amounts) */
    this.digitRuns = new Set();

    /**
     * Which configured entry produced each guarded key, as its YAML path
     * (`protected.salary.current_base`) — or `value N` when the caller supplied
     * no key. Used to make an error actionable without ever echoing the value.
     * @type {Map<string, string>}
     */
    this.keyOrigin = new Map();

    /**
     * Each guarded text key mapped back to the spelling the user configured.
     *
     * `textValues` holds lowercased keys because matching is case-insensitive.
     * Redact mode needs the original to put back: rehydrating `jordan a.
     * placeholder` in place of the name the user typed is a visible corruption
     * of their own document. Only the FIRST spelling seen wins, so a value
     * written twice in different cases restores consistently.
     * @type {Map<string, string>}
     */
    this.textOriginals = new Map();

    let position = 0;
    for (const value of values) {
      position += 1;
      const label = valueKeys[position - 1] || `value ${position}`;
      const normalized = normalizeValue(value);
      if (!normalized) continue;
      if (normalized.kind === 'text') {
        this.textValues.add(normalized.key);
        this.keyOrigin.set(normalized.key, label);
        // Remember the user's own spelling for redact-mode rehydration.
        if (!this.textOriginals.has(normalized.key)) {
          this.textOriginals.set(normalized.key, String(value).trim());
        }
        // Derive the bare handle regardless of how the value was written. The
        // earlier version gated this on a URL-shaped regex, so
        // "linkedin.com/in/jane" (no scheme) derived nothing while the docs
        // promised the handle was guarded. `derivedKeys` is the single decision
        // point — it returns [] for anything that is not a URL.
        for (const extra of derivedKeys(String(value).trim())) {
          this.textValues.add(extra);
          this.keyOrigin.set(extra, label);
        }
      } else if (normalized.kind === 'digit_str') {
        this.digitStrings.add(normalized.key);
        this.keyOrigin.set(normalized.key, label);
        // A country-coded number also matches without the country code.
        if (normalized.key.length > 10) {
          const national = normalized.key.slice(-10);
          this.digitStrings.add(national);
          this.keyOrigin.set(national, label);
        }
      } else {
        this.digitRuns.add(normalized.key);
        this.keyOrigin.set(normalized.key, label);
      }
    }
  }

  /** How many configured values are actually being guarded. Diagnostic only. */
  get configuredCount() {
    return this.textValues.size + this.digitStrings.size + this.digitRuns.size;
  }

  /** The enabled pattern list for this instance. */
  get activePatterns() {
    return patterns().filter((p) => this.autoDetect[p.key]);
  }

  /**
   * Inspect a built request and return every finding.
   *
   * Never throws for a finding, and never includes a value in the result: each
   * finding is `{category, id, count}` where `id` is a stable, non-reversible
   * label (the configured key's index / the pattern's category), not the match.
   *
   * @param {unknown} payload A string, or a request body object to serialize.
   * @param {object} [options]
   * @param {string} [options.haystack] Pre-serialized text, to avoid re-serializing.
   * @returns {{category: string, id: string, count: number}[]}
   * @throws {Error} If the payload cannot be serialized (fail-closed; see caller).
   */
  inspect(payload, { haystack } = {}) {
    if (!this.enabled) return [];
    const text = haystack !== undefined ? haystack : serializePayload(payload);
    if (typeof text !== 'string') {
      throw new TypeError('privacy guard: payload could not be serialized to text');
    }

    const findings = [];
    const lower = text.toLowerCase();

    // ── Tier 1: configured text values ──────────────────────────────────────
    for (const needle of this.textValues) {
      if (lower.includes(needle)) {
        findings.push({
          category: CATEGORY.CONFIGURED_TEXT,
          id: this.keyOrigin.get(needle) ?? 'configured value',
          count: 1,
        });
      }
    }

    // ── Tier 1: configured numeric values ────────────────────────────────────
    const digitStream = digitsOf(text);
    for (const needle of this.digitStrings) {
      if (digitStream.includes(needle)) {
        findings.push({
          category: CATEGORY.CONFIGURED_NUMBER,
          id: this.keyOrigin.get(needle) ?? 'configured value',
          count: 1,
        });
      }
    }
    if (this.digitRuns.size > 0) {
      // Strip only thousands-separator commas from the original text first,
      // keeping adjacent numbers in JSON arrays or CSV lines (e.g. [1024,98765])
      // as separate runs rather than merging them into 102498765.
      const runs = new Set(text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1').match(/\d+/g) ?? []);
      for (const needle of this.digitRuns) {
        if (runs.has(needle)) {
          findings.push({
            category: CATEGORY.CONFIGURED_NUMBER,
            id: this.keyOrigin.get(needle) ?? 'configured value',
            count: 1,
          });
        }
      }
    }

    // ── Tier 2: automatic pattern detection ──────────────────────────────────
    for (const { category, regex } of this.activePatterns) {
      // Fresh regex per request: a shared /g regex keeps lastIndex between calls.
      const matches = text.match(new RegExp(regex.source, regex.flags));
      if (matches && matches.length > 0) {
        findings.push({ category, id: `pattern-${category.replace(/\s+/g, '-')}`, count: matches.length });
      }
    }

    return findings;
  }

  /**
   * Inspect a request and throw if anything protected is present.
   *
   * @param {unknown} payload
   * @param {object} [options]
   * @param {string} [options.haystack]
   * @returns {true} When the payload is safe to send.
   * @throws {PrivacyGuardError} When a protected value is found.
   */
  assertSafe(payload, options) {
    const findings = this.inspect(payload, options);
    if (findings.length === 0) return true;
    // One error, most severe category first, naming only counts and WHERE the
    // configured entries live. The category is what the user must act on; the
    // YAML key path lets them find it in config/privacy.yml without the error
    // ever echoing the value. A 10-digit configured number is matched as a
    // substring of any longer digit run, so without the label a user reading
    // "configured protected number" has no way to tell which line is at fault.
    const byCategory = new Map();
    for (const f of findings) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + f.count);
    const [category, hits] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
    const origins = [...new Set(findings.map((f) => f.id))].join(', ');
    const detail = `Found: ${[...byCategory.keys()].join(', ')} (${origins}).`;
    throw new PrivacyGuardError(category, { hits, detail });
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The config path, honouring a data-root override and an explicit env var. */
export function getPrivacyConfigPath(explicit) {
  if (explicit) return resolve(explicit);
  if (process.env.CAREER_OPS_PRIVACY?.trim()) return resolve(process.env.CAREER_OPS_PRIVACY.trim());
  return join(getCareerOpsRoot(), 'config', 'privacy.yml');
}

/** The shipped sample, used only to explain setup in errors and docs. */
export function getPrivacyExamplePath() {
  return join(__dirname, '..', 'config', 'privacy.example.yml');
}

/**
 * Read the privacy config.
 *
 * Absent → `{present: false}` and the guard runs with only pattern detection,
 * which is the documented safe default. Present but unparseable/shapeless →
 * `PrivacyConfigError`, so an enabled guard never reports success on a config it
 * could not read.
 *
 * @param {string} [explicitPath]
 * @returns {{present: boolean, path: string, enabled: boolean, autoDetect: object, values: unknown[], source: string}}
 */
export function readPrivacyConfig(explicitPath) {
  const path = getPrivacyConfigPath(explicitPath);
  if (!existsSync(path)) {
    return { present: false, path, enabled: true, autoDetect: {}, values: [], source: 'absent' };
  }

  let parsed;
  try {
    parsed = loadYaml(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new PrivacyConfigError(
      `privacy: could not parse ${path} — ${err.message}. Fix it, or remove it to run with ` +
        `pattern detection only. The guard refuses to treat an unreadable config as protection.`
    );
  }

  // A comment-only file parses to null/empty, which is the same "nothing
  // configured" state as an absent file — not an error, but reported distinctly.
  if (parsed === null || parsed === undefined || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) {
    return { present: true, path, enabled: true, autoDetect: {}, values: [], source: 'empty' };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PrivacyConfigError(
      `privacy: ${path} must be a YAML mapping at the top level, got ${Array.isArray(parsed) ? 'a list' : typeof parsed}.`
    );
  }

  const protectedSection = parsed.protected ?? parsed;

  /**
   * Walk `protected:` and collect every guardable leaf WITH its YAML key path,
   * e.g. `protected.salary.current_base`.
   *
   * The path is what a block error reports (`protected.salary.current_base`),
   * so it must name something the user can find in the file — the earlier
   * flattened-index label ("entry 3") pointed at nothing visible once a value
   * was nested, which made the label useless for the nested case it was added
   * for. Booleans are control flags, not values, and are skipped here so they
   * never occupy a position.
   *
   * @param {unknown} node
   * @param {string} keyPath Dotted path to `node`.
   * @param {{value: unknown, key: string}[]} out
   */
  const collect = (node, keyPath, out) => {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => collect(item, `${keyPath}[${index}]`, out));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) collect(value, `${keyPath}.${key}`, out);
      return;
    }
    out.push({ value: node, key: keyPath });
  };

  const entries = [];
  const sectionName = parsed.protected !== undefined ? 'protected' : '';
  // `protected:` is the documented block. Unknown top-level keys are ignored so
  // a comment or extra metadata does not become a "protected value".
  if (protectedSection && typeof protectedSection === 'object') {
    for (const [key, value] of Object.entries(protectedSection)) {
      collect(value, sectionName ? `${sectionName}.${key}` : key, entries);
    }
  }

  const values = entries.map((entry) => entry.value);
  const valueKeys = entries.map((entry) => entry.key);

  const enabled = parsed.enabled !== false;
  const autoDetect = typeof parsed.auto_detect === 'object' && parsed.auto_detect !== null ? parsed.auto_detect : {};

  return { present: true, path, enabled, autoDetect, values, valueKeys, source: path };
}

/**
 * True when the guard has been explicitly switched off for this process.
 *
 * Two conditions must both hold: `PRIVACY_GUARD=off` AND a non-empty
 * `PRIVACY_BYPASS_TOKEN`. A single flag is not enough — this exists so a typo
 * or an inherited shell variable cannot silently disable protection in
 * production. Disabling is not something a workflow does by accident.
 *
 * @param {NodeJS.ProcessEnv} [env] Environment to read. Defaults to `process.env`.
 * @returns {boolean}
 */
export function bypassRequested(env = process.env) {
  const mode = String(env.PRIVACY_GUARD ?? '').trim().toLowerCase();
  if (mode !== 'off' && mode !== 'disabled' && mode !== '0') return false;
  const token = String(env.PRIVACY_BYPASS_TOKEN ?? '').trim();
  if (!token) {
    // Asked to disable without the second factor: refuse, and say so loudly.
    console.warn(
      'privacy: PRIVACY_GUARD=off was set without PRIVACY_BYPASS_TOKEN — the guard stays ON. ' +
        'See docs/PRIVACY.md.'
    );
    return false;
  }
  return true;
}

/**
 * Build the process-wide guard from the environment and config.
 *
 * @param {object} [options]
 * @param {string} [options.configPath] Override the config location (tests).
 * @param {object} [options.env] Override the environment (tests).
 * @returns {PrivacyGuard}
 */
export function loadPrivacyGuard({ configPath, env = process.env, config: preRead } = {}) {
  // `env` is threaded through explicitly rather than by reassigning the global
  // `process.env`: dotenv and other modules hold a reference to that object, so
  // swapping it out would break them for the duration of the call.
  if (bypassRequested(env)) {
    return new PrivacyGuard({ enabled: false, source: 'bypass' });
  }
  // A caller that already read the config (to report on its `source`, say) can
  // pass it in rather than have the file parsed a second time. The CLI status
  // path did exactly that, and re-reading could also disagree with itself if the
  // file changed between the two reads.
  const config = preRead ?? readPrivacyConfig(configPath);
  return new PrivacyGuard({
    values: config.values,
    valueKeys: config.valueKeys,
    autoDetect: config.autoDetect,
    enabled: config.enabled,
    source: config.source,
  });
}

/** Memoized process-wide guard. Reset with `resetDefaultGuard()` (tests). */
let defaultGuardInstance = null;

/** @returns {PrivacyGuard} */
export function getDefaultGuard() {
  if (defaultGuardInstance === null) defaultGuardInstance = loadPrivacyGuard();
  return defaultGuardInstance;
}

/** Drop the memoized guard so the next `getDefaultGuard()` reloads config. */
export function resetDefaultGuard() {
  defaultGuardInstance = null;
}

/**
 * Legacy compatibility surface.
 *
 * The earlier redaction flow (`lib/pii-interceptor.mjs`) imports `defaultGuard`
 * and the `PiiGuard` name. Keeping the same names means an install mid-upgrade
 * does not crash on a missing export, and the two generations of the guard
 * resolve to one policy object.
 *
 * `defaultGuard` is a lazy proxy rather than an eagerly-evaluated instance so
 * it does not call `loadPrivacyGuard()` at module-evaluation time — before
 * dotenv has had a chance to populate `process.env`. Any call site that needs
 * the guard should use `getDefaultGuard()` directly; this export exists only
 * for callers that were written against the old API.
 */
export class PiiGuard extends PrivacyGuard {}

/** @deprecated Use `getDefaultGuard()`. Kept for the legacy redaction flow. */
export const defaultGuard = new Proxy({}, {
  get(_target, prop, receiver) {
    const instance = getDefaultGuard();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  has(_target, prop) {
    return Reflect.has(getDefaultGuard(), prop);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getDefaultGuard(), prop);
  },
  ownKeys(_target) {
    return Reflect.ownKeys(getDefaultGuard());
  },
  getPrototypeOf(_target) {
    return Reflect.getPrototypeOf(getDefaultGuard());
  },
});

/** Default pattern policy, exported so docs and tests read one definition. */
export const AUTO_DETECT_DEFAULTS = DEFAULT_AUTO_DETECT;

/** The four-shape confirmation UX vocabulary from AGENTS.md, for callers to reuse. */
export const CONFIRMATION_OUTCOMES = Object.freeze([
  'confirm-accurate',
  'provide-figure',
  'narrative-only',
  'user-cannot-confirm',
]);
