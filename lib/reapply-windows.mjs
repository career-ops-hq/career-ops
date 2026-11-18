/**
 * Re-apply cooldown windows (`re_apply_windows` in config/profile.yml).
 *
 * scan.mjs reads these windows and skips postings inside them (#571). This
 * module is the writer side: set-status.mjs calls recordCooldown() when a row
 * moves to Rejected with --cooldown-days, so the window is recorded at the
 * moment the candidate learns about it instead of being hand-written later.
 *
 * profile.yml is a USER-LAYER file full of comments and commented-out opt-in
 * keys, and js-yaml never emits comments. So the write is a text edit: only
 * the one company's block under `re_apply_windows:` is replaced (or appended),
 * every other line round-trips byte for byte, and the result must parse to
 * exactly the expected document. A shape the edit cannot place (a flow
 * mapping, an anchor, a block it cannot find the end of) makes the upsert
 * return null and nothing is written. Never a yaml.dump fallback: losing the
 * user's comments is a worse outcome than an unrecorded cooldown, which the
 * caller reports.
 */

import { readFileSync, existsSync } from 'fs';
import { isDeepStrictEqual } from 'node:util';
import * as yaml from 'js-yaml';
import { loadYaml } from './yaml-document.mjs';
import { writeFileAtomic, normalizeCompany, companiesMatchIgnoringCorporateForm } from '../tracker-utils.mjs';

export const SECTION = 're_apply_windows';
export const COOLDOWN_SCOPES = ['role', 'company'];
export const MAX_COOLDOWN_DAYS = 3650;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} dateStr YYYY-MM-DD @param {number} days */
export function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** @param {unknown} value */
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * The day a window starts counting. `cooldown_from` is the explicit name (the
 * date of the decision, which is what company cooldowns count from);
 * `last_apply_date` is the original #571 key and is still honoured.
 * @param {Record<string, unknown>} win
 * @returns {string | undefined}
 */
export function windowStart(win) {
  if (isCalendarDate(win?.cooldown_from)) return /** @type {string} */ (win.cooldown_from);
  if (isCalendarDate(win?.last_apply_date)) return /** @type {string} */ (win.last_apply_date);
  return undefined;
}

/** First day the candidate is eligible again, or undefined for an unusable window. */
export function windowUntil(win) {
  const start = windowStart(win);
  if (!start) return undefined;
  const days = Number(win.same_role_days || 0);
  return addDays(start, Number.isInteger(days) && days >= 0 ? days : 0);
}

/** The key of an existing window for `company`, matched the way the tracker matches companies. */
export function findWindowKey(windows, company) {
  if (!windows || typeof windows !== 'object') return undefined;
  if (Object.hasOwn(windows, company)) return company;
  const wanted = normalizeCompany(company);
  if (!wanted) return undefined;
  const keys = Object.keys(windows);
  return keys.find((key) => normalizeCompany(key) === wanted)
    ?? keys.find((key) => companiesMatchIgnoringCorporateForm(key, company));
}

/**
 * The window after recording a new cooldown on top of `existing`.
 *
 * Never shortens: when the window already runs past the new end date, its
 * start and length stay. The role is added to applied_to. A company-wide scope
 * is never narrowed back to role scope by a later, narrower rejection.
 *
 * @param {Record<string, unknown> | undefined} existing
 * @param {{ from: string, days: number, role?: string, scope?: 'role' | 'company' }} input
 */
export function mergeWindow(existing, { from, days, role, scope = 'role' }) {
  const prior = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  const newUntil = addDays(from, days);
  const priorUntil = windowUntil(prior);
  /** @type {Record<string, unknown>} */
  const next = {};
  if (!priorUntil || newUntil >= priorUntil) {
    next.cooldown_from = from;
    next.same_role_days = days;
    delete prior.last_apply_date;
    delete prior.cooldown_from;
    delete prior.same_role_days;
  } else {
    for (const key of ['cooldown_from', 'last_apply_date', 'same_role_days']) {
      if (key in prior) { next[key] = prior[key]; delete prior[key]; }
    }
  }
  const applied = Array.isArray(prior.applied_to) ? prior.applied_to.filter((r) => typeof r === 'string') : [];
  const cleanRole = typeof role === 'string' ? role.trim() : '';
  if (cleanRole && !applied.some((r) => r.toLowerCase() === cleanRole.toLowerCase())) applied.push(cleanRole);
  delete prior.applied_to;
  if (applied.length) next.applied_to = applied;
  const wide = scope === 'company' || prior.scope === 'company';
  delete prior.scope;
  Object.assign(next, prior);
  if (wide) next.scope = 'company';
  return next;
}

// ── text edit ────────────────────────────────────────────────────

const indentOf = (line) => /^[ ]*/.exec(line)[0];
const isBlankOrComment = (line) => {
  const t = line.trim();
  return t === '' || t.startsWith('#');
};

/** The mapping key on a block-mapping line, unquoted, or null. */
function lineKey(line) {
  const t = line.trimStart();
  const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^#:\s][^#:]*?)\s*:(?:\s|$)/.exec(t);
  if (!m) return null;
  try {
    const parsed = yaml.load(`${m[1]}: 0`);
    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
    return keys.length === 1 ? keys[0] : null;
  } catch {
    return null;
  }
}

