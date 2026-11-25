#!/usr/bin/env node
/**
 * panelist-roles.mjs - classify the people named in an interview invite (#5797).
 *
 * When an invite names the panel, the prep should change with who is on it: a
 * privacy officer probes confidentiality, a hiring manager probes delivery, a
 * recruiter probes fit and logistics, a technical peer probes depth.
 * invite-match.mjs reads an invite for company / date / requisition and
 * ics-interview.mjs reads the calendar file, but neither looks at the people.
 *
 * Input: the same pasted invite text / file those take, or an .ics (the
 * SUMMARY, DESCRIPTION and ORGANIZER / ATTENDEE display names of the first
 * VEVENT). Extracted from that text ONLY:
 *   - `Name - Title`  (hyphen, en dash, em dash or pipe)
 *   - `Name, Title`   (only when the title carries a known title word)
 *   - `meeting with Name` style lead-ins (name, no title -> role `unknown`)
 *   - sign-off blocks (`Regards,` / name / title, or a title alone)
 * Each title is classified with the keyword table in
 * templates/panelist-roles.yml (editable data; see that file, and `--table`
 * for a copy of your own). First matching role wins, any further matching role
 * is listed as `alsoMatches`, no match is `unknown`.
 *
 * Offline and zero-LLM: no network, no LinkedIn or any other profile lookup,
 * no dependency beyond the YAML loader the repo already uses.
 *
 * Read-only: it writes nothing - not the tracker, not a cache, not a log.
 * Panelist names are third-party personal data, so they exist only in this
 * run's output; do not copy them into data/ or reports/ files you commit.
 *
 * Everything extracted is DATA. Names and titles are echoed (control
 * characters stripped, length capped) and classified by keyword; an
 * instruction-like sentence in the invite is never followed, and it only shows
 * up if it happens to have the `Name - Title` shape, as a plain string.
 *
 * Usage:
 *   node panelist-roles.mjs invite.txt              # JSON
 *   node panelist-roles.mjs invite.txt --summary    # one line per panelist
 *   node panelist-roles.mjs invite.ics --summary
 *   pbpaste | node panelist-roles.mjs --summary     # stdin
 *   node panelist-roles.mjs invite.txt --table config/panelist-roles.yml
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';
import { loadYaml } from './lib/yaml-document.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { unfoldLines, parseContentLine, unescapeText } from './ics-interview.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TABLE = join(HERE, 'templates', 'panelist-roles.yml');

const MAX_NAME = 80;
const MAX_TITLE = 160;

// ---------------------------------------------------------------------------
// Role table
// ---------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compileKeyword(raw) {
  const whole = raw.startsWith('=');
  const word = (whole ? raw.slice(1) : raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!word) throw new Error(`keyword "${raw}" has no text`);
  // Word START boundary; `=kw` also needs a word END boundary.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word).replace(/ /g, '\\s+')}${whole ? '(?![\\p{L}\\p{N}])' : ''}`, 'u');
  return { raw, re };
}

/** Validate a parsed table; returns { fallback, roles } or throws Error with a plain message. */
export function validateTable(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('table is empty or not a YAML mapping');
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  const fb = doc.fallback;
  if (!fb || !str(fb.id) || !str(fb.label) || !str(fb.focus)) {
    throw new Error('`fallback` needs id, label and focus');
  }
  if (!Array.isArray(doc.roles) || doc.roles.length === 0) throw new Error('`roles` must be a non-empty list');
  const seen = new Set([fb.id]); // a role id equal to the fallback id would be read as "no match"
  const roles = doc.roles.map((r, i) => {
    if (!r || !str(r.id) || !str(r.label) || !str(r.focus)) throw new Error(`roles[${i}] needs id, label and focus`);
    if (seen.has(r.id)) throw new Error(`roles[${i}]: duplicate id "${r.id}"`);
    seen.add(r.id);
    if (!Array.isArray(r.keywords) || r.keywords.length === 0 || !r.keywords.every(str)) {
      throw new Error(`roles[${i}] (${r.id}): keywords must be a non-empty list of strings`);
    }
    return { id: r.id, label: r.label, focus: r.focus.trim(), keywords: r.keywords.map((k) => compileKeyword(k)) };
  });
  return { fallback: { id: fb.id, label: fb.label, focus: fb.focus.trim() }, roles };
}

