// Deterministic, text-only comparison. Offsets always refer to untouched input.
import { createHash } from 'node:crypto';

export const MAX_TEXT = 60_000;
export const hashText = text => createHash('sha256').update(text).digest('hex');
export const normalizeText = text => text.replace(/\r\n?/g, '\n').replace(/^[ \t]*(?:#{1,6} |[-*•] )/gm, '').replace(/\s+/g, ' ').trim();
const rules = [
  ['Work arrangement', /\b(remote|hybrid|on[ -]site|work from home)\b/i],
  ['Salary and compensation', /[$€£₹]|\b(salary|compensation|pay|equity|bonus|USD|EUR|GBP|INR)\b/i],
  ['Required experience', /\b(experience|\d+\+?\s*(?:years?|yrs?))\b/i],
  ['Location', /\b(location|based in|located in|relocat|office in)/i],
  ['Employment type', /\b(full[ -]time|part[ -]time|contract|permanent|temporary|internship)\b/i],
  ['Responsibilities', /\b(responsibilit|you will|you’ll|duties|what you.ll do|build|develop|manage|lead|design|maintain|deliver)/i],
  ['Skills and qualifications', /\b(skills?|qualifications?|requirements|proficien|degree|certification|knowledge|Python|JavaScript|SQL)\b/i],
];
function categories(text) { return rules.filter(([, re]) => re.test(text)).map(([name]) => name); }
function lines(text) {
  let offset = 0, section = '';
  return text.split(/(?<=\n)/).map(raw => {
    const start = offset; offset += raw.length;
    const clean = normalizeText(raw);
    if (/^(?:responsibilities|what you.ll do|skills?|qualifications?|requirements|location|compensation)\s*:?(?:\s*)$/i.test(clean)) section = clean;
    else if (/^[ \t]*#{1,6}\s+/.test(raw)) section = '';
    return { text: raw, start, end: offset, key: clean, section };
  }).filter(line => line.key);
}
export function compareDescriptions(before, after) {
  const warnings = [];
  for (const [label, text] of [['Baseline', before], ['Latest', after]]) {
    if (/\bremote\b/i.test(text) && /\b(hybrid|on[ -]site)\b/i.test(text)) warnings.push(`${label} mentions multiple work arrangements. Review the original statements; they may conflict or describe alternatives.`);
  }
  if (normalizeText(before) === normalizeText(after)) return { changes: [], warnings };
  const a = lines(before), b = lines(after);
  // Bound quadratic work for unusually fragmented input. The fallback retains all text.
  if (a.length * b.length > 1_000_000) return { warnings, changes: [{ categories: ['Other text changes'], summary: 'Text changed — inspect the full comparison.', before: { text: before, start: 0, end: before.length }, after: { text: after, start: 0, end: after.length } }] };
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const changes = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].key === b[j].key) { i++; j++; continue; }
    const removed = [], added = [];
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i].key === b[j].key) break;
      if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1])) removed.push(a[i++]); else added.push(b[j++]);
    }
    const excerpt = (items, original) => items.length ? { text: original.slice(items[0].start, items.at(-1).end), start: items[0].start, end: items.at(-1).end } : null;
    const old = excerpt(removed, before), next = excerpt(added, after);
    const groups = categories([...removed, ...added].map(x => `${x.section}\n${x.text}`).join('\n'));
    let summary = old && next ? 'Passage changed' : old ? 'Passage removed' : 'Passage added';
    const removals = [];
    if (groups.includes('Salary and compensation') && old && !rules[1][1].test(after)) removals.push('Salary no longer stated');
    if (groups.includes('Work arrangement') && old && !rules[0][1].test(after)) removals.push('Work arrangement no longer stated; no new requirement inferred');
    if (removals.length) summary = removals.join('. ');
    changes.push({ categories: groups.length ? groups : ['Other text changes'], summary, before: old, after: next });
  }
  return { changes, warnings };
}

export function identityWarnings(expected, capture) {
  const warnings = [];
  const tokens = s => new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  for (const field of ['title', 'company']) {
    if (!expected[field] || !capture[field]) continue;
    const a = tokens(expected[field]), b = tokens(capture[field]);
    const shared = [...a].filter(token => b.has(token)).length;
    if (shared < Math.ceil(Math.min(a.size, b.size) * 0.6)) warnings.push(`${field} differs: expected “${expected[field]}”, captured “${capture[field]}”.`);
  }
  const ids = text => [...String(text).matchAll(/\b(?:job id|requisition(?: id)?|req)\s*[:#]?\s*([\w-]*\d[\w-]*)/gi)].map(m => m[1].toLowerCase());
  const a = ids(expected.text), b = ids(capture.text);
  if (a.length && b.length && !a.some(id => b.includes(id))) warnings.push('Posting requisition identifiers differ.');
  return warnings;
}
