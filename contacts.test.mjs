/**
 * contacts.test.mjs — Systematic test suite for contacts.mjs
 *
 * Tests every exported function across:
 * - TSV phonebook parsing (well-formed, malformed, comments, `-` tracker ref)
 * - vCard escaping (backslash-first order, semicolon, comma, newline)
 * - 75-octet byte-counted line folding (ASCII, umlaut, CJK — never splitting
 *   a multibyte UTF-8 sequence)
 * - UID slug determinism + 8-hex hash fallback for empty (non-ASCII) slugs,
 *   caller-id FN variant, optional-field omission, duplicate last-wins export
 * - CLI behavior (JSON/--summary/--vcf/--caller-id, empty store, path guard)
 *
 * Expected vCard strings are built in code on purpose — a committed .vcf
 * fixture would be corrupted by git autocrlf on Windows.
 *
 * Run: node contacts.test.mjs
 */

import { parseContacts, escapeVcard, foldLine, slug, uidPart, contactUid, contactToVcard, buildVcf } from './contacts.mjs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

const row = (cells) => cells.join('\t');
const bytes = (s) => Buffer.byteLength(s, 'utf-8');
const REV = '2026-07-09T00:00:00.000Z';

// ============================================================================
// 1. parseContacts — input validation
// ============================================================================
console.log('\n--- 1. parseContacts input validation ---');

eq('null input -> no contacts', parseContacts(null).contacts, []);
eq('undefined input -> no contacts', parseContacts(undefined).contacts, []);
eq('empty string -> no contacts', parseContacts('').contacts, []);
eq('whitespace-only -> no contacts', parseContacts('   \n  \n').contacts, []);
eq('comment-only store -> no contacts', parseContacts('# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes').contacts, []);
eq('clean empty store -> empty quality buckets', parseContacts(''), { contacts: [], quality: { shortRows: [], missingRequired: [], invalidTypes: [], duplicates: [] } });

// ============================================================================
// 2. parseContacts — well-formed rows
// ============================================================================
console.log('\n--- 2. well-formed rows ---');

const full = parseContacts(row(['Jane Doe', 'Acme', 'recruiter', 'Talent Partner', '+49 151 1234567', 'jane@acme.io', 'https://linkedin.com/in/janedoe', '012', 'met at screen'])).contacts;
eq('parses 1 full row', full.length, 1);
eq('name mapped', full[0].name, 'Jane Doe');
eq('company mapped', full[0].company, 'Acme');
eq('type mapped', full[0].type, 'recruiter');
eq('title mapped', full[0].title, 'Talent Partner');
eq('phone mapped', full[0].phone, '+49 151 1234567');
eq('email mapped', full[0].email, 'jane@acme.io');
eq('linkedin mapped', full[0].linkedin, 'https://linkedin.com/in/janedoe');
eq('tracker mapped', full[0].tracker, '012');
eq('notes mapped', full[0].notes, 'met at screen');

const minimal = parseContacts(row(['山田 太郎', 'Globex', 'hiring-manager', ''])).contacts;
eq('minimal 4-cell row parses', minimal.length, 1);
eq('missing optional cells default empty', [minimal[0].phone, minimal[0].email, minimal[0].linkedin, minimal[0].notes], ['', '', '', '']);
eq('absent tracker cell -> null', minimal[0].tracker, null);

const dash = parseContacts(row(['Jörg Müller', 'Initech', 'peer', '', '', 'joerg@initech.de', '', '-', 'pre-application contact'])).contacts;
eq('`-` tracker ref -> null (contact precedes application)', dash[0].tracker, null);

const multi = parseContacts([
  '# columns comment',
  row(['A One', 'Acme', 'recruiter', '']),
  '',
  row(['B Two', 'Globex', 'peer', '']),
].join('\n'));
eq('comments and blank lines skipped, 2 contacts parsed', multi.contacts.length, 2);
eq('CRLF store parses identically', parseContacts(row(['A One', 'Acme', 'recruiter', '']) + '\r\n' + row(['B Two', 'Globex', 'peer', '']) + '\r\n').contacts.length, 2);

// ============================================================================
// 3. parseContacts — malformed rows land in quality, never dropped silently
// ============================================================================
console.log('\n--- 3. malformed rows -> quality ---');