export function loadTable(path = DEFAULT_TABLE) {
  if (!existsSync(path)) throw new Error(`role table not found: ${path}`);
  return validateTable(loadYaml(readFileSync(path, 'utf-8')));
}

/** Classify one title. No title or no keyword hit -> the fallback. */
export function classifyTitle(title, table) {
  const t = String(title ?? '').toLowerCase();
  const hits = t ? table.roles.filter((r) => r.keywords.some((k) => k.re.test(t))) : [];
  if (hits.length === 0) return { role: table.fallback.id, label: table.fallback.label, focus: table.fallback.focus, alsoMatches: [] };
  return { role: hits[0].id, label: hits[0].label, focus: hits[0].focus, alsoMatches: hits.slice(1).map((h) => h.id) };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const clean = (s, max) => String(s ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const CAP = "\\p{Lu}[\\p{L}'\u2019.-]*";
const PARTICLE = '(?:van|von|der|den|de|del|della|da|di|la|le|bin|al|el)';
const NAME_SRC = `${CAP}(?:\\s+(?:${PARTICLE}\\s+)?${CAP}){1,3}`;
const SEP_SRC = '(?=\\s+[-\u2013\u2014|]\\s+|,\\s+\\S)';

// Words that start a sentence or a greeting and are not part of a name.
const NOT_NAME = new Set([
  'hi', 'hello', 'dear', 'thanks', 'thank', 'regards', 'best', 'sincerely', 'cheers', 'kind', 'warm', 'please',
  'you', 'your', 'we', 'our', 'the', 'a', 'an', 'this', 'that', 'note', 'also', 'join', 'joining', 'meet', 'meeting',
  'interview', 'interviewer', 'interviewers', 'panel', 'panelist', 'panelists', 'round', 'phone', 'video', 'screen',
  'zoom', 'teams', 'microsoft', 'google', 'webex', 'location', 'when', 'where', 'who', 'what', 'time', 'date', 'subject',
  'from', 'to', 'cc', 'bcc', 'sent', 're', 'fw', 'fwd', 'system', 'assistant', 'ai', 'ignore', 'disregard',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
]);

const SIGNOFF = /^\s*(?:best(?: regards| wishes)?|kind regards|warm regards|regards|sincerely|cheers|thanks|thank you|many thanks|yours truly|respectfully|with thanks)\b[\s,!.-]*$/i;

const LEAD_IN = /(?:\b(?:meeting|meet|speaking|speak|talking|talk|chatting|chat)\s+with|\binterviewed\s+by|\bjoined\s+by|\bpanel\s+(?:includes|consists\s+of|members?:?)|\bpanelists?:|\binterviewers?:|\byour\s+interviewers?\s+(?:is|are)|\binterview(?:er)?s?\s+(?:will\s+be|include))\s+/gi;

/** Allowed text just before a name for it to start a panelist entry. */
const CONTEXT_OK = /(?:^|[&;:(]|\b(?:with|and|by|includes?|including|panel|panelists?|interviewers?|meet|meeting|joined|joining)|^[\s\-*\u2022\d.)]+)\s*$/i;

function trimName(raw) {
  const words = String(raw).trim().split(/\s+/);
  while (words.length && NOT_NAME.has(words[0].toLowerCase().replace(/[^\p{L}]/gu, ''))) words.shift();
  if (words.length < 2) return null;
  const name = words.join(' ').replace(/[.,]+$/, '');
  return clean(name, MAX_NAME);
}

/** Cut a raw title segment down to the title itself. */
export function trimTitle(raw) {
  let t = String(raw ?? '');
  // sentence end or clause break
  t = t.split(/\.(?:\s|$)|;/)[0];
  // dangling clause after the title
  t = t.replace(/,?\s+(?:who|which|and\s+(?:will|is|are)|will|is|are|to\s+discuss|for\s+(?:a|the|your)|about)\s.*$/i, '');
  // trailing "and myself / me / I / the team ..."
  t = t.replace(/\s+(?:and|&)\s+(?:myself|me|i|us|we|the\s+(?:team|rest|hiring\s+team)|others?)\b.*$/i, '');
  // an unbalanced closing bracket ends the title
  let depth = 0;
  let cut = t.length;
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] === '(') depth += 1;
    else if (t[i] === ')') {
      if (depth === 0) { cut = i; break; }
      depth -= 1;
    }
  }
  t = t.slice(0, cut);
  t = t.replace(/[\s,&:\-\u2013\u2014|]+$/, '').replace(/\s+(?:and|&)$/i, '').replace(/^[\s,:\-\u2013\u2014|]+/, '');
  return clean(t, MAX_TITLE);
}

