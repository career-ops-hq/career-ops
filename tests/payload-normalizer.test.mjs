#!/usr/bin/env node

/**
 * Offline unit tests for lib/payload-normalizer.mjs.
 *
 * No network, no API key, no OpenAI call. Pure function tests against a
 * hand-written payload plus one end-to-end render through build-cv-html.mjs to
 * prove the normalized payload actually produces <li> elements — the whole
 * point of the module is the HTML that comes out the other end, so asserting
 * only on the returned object would not test it.
 *
 * The failure this module exists for is documented at
 * tests/compiler-payload-validation.test.mjs ("REGRESSION: string bullets pass
 * validation and silently render an empty <ul>"). This suite asserts the fix
 * for it, so if the compiler's silent-drop ever regresses back to a throw or a
 * drop, both suites fail together.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalizePayload } from '../lib/payload-normalizer.mjs';
import { validatePayload } from '../lib/cv-payload-schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal payload that already validates, used as the base for mutations. */
function base() {
  return {
    lang: 'en',
    page_format: 'letter',
    candidate: { name: 'Ada Lovelace', email: 'ada@example.invalid' },
    summary: 's',
    competencies: ['a'],
    experience: [{ company: 'Analytical Engine Works', role: 'Principal Programmer', bullets: ['one', 'two'] }],
    projects: [{ name: 'Note G', bullets: ['draft'] }],
    education: [{ title: 'Mathematics', org: 'Private Tuition', year: '1835' }],
    skills: [{ category: 'Technical', items: ['Logic'] }],
  };
}

function render(payload, label) {
  const dir = mkdtempSync(join(tmpdir(), `cvnorm-${label}-`));
  const json = join(dir, 'payload.json');
  const out = join(dir, 'cv.html');
  writeFileSync(json, JSON.stringify(payload, null, 2), 'utf-8');
  execFileSync(process.execPath, [join(ROOT, 'build-cv-html.mjs'), json, out], { cwd: ROOT, encoding: 'utf-8' });
  return { html: readFileSync(out, 'utf-8'), dir };
}

// ---------------------------------------------------------------------------
// 1. bullets as a raw string
// ---------------------------------------------------------------------------

test('a single-line string bullets becomes a one-element array', () => {
  const p = base();
  p.experience[0].bullets = 'Published Note G, the first published algorithm.';
  const { payload, notes, errors } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, ['Published Note G, the first published algorithm.']);
  assert.deepEqual(errors, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /experience\[0\]: bullets was a string -> array of 1 \(split as one bullet\)/);
});

test('a newline-separated string bullets splits into one array element per line', () => {
  const p = base();
  p.experience[0].bullets = 'First bullet.\nSecond bullet.\nThird bullet.';
  const { payload, errors } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, ['First bullet.', 'Second bullet.', 'Third bullet.']);
  assert.deepEqual(errors, []);
});

test('markdown list markers and blank lines are stripped from a multi-line string', () => {
  const p = base();
  p.experience[0].bullets = '- Dash bullet\n* Star bullet\n\n- Second dash';
  const { payload } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, ['Dash bullet', 'Star bullet', 'Second dash']);
});

test('a CRLF string splits cleanly', () => {
  const p = base();
  p.experience[0].bullets = 'Alpha\r\nBeta';
  const { payload } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, ['Alpha', 'Beta']);
});

test('string bullets are normalized on the projects section too', () => {
  const p = base();
  p.projects[0].bullets = 'Single project note.';
  const { payload, notes } = normalizePayload(p);
  assert.deepEqual(payload.projects[0].bullets, ['Single project note.']);
  assert.match(notes[0], /projects\[0\]: bullets was a string/);
});

test('every entry in a multi-entry section is normalized, not just the first', () => {
  const p = base();
  p.experience.push({ company: 'Bernoulli Project', role: 'Researcher', bullets: 'One.\nTwo.' });
  const { payload, notes } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, ['one', 'two'], 'array entry untouched');
  assert.deepEqual(payload.experience[1].bullets, ['One.', 'Two.']);
  assert.equal(notes.length, 1, 'only the string entry is noted');
});

// ---------------------------------------------------------------------------
// 2. Missing / unusable bullets
// ---------------------------------------------------------------------------

test('an absent bullets property is initialized to []', () => {
  const p = base();
  delete p.experience[0].bullets;
  const { payload, notes, errors } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, []);
  assert.deepEqual(errors, []);
  assert.match(notes[0], /experience\[0\]: bullets absent -> \[\]/);
});

test('a null or undefined bullets becomes []', () => {
  for (const value of [null, undefined]) {
    const p = base();
    p.experience[0].bullets = value;
    const { payload } = normalizePayload(p);
    assert.deepEqual(payload.experience[0].bullets, [], `failed for ${String(value)}`);
  }
});

