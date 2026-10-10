#!/usr/bin/env node

/**
 * Versioned local listing identity (#1030). Only a resolved ATS-native triple
 * authorizes a match. URL context never does; JD similarity remains owned by
 * fingerprint-core.mjs. See docs/listing-fingerprint.md for the v1 contract.
 */
import { createHash } from 'node:crypto';
import { isMainModule } from './lib/is-main-module.mjs';

export const LISTING_FINGERPRINT_VERSION = 1;
const TRIPLE_FIELDS = ['ats_provider', 'board_slug', 'posting_id'];
const RECORD_FIELDS = ['schema_version', 'identity', 'strong', 'canonical_host', 'canonical_path', 'listing_key'];

function object(value, name, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be an object`);
  }
  if (Reflect.ownKeys(value).some(key => !fields.includes(key))) {
    throw new TypeError(`${name} contains unsupported fields`);
  }
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) {
    throw new TypeError(`${name} must contain data properties, not accessors`);
  }
  if (fields.some(field => field in value && !Object.hasOwn(value, field))) {
    throw new TypeError(`${name} must use own properties`);
  }
}

// Keep board/posting identifiers opaque: no casing, Unicode normalization,
// punctuation removal, URL decoding or numeric coercion can merge two IDs.
function triple(value, allowIncomplete = false) {
  object(value, 'strong', TRIPLE_FIELDS);
  let missing = false;
  for (const field of TRIPLE_FIELDS) {
    const part = value[field];
    if (part === undefined) {
      missing = true;
      continue;
    }
    if (typeof part !== 'string') throw new TypeError(`strong.${field} must be a string`);
    if (!part.trim()) {
      missing = true;
      continue;
    }
    if (part !== part.trim() || /[\u0000-\u001f\u007f]/u.test(part)) {
      throw new TypeError(`strong.${field} must not contain controls or surrounding whitespace`);
    }
    if (field === 'ats_provider' && !/^[a-z][a-z0-9_-]*$/.test(part)) {
      throw new TypeError('strong.ats_provider must be a lowercase provider slug');
    }
  }
  if (missing) {
    if (allowIncomplete) return null;
    throw new TypeError('strong requires ats_provider, board_slug and posting_id');
  }
  return Object.fromEntries(TRIPLE_FIELDS.map(field => [field, value[field]]));
}

function keyFor(strong) {
  const bytes = JSON.stringify(['listing-fingerprint', LISTING_FINGERPRINT_VERSION,
    ...TRIPLE_FIELDS.map(field => strong[field])]);
  return `listing_v1_${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

function urlContext(value) {
  if (value === undefined || value === null) return { canonical_host: null, canonical_path: null };
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)
      || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('url must be an absolute HTTP(S) URL without credentials');
  }
  let parsed;
  try { parsed = new URL(value); } catch {
    throw new TypeError('url must be an absolute HTTP(S) URL without credentials');
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new TypeError('url must be an absolute HTTP(S) URL without credentials');
  }
  return {
    canonical_host: parsed.host,
    canonical_path: parsed.pathname.replace(/\/+$/, '') || '/',
  };
}

/**
 * Create a local v1 record from public URL context and an explicitly resolved
 * ATS triple. An absent/incomplete triple produces partial context and no key.
 * Unknown fields and malformed values throw; the input is never modified.
 * @param {{url?: string, strong?: {ats_provider?: string, board_slug?: string, posting_id?: string}}} input
 * @returns {object} A validated-by-construction listing fingerprint record.
 */
export function computeListingFingerprint(input = {}) {
  object(input, 'input', ['url', 'strong']);
  const strong = input.strong === undefined ? null : triple(input.strong, true);
  return {
    schema_version: LISTING_FINGERPRINT_VERSION,
    identity: strong ? 'strong' : 'partial',
    ...(strong ? { strong } : {}),
    ...urlContext(input.url),
    listing_key: strong ? keyFor(strong) : null,
  };
}

/**
 * Validate a persisted local record, including its version and derived key.
 * Validation checks shape/consistency, not whether an ATS actually issued an ID.
 * @param {unknown} record - Parsed JSON to validate.
 * @returns {{valid: boolean, errors: string[]}} Does not coerce or repair input.
 */
export function validateListingFingerprint(record) {
  try {
    object(record, 'record', RECORD_FIELDS);
    if (record.schema_version !== LISTING_FINGERPRINT_VERSION) {
      throw new TypeError('unsupported schema_version; expected 1');
    }
    if (!['strong', 'partial'].includes(record.identity)) {
      throw new TypeError('identity must be strong or partial');
    }
    const { canonical_host: host, canonical_path: path } = record;
    if (host !== null || path !== null) {
      if (typeof host !== 'string' || typeof path !== 'string' || !host || !path.startsWith('/')) {
        throw new TypeError('canonical_host and canonical_path must be normalized strings or both null');
      }
      // Scheme is deliberately absent from context. Either scheme may have
      // produced a non-default port (e.g. http://example.test:443/jobs).
      const normalized = ['http:', 'https:'].some(scheme => {
        try {
          const context = urlContext(`${scheme}//${host}${path}`);
          return context.canonical_host === host && context.canonical_path === path;
        } catch { return false; }
      });
      if (!normalized) throw new TypeError('canonical_host and canonical_path must be normalized');
    }
    if (record.identity === 'strong') {
      const strong = triple(record.strong);
      if (record.listing_key !== keyFor(strong)) throw new TypeError('listing_key does not match the strong triple');
    } else if (Object.hasOwn(record, 'strong') || record.listing_key !== null) {
      throw new TypeError('partial identity must omit strong and have a null listing_key');
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
}

/**
 * Return a validated strong key, or null for partial context. Callers must
 * refuse a cache hit/match for null; two partial records are not an identity.
 * @param {unknown} record - Local record (not a raw provider response).
 * @returns {string|null} Throws TypeError when the record is invalid.
 */
export function listingKey(record) {
  const result = validateListingFingerprint(record);
  if (!result.valid) throw new TypeError(result.errors.join('; '));
  return record.listing_key;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node listing-fingerprint.mjs [--validate] \'<JSON>\'\n'
      + 'Compute a local record from {url?, strong?}, or validate a stored record. No files are written.');
  } else {
    const validate = args[0] === '--validate';
    const values = validate ? args.slice(1) : args;
    try {
      if (values.length !== 1) throw new TypeError('expected one JSON argument; use --help');
      let input;
      try { input = JSON.parse(values[0]); } catch { throw new TypeError('invalid JSON'); }
      const result = validate ? validateListingFingerprint(input) : computeListingFingerprint(input);
      console.log(JSON.stringify(result, null, 2));
      if (validate && !result.valid) process.exitCode = 1;
    } catch (error) {
      console.error(`listing-fingerprint: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