const hasKeyword = (title, table) => classifyTitle(title, table).role !== table.fallback.id;

/**
 * Extract { name, title, source } entries from invite text. `table` is only
 * used to decide whether a `Name, X` comma form really carries a title.
 */
export function extractPanelists(text, table) {
  const found = [];
  const byKey = new Map();
  const add = (name, title, source) => {
    const n = name ? clean(name, MAX_NAME) : null;
    const t = title ? clean(title, MAX_TITLE) : null;
    if (!n && !t) return;
    const key = n ? n.toLowerCase() : `\u0000title:${(t || '').toLowerCase()}`;
    const prior = byKey.get(key);
    if (prior) {
      if (!prior.title && t) { prior.title = t; prior.source = source; }
      return;
    }
    const entry = { name: n, title: t || null, source };
    byKey.set(key, entry);
    found.push(entry);
  };

  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const nameRe = new RegExp(`(${NAME_SRC})${SEP_SRC}`, 'gu');

  for (const line of lines) {
    // 1. Name - Title / Name, Title
    const cands = [];
    nameRe.lastIndex = 0;
    let m;
    while ((m = nameRe.exec(line)) !== null) {
      const name = trimName(m[1]);
      const nameEnd = m.index + m[1].length;
      if (!name) { nameRe.lastIndex = m.index + 1; continue; }
      // Where the trimmed name really starts, after any dropped greeting words.
      const dropped = Math.max(0, m[1].trim().split(/\s+/).length - name.split(' ').length);
      let offset = 0;
      for (let i = 0; i < dropped; i += 1) offset += /^\s*\S+\s*/.exec(m[1].slice(offset))[0].length;
      const start = m.index + offset;
      if (!CONTEXT_OK.test(line.slice(0, start).replace(/(?:\b(?:hi|hello|hey|dear|thanks|thank you)\b[\s,]*)+$/i, ''))) { nameRe.lastIndex = nameEnd; continue; }
      const rest = line.slice(nameEnd);
      const dash = /^\s+[-\u2013\u2014|]\s+/.exec(rest);
      const comma = dash ? null : /^,\s+/.exec(rest);
      const sep = dash || comma;
      if (!sep) { nameRe.lastIndex = nameEnd; continue; }
      cands.push({ name, start, titleStart: nameEnd + sep[0].length, form: dash ? 'dash' : 'comma' });
      nameRe.lastIndex = nameEnd + sep[0].length;
    }
    cands.forEach((c, i) => {
      const end = i + 1 < cands.length ? cands[i + 1].start : line.length;
      const title = trimTitle(line.slice(c.titleStart, end));
      if (!title || /^\d/.test(title)) return;
      if (c.form === 'comma' && !hasKeyword(title, table)) return;
      add(c.name, title, c.form === 'dash' ? 'name-dash-title' : 'name-comma-title');
    });

    // 2. lead-in, name without a title ("meeting with Jordan Rivera and Sam Lee")
    LEAD_IN.lastIndex = 0;
    let lm;
    while ((lm = LEAD_IN.exec(line)) !== null) {
      let pos = lm.index + lm[0].length;
      const sticky = new RegExp(NAME_SRC, 'uy');
      for (let guard = 0; guard < 6; guard += 1) {
        sticky.lastIndex = pos;
        const nm = sticky.exec(line);
        if (!nm) break;
        const name = trimName(nm[0]);
        if (!name) break;
        pos = nm.index + nm[0].length;
        add(name, null, 'lead-in');
        const next = /^\s*(?:,\s*(?:and\s+|&\s+)?|\s+and\s+|\s*&\s+)/i.exec(line.slice(pos));
        if (!next) break;
        pos += next[0].length;
      }
    }
  }

  // 3. sign-off block: "Regards," / Name / Title   or   "Regards," / Title
  const isShort = (l) => l.split(/\s+/).length <= 8 && !/[@:/]|https?|\d{3}/.test(l);
  const nameOnly = new RegExp(`^${NAME_SRC}$`, 'u');
  for (let i = 0; i < lines.length; i += 1) {
    if (!SIGNOFF.test(lines[i])) continue;
    const next = [];
    for (let j = i + 1; j < lines.length && next.length < 3; j += 1) {
      const l = lines[j].trim();
      if (l) next.push(l);
      else if (next.length) break;
    }
    if (next[0] && isShort(next[0]) && nameOnly.test(next[0]) && !hasKeyword(next[0], table) && trimName(next[0]) && next[1] && isShort(next[1]) && hasKeyword(next[1], table)) {
      add(trimName(next[0]), trimTitle(next[1]), 'signature');
    } else if (next[0] && isShort(next[0]) && hasKeyword(next[0], table)) {
      add(null, trimTitle(next[0]), 'signature');
    }
  }
  return found;
}