const bad = parseContacts([
  row(['Good Row', 'Acme', 'recruiter', '']),
  row(['Too', 'Few']),
  row(['', 'NoName GmbH', 'other', '']),
  row(['No Company', '', 'other', '']),
  row(['Typo Type', 'Hooli', 'recruter', '']),
].join('\n'));
eq('valid rows kept alongside malformed ones', bad.contacts.length, 2);
eq('short row reported with line + cell count', bad.quality.shortRows, [{ line: 2, cells: 2 }]);
eq('empty name reported (leading tab does NOT shift columns)', bad.quality.missingRequired[0], { line: 3, name: '', company: 'NoName GmbH' });
eq('empty company reported', bad.quality.missingRequired[1], { line: 4, name: 'No Company', company: '' });
eq('off-enum type reported', bad.quality.invalidTypes, [{ line: 5, name: 'Typo Type', type: 'recruter' }]);
ok('off-enum type contact is KEPT', bad.contacts.some(c => c.name === 'Typo Type'));
eq('empty type is allowed (not an invalidTypes entry)', parseContacts(row(['A One', 'Acme', '', ''])).quality.invalidTypes, []);

// A stray tab inside the notes column must not silently drop the tail cells —
// notes is the LAST column, so cells past the 9th fold back in (tab -> space).
const tabbed = parseContacts(row(['Tab Note', 'Hooli', 'other', '', '', '', '', '-', 'part one', 'part two']));
eq('tab inside notes: contact still parses', tabbed.contacts.length, 1);
eq('tab inside notes folds back into the notes cell', tabbed.contacts[0].notes, 'part one part two');
eq('tab inside notes: no quality complaint', tabbed.quality, { shortRows: [], missingRequired: [], invalidTypes: [], duplicates: [] });

// Duplicate name+company (same UID): JSON keeps every row, quality reports it.
const dupPair = parseContacts([
  row(['Jane Doe', 'Acme', 'recruiter', '', '', '', '', '012', 'first line']),
  row(['Jane Doe', 'Acme', 'recruiter', '', '', '', '', '012', 'updated line']),
].join('\n'));
eq('duplicate pair: both rows kept in JSON', dupPair.contacts.length, 2);
eq('duplicate pair: one quality.duplicates entry', dupPair.quality.duplicates,
  [{ uid: 'careerops-jane-doe-acme', name: 'Jane Doe', company: 'Acme', count: 2 }]);

// ============================================================================
// 4. escapeVcard — backslash first, then ; , then newline
// ============================================================================
console.log('\n--- 4. escapeVcard ---');