test('a whitespace-only string bullets becomes [] and says so', () => {
  const p = base();
  p.experience[0].bullets = '   \n  ';
  const { payload, notes } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, []);
  assert.match(notes[0], /empty\/blank string -> \[\]/);
});

test('a numeric or object bullets is replaced with [] rather than stringified', () => {
  for (const bad of [42, true, { a: 1 }]) {
    const p = base();
    p.experience[0].bullets = bad;
    const { payload, notes } = normalizePayload(p);
    assert.deepEqual(payload.experience[0].bullets, [], `failed for ${JSON.stringify(bad)}`);
    assert.ok(notes.some(n => /unusable shape\) -> \[\]/.test(n)), 'shape error must be recorded');
  }
});

test('non-string bullets ELEMENTS are dropped, not coerced to [object Object]', () => {
  const p = base();
  p.experience[0].bullets = ['good', {}, null, '   ', 7, 'also good'];
  const { payload, notes } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, ['good', 'also good']);
  assert.match(notes[0], /dropped 4 non-string or blank bullet\(s\)/);
});

test('a well-formed array is left completely untouched and unnoted', () => {
  const p = base();
  const before = JSON.stringify(p);
  const { payload, notes, errors } = normalizePayload(p);
  assert.deepEqual(payload.experience[0].bullets, ['one', 'two']);
  assert.deepEqual(notes, [], 'a conforming payload must produce no notes');
  assert.deepEqual(errors, []);
  assert.equal(JSON.stringify(payload), before, 'payload must be byte-identical');
});

test('non-object entries in a list section are skipped, not crashed on', () => {
  const p = base();
  p.experience.push('a bare string');
  p.experience.push(null);
  const { errors } = normalizePayload(p);
  // The validator reports them as malformed entries; the normalizer must not throw.
  assert.ok(errors.length > 0, 'validator should reject the malformed entries');
  assert.ok(errors.some(e => /experience\[[12]\]/.test(e)), 'errors should name the bad entries');
});

// ---------------------------------------------------------------------------
// 3. Education key dialect conversion
// ---------------------------------------------------------------------------

test('LaTeX education keys are renamed into the html dialect and become renderable', () => {
  const p = base();
  p.education = [{ institution: 'Private Tuition', degree: 'Mathematics', location: 'London', dates: '1835' }];

  // Baseline: wrong-dialect keys are a LOUD validator error, not a silent drop
  // (unlike string bullets). Conversion's value is auto-repair, not visibility.
  const raw = validatePayload(p, 'html');
  assert.ok(raw.errors.some(e => /missing required field title/.test(e)), 'validator flags the wrong dialect');
  assert.ok(raw.errors.some(e => /unrecognised keys present: institution, degree, dates/.test(e)),
    'and names the offending keys, so the diagnosis is already unambiguous');

  const { payload, notes, errors } = normalizePayload(p, { format: 'html' });
  assert.equal(payload.education[0].institution, undefined, 'source key must be renamed, not duplicated');
  assert.equal(payload.education[0].title, 'Private Tuition');
  assert.equal(payload.education[0].org, 'Mathematics');
  assert.equal(payload.education[0].year, '1835');
  assert.equal(payload.education[0].location, 'London', 'location is spelled the same in both dialects');
  assert.deepEqual(errors, []);
  assert.match(notes[0], /education\[0\]: renamed 3 key\(s\) into the html dialect \(now renderable\)/);
});

test('html education keys are renamed into the tex dialect', () => {
  const p = base();
  p.education = [{ title: 'Mathematics', org: 'Private Tuition', location: 'London', year: '1835' }];
  const { payload, notes, errors } = normalizePayload(p, { format: 'tex' });
  assert.equal(payload.education[0].institution, 'Mathematics');
  assert.equal(payload.education[0].degree, 'Private Tuition');
  assert.equal(payload.education[0].dates, '1835');
  assert.equal(payload.education[0].title, undefined);
  assert.deepEqual(errors, []);
  assert.match(notes[0], /into the tex dialect \(now renderable\)/);
});

test('conversion never overwrites a key the payload already has', () => {
  const p = base();
  // Both spellings present: the html key must win, the tex one left alone.
  p.education = [{ title: 'Real Title', institution: 'Stray', degree: 'Mathematics' }];
  const { payload } = normalizePayload(p, { format: 'html' });
  assert.equal(payload.education[0].title, 'Real Title', 'existing target key must not be clobbered');
  assert.equal(payload.education[0].institution, 'Stray', 'source key is left alone when a target exists');
});

test('an education entry that cannot reach renderable state still reports it', () => {
  // tex education requires BOTH institution and degree (schema:49), so a lone
  // html `title` renames into a still-incomplete tex entry. That incompleteness
  // must be visible rather than rendering as an empty section.
  const p = base();
  p.education = [{ title: 'Only A Title' }];
  const { payload, notes, errors } = normalizePayload(p, { format: 'tex' });
  assert.equal(payload.education[0].institution, 'Only A Title');
  assert.match(notes[0], /STILL missing a required field/);
  assert.ok(errors.some(e => e.includes('missing required field')),
    'a partially-recognised entry must still surface a validation error, not be silently dropped');
});