/** Pull the first VEVENT's text and display names out of an .ics body. */
export function readIcsText(body) {
  const text = [];
  const names = [];
  let inEvent = false;
  let alarm = 0;
  for (const line of unfoldLines(body)) {
    const p = parseContentLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') { inEvent = true; continue; }
    if (p.name === 'END' && p.value.toUpperCase() === 'VEVENT') break;
    if (!inEvent) continue;
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VALARM') { alarm += 1; continue; }
    if (p.name === 'END' && p.value.toUpperCase() === 'VALARM') { alarm -= 1; continue; }
    if (alarm > 0) continue;
    if (p.name === 'SUMMARY' || p.name === 'DESCRIPTION') text.push(unescapeText(p.value));
    if ((p.name === 'ORGANIZER' || p.name === 'ATTENDEE') && p.params.CN) {
      const n = trimName(unescapeText(p.params.CN));
      if (n && !n.includes('@')) names.push({ name: n, source: p.name === 'ORGANIZER' ? 'ics-organizer' : 'ics-attendee' });
    }
  }
  return { text: text.join('\n'), names };
}

/**
 * Full analysis of invite text (or an .ics body).
 * @returns {{ input: 'text'|'ics', panelists: object[], roles: object[], warnings: object[] }}
 */
export function analyzePanel(body, table) {
  const isIcs = /BEGIN:VCALENDAR/i.test(body);
  let text = body;
  let extra = [];
  if (isIcs) {
    const ics = readIcsText(body);
    text = ics.text;
    extra = ics.names;
  }
  const entries = extractPanelists(text, table);
  for (const e of extra) {
    if (!entries.some((x) => x.name && x.name.toLowerCase() === e.name.toLowerCase())) {
      entries.push({ name: e.name, title: null, source: e.source });
    }
  }
  const panelists = entries.map((e) => {
    const c = classifyTitle(e.title, table);
    return { name: e.name, title: e.title, role: c.role, roleLabel: c.label, alsoMatches: c.alsoMatches, source: e.source, prepFocus: c.focus };
  });
  const byRole = new Map();
  for (const p of panelists) {
    if (!byRole.has(p.role)) byRole.set(p.role, { role: p.role, label: p.roleLabel, count: 0, prepFocus: p.prepFocus });
    byRole.get(p.role).count += 1;
  }
  const warnings = [];
  if (panelists.length === 0) {
    warnings.push({ code: 'no-panelists', message: 'No "Name - Title", "Name, Title", "meeting with Name" or sign-off pattern was found in the text.' });
  }
  if (panelists.some((p) => p.source === 'signature' || p.source === 'ics-organizer')) {
    warnings.push({ code: 'sender-may-not-be-panelist', message: 'Signature and organizer entries are the sender; they may not be on the panel.' });
  }
  return { input: isIcs ? 'ics' : 'text', panelists, roles: [...byRole.values()], warnings };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const KNOWN_FLAGS = ['--summary', '--table', '--help', '-h'];
const VALUE_FLAGS = ['--table'];
const USAGE = `Usage:
  node panelist-roles.mjs <invite.txt|invite.ics>            # JSON: panelists, roles, one-line prep focus per role
  node panelist-roles.mjs < invite.txt                        # read the invite text from stdin
  node panelist-roles.mjs <invite> --summary                  # one line per panelist
  node panelist-roles.mjs <invite> --table <panelist-roles.yml>   # your own keyword table (default: templates/panelist-roles.yml)
  node panelist-roles.mjs --help

Offline and read-only: no network, no profile lookups, writes nothing. Panelist
names appear in the output only; they are third-party personal data.`;

function positionalOperand(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (VALUE_FLAGS.includes(a)) { i += 1; continue; }
    if (!a.startsWith('-')) return a;
  }
  return null;
}

