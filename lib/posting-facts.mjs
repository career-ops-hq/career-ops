/**
 * posting-facts.mjs - what the files already know about one posting: the day
 * the scan first saw it, the board's own posting date, and the last conclusive
 * liveness verdict. Read by the web Today page; no network, no clock.
 *
 * The liveness verdicts live in data/liveness-checks.tsv (url, checked_at,
 * result), one row per posting, written by check-liveness.mjs. Only a
 * conclusive verdict is kept: an `uncertain` or unreadable result says nothing
 * about the posting, so it never replaces an earlier answer. checked_at is the
 * local observation time with its UTC offset (YYYY-MM-DDTHH:MM:SS+HH:MM), an
 * older stamp without the offset, or a bare day. Two sweeps can commit out of
 * order, so an older observation never replaces a newer one.
 */

import { parsedScanHistory } from './scan-history-columns.mjs';
import { parseDate } from './parse-date.mjs';
import { isClosureEvidence } from '../liveness-core.mjs';
import { normalizeUrl } from '../url-key.mjs';

const LIVENESS_HEADER = 'url\tchecked_at\tresult';

const validDay = (value) => (parseDate(String(value ?? '').trim()) ? String(value).trim() : '');

// YYYY-MM-DD, or YYYY-MM-DDTHH:MM:SS local time with an optional UTC offset.
const validStamp = (value) => {
  const v = String(value ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})(T([01]\d|2[0-3]):[0-5]\d:[0-5]\d([+-]([01]\d|2[0-3]):[0-5]\d)?)?$/.exec(v);
  return m && validDay(m[1]) ? v : '';
};

// Real-time order. A stamp without an offset, or a bare day, reads as local time.
const instant = (stamp) => Date.parse(stamp.length === 10 ? `${stamp}T00:00:00` : stamp);

/**
 * @param {string|null|undefined} text raw data/liveness-checks.tsv
 * @returns {Map<string, {result: 'active'|'expired', day: string, at: string}>} keyed by normalized url
 */
export function parseLivenessLog(text) {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim() || line.startsWith('url\t')) continue;
    const [url, stamp, result] = line.split('\t');
    const key = normalizeUrl(url ?? '');
    const at = validStamp(stamp);
    if (!key || !at || (result !== 'active' && result !== 'expired')) continue;
    const previous = out.get(key);
    if (previous && instant(previous.at) > instant(at)) continue;
    out.set(key, { result, day: at.slice(0, 10), at });
  }
  return out;
}

/**
 * New log text with this run's conclusive verdicts applied. Pure: the caller
 * reads the file, writes the result, and holds the lock.
 *
 * @param {string|null|undefined} text current log text
 * @param {{url?: string, result?: string, code?: string, checkedAt?: string}[]} verdicts
 * @param {string} day YYYY-MM-DD the check ran, for a verdict with no checkedAt
 * @returns {string}
 */
export function mergeLivenessLog(text, verdicts, day) {
  const state = parseLivenessLog(text);
  const raw = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim() || line.startsWith('url\t')) continue;
    const [url, stamp, result] = line.split('\t');
    const key = normalizeUrl(url ?? '');
    const at = validStamp(stamp);
    if (!key || !at || (result !== 'active' && result !== 'expired')) continue;
    if (!state.has(key) || instant(at) < instant(state.get(key).at)) continue;
    raw.set(key, url);
  }
  for (const verdict of verdicts ?? []) {
    const url = typeof verdict?.url === 'string' ? verdict.url.trim() : '';
    const key = normalizeUrl(url);
    const at = validStamp(verdict?.checkedAt) || validDay(day);
    if (!key || !at) continue;
    const stored = state.get(key);
    if (stored && instant(stored.at) > instant(at)) continue;
    if (verdict.result === 'active') state.set(key, { result: 'active', day: at.slice(0, 10), at });
    else if (isClosureEvidence(verdict)) state.set(key, { result: 'expired', day: at.slice(0, 10), at });
    else continue;
    raw.set(key, url);
  }
  const lines = [...state].map(([key, v]) => `${raw.get(key) ?? key}\t${v.at}\t${v.result}`);
  return `${[LIVENESS_HEADER, ...lines].join('\n')}\n`;
}

/**
 * @param {string|null|undefined} scanHistoryText raw data/scan-history.tsv
 * @param {string|null|undefined} livenessText raw data/liveness-checks.tsv
 * @returns {Map<string, {firstSeen: string, postedAt: string, check: {result: string, day: string}|null}>}
 */
export function postingFactsIndex(scanHistoryText, livenessText) {
  const index = new Map();
  for (const row of parsedScanHistory(scanHistoryText)) {
    const key = normalizeUrl(row.url);
    if (!key) continue;
    const facts = index.get(key) ?? { firstSeen: '', postedAt: '', check: null };
    const seen = validDay(row.first_seen);
    if (seen && (!facts.firstSeen || seen < facts.firstSeen)) facts.firstSeen = seen;
    const posted = validDay(row.posted_at);
    if (posted && !facts.postedAt) facts.postedAt = posted;
    index.set(key, facts);
  }
  for (const [key, { result, day }] of parseLivenessLog(livenessText)) {
    const facts = index.get(key) ?? { firstSeen: '', postedAt: '', check: null };
    facts.check = { result, day };
    index.set(key, facts);
  }
  return index;
}

/**
 * @param {ReadonlyMap<string, object>} index
 * @param {unknown} url
 */
export function postingFactsForUrl(index, url) {
  if (!index || typeof url !== 'string' || !url) return null;
  const key = normalizeUrl(url);
  return key ? index.get(key) ?? null : null;
}
