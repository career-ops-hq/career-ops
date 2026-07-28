#!/usr/bin/env node
/**
 * contacts.mjs — Job-search phonebook → vCard 3.0 exporter
 *
 * Reads data/contacts.tsv (user layer, gitignored — third-party PII), one
 * contact per line, no header row (writers SHOULD keep a leading `#` comment
 * line naming the columns; readers skip `#` and blank lines):
 *
 *   {name}\t{company}\t{type}\t{title}\t{phone}\t{email}\t{linkedin}\t{tracker#|-}\t{notes}
 *
 * The schema is the vCard fields, nothing more: every column maps 1:1 to a
 * vCard 3.0 property or a tracker join. Minimum valid row: >= 4 cells with
 * non-empty name + company; all channels optional; `-` for tracker# when the
 * contact precedes an application. type: recruiter|hiring-manager|peer|
 * interviewer|other (contacto taxonomy). Lines are updated in place when a
 * contact's details change — unlike the append-only salary-observations log.
 * If two lines share the same name + company (same UID), the LAST line wins
 * the --vcf export — in an update-in-place store the freshest line is the
 * truth; JSON keeps every row and reports the clash in quality.duplicates.
 *
 * vCard output is VERSION:3.0 (iOS/Android import compat; 4.0 support is
 * still patchy): CRLF line endings, 75-octet line folding counted in BYTES
 * that never splits a multibyte UTF-8 sequence, and a stable deterministic
 * UID (careerops-{uidPart(name)}--{uidPart(company)}, where each part is
 * {slug}-{8-hex sha1 of the normalized value}, or just the bare 8-hex hash when
 * the slug is empty — e.g. a fully CJK name; the normalized-value hash folds
 * case/whitespace/NFC noise yet keeps values that slug identically, like
 * "José"/"Josè", from colliding) so re-importing UPDATES
 * existing entries instead of duplicating them on platforms that honor UID (iOS
 * fallback: assign imports to a group, delete the group to bulk-remove).
 *
 * Malformed rows (too few cells, missing name/company, off-enum type) are
 * collected into a `quality` object — reported loudly, never dropped
 * silently, never throwing.
 *
 * Run: node contacts.mjs                     (JSON: contacts + quality + total)
 *      node contacts.mjs --summary           (human-readable table)
 *      node contacts.mjs --vcf [path]        (write vCard, default output/contacts.vcf)
 *      node contacts.mjs --vcf --caller-id   (FN as "Jane Doe (Acme recruiter)")
 *      node contacts.mjs --self-test
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, lstatSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute, basename, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'crypto';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const CONTACTS_PATH = join(CAREER_OPS, 'data/contacts.tsv');
const DEFAULT_VCF = join(CAREER_OPS, 'output/contacts.vcf');

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const callerIdMode = args.includes('--caller-id');
const vcfIdx = args.indexOf('--vcf');
const vcfMode = vcfIdx !== -1;
// Optional path argument: the token right after --vcf, unless it is another flag.
const vcfPathArg = vcfMode && args[vcfIdx + 1] && !args[vcfIdx + 1].startsWith('--') ? args[vcfIdx + 1] : null;

const VALID_TYPES = new Set(['recruiter', 'hiring-manager', 'peer', 'interviewer', 'other']);

// --- Phonebook parsing (TSV) ---
// line: {name}\t{company}\t{type}\t{title}\t{phone}\t{email}\t{linkedin}\t{tracker#|-}\t{notes}
// Cells are split BEFORE trimming the line (only the trailing \r is stripped):
// name is the required FIRST cell, so a leading tab (empty name) must surface
// as missingRequired, not silently shift every column left.
export function parseContacts(content) {
  const contacts = [];
  const quality = { shortRows: [], missingRequired: [], invalidTypes: [], duplicates: [] };
  let lineNo = 0;
  for (const raw of String(content || '').split('\n')) {
    lineNo++;
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const cells = line.split('\t').map(c => c.trim());
    if (cells.length < 4) { quality.shortRows.push({ line: lineNo, cells: cells.length }); continue; }
    const [name, company, type, title = '', phone = '', email = '', linkedin = '', tracker = ''] = cells;
    // notes is the LAST column: a stray tab pasted inside a note must not
    // silently drop the tail cells — everything past the 9th cell folds back
    // into notes (tab -> single space).
    const notes = cells.slice(8).join(' ');
    if (!name || !company) { quality.missingRequired.push({ line: lineNo, name, company }); continue; }
    // Off-enum type is reported but the contact is KEPT (its channels still
    // export fine) — quality surfaces the typo, e.g. "recruter" vs "recruiter".
    if (type && !VALID_TYPES.has(type)) quality.invalidTypes.push({ line: lineNo, name, type });
    contacts.push({ name, company, type, title, phone, email, linkedin, tracker: tracker === '-' ? null : tracker || null, notes });
  }
  // Same UID (name + company key) on multiple lines: JSON keeps every row so
  // nothing vanishes silently, but the clash is reported — buildVcf exports
  // only the LAST occurrence (update-in-place store, freshest line wins).
  const byUid = new Map();
  for (const c of contacts) {
    const uid = contactUid(c);
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push(c);
  }
  for (const [uid, group] of byUid) {
    if (group.length > 1) {
      const last = group[group.length - 1];
      quality.duplicates.push({ uid, name: last.name, company: last.company, count: group.length });
    }
  }
  return { contacts, quality };
}

// --- vCard 3.0 emitter ---
// RFC 2426 text-value escaping. Order matters: backslash FIRST (or the
// backslashes introduced by the later replacements would be doubled),
// then `;` and `,`, then any newline flavor to the two-character `\n`.
export function escapeVcard(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// RFC 2425 line folding at 75 octets — counted in BYTES (Buffer.byteLength),
// not JS characters, and never splitting a multibyte UTF-8 sequence: for..of
// iterates code points, and a code point whose bytes would cross the budget
// moves whole onto the continuation line (so a fold before a 3-byte CJK char
// may close a physical line at 73-74 octets — that is correct, not a bug).
// Continuation lines start with a single space that counts toward the budget.
export function foldLine(line) {
  if (Buffer.byteLength(line, 'utf-8') <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, 'utf-8');
    if (curBytes + chBytes > 75) {
      out.push(cur);
      cur = ' ';
      curBytes = 1;
    }
    cur += ch;
    curBytes += chBytes;
  }
  out.push(cur);
  return out.join('\r\n');
}

// UID slug: lowercase, every non-alphanumeric run -> single dash, trimmed.
// Deterministic on purpose — the UID must not change between exports.
export function slug(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Fold the noise that must NOT change a UID — letter case, surrounding and
// collapsed interior whitespace, and Unicode composition (NFC vs NFD) — WITHOUT
// deburring accents. This is the exact representation uidPart() hashes, so pure
// "José" / "josé " / "JOSÉ" capitalization/spacing/composition variants of one
// name produce the SAME UID, while é vs è stay distinct (see uidPart).
export function normalizeForHash(raw) {
  return String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

// UID building block: an 8-hex sha1 of the NORMALIZED value (normalizeForHash:
// case/whitespace/NFC-folded but accent-preserving), prefixed with the pretty
// slug when it survives. The hash — not the slug — is what makes the part
// collision-resistant: slug() is lossy (accented chars drop out, e.g. "José"
// and "Josè" both slug to "jos"; punctuation and spacing collapse, e.g. "Acme
// Inc" and "Acme, Inc." both to "acme-inc"), so two distinct values can share a
// slug and would otherwise collide into one UID. Hashing the normalized value
// keeps genuinely distinct inputs (é vs è) distinct while folding away only the
// noise (case, spacing, composition) that should map to one stable UID, and the
// readable slug prefix stays for humans. slug('山田 太郎') is empty (every char
// is non-alphanumeric), so a fully non-ASCII part is just the bare hash. The
// hash is deterministic, so the UID stays stable across exports.
export function uidPart(raw) {
  const s = slug(raw);
  const h = createHash('sha1').update(normalizeForHash(raw), 'utf8').digest('hex').slice(0, 8);
  return s ? `${s}-${h}` : h;
}

// Join the name and company parts with a DOUBLE dash: each part is a slug (only
// single dashes, never `--`) optionally suffixed with a hex hash (no dashes at
// all), so a double dash is the one unambiguous name/company boundary. A single
// dash would be indistinguishable from an internal slug dash, letting different
// pairs collide — e.g. ("Van Der Berg", "Acme") and ("Van", "Der Berg Acme").
// The per-part raw-value hash (see uidPart) is the collision guard; the `--`
// join keeps the boundary readable and unambiguous on top of that.
export function contactUid(c) {
  return `careerops-${uidPart(c.name)}--${uidPart(c.company)}`;
}

// One contact -> one folded, CRLF-joined VCARD block (no trailing CRLF).
// `rev` is injectable so tests can pin the timestamp; production callers omit it.
export function contactToVcard(contact, { callerId = false, rev = null } = {}) {
  const c = contact;
  // Best-effort Last;First split: last whitespace token = family name, the
  // rest = given. Single-token names land whole in the family slot.
  const parts = c.name.trim().split(/\s+/);
  const family = parts[parts.length - 1];
  const given = parts.slice(0, -1).join(' ');
  // --caller-id: the phone lock screen shows FN, so fold company + type into
  // it ("Jane Doe (Acme recruiter)"). Default FN stays the plain name.
  const fn = callerId ? `${c.name} (${c.company}${c.type ? ` ${c.type}` : ''})` : c.name;
  const noteParts = [];
  if (c.type) noteParts.push(c.type);
  if (c.tracker) noteParts.push(`tracker #${c.tracker}`);
  if (c.notes) noteParts.push(c.notes);

  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`UID:${contactUid(c)}`);
  lines.push(`FN:${escapeVcard(fn)}`);
  lines.push(`N:${escapeVcard(family)};${escapeVcard(given)};;;`);
  lines.push(`ORG:${escapeVcard(c.company)}`);
  if (c.title) lines.push(`TITLE:${escapeVcard(c.title)}`);
  if (c.phone) lines.push(`TEL;TYPE=CELL:${escapeVcard(c.phone)}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(c.email)}`);
  if (c.linkedin) lines.push(`URL:${escapeVcard(c.linkedin)}`);
  if (noteParts.length) lines.push(`NOTE:${escapeVcard(noteParts.join(' — '))}`);
  lines.push('CATEGORIES:career-ops');
  lines.push(`REV:${rev ?? new Date().toISOString()}`);
  lines.push('END:VCARD');
  return lines.map(foldLine).join('\r\n');
}

export function buildVcf(contacts, opts = {}) {
  if (!contacts.length) return '';
  // One card per UID, LAST occurrence wins: the store is updated in place, so
  // the freshest line for a person is the authoritative one — and platforms
  // honoring UID would merge duplicate cards unpredictably anyway.
  const byUid = new Map();
  for (const c of contacts) byUid.set(contactUid(c), c);
  return [...byUid.values()].map(c => contactToVcard(c, opts)).join('\r\n') + '\r\n';
}

// --- Self-test ---
const CONTACTS_FIXTURE = [
  '# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes',
  '',
  'Jane Doe\tAcme\trecruiter\tTalent Partner\t+49 151 1234567\tjane@acme.io\thttps://linkedin.com/in/janedoe\t012\tmet at screen; email, ok',
  '山田 太郎\tGlobex\thiring-manager\t\t\t\t\t-\t',
  'Jörg Müller\tInitech\tpeer\t\t\tjoerg@initech.de\t\t-\tintro via meetup',
  'Too\tFew',
  '\tNoName GmbH\tother\t',
  'Typo Type\tHooli\trecruter\t',
  'Tab Note\tHooli\tother\t\t\t\t\t-\tpart one\tpart two',
  'Jane Doe\tAcme\trecruiter\tTalent Partner\t+49 151 1234567\tjane@acme.io\thttps://linkedin.com/in/janedoe\t012\tupdated after call',
].join('\n');

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) { console.error(`SELF-TEST FAIL: ${msg}`); process.exit(1); }
  };

  // parseContacts
  const { contacts, quality } = parseContacts(CONTACTS_FIXTURE);
  assert(contacts.length === 6, `6 contacts parsed, got ${contacts.length}`);
  assert(contacts[0].name === 'Jane Doe' && contacts[0].tracker === '012', 'fields mapped');
  assert(contacts[1].tracker === null, '- tracker ref -> null');
  assert(parseContacts('').contacts.length === 0, 'empty store');
  assert(quality.shortRows.length === 1 && quality.shortRows[0].cells === 2, 'short row reported');
  assert(quality.missingRequired.length === 1 && quality.missingRequired[0].company === 'NoName GmbH', 'empty name reported, columns not shifted');
  assert(quality.invalidTypes.length === 1 && quality.invalidTypes[0].type === 'recruter', 'off-enum type reported');
  assert(contacts.some(c => c.name === 'Typo Type'), 'off-enum type contact kept, not dropped');
  assert(contacts.find(c => c.name === 'Tab Note').notes === 'part one part two', 'tab inside notes folds back (tab -> space), tail cells never dropped');
  assert(quality.duplicates.length === 1 && /^careerops-jane-doe-[0-9a-f]{8}--acme-[0-9a-f]{8}$/.test(quality.duplicates[0].uid) && quality.duplicates[0].count === 2,
    'duplicate name+company reported in quality.duplicates');

  // escaping — backslash first, then ; , then newline
  assert(escapeVcard('a\\b;c,d\ne') === 'a\\\\b\\;c\\,d\\ne', 'escape order backslash;comma newline');
  assert(escapeVcard('x\r\ny') === 'x\\ny', 'CRLF collapses to one \\n');
  assert(escapeVcard(null) === '', 'null -> empty');

  // folding — byte-counted, multibyte-safe
  const ascii = foldLine('NOTE:' + 'x'.repeat(100));
  const asciiLines = ascii.split('\r\n');
  assert(asciiLines.length === 2 && Buffer.byteLength(asciiLines[0], 'utf-8') === 75, 'ASCII folds at exactly 75 octets');
  assert(asciiLines[1].startsWith(' ') && asciiLines.map((l, i) => (i ? l.slice(1) : l)).join('') === 'NOTE:' + 'x'.repeat(100), 'continuation starts with one space, content preserved');
  const cjk = foldLine('NOTE:' + 'あ'.repeat(40)); // 5 + 120 bytes
  const cjkLines = cjk.split('\r\n');
  // 5 + 23*3 = 74: the 24th あ would hit 77 octets, so the line closes early
  assert(Buffer.byteLength(cjkLines[0], 'utf-8') === 74, `CJK fold closes at 74 octets (never splits あ), got ${Buffer.byteLength(cjkLines[0], 'utf-8')}`);
  assert(cjkLines.every(l => Buffer.byteLength(l, 'utf-8') <= 75), 'every folded CJK line <= 75 octets');
  assert(cjkLines.map((l, i) => (i ? l.slice(1) : l)).join('') === 'NOTE:' + 'あ'.repeat(40), 'CJK content survives folding intact');

  // UID — stable, deterministic {slug}-{8-hex raw hash} parts (bare hash when
  // the slug is empty), joined with a double dash.
  assert(slug('Jörg Müller') === 'j-rg-m-ller', 'slug collapses non-alphanumerics');
  assert(slug('--Acme  Inc.--') === 'acme-inc', 'slug trims dashes');
  assert(/^jane-doe-[0-9a-f]{8}$/.test(uidPart('Jane Doe')), 'uidPart = pretty slug + raw-value hash for ASCII');
  assert(/^[0-9a-f]{8}$/.test(uidPart('山田 太郎')), 'empty slug (CJK) is the bare 8-hex sha1');
  const taroPart1 = uidPart('山田 太郎');
  const taroPart2 = uidPart('山田 太郎');
  assert(taroPart1 === taroPart2, 'uidPart deterministic across two calls');
  assert(uidPart('山田 太郎') !== uidPart('佐藤 花子'), 'different CJK names never collide');
  // Lossy-slug collision guard: distinct accented names that slug identically
  // ("José" and "Josè" both -> "jos", since slug drops the accented char) must
  // still get DIFFERENT UIDs via the raw-value hash — the point of hashing the
  // raw, not the slug.
  assert(slug('José') === slug('Josè'), 'distinct accented names slug identically');
  assert(uidPart('José') !== uidPart('Josè'), 'lossy-equal slugs still get distinct UID parts');
  assert(contactUid({ name: 'José', company: 'Acme' }) !== contactUid({ name: 'Josè', company: 'Acme' }),
    'distinct raw names that slug the same produce different contact UIDs');
  // Stability guard (the flip side): pure case / surrounding-whitespace variants
  // of ONE name must fold to the SAME UID part — the hash input is normalized
  // (normalizeForHash), not raw. These variants also slug identically, so the
  // whole uidPart matches, prefix and hash.
  assert(uidPart('José') === uidPart('JOSÉ') && uidPart('José') === uidPart('  josé  '),
    'case + surrounding-whitespace variants of one name get the same UID part');
  // Composition (NFC vs NFD) is folded in the HASH input: normalizeForHash maps
  // both forms of one name to the same string (accents preserved, é ≠ è).
  assert(normalizeForHash('José'.normalize('NFC')) === normalizeForHash('José'.normalize('NFD')),
    'NFC vs NFD composition folds to one normalized hash input');
  assert(normalizeForHash('José') !== normalizeForHash('Josè'), 'normalizeForHash keeps é vs è distinct');
  const cjkCard = contactToVcard(contacts[1], { rev: '2026-07-09T00:00:00.000Z' });
  assert(/UID:careerops-[0-9a-f]{8}--globex-[0-9a-f]{8}\r\n/.test(cjkCard), 'CJK contact UID: bare hash name part, slug+hash company part');
  const card = contactToVcard(contacts[0], { rev: '2026-07-09T00:00:00.000Z' });
  assert(/UID:careerops-jane-doe-[0-9a-f]{8}--acme-[0-9a-f]{8}\r\n/.test(card), 'UID = careerops-{uidPart(name)}--{uidPart(company)}');
  assert(card === contactToVcard(contacts[0], { rev: '2026-07-09T00:00:00.000Z' }), 'card deterministic under pinned REV');
  assert(card.includes('FN:Jane Doe\r\n'), 'default FN is the plain name');
  assert(card.includes('N:Doe;Jane;;;'), 'N best-effort Last;First split');
  assert(card.includes('NOTE:recruiter — tracker #012 — met at screen\\; email\\, ok'), 'NOTE joins type + tracker + notes with escaping');
  const callerCard = contactToVcard(contacts[0], { callerId: true, rev: '2026-07-09T00:00:00.000Z' });
  assert(callerCard.includes('FN:Jane Doe (Acme recruiter)'), '--caller-id FN variant');

  // buildVcf — CRLF everywhere, trailing CRLF, last duplicate wins, empty store -> empty string
  const vcf = buildVcf(contacts.slice(0, 2), { rev: '2026-07-09T00:00:00.000Z' });
  assert(vcf.endsWith('END:VCARD\r\n'), 'vcf ends with CRLF');
  assert(!/[^\r]\n/.test(vcf) && !vcf.startsWith('\n'), 'no bare LF anywhere');
  assert((vcf.match(/BEGIN:VCARD/g) || []).length === 2, 'one card per contact');
  const dedupVcf = buildVcf(contacts, { rev: '2026-07-09T00:00:00.000Z' });
  assert((dedupVcf.match(/BEGIN:VCARD/g) || []).length === 5, '6 rows, 1 duplicate pair -> 5 cards');
  assert(dedupVcf.includes('updated after call') && !dedupVcf.includes('met at screen'), 'LAST duplicate occurrence wins the export');
  assert(buildVcf([]) === '', 'empty store -> empty vcf');

  console.log('contacts self-test OK (parser + escaping + byte-safe folding + UID fallback + dedup + emitter)');
}

// --- Output ---
function printSummary(contacts, quality) {
  console.log('\nCONTACTS — job-search phonebook\n');

  if (!contacts.length) {
    console.log('  No contacts yet.');
    console.log('  Add lines to data/contacts.tsv:');
    console.log('  {name}\\t{company}\\t{type}\\t{title}\\t{phone}\\t{email}\\t{linkedin}\\t{tracker#|-}\\t{notes}');
    console.log('  Export to your phone with: node contacts.mjs --vcf');
  } else {
    const rows = contacts.map(c => [
      c.name, c.company, c.type || '—',
      ['phone', 'email', 'linkedin'].filter(ch => c[ch]).join(',') || '—',
      c.tracker ? `#${c.tracker}` : '—',
    ]);
    const header = ['NAME', 'COMPANY', 'TYPE', 'CHANNELS', 'APP'];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
    for (const r of [header, ...rows]) {
      console.log('  ' + r.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd());
    }
  }

  // Data quality — always printed, never smoothed over
  console.log('\n  Data quality:');
  if (quality.shortRows.length) {
    console.log(`  ⚠ ${quality.shortRows.length} row${quality.shortRows.length === 1 ? '' : 's'} with fewer than 4 cells (skipped):`);
    for (const r of quality.shortRows) console.log(`      line ${r.line} (${r.cells} cell${r.cells === 1 ? '' : 's'})`);
  } else {
    console.log('  short rows: none');
  }
  if (quality.missingRequired.length) {
    console.log(`  ⚠ ${quality.missingRequired.length} row${quality.missingRequired.length === 1 ? '' : 's'} missing name or company (skipped):`);
    for (const r of quality.missingRequired) console.log(`      line ${r.line}: name "${r.name}", company "${r.company}"`);
  } else {
    console.log('  missing name/company: none');
  }
  if (quality.invalidTypes.length) {
    console.log(`  ⚠ ${quality.invalidTypes.length} contact${quality.invalidTypes.length === 1 ? '' : 's'} with off-enum type (kept — check for typos, e.g. recruter vs recruiter):`);
    for (const r of quality.invalidTypes) console.log(`      line ${r.line} ${r.name}: type "${r.type}"`);
  } else {
    console.log('  off-enum types: none');
  }
  if (quality.duplicates.length) {
    console.log(`  ⚠ ${quality.duplicates.length} duplicated contact${quality.duplicates.length === 1 ? '' : 's'} (same name+company — the LAST line wins the --vcf export):`);
    for (const d of quality.duplicates) console.log(`      ${d.name} @ ${d.company} (${d.count} lines, ${d.uid})`);
  } else {
    console.log('  duplicates: none');
  }
  console.log(`  total: ${contacts.length} contact${contacts.length === 1 ? '' : 's'}`);
  console.log('');
}

// True if `p` is itself a symlink (lstat does not follow the link). A missing
// path returns false; a dangling symlink still returns true — which is exactly
// what the vCard write guard needs so writeFileSync can't follow it out of repo.
function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function writeVcf(contacts, quality) {
  // --vcf is the piped/scripted mode, so quality clashes go to stderr — the
  // same never-silently-dropped contract as the JSON and --summary modes.
  const issues = quality.shortRows.length + quality.missingRequired.length
    + quality.invalidTypes.length + quality.duplicates.length;
  if (issues) {
    console.error(`⚠ ${issues} data-quality issue${issues === 1 ? '' : 's'} in data/contacts.tsv (details: node contacts.mjs --summary):`);
    if (quality.shortRows.length) console.error(`    ${quality.shortRows.length} row${quality.shortRows.length === 1 ? '' : 's'} with fewer than 4 cells (skipped)`);
    if (quality.missingRequired.length) console.error(`    ${quality.missingRequired.length} row${quality.missingRequired.length === 1 ? '' : 's'} missing name or company (skipped)`);
    if (quality.invalidTypes.length) console.error(`    ${quality.invalidTypes.length} contact${quality.invalidTypes.length === 1 ? '' : 's'} with off-enum type (kept)`);
    if (quality.duplicates.length) console.error(`    ${quality.duplicates.length} duplicated contact${quality.duplicates.length === 1 ? '' : 's'} (the last line wins)`);
  }
  if (!contacts.length) {
    console.log('No contacts to export — data/contacts.tsv is empty or missing. No file written.');
    return;
  }
  const outPath = resolve(vcfPathArg ?? DEFAULT_VCF);
  // Path-traversal guard: keep the vCard write inside the project directory so
  // a crafted output argument (e.g. "../../etc/cron.d/x") can't escape the
  // repo. Anchored to the repo root (CAREER_OPS), not process.cwd() — see the
  // generate-pdf.mjs precedent. Cheap lexical gate first…
  const relOut = relative(CAREER_OPS, outPath);
  if (relOut === '' || relOut.startsWith('..') || isAbsolute(relOut)) {
    console.error(`Refusing to write the vCard outside the project directory: ${outPath}`);
    process.exit(1);
  }
  const vcf = buildVcf(contacts, { callerId: callerIdMode });
  const cards = (vcf.match(/BEGIN:VCARD/g) || []).length; // may be < rows: duplicates export last-wins
  // …then the authoritative, symlink-aware containment check, applied immediately
  // before the write so it also guards a TOCTOU swap. The lexical gate above only
  // inspects the string: a symlinked child directory (or a symlinked target file)
  // can resolve OUTSIDE the repo while passing it. Create the parent first, then
  // re-verify the CANONICAL destination is inside the repo. Mirrors the
  // reconcile-pipeline.mjs / followup-seed.mjs realpath-containment pattern.
  mkdirSync(dirname(outPath), { recursive: true });
  // A symlink at the target path (even a dangling one) would let writeFileSync
  // follow it and escape — refuse before resolving anything else.
  if (isSymlink(outPath)) {
    console.error(`Refusing to write the vCard outside the project directory: ${outPath}`);
    process.exit(1);
  }
  const repoReal = realpathSync(CAREER_OPS);
  const canonicalTarget = existsSync(outPath)
    ? realpathSync(outPath)
    : join(realpathSync(dirname(outPath)), basename(outPath));
  const relReal = relative(repoReal, canonicalTarget);
  if (relReal === '' || relReal === '..' || relReal.startsWith(`..${sep}`) || isAbsolute(relReal)) {
    console.error(`Refusing to write the vCard outside the project directory: ${outPath}`);
    process.exit(1);
  }
  writeFileSync(outPath, vcf);
  console.log(`Wrote ${cards} contact${cards === 1 ? '' : 's'} → ${outPath}`);
}

function main() {
  if (selfTestMode) { selfTest(); return; }

  const content = existsSync(CONTACTS_PATH) ? readFileSync(CONTACTS_PATH, 'utf-8') : '';
  const { contacts, quality } = parseContacts(content);

  if (vcfMode) {
    writeVcf(contacts, quality);
  } else if (summaryMode) {
    printSummary(contacts, quality);
  } else {
    console.log(JSON.stringify({ contacts, quality, total: contacts.length }, null, 2));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
