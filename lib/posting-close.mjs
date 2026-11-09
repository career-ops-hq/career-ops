import { parseDate } from './parse-date.mjs';
import { OBSERVATIONAL_SCAN_HISTORY_STATUSES, parseScanHistoryLine, scanHistoryDataLines } from './scan-history-columns.mjs';
import { normalizeUrl } from '../url-key.mjs';

/** First present valid field wins. */
const CLOSE_FIELDS = [
  'validThrough',
  'applicationDeadline',
  'application_deadline',
  'endDate',
  'end_date',
  'closeDate',
  'close_date',
];

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * A posting close date is a calendar day, or absent.
 * A date-only string stays that day. A datetime keeps its date prefix unless
 * the input has an explicit Z or numeric offset, in which case the day is the
 * UTC calendar day. No zone is guessed from the machine.
 *
 * @param {unknown} value
 * @returns {string} `YYYY-MM-DD`, or `''`
 */
export function closesAtIso(value) {
  if (typeof value === 'string') return dayFromString(value);
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const name of CLOSE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) continue;
    const field = value[name];
    if (typeof field !== 'string') continue;
    const day = dayFromString(field);
    if (day) return day;
  }
  return '';
}

function dayFromString(raw) {
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return parseDate(text) ? text : '';
  const match = DATE_TIME.exec(text);
  if (!match) return '';
  const day = match[1];
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = match[4] === undefined ? 0 : Number(match[4]);
  if (hours > 23 || minutes > 59 || seconds > 59) return '';
  if (!parseDate(day)) return '';
  const zone = match[6];
  if (!zone) return day;
  return utcCalendarDay(day, hours, minutes, seconds, match[5], zone);
}

function utcCalendarDay(day, hours, minutes, seconds, fraction, zone) {
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
    if (!match) return '';
    const sign = match[1] === '+' ? 1 : -1;
    const offsetHours = Number(match[2]);
    const offsetMins = Number(match[3]);
    if (offsetHours > 14 || offsetMins > 59) return '';
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }
  const fractionMs = fraction ? Number(fraction.slice(1, 4).padEnd(3, '0')) : 0;
  const localAsUtc = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    hours,
    minutes,
    seconds,
    fractionMs,
  );
  const utc = new Date(localAsUtc - offsetMinutes * 60 * 1000);
  if (Number.isNaN(utc.getTime())) return '';
  return utc.toISOString().slice(0, 10);
}

/**
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function closeDatesByUrl(text) {
  const index = new Map();
  const added = new Set();
  for (const line of scanHistoryDataLines(text)) {
    if (!line.trim()) continue;
    const row = parseScanHistoryLine(line);
    const day = closesAtIso(row.closes_at);
    if (!day) continue;
    const key = normalizeUrl(row.url);
    if (!key) continue;
    if (row.status === 'added') {
      added.add(key);
      index.set(key, day);
      continue;
    }
    if (added.has(key) && OBSERVATIONAL_SCAN_HISTORY_STATUSES.has(row.status)) continue;
    index.set(key, day);
  }
  return index;
}

/**
 * @param {ReadonlyMap<string, string>|null|undefined} index
 * @param {unknown} url
 * @returns {string}
 */
export function closeDateForUrl(index, url) {
  if (!index || typeof url !== 'string' || !url) return '';
  const key = normalizeUrl(url);
  if (!key || !index.has(key)) return '';
  return index.get(key);
}