function printSummary(r) {
  console.log(`\n${'='.repeat(70)}\n  Panelist roles - career-ops\n${'='.repeat(70)}\n`);
  if (r.panelists.length === 0) console.log('  No panelists found.');
  for (const p of r.panelists) {
    const who = p.name ?? '(name not given)';
    const also = p.alsoMatches.length ? ` (also: ${p.alsoMatches.join(', ')})` : '';
    console.log(`  ${who} - ${p.title ?? '(no title)'}`);
    console.log(`    ${p.role}${also}: ${p.prepFocus}`);
  }
  for (const w of r.warnings) console.log(`  ! ${w.code}: ${w.message}`);
  console.log('');
}

/**
 * An explicit --table: absolute paths as given; a relative path is read from
 * the working directory, else from the data root (CAREER_OPS_ROOT), so the
 * documented `config/panelist-roles.yml` works from anywhere. Never implicit:
 * only a path the caller named is looked up.
 */
function resolveTablePath(p) {
  if (isAbsolute(p) || existsSync(p)) return p;
  const underRoot = join(getCareerOpsRoot(), p);
  return existsSync(underRoot) ? underRoot : p;
}

function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  let table;
  const tablePath = flagValue(args, '--table');
  try {
    table = loadTable(tablePath === undefined ? DEFAULT_TABLE : resolveTablePath(tablePath));
  } catch (e) {
    console.error(`panelist-roles: cannot use role table${tablePath ? ` ${tablePath}` : ''}: ${e.message}`);
    process.exit(2);
  }

  const operand = positionalOperand(args);
  let body;
  if (operand) {
    try {
      body = readFileSync(operand, 'utf-8');
    } catch (e) {
      console.error(`panelist-roles: cannot read ${operand}: ${e.code === 'ENOENT' ? 'file not found' : e.message}`);
      process.exit(1);
    }
  } else {
    try {
      body = readFileSync(0, 'utf-8');
    } catch (e) {
      console.error(`panelist-roles: no file given and stdin could not be read (${e.message}). ${USAGE.split('\n')[1].trim()}`);
      process.exit(1);
    }
  }

  const result = analyzePanel(body, table);
  if (args.includes('--summary')) printSummary(result);
  else console.log(JSON.stringify(result, null, 2));
}

if (isMainModule(import.meta.url)) {
  main();
}
