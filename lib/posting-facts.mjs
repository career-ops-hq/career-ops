/**
 * posting-facts.mjs - what the files already know about one posting: the day
 * the scan first saw it, the board's own posting date, and the last conclusive
 * liveness verdict. Read by the web Today page; no network, no clock.
 *
 * The liveness verdicts live in data/liveness-checks.tsv (url, checked_at,
 * result), one row per posting, written by check-liveness.mjs. Only a
 * conclusive verdict is kept: an `uncertain` or unreadable result says nothing
 * about the posting, so it never replaces an earlier answer.
 */

import { parsedScanHistory } from './scan-history-columns.mjs';
import { parseDate } from './parse-date.mjs';
import { isClosureEvidence } from '../liveness-core.mjs';
import { normalizeUrl } from '../url-key.mjs';

const LIVENESS_HEADER = 'url\tchecked_at\tresult';

const validDay = (value) => (parseDate(String(value ?? '').trim()) ? String(value).trim() : '');

/**
 * @param {string|null|undefined} text raw data/liveness-checks.tsv
 * @returns {Map<string, {result: 'active'|'expired', day: string}>} keyed by normalized url
 */
export function parseLivenessLog(text) {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim() || line.startsWith('url\t')) continue;
    const [url, day, result] = line.split('\t');
    const key = normalizeUrl(url ?? '');
    if (!key || !validDay(day) || (result !== 'active' && result !== 'expired')) continue;
    out.set(key, { result, day: day.trim() });
  }
  return out;
}

/**
 * New log text with this run's conclusive verdicts applied. Pure: the caller
 * reads the file, writes the result, and holds the lock.
 *
 * @param {string|null|undefined} text current log text
 * @param {{url?: string, result?: string, code?: string}[]} verdicts
 * @param {string} day YYYY-MM-DD the check ran
 * @returns {string}
 */
export function mergeLivenessLog(text, verdicts, day) {
  const state = parseLivenessLog(text);
  const raw = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim() || line.startsWith('url\t')) continue;
    const url = line.split('\t')[0];
    const key = normalizeUrl(url ?? '');
    if (key && state.has(key)) raw.set(key, url);
  }
  for (const verdict of verdicts ?? []) {
    const url = typeof verdict?.url === 'string' ? verdict.url.trim() : '';
    const key = normalizeUrl(url);
    if (!key || !validDay(day)) continue;
    if (verdict.result === 'active') state.set(key, { result: 'active', day });
    else if (isClosureEvidence(verdict)) state.set(key, { result: 'expired', day });
    else continue;
    raw.set(key, url);
  }
  const lines = [...state].map(([key, v]) => `${raw.get(key) ?? key}\t${v.day}\t${v.result}`);
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
  for (const [key, check] of parseLivenessLog(livenessText)) {
    const facts = index.get(key) ?? { firstSeen: '', postedAt: '', check: null };
    facts.check = check;
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
