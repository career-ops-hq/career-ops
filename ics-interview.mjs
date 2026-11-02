#!/usr/bin/env node
/**
 * ics-interview.mjs — read an interview invite's .ics into an
 * active-interviews.md row (#5743).
 *
 * Interview invites very often carry an .ics attachment, and that file is the
 * one place holding the exact start, end, time zone and link in machine-readable
 * form. invite-match.mjs reads the invite TEXT; nothing read the .ics itself,
 * so the candidate copied the date, zone, link and length by hand.
 *
 * For the FIRST VEVENT this prints (JSON, or --summary):
 *   - start / end as stated (original TZID kept) and the same instant in the
 *     display zone, plus durationMinutes (from DTEND or DURATION)
 *   - summary, location, a meeting URL found in LOCATION / DESCRIPTION / URL
 *   - organizer and attendees (display names only, never addresses)
 *   - a ready-to-paste `| Company | Role | Round | Date/Time | Interviewer |
 *     Status | Notes |` row for data/active-interviews.md, with every field
 *     that could not be read left as an em dash rather than guessed
 *
 * Read-only and zero-LLM: it never writes data/active-interviews.md (the user
 * pastes the row), and the iCalendar subset it needs is parsed by hand, so
 * there is no new dependency.
 *
 * Time semantics, reported rather than assumed:
 *   - `...Z`                     UTC instant
 *   - `;TZID=Area/City`          wall time in that zone, converted to an instant
 *   - no zone and no `Z`         floating: a wall time with NO zone; not converted
 *   - `;VALUE=DATE`              all-day: reported as a date, never as a time
 *   - a TZID that is not an IANA zone (e.g. a Windows zone name) is reported as
 *     `unknown-tzid` and not converted
 *   - RRULE is ignored (only the first occurrence is read; a warning says so)
 *
 * Display zone: --tz, else config/profile.yml `location.timezone` (when it is
 * a valid IANA name), else this machine's zone.
 *
 * Usage:
 *   node ics-interview.mjs invite.ics            # JSON
 *   node ics-interview.mjs invite.ics --summary  # human-readable
 *   node ics-interview.mjs < invite.ics          # read stdin
 *   node ics-interview.mjs invite.ics --tz America/Toronto
 *   node ics-interview.mjs invite.ics --match "<invite email text>"
 */

import { readFileSync, existsSync } from 'fs';
import { loadYaml } from './lib/yaml-document.mjs';
import { getProfilePath } from './path-resolver.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const DASH = '—';

// ---------------------------------------------------------------------------
// iCalendar parsing
// ---------------------------------------------------------------------------

/** RFC 5545 line unfolding: a CRLF (or LF) followed by one space/tab continues the line. */
export function unfoldLines(text) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
}

/**
 * Split one unfolded content line into { name, params, value }. Parameter
 * values may be double-quoted and then may contain ':' / ';' / ','.
 */
export function parseContentLine(line) {
  let i = 0;
  const n = line.length;
  const readUntil = (stops) => {
    let s = '';
    let quoted = false;
    while (i < n) {
      const c = line[i];
      if (c === '"') { quoted = !quoted; s += c; i += 1; continue; }
      if (!quoted && stops.includes(c)) break;
      s += c;
      i += 1;
    }
    return s;
  };
  const name = readUntil([':', ';']).toUpperCase();
  const params = {};
  while (i < n && line[i] === ';') {
    i += 1;
    const key = readUntil(['=', ':', ';']).toUpperCase();
    let val = '';
    if (line[i] === '=') {
      i += 1;
      val = readUntil([':', ';']);
    }
    params[key] = val.replace(/^"(.*)"$/, '$1');
  }
  if (line[i] !== ':') return null;
  return { name, params, value: line.slice(i + 1) };
}

/** iCalendar TEXT unescaping: \n \N newline, \, \; \\ literals. */
export function unescapeText(value) {
  return String(value ?? '').replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Parse an iCalendar DURATION (PT45M, PT1H30M, P1D, P1W, -PT15M) into minutes, or null. */
export function parseDurationMinutes(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(value ?? '').trim());
  if (!m || value.trim().length <= 1) return null;
  const [, sign, w, d, h, mi, s] = m;
  const total = (Number(w || 0) * 7 + Number(d || 0)) * 1440 + Number(h || 0) * 60 + Number(mi || 0) + Number(s || 0) / 60;
  return (sign === '-' ? -1 : 1) * Math.round(total);
}

/**
 * Parse a DTSTART / DTEND value. Returns null when the value is unreadable.
 * kind: 'date' (all-day) | 'utc' | 'zoned' | 'floating'
 */
