// tests/clean-markers-joiners.test.mjs — --keep-script-joiners keeps the
// single ZWJ / ZWNJ / VS16 that emoji, Persian and Brahmic spelling need, and
// still strips every joiner that could carry a zero-width payload (#5268).
//
// Each case runs through both `clean` and `audit`, since the two share one
// predicate and must agree. Invisible characters are written as \u escapes
// so the fixture is readable.
//
// HERMETIC: every file lives in a tmpdir fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'clean-markers.mjs');

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 30_000 });
  assert.equal(r.error, undefined, `clean-markers.mjs failed to spawn: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// Writes `text` to a fresh file, runs clean-markers on it, returns the result and the file's content after.
function onFile(text, ...args) {
  const dir = mkdtempSync(join(tmpdir(), 'clean-markers-joiners-'));
  try {
    const file = join(dir, 'doc.md');
    writeFileSync(file, text);
    const r = run(...args, file);
    return { ...r, after: readFileSync(file, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const KEPT = [
  ['man technologist (ZWJ sequence)', '\u{1F468}\u200D\u{1F4BB}'],
  ['heart with emoji presentation (VS16)', '\u2764\uFE0F'],
  ['Persian ZWNJ between stem and suffix', '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645'],
  ['Hindi conjunct with ZWJ after the virama', '\u0915\u094D\u200D\u0937'],
  ['heart on fire (VS16 before the ZWJ)', '\u2764\uFE0F\u200D\u{1F525}'],
  ['technologist with a skin tone before the ZWJ', '\u{1F468}\u{1F3FD}\u200D\u{1F4BB}'],
];

const STRIPPED = [
  ['ZWNJ between Latin letters', 'Fami\u200Clly', 'Familly'],
  ['ZWJ between Latin letters', 'a\u200Db', 'ab'],
  ['two joiners in a row between Arabic letters', '\u0627\u200D\u200D\u0628', '\u0627\u0628'],
  ['two ZWNJ in a row between Persian letters', '\u0645\u06CC\u200C\u200C\u062E', '\u0645\u06CC\u062E'],
  ['leading ZWJ', '\u200D\u{1F4BB}', '\u{1F4BB}'],
  ['VS16 after a letter', 'a\uFE0F', 'a'],
  ['ZWNJ between scripts (Arabic, then Devanagari)', '\u0627\u200C\u0915', '\u0627\u0915'],
  ['ZWJ next to a space', '\u{1F468} \u200D\u{1F4BB}', '\u{1F468} \u{1F4BB}'],
  ['ZWJ at the end of a line', '\u{1F468}\u200D\n', '\u{1F468}\n'],
  ['VS15 after a pictograph', '\u2764\uFE0E', '\u2764'],
  ['ZWNJ between two Arabic-Indic digits', '\u0661\u200C\u0662', '\u0661\u0662'],
  ['ZWJ between two Devanagari digits', '\u0967\u200D\u0968', '\u0967\u0968'],
];

for (const [name, text] of KEPT) {
  test(`--keep-script-joiners keeps: ${name}`, () => {
    const c = onFile(text, 'clean', '--keep-script-joiners');
    assert.equal(c.status, 0, describeSpawn(c, 'clean exited non-zero'));
    assert.equal(c.after, text, 'clean changed text the flag should keep');

    const a = onFile(text, 'audit', '--keep-script-joiners');
    assert.equal(a.status, 0, describeSpawn(a, 'audit failed a file whose joiners are all kept'));
    assert.match(a.stdout, /kept \d+ script joiners?/, 'audit did not report the kept joiners');
  });

  test(`default behaviour still strips: ${name}`, () => {
    const a = onFile(text, 'audit');
    assert.equal(a.status, 1, describeSpawn(a, 'audit without the flag passed a file with joiners'));

    const c = onFile(text, 'clean');
    assert.notEqual(c.after, text, 'clean without the flag left the joiners in place');
    assert.doesNotMatch(c.after, /[\u200C\u200D\uFE0F]/u, 'clean without the flag left a joiner');
  });
}

for (const [name, text, want] of STRIPPED) {
  test(`--keep-script-joiners still strips: ${name}`, () => {
    const a = onFile(text, 'audit', '--keep-script-joiners');
    assert.equal(a.status, 1, describeSpawn(a, 'audit passed a joiner the flag must not keep'));

    const c = onFile(text, 'clean', '--keep-script-joiners');
    assert.equal(c.status, 0, describeSpawn(c, 'clean exited non-zero'));
    assert.equal(c.after, want);
  });
}

test('the kept count covers every kept joiner in a file', () => {
  // ZWJ + VS16 + ZWNJ kept; the Latin ZWNJ still fails the audit.
  const text = '\u{1F468}\u200D\u{1F4BB} \u2764\uFE0F \u0645\u06CC\u200C\u062E Fami\u200Clly';
  const a = onFile(text, 'audit', '--keep-script-joiners');
  assert.equal(a.status, 1, describeSpawn(a, 'audit passed a file with a Latin ZWNJ'));
  assert.match(a.stdout, /kept 3 script joiners/);
  assert.match(a.stdout, /"ZWNJ":1/);

  const c = onFile(text, 'clean', '--keep-script-joiners');
  assert.equal(c.after, '\u{1F468}\u200D\u{1F4BB} \u2764\uFE0F \u0645\u06CC\u200C\u062E Familly');
});

test('--keep-script-joiners is a known flag', () => {
  const r = run('--help');
  assert.equal(r.status, 0, describeSpawn(r, '--help exited non-zero'));
  assert.match(r.all, /audit --keep-script-joiners/, '--help does not show the flag with audit');
  assert.match(r.all, /clean --keep-script-joiners/, '--help does not show the flag with clean');
});

test('with the flag on, every line names the kept count, zero included', () => {
  const a = onFile('plain text\n', 'audit', '--keep-script-joiners');
  assert.equal(a.status, 0, describeSpawn(a, 'audit failed a clean file'));
  assert.match(a.stdout, /kept 0 script joiners/);

  const off = onFile('plain text\n', 'audit');
  assert.doesNotMatch(off.stdout, /script joiner/, 'the kept note must stay absent without the flag');
});