eq('backslash escaped', escapeVcard('a\\b'), 'a\\\\b');
eq('semicolon escaped', escapeVcard('a;b'), 'a\\;b');
eq('comma escaped', escapeVcard('a,b'), 'a\\,b');
eq('LF -> literal \\n', escapeVcard('a\nb'), 'a\\nb');
eq('CRLF -> single literal \\n', escapeVcard('a\r\nb'), 'a\\nb');
eq('lone CR -> literal \\n', escapeVcard('a\rb'), 'a\\nb');
eq('all together, order preserved', escapeVcard('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
// order proof: if newline ran before backslash, the "\" of "\n" would double
eq('pre-escaped-looking input stays literal', escapeVcard('a\\nb'), 'a\\\\nb');
eq('null -> empty string', escapeVcard(null), '');
eq('undefined -> empty string', escapeVcard(undefined), '');

// ============================================================================
// 5. foldLine — 75 octets by BYTES, multibyte-safe
// ============================================================================
console.log('\n--- 5. foldLine ---');

eq('75-octet line untouched', foldLine('x'.repeat(75)), 'x'.repeat(75));
const fold76 = foldLine('x'.repeat(76));
eq('76-octet ASCII line folds into two', fold76.split('\r\n').length, 2);
eq('first ASCII segment is exactly 75 octets', bytes(fold76.split('\r\n')[0]), 75);
ok('continuation line starts with a single space', fold76.split('\r\n')[1] === ' x');

const longAscii = foldLine('NOTE:' + 'x'.repeat(200));
ok('every ASCII folded segment <= 75 octets', longAscii.split('\r\n').every(l => bytes(l) <= 75));
eq('ASCII unfold reconstructs the original', longAscii.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), 'NOTE:' + 'x'.repeat(200));

// Umlaut (2-byte ö) straddling the boundary: 74 ASCII bytes + ö would hit 76,
// so the whole ö moves to the continuation line and the first closes at 74.
const umlaut = foldLine('x'.repeat(74) + 'ö' + 'y'.repeat(10));
const umlautLines = umlaut.split('\r\n');
eq('umlaut never split: first segment closes at 74 octets', bytes(umlautLines[0]), 74);
ok('umlaut lands intact on the continuation line', umlautLines[1].startsWith(' ö'));
ok('every umlaut segment <= 75 octets', umlautLines.every(l => bytes(l) <= 75));
eq('umlaut unfold reconstructs the original', umlautLines.map((l, i) => (i ? l.slice(1) : l)).join(''), 'x'.repeat(74) + 'ö' + 'y'.repeat(10));

// CJK (3-byte あ): "NOTE:" (5) + 23*3 = 74; the 24th あ would hit 77.
const cjk = foldLine('NOTE:' + 'あ'.repeat(60));
const cjkLines = cjk.split('\r\n');
eq('CJK first segment closes at 74 octets (never splits あ)', bytes(cjkLines[0]), 74);
ok('every CJK segment <= 75 octets', cjkLines.every(l => bytes(l) <= 75));
ok('no replacement characters introduced', !cjk.includes('�'));
eq('CJK unfold reconstructs the original', cjkLines.map((l, i) => (i ? l.slice(1) : l)).join(''), 'NOTE:' + 'あ'.repeat(60));

// ============================================================================
// 6. slug + UID determinism
// ============================================================================
console.log('\n--- 6. slug + UID ---');

eq('lowercase', slug('Jane Doe'), 'jane-doe');
eq('non-alphanumeric runs collapse to one dash', slug('Jörg  Müller'), 'j-rg-m-ller');
eq('leading/trailing dashes trimmed', slug('--Acme  Inc.--'), 'acme-inc');
eq('slug is deterministic', slug('Jane Doe'), slug('Jane Doe'));

const jane = { name: 'Jane Doe', company: 'Acme', type: 'recruiter', title: '', phone: '', email: '', linkedin: '', tracker: null, notes: '' };
ok('UID = careerops-{slug(name)}-{slug(company)}', contactToVcard(jane, { rev: REV }).includes('UID:careerops-jane-doe-acme'));
eq('same contact -> identical card under pinned REV', contactToVcard(jane, { rev: REV }), contactToVcard(jane, { rev: REV }));

// Hash fallback: a fully non-ASCII value slugs to '' — an empty UID part would
// collide every same-company CJK contact. uidPart substitutes a deterministic
// 8-hex sha1 of the raw value instead.
eq('uidPart keeps the pretty ASCII slug', uidPart('Jane Doe'), 'jane-doe');
ok('uidPart CJK fallback is 8 hex chars', /^[0-9a-f]{8}$/.test(uidPart('山田 太郎')));
eq('uidPart CJK fallback is deterministic', uidPart('山田 太郎'), uidPart('山田 太郎'));
ok('different CJK names at the same company do NOT collide',
  contactUid({ name: '山田 太郎', company: 'Globex' }) !== contactUid({ name: '佐藤 花子', company: 'Globex' }));
const taro = { name: '山田 太郎', company: 'Globex', type: 'hiring-manager', title: '', phone: '', email: '', linkedin: '', tracker: null, notes: '' };
eq('CJK contact UID: same input -> same UID across two calls',
  contactToVcard(taro, { rev: REV }).match(/UID:[^\r]+/)[0],
  contactToVcard(taro, { rev: REV }).match(/UID:[^\r]+/)[0]);
ok('CJK contact UID = careerops-{8-hex}-globex', /UID:careerops-[0-9a-f]{8}-globex/.test(contactToVcard(taro, { rev: REV })));
ok('ASCII UID path unchanged by the fallback', contactUid(jane) === 'careerops-jane-doe-acme');

// ============================================================================
// 7. contactToVcard — structure, expected string built in code (no fixture)
// ============================================================================
console.log('\n--- 7. contactToVcard ---');

const fullContact = {
  name: 'Jane Doe', company: 'Acme', type: 'recruiter', title: 'Talent Partner',
  phone: '+49 151 1234567', email: 'jane@acme.io', linkedin: 'https://linkedin.com/in/janedoe',
  tracker: '012', notes: 'met at screen; email, ok',
};
const expectedCard = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:careerops-jane-doe-acme',
  'FN:Jane Doe',
  'N:Doe;Jane;;;',
  'ORG:Acme',
  'TITLE:Talent Partner',
  'TEL;TYPE=CELL:+49 151 1234567',
  'EMAIL;TYPE=INTERNET:jane@acme.io',
  'URL:https://linkedin.com/in/janedoe',
  'NOTE:recruiter — tracker #012 — met at screen\\; email\\, ok',
  'CATEGORIES:career-ops',
  `REV:${REV}`,
  'END:VCARD',
].join('\r\n');
eq('full contact renders the exact expected card', contactToVcard(fullContact, { rev: REV }), expectedCard);