test('a lone institution IS renderable for html, since html education needs only title', () => {
  // Guards the previous test against being a false alarm: html education.required
  // is ['title'] alone (schema:31), so this conversion genuinely completes.
  const p = base();
  p.education = [{ institution: 'Only institution' }];
  const { payload, notes, errors } = normalizePayload(p, { format: 'html' });
  assert.equal(payload.education[0].title, 'Only institution');
  assert.match(notes[0], /now renderable/);
  assert.deepEqual(errors, []);
});

test('already-correct html education keys are left untouched', () => {
  const p = base();
  const before = JSON.stringify(p.education);
  const { payload, notes } = normalizePayload(p, { format: 'html' });
  assert.equal(JSON.stringify(payload.education), before);
  assert.deepEqual(notes, [], 'nothing to convert, so nothing to report');
});

test('a non-object education entry is skipped without throwing', () => {
  const p = base();
  p.education = ['a bare string', null];
  const { errors } = normalizePayload(p, { format: 'html' });
  assert.ok(errors.some(e => /education\[/.test(e)));
});

// ---------------------------------------------------------------------------
// 4. Non-object and unknown-format inputs
// ---------------------------------------------------------------------------

test('a non-object payload returns a safe error instead of throwing', () => {
  for (const bad of [null, undefined, 'a string', 42, ['an', 'array']]) {
    const { payload, errors, notes } = normalizePayload(bad);
    assert.equal(payload, bad, 'input is returned untouched');
    assert.ok(errors.length === 1, `expected 1 error for ${JSON.stringify(bad)}`);
    assert.match(errors[0], /expected an object/);
    assert.deepEqual(notes, []);
  }
});

test('an unknown format is reported rather than silently defaulting', () => {
  const p = base();
  const { errors } = normalizePayload(p, { format: 'docx' });
  assert.ok(errors.some(e => /unknown payload format/.test(e)));
});

// ---------------------------------------------------------------------------
// 5. End-to-end: the normalized payload must produce real <li> elements
// ---------------------------------------------------------------------------

test('normalized string bullets render as real <li> elements (the point of the module)', (t) => {
  const p = base();
  p.experience[0].bullets = 'Published Note G.\nFormalised looping semantics.\nDerived the Bernoulli numbers.';
  const { payload, errors } = normalizePayload(p, { format: 'html' });
  assert.deepEqual(errors, []);

  const { html, dir } = render(payload, 'e2e');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // 3 <li> from experience only: projects join bullets into a .project-desc
  // line (build-cv-html.mjs:402-404) rather than emitting list items.
  assert.equal((html.match(/<li>/g) || []).length, 3, 'the 3 normalized experience bullets');
  assert.ok(html.includes('Published Note G.'));
  assert.ok(html.includes('Formalised looping semantics.'));
  assert.ok(html.includes('Derived the Bernoulli numbers.'));
  assert.ok(!/<ul>\s*<\/ul>/.test(html), 'no empty bullet list may survive normalization');
  assert.ok(html.includes('draft'), 'the untouched project bullet still renders');
});

test('the un-normalized payload really does render an empty <ul> — the bug being fixed', (t) => {
  // Guards against the module silently becoming a no-op: if build-cv-html.mjs is
  // ever fixed to handle string bullets itself, THIS test fails, which is the
  // signal to retire the normalizer rather than keep dead code.
  const p = base();
  p.experience[0].bullets = 'Prose that the compiler silently discards.';

  const preErrors = validatePayload(p, 'html');
  assert.deepEqual(preErrors.errors, [], 'validator does not catch string bullets');
  assert.deepEqual(preErrors.warnings, [], 'nor warn about them');

  const { html, dir } = render(p, 'e2e-unnormalized');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.match(html, /<ul>\s*<\/ul>/, 'expected the known silent-empty-bullet-list behavior');
  assert.ok(!html.includes('Prose that the compiler'), 'the string must not leak into the CV');
});

test('renamed education renders in the html output, closing the #3523 drop', (t) => {
  const p = base();
  p.education = [{ institution: 'Private Tuition', degree: 'Mathematics', location: 'London', dates: '1835' }];
  const { payload, errors } = normalizePayload(p, { format: 'html' });
  assert.deepEqual(errors, []);

  const { html, dir } = render(payload, 'edu');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.match(html, /<div class="cert-table">|Education/, 'education section should be present');
  assert.ok(html.includes('Private Tuition'), 'institution must reach the rendered CV');
  assert.ok(html.includes('Mathematics'));
});