export function parseIcsDate(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  // Date.UTC remaps years 0-99 to 1900-1999, and an interview in those years is
  // not a real invite, so a year before 1000 is treated as unreadable.
  if (+y < 1000) return null;
  const base = { y: +y, mo: +mo, d: +d, h: +(h ?? 0), mi: +(mi ?? 0), s: +(s ?? 0), raw: value.trim() };
  if (mo === '00' || +mo > 12 || +d < 1 || base.h > 23 || base.mi > 59 || base.s > 60) return null;
  // The day must exist in that month (Feb 30 would otherwise roll into March).
  if (+d > new Date(Date.UTC(+y, +mo, 0)).getUTCDate()) return null;
  const isDateOnly = h === undefined || String(params.VALUE ?? '').toUpperCase() === 'DATE';
  if (isDateOnly) return { ...base, kind: 'date', tzid: null };
  if (z) return { ...base, kind: 'utc', tzid: null };
  if (params.TZID) return { ...base, kind: 'zoned', tzid: params.TZID };
  return { ...base, kind: 'floating', tzid: null };
}

/**
 * Parse the FIRST VEVENT of an .ics body.
 * @returns {{ props: Array<{name:string, params:object, value:string}> } | null}
 */
export function firstEvent(text) {
  const lines = unfoldLines(text);
  let depth = 0;
  let inEvent = false;
  const props = [];
  for (const line of lines) {
    const p = parseContentLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (!inEvent && p.value.toUpperCase() === 'VEVENT') { inEvent = true; depth = 0; continue; }
      if (inEvent) depth += 1;
      continue;
    }
    if (p.name === 'END') {
      if (inEvent && depth === 0 && p.value.toUpperCase() === 'VEVENT') return { props };
      if (inEvent) depth -= 1;
      continue;
    }
    // Properties of nested components (e.g. VALARM) are not the event's.
    if (inEvent && depth === 0) props.push(p);
  }
  // A truncated file that never closes the VEVENT still yields what it had.
  return inEvent ? { props } : null;
}

// ---------------------------------------------------------------------------
// Time zones (Intl only)
// ---------------------------------------------------------------------------

export function isValidZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function machineZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function zoneParts(ms, zone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  });
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}