const callerCard = contactToVcard(fullContact, { callerId: true, rev: REV });
ok('--caller-id FN variant', callerCard.includes('FN:Jane Doe (Acme recruiter)'));
ok('caller-id leaves N untouched', callerCard.includes('N:Doe;Jane;;;'));
const typelessCaller = contactToVcard({ ...fullContact, type: '' }, { callerId: true, rev: REV });
ok('caller-id without type -> company only', typelessCaller.includes('FN:Jane Doe (Acme)'));

const minimalCard = contactToVcard({ name: 'Cher', company: 'Globex', type: '', title: '', phone: '', email: '', linkedin: '', tracker: null, notes: '' }, { rev: REV });
ok('single-token name lands in the family slot', minimalCard.includes('N:Cher;;;;'));
ok('no TEL when phone empty', !minimalCard.includes('TEL'));
ok('no EMAIL when email empty', !minimalCard.includes('EMAIL'));
ok('no URL when linkedin empty', !minimalCard.includes('URL'));
ok('no NOTE when type/tracker/notes all empty', !minimalCard.includes('NOTE'));
ok('no TITLE when title empty', !minimalCard.includes('TITLE'));

const threeToken = contactToVcard({ ...jane, name: 'Ana María García' }, { rev: REV });
ok('multi-token name: last token = family, rest = given', threeToken.includes('N:García;Ana María;;;'));
ok('long NOTE lines come out folded', contactToVcard({ ...jane, notes: 'z'.repeat(200) }, { rev: REV }).split('\r\n').every(l => bytes(l) <= 75));
ok('REV defaults to an ISO timestamp when not pinned', /REV:\d{4}-\d{2}-\d{2}T[\d:.]+Z/.test(contactToVcard(jane)));

// ============================================================================
// 8. buildVcf — CRLF discipline
// ============================================================================
console.log('\n--- 8. buildVcf ---');

const distinct = { ...jane, name: 'Bob Roe', company: 'Globex' };
const vcf = buildVcf([fullContact, distinct], { rev: REV });
eq('two cards emitted for distinct contacts', (vcf.match(/BEGIN:VCARD/g) || []).length, 2);
ok('file ends with CRLF', vcf.endsWith('END:VCARD\r\n'));
ok('no bare LF anywhere', !/[^\r]\n/.test(vcf) && !vcf.startsWith('\n'));
eq('empty store -> empty string', buildVcf([]), '');

// Duplicates (same UID): LAST occurrence wins the export — the store is
// updated in place, so the freshest line is the authoritative one.
const dupVcf = buildVcf([
  { ...jane, notes: 'stale line' },
  { ...jane, notes: 'fresh line' },
], { rev: REV });
eq('duplicate pair -> one card in the vcf', (dupVcf.match(/BEGIN:VCARD/g) || []).length, 1);
ok('the LATER occurrence wins', dupVcf.includes('fresh line') && !dupVcf.includes('stale line'));

// ============================================================================
// 9. CLI behavior
// ============================================================================
console.log('\n--- 9. CLI behavior ---');

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'contacts.mjs');

try {
  execFileSync('node', [scriptPath, '--self-test'], { encoding: 'utf-8', timeout: 10000 });
  ok('--self-test exits 0', true);
} catch (e) {
  ok('--self-test exits 0', false);
  console.log(`    exit code: ${e.status}, stderr: ${e.stderr?.slice(0, 200)}`);
}