// Strings are written double-quoted, the style profile.example.yml uses
// (JSON string syntax is valid YAML). A value of a shape this module never
// writes (a user's own nested key) falls back to js-yaml for that key alone.
const renderKey = (key) => (/^[A-Za-z0-9][A-Za-z0-9 _.&-]*$/.test(key) && !/\s$/.test(key) ? key : JSON.stringify(key));

/** Render one window as block lines at `indent`. */
function renderBlock(key, win, indent) {
  const lines = [`${indent}${renderKey(key)}:`];
  const inner = `${indent}  `;
  for (const [k, v] of Object.entries(win)) {
    if (typeof v === 'string') lines.push(`${inner}${renderKey(k)}: ${JSON.stringify(v)}`);
    else if (typeof v === 'number' || typeof v === 'boolean') lines.push(`${inner}${renderKey(k)}: ${v}`);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      lines.push(`${inner}${renderKey(k)}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    } else {
      const dumped = yaml.dump({ [k]: v }, { lineWidth: -1, noRefs: true }).replace(/\n$/, '').split('\n');
      lines.push(...dumped.map((line) => `${inner}${line}`));
    }
  }
  return lines;
}

/**
 * Set `re_apply_windows.<company>` in profile text, keeping every other line.
 *
 * @param {string} source current profile.yml text ('' for none)
 * @param {string} company the company as the tracker names it
 * @param {{ from: string, days: number, role?: string, scope?: 'role' | 'company' }} input
 * @returns {{ text: string, key: string, window: Record<string, unknown> } | null}
 *   null when the profile is not a mapping, or uses a shape this edit does not place
 */
export function upsertReapplyWindow(source, company, input) {
  let doc;
  try {
    doc = loadYaml(source) ?? {};
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const section = doc[SECTION];
  if (section != null && (typeof section !== 'object' || Array.isArray(section))) return null;

  const key = findWindowKey(section, company) ?? company.trim();
  const window = mergeWindow(section?.[key], input);
  const expected = { ...doc, [SECTION]: { ...(section ?? {}), [key]: window } };

  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const sectionAt = lines.findIndex((line) => new RegExp(`^${SECTION}\\s*:\\s*(#.*)?$`).test(line));
  if (sectionAt === -1) {
    // A non-block form (`re_apply_windows: {}`) is a shape we do not rewrite.
    if (lines.some((line) => new RegExp(`^${SECTION}\\s*:`).test(line))) return null;
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`${SECTION}:`, ...renderBlock(key, window, '  '));
  } else {
    let end = lines.length;
    for (let i = sectionAt + 1; i < lines.length; i++) {
      if (!isBlankOrComment(lines[i]) && indentOf(lines[i]) === '') { end = i; break; }
    }
    const children = [];
    for (let i = sectionAt + 1; i < end; i++) if (!isBlankOrComment(lines[i])) children.push(i);
    const childIndent = children.length ? indentOf(lines[children[0]]) : '  ';
    const block = renderBlock(key, window, childIndent);
    const at = children.find((i) => indentOf(lines[i]) === childIndent && lineKey(lines[i]) === key);
    if (at === undefined) {
      const insert = children.length ? children[children.length - 1] + 1 : sectionAt + 1;
      lines.splice(insert, 0, ...block);
    } else {
      // The block runs to the last line indented deeper than the key.
      let last = at;
      for (let i = at + 1; i < end; i++) {
        if (isBlankOrComment(lines[i])) continue;
        if (indentOf(lines[i]).length > childIndent.length) last = i;
        else break;
      }
      lines.splice(at, last - at + 1, ...block);
    }
  }

  const text = lines.join(eol) + eol;
  try {
    return isDeepStrictEqual(loadYaml(text), expected) ? { text, key, window } : null;
  } catch {
    return null;
  }
}

/**
 * Record a cooldown in the profile file. Never throws: the outcome is data for
 * the caller to report, because a status change that already landed must not
 * fail over its side effect.
 *
 * @param {{ profilePath: string, company: string, role?: string, from: string, days: number,
 *           scope?: 'role' | 'company', dryRun?: boolean }} input
 * @returns {{ recorded: boolean, dryRun?: boolean, company?: string, from?: string, until?: string,
 *             days?: number, scope?: string, reason?: string, error?: string }}
 */
export function recordCooldown({ profilePath, company, role, from, days, scope = 'role', dryRun = false }) {
  try {
    if (!company || !company.trim()) return { recorded: false, reason: 'no-company' };
    if (!isCalendarDate(from)) return { recorded: false, reason: 'bad-date' };
    if (!Number.isInteger(days) || days < 0 || days > MAX_COOLDOWN_DAYS) return { recorded: false, reason: 'bad-days' };
    if (days === 0) return { recorded: false, reason: 'no-cooldown' };
    if (!existsSync(profilePath)) return { recorded: false, reason: 'no-profile' };
    const source = readFileSync(profilePath, 'utf-8');
    const result = upsertReapplyWindow(source, company, { from, days, role, scope });
    if (!result) {
      return { recorded: false, reason: 'unplaceable', error: `could not edit ${SECTION} in ${profilePath} without rewriting it; add the window by hand` };
    }
    const summary = {
      company: result.key,
      from: windowStart(result.window),
      until: windowUntil(result.window),
      days: Number(result.window.same_role_days || 0),
      scope: result.window.scope === 'company' ? 'company' : 'role',
    };
    if (dryRun) return { recorded: false, dryRun: true, ...summary };
    if (result.text !== source) writeFileAtomic(profilePath, result.text);
    return { recorded: true, ...summary };
  } catch (err) {
    return { recorded: false, reason: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