function offsetMs(ms, zone) {
  const o = zoneParts(ms, zone);
  const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock time in `zone` -> epoch ms (gap/overlap times resolve to the earlier offset). */
export function wallToInstant(d, zone) {
  const guess = Date.UTC(d.y, d.mo - 1, d.d, d.h, d.mi, d.s);
  let ms = guess - offsetMs(guess, zone);
  ms = guess - offsetMs(ms, zone);
  return ms;
}

/** Instant formatted in a zone: { date: 'YYYY-MM-DD', time: 'HH:MM', abbr, zone }. */
export function formatInZone(ms, zone) {
  const o = zoneParts(ms, zone);
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}`, abbr: o.timeZoneName, zone };
}

const pad = (n) => String(n).padStart(2, '0');
const wallString = (d) => `${d.y}-${pad(d.mo)}-${pad(d.d)}T${pad(d.h)}:${pad(d.mi)}:${pad(d.s)}`;

/**
 * Describe one parsed DTSTART/DTEND: the time as stated, plus its instant when
 * one can be established without assuming anything.
 */
function describeTime(t, warnings, label) {
  if (!t) return null;
  const out = { raw: t.raw, kind: t.kind, tzid: t.tzid, local: t.kind === 'date' ? `${t.y}-${pad(t.mo)}-${pad(t.d)}` : wallString(t), utc: null, epochMs: null };
  if (t.kind === 'utc') {
    out.epochMs = Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi, t.s);
  } else if (t.kind === 'zoned') {
    if (isValidZone(t.tzid)) {
      out.epochMs = wallToInstant(t, t.tzid);
    } else {
      out.kind = 'unknown-tzid';
      warnings.push({ code: 'unknown-tzid', message: `${label} TZID "${t.tzid}" is not an IANA time zone this tool can read; the time is shown as written and not converted.` });
    }
  } else if (t.kind === 'floating') {
    warnings.push({ code: 'floating-time', message: `${label} has no time zone (floating); it is shown as written and not converted.` });
  }
  if (out.epochMs !== null) out.utc = new Date(out.epochMs).toISOString().replace('.000Z', 'Z');
  return out;
}

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"'\\)\]]+/gi;
const MEETING_HOST_RE = /(zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|webex\.com|gotomeeting\.com|goto\.com|whereby\.com|bluejeans\.com|chime\.aws|hirevue\.com|calendly\.com)/i;

/** First meeting-looking URL across the given texts, else the first URL at all, else null. */
export function findMeetingUrl(...texts) {
  const urls = [];
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(URL_RE)) urls.push(m[0].replace(/[.,;:!?]+$/, ''));
  }
  return urls.find((u) => MEETING_HOST_RE.test(u)) ?? urls[0] ?? null;
}

function personName(prop) {
  const cn = prop?.params?.CN;
  const name = cn ? unescapeText(cn).trim() : '';
  // Names only: a CN that is itself an address (or a mailto:) is never emitted.
  if (!name || /^mailto:/i.test(name) || /\S+@\S+/.test(name)) return null;
  return name;
}

/**
 * Parse an .ics body.
 * @param {string} text
 * @param {{displayZone?: string}} [opts]
 * @returns {{event: object|null, warnings: Array<{code:string,message:string}>}}
 */
export function parseIcs(text, { displayZone } = {}) {
  const warnings = [];
  const ev = firstEvent(text);
  if (!ev) {
    warnings.push({ code: 'no-vevent', message: 'No VEVENT found in the input.' });
    return { event: null, warnings };
  }
  const get = (name) => ev.props.find((p) => p.name === name);
  const text_ = (name) => { const p = get(name); return p ? unescapeText(p.value).trim() || null : null; };

  if (get('RRULE')) warnings.push({ code: 'rrule-ignored', message: 'RRULE present and ignored; only the first occurrence is read.' });

  const dtstartProp = get('DTSTART');
  const start = describeTime(dtstartProp ? parseIcsDate(dtstartProp.value, dtstartProp.params) : null, warnings, 'DTSTART');
  if (!start) warnings.push({ code: 'no-start', message: dtstartProp ? `DTSTART "${dtstartProp.value}" is not readable.` : 'No DTSTART.' });

  const dtendProp = get('DTEND');
  const durProp = get('DURATION');
  let end = describeTime(dtendProp ? parseIcsDate(dtendProp.value, dtendProp.params) : null, warnings, 'DTEND');
  if (dtendProp && !end) warnings.push({ code: 'bad-end', message: `DTEND "${dtendProp.value}" is not readable.` });

  let durationMinutes = null;
  if (start && end) {
    if (start.kind === 'date' || end.kind === 'date') {
      if (start.kind === 'date' && end.kind === 'date') {
        durationMinutes = Math.round((Date.UTC(+end.local.slice(0, 4), +end.local.slice(5, 7) - 1, +end.local.slice(8, 10))
          - Date.UTC(+start.local.slice(0, 4), +start.local.slice(5, 7) - 1, +start.local.slice(8, 10))) / 60000);
      }
    } else if (start.epochMs !== null && end.epochMs !== null) {
      durationMinutes = Math.round((end.epochMs - start.epochMs) / 60000);
    } else if (start.kind === end.kind && start.tzid === end.tzid && start.kind !== 'zoned') {
      // Same floating clock on both ends: the difference is meaningful without a zone.
      durationMinutes = Math.round((Date.parse(`${end.local}Z`) - Date.parse(`${start.local}Z`)) / 60000);
    } else if (start.tzid && start.tzid === end.tzid) {
      // Same unreadable TZID on both ends: wall-clock difference.
      durationMinutes = Math.round((Date.parse(`${end.local}Z`) - Date.parse(`${start.local}Z`)) / 60000);
    }
  } else if (start && !end && durProp) {
    durationMinutes = parseDurationMinutes(durProp.value);
    if (durationMinutes === null) warnings.push({ code: 'bad-duration', message: `DURATION "${durProp.value}" is not readable.` });
    else if (start.kind !== 'date' && start.epochMs !== null) {
      const epochMs = start.epochMs + durationMinutes * 60000;
      end = { raw: null, kind: 'derived', tzid: start.tzid, local: null, utc: new Date(epochMs).toISOString().replace('.000Z', 'Z'), epochMs };
    }
  } else if (start && !end) {
    warnings.push({ code: 'no-end', message: 'No DTEND or DURATION; the length is not stated in the .ics.' });
  }
  if (durationMinutes !== null && durationMinutes < 0) {
    warnings.push({ code: 'negative-duration', message: 'End is before start; length left unstated.' });
    durationMinutes = null;
  }

  const allDay = start?.kind === 'date';
  const zone = displayZone ?? machineZone();
  let display = null;
  if (start && start.epochMs !== null && !allDay) {
    display = { zone, start: formatInZone(start.epochMs, zone), end: end && end.epochMs !== null ? formatInZone(end.epochMs, zone) : null };
  }

  const organizerProp = get('ORGANIZER');
  const attendees = ev.props.filter((p) => p.name === 'ATTENDEE').map(personName).filter(Boolean);
  const organizer = personName(organizerProp);

  const strip = (t) => (t ? { raw: t.raw, kind: t.kind, tzid: t.tzid, local: t.local, utc: t.utc } : null);
  return {
    event: {
      summary: text_('SUMMARY'),
      location: text_('LOCATION'),
      meetingUrl: findMeetingUrl(text_('LOCATION'), text_('DESCRIPTION'), text_('URL')),
      organizer,
      attendees,
      allDay,
      start: strip(start),
      end: strip(end),
      durationMinutes: allDay ? null : durationMinutes,
      display,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// active-interviews.md row
// ---------------------------------------------------------------------------

const cell = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
  return s || DASH;
};

/** Date/Time cell text for the row (never invents a time the .ics did not carry). */
export function dateTimeCell(event) {
  if (!event?.start) return DASH;
  const s = event.start;
  if (event.allDay) return `${s.local} (all-day, no time stated)`;
  if (s.kind === 'floating') return `${s.local.slice(0, 10)} ${s.local.slice(11, 16)} (no time zone)`;
  if (s.kind === 'unknown-tzid') return `${s.local.slice(0, 10)} ${s.local.slice(11, 16)} (unknown TZID ${s.tzid})`;
  const d = event.display;
  if (!d) return DASH;
  let out = `${d.start.date} ${d.start.time}`;
  if (d.end) out += d.end.date === d.start.date ? `-${d.end.time}` : ` - ${d.end.date} ${d.end.time}`;
  return `${out} ${d.start.abbr}`;
}

/**
 * Build the pasteable row. `tracker` (optional) is a matched tracker candidate
 * supplying Company and Role; otherwise those stay em dashes.
 */
export function buildRow(event, tracker = null) {
  if (!event) return null;
  const notes = [];
  if (event.durationMinutes !== null && event.durationMinutes !== undefined) notes.push(`${event.durationMinutes} min`);
  if (event.start?.tzid && event.start.kind !== 'unknown-tzid') notes.push(`invite zone ${event.start.tzid}`);
  if (event.meetingUrl) notes.push(event.meetingUrl);
  const cells = [
    cell(tracker?.company), cell(tracker?.role), DASH, cell(dateTimeCell(event)),
    cell(event.organizer), 'Scheduled', cell(notes.join('; ')),
  ];
  return `| ${cells.join(' | ')} |`;
}

// ---------------------------------------------------------------------------
// Display zone
// ---------------------------------------------------------------------------

/** --tz > profile location.timezone (valid IANA only) > machine zone. */
export function resolveDisplayZone(tzFlag, warnings = []) {
  if (tzFlag !== undefined) {
    if (isValidZone(tzFlag)) return { zone: tzFlag, source: '--tz' };
    warnings.push({ code: 'display-zone-invalid', message: `--tz "${tzFlag}" is not an IANA time zone; using the next fallback.` });
  }
  try {
    const path = getProfilePath();
    if (path && existsSync(path)) {
      const tz = loadYaml(readFileSync(path, 'utf-8'))?.location?.timezone;
      if (typeof tz === 'string' && tz.trim()) {
        if (isValidZone(tz.trim())) return { zone: tz.trim(), source: 'profile' };
        warnings.push({ code: 'display-zone-invalid', message: `config/profile.yml location.timezone "${tz}" is not a time zone name Intl knows (e.g. America/Toronto); using the machine zone.` });
      }
    }
  } catch (e) {
    warnings.push({ code: 'profile-unreadable', message: `config/profile.yml could not be read (${e.message}); using the machine zone.` });
  }
  return { zone: machineZone(), source: 'machine' };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const KNOWN_FLAGS = ['--summary', '--tz', '--match', '--help', '-h'];
const VALUE_FLAGS = ['--tz', '--match'];
const USAGE = `Usage:
  node ics-interview.mjs <invite.ics>                 # JSON: first VEVENT + a row for data/active-interviews.md
  node ics-interview.mjs < invite.ics                 # read the .ics from stdin
  node ics-interview.mjs <invite.ics> --summary       # human-readable
  node ics-interview.mjs <invite.ics> --tz <IANA>     # display zone (default: profile location.timezone, then machine zone)
  node ics-interview.mjs <invite.ics> --match "<invite text>"   # also suggest the tracker row (text, or a path to a file holding it)
  node ics-interview.mjs --help

Read-only: prints a row to paste; it never writes data/active-interviews.md.`;

function positionalOperand(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (VALUE_FLAGS.includes(a)) { i += 1; continue; }
    if (!a.startsWith('-')) return a;
  }
  return null;
}

async function matchTracker(matchArg, event) {
  let text = matchArg;
  try {
    if (existsSync(matchArg)) text = readFileSync(matchArg, 'utf-8');
  } catch { /* treat the argument as the invite text itself */ }
  // Imported on demand: invite-match.mjs reads process.argv at module load.
  const { analyzeInvite } = await import('./invite-match.mjs');
  const result = analyzeInvite(text);
  return {
    classification: result.classification,
    company: result.signals.company,
    candidates: result.candidates.slice(0, 3),
    lengthMinutes: event?.durationMinutes ?? null,
    lengthSource: event?.durationMinutes != null ? '.ics' : null,
  };
}

function printSummary(r) {
  const e = r.event;
  console.log(`\n${'='.repeat(70)}\n  Interview .ics — career-ops\n${'='.repeat(70)}\n`);
  if (!e) {
    console.log('  No event could be read.');
  } else {
    const line = (k, v) => console.log(`  ${k.padEnd(22)}${v ?? DASH}`);
    line('Summary:', e.summary);
    line('Starts (as sent):', e.start ? `${e.start.local}${e.start.utc ? ' = ' + e.start.utc : ''}${e.start.tzid ? ' [' + e.start.tzid + ']' : ''} (${e.start.kind})` : null);
    line('Ends (as sent):', e.end ? `${e.end.local ?? DASH}${e.end.utc ? ' = ' + e.end.utc : ''}` : null);
    line('Length:', e.durationMinutes != null ? `${e.durationMinutes} min` : (e.allDay ? 'all-day' : 'not stated'));
    line(`In ${r.displayZone.zone}:`, e.display ? `${e.display.start.date} ${e.display.start.time} ${e.display.start.abbr}${e.display.end ? ' - ' + e.display.end.time : ''}` : null);
    line('Meeting link:', e.meetingUrl);
    line('Location:', e.location);
    line('Organizer:', e.organizer);
    line('Attendees:', e.attendees.length ? e.attendees.join(', ') : null);
  }
  for (const w of r.warnings) console.log(`  ! ${w.code}: ${w.message}`);
  if (r.match) {
    console.log(`\n  Tracker match (${r.match.classification}): ${r.match.company ?? '(no company found)'}`);
    for (const c of r.match.candidates) console.log(`    #${c.appNumber} ${c.company} - ${c.role} [${c.status}]`);
    if (r.match.lengthMinutes != null) console.log(`  Length from .ics: ${r.match.lengthMinutes} min`);
  }
  if (r.row) console.log(`\n  Row for data/active-interviews.md:\n  ${r.row}`);
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  const operand = positionalOperand(args);
  let body;
  if (operand) {
    try {
      body = readFileSync(operand, 'utf-8');
    } catch (e) {
      console.error(`ics-interview: cannot read ${operand}: ${e.code === 'ENOENT' ? 'file not found' : e.message}`);
      process.exit(1);
    }
  } else {
    try {
      body = readFileSync(0, 'utf-8');
    } catch (e) {
      console.error(`ics-interview: no .ics file given and stdin could not be read (${e.message}). ${USAGE.split('\n')[1].trim()}`);
      process.exit(1);
    }
  }

  const warnings = [];
  const displayZone = resolveDisplayZone(flagValue(args, '--tz'), warnings);
  const parsed = parseIcs(body, { displayZone: displayZone.zone });
  warnings.push(...parsed.warnings);

  let match = null;
  const matchArg = flagValue(args, '--match');
  if (matchArg !== undefined) {
    try {
      match = await matchTracker(matchArg, parsed.event);
    } catch (e) {
      warnings.push({ code: 'match-failed', message: `invite-match could not run (${e.message}).` });
    }
  }
  const top = match?.candidates?.[0] ?? null;
  const row = buildRow(parsed.event, top && top.nameScore === 1 && match.candidates.length === 1 ? top : null);

  const result = { event: parsed.event, displayZone, row, match, warnings };
  if (args.includes('--summary')) printSummary(result);
  else console.log(JSON.stringify(result, null, 2));
  process.exit(parsed.event ? 0 : 1);
}

if (isMainModule(import.meta.url)) {
  await main();
}