// contacts.mjs resolves its paths from import.meta.url and is zero-dep, so a
// copy of the script into a temp dir is a fully isolated career-ops root:
// data/contacts.tsv and output/ under the temp dir, no dependence on whatever
// the caller's real workspace contains — a contributor with a real phonebook
// gets the same results as CI.
const tmpRoot = mkdtempSync(join(tmpdir(), 'contacts-cli-'));
const tmpScript = join(tmpRoot, 'contacts.mjs');
try {
  copyFileSync(scriptPath, tmpScript);
  mkdirSync(join(tmpRoot, 'data'), { recursive: true });
  writeFileSync(join(tmpRoot, 'data/contacts.tsv'), [
    '# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes',
    row(['Jane Doe', 'Acme', 'recruiter', 'Talent Partner', '+49 151 1234567', 'jane@acme.io', 'https://linkedin.com/in/janedoe', '012', 'met at screen; prefers email, not calls']),
    row(['山田 太郎', 'Globex', 'hiring-manager', '', '', 'taro@globex.jp', '', '-', '']),
  ].join('\n'));

  const jsonOut = JSON.parse(execFileSync('node', [tmpScript], { encoding: 'utf-8', timeout: 10000 }));
  eq('default JSON: total = 2', jsonOut.total, 2);
  eq('default JSON: contacts array present', jsonOut.contacts.length, 2);
  ok('default JSON: quality object present', 'quality' in jsonOut);

  const summaryOut = execFileSync('node', [tmpScript, '--summary'], { encoding: 'utf-8', timeout: 10000 });
  ok('--summary is human-readable', summaryOut.includes('CONTACTS') && summaryOut.includes('Jane Doe'));
  ok('--summary prints the data-quality section', summaryOut.includes('Data quality:'));

  execFileSync('node', [tmpScript, '--vcf'], { encoding: 'utf-8', timeout: 10000 });
  const vcfPath = join(tmpRoot, 'output/contacts.vcf');
  ok('--vcf writes output/contacts.vcf by default', existsSync(vcfPath));
  const written = readFileSync(vcfPath, 'utf-8');
  ok('written vcf uses CRLF', written.includes('\r\n') && !/[^\r]\n/.test(written));
  ok('written vcf carries UIDs', written.includes('UID:careerops-jane-doe-acme'));
  ok('written vcf keeps the CJK name intact', written.includes('山田 太郎'));
  ok('default FN has no caller-id suffix', written.includes('FN:Jane Doe\r\n'));

  execFileSync('node', [tmpScript, '--vcf', '--caller-id'], { encoding: 'utf-8', timeout: 10000 });
  ok('--vcf --caller-id renders annotated FN', readFileSync(vcfPath, 'utf-8').includes('FN:Jane Doe (Acme recruiter)'));

  const customOut = execFileSync('node', [tmpScript, '--vcf', 'output/custom.vcf'], { encoding: 'utf-8', timeout: 10000, cwd: tmpRoot });
  ok('--vcf accepts a custom in-project path', existsSync(join(tmpRoot, 'output/custom.vcf')) && customOut.includes('custom.vcf'));

  let escaped = false;
  try {
    execFileSync('node', [tmpScript, '--vcf', join(tmpdir(), 'contacts-escape.vcf')], { encoding: 'utf-8', timeout: 10000 });
    escaped = true;
  } catch (e) {
    ok('--vcf refuses a path escaping the project dir (exit 1)', e.status === 1);
    ok('refusal names the offending path', String(e.stderr).includes('Refusing to write'));
  }
  if (escaped) ok('--vcf refuses a path escaping the project dir (exit 1)', false);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

// Empty store: fresh temp root with NO data/contacts.tsv at all.
const emptyRoot = mkdtempSync(join(tmpdir(), 'contacts-empty-'));
try {
  copyFileSync(scriptPath, join(emptyRoot, 'contacts.mjs'));
  const emptyJson = JSON.parse(execFileSync('node', [join(emptyRoot, 'contacts.mjs')], { encoding: 'utf-8', timeout: 10000 }));
  eq('missing store: JSON total = 0', emptyJson.total, 0);
  eq('missing store: contacts = []', emptyJson.contacts, []);
  const emptyVcfOut = execFileSync('node', [join(emptyRoot, 'contacts.mjs'), '--vcf'], { encoding: 'utf-8', timeout: 10000 });
  ok('missing store: --vcf exits 0 with a clear message', emptyVcfOut.includes('No contacts to export'));
  ok('missing store: --vcf writes no file', !existsSync(join(emptyRoot, 'output/contacts.vcf')));
} finally {
  rmSync(emptyRoot, { recursive: true, force: true });
}

// ============================================================================
// RESULTS
// ============================================================================
console.log(`\n${'='.repeat(78)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\n  Failed tests:`);
  for (const f of failures) console.log(`    - ${f}`);
}
console.log(`${'='.repeat(78)}`);

process.exit(failed > 0 ? 1 : 0);
