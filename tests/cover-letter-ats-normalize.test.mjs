// A cover letter gets the text pass a CV gets. modes/_writing.md promises it for
// candidate prose, and without it the PDF printed a draft's **bold** with its
// asterisks. Runs the real script up to the render, so a call that stops
// reaching the renderer fails here, not on someone's letter.
//
// Run:  node --test tests/cover-letter-ats-normalize.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { newFactWarnings } from '../verify-cv-facts.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CAPTURE = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'cover-pdf-capture-register.mjs')).href;

/** Runs the script on a letter. `html` is what reached the renderer, if anything did. */
function letter(fields, { cv = 'Jane Doe builds systems.\n', facts, inputs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cover-ats-'));
  try {
    mkdirSync(join(dir, 'output'));
    writeFileSync(join(dir, 'cv.md'), cv);
    if (facts) {
      mkdirSync(join(dir, 'config'));
      writeFileSync(join(dir, 'config', 'cv-facts.json'), JSON.stringify(facts));
    }
    const payload = {
      candidate: { name: 'Jane Doe' },
      letter: { role_title: 'Engineer', opening: 'Opening.', profile_intro: 'Profile.', ...fields },
      output_path: 'output/letter.pdf',
      ...(inputs ? { user_inputs: inputs } : {}),
    };
    writeFileSync(join(dir, 'payload.json'), JSON.stringify(payload));
    const capture = join(dir, 'printed.html');
    const run = spawnSync(process.execPath, [
      '--import', CAPTURE,
      join(ROOT, 'generate-cover-letter.mjs'),
      '--payload', join(dir, 'payload.json'),
    ], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 60_000,
      // A tracker or PDF-index override set in the developer's shell would place
      // the run's output/ in that workspace instead of this fixture.
      env: {
        ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '', CAREER_OPS_TRACKER: '',
        CAREER_OPS_PDF_INDEX: '', CAREER_OPS_PDF_SHARED: '', COVER_HTML_CAPTURE: capture,
      },
    });
    return { run, html: existsSync(capture) ? readFileSync(capture, 'utf-8') : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The body of the HTML generate-cover-letter.mjs hands to the renderer. */
function printed(fields, options) {
  const { run, html } = letter(fields, options);
  assert.equal(run.status, 0, describeSpawn(run));
  return html.slice(html.indexOf('<body'));
}

test('markdown bold prints as bold, not as asterisks', () => {
  const body = printed({ opening: 'I cut incidents to **zero** in a year.' });
  assert.match(body, /<strong>zero<\/strong>/);
  assert.ok(!body.includes('**'), body);
});

test('dashes and curly quotes become their ASCII forms', () => {
  const body = printed({ profile_intro: 'I build “boring” systems — it’s the job.' });
  assert.ok(!/[—“”’]/.test(body), body);
  assert.match(body, /(?:"|&quot;)boring(?:"|&quot;) systems - it(?:'|&#39;)s the job\./);
});

test('every letter field gets the pass, not only the opening', () => {
  const body = printed({
    greeting: 'Dear **Team**,',
    problems_section: 'One **problem**.',
    closing: 'A **closing**.',
    language_closing: 'Una **frase**.',
  });
  assert.ok(!body.includes('**'), body);
});

test('text in another language is left alone', () => {
  const body = printed({ language_closing: 'Espero alcanzar el nivel B2 a finales de año.' });
  assert.match(body, /Espero alcanzar el nivel B2 a finales de año\./);
});

test('a forbidden phrase only the pass spells out is refused before it prints', () => {
  const { run, html } = letter({ opening: 'I am a self–starter.' }, { facts: { forbidden_phrases: ['self-starter'] } });
  assert.equal(run.status, 1, describeSpawn(run));
  assert.match(run.stderr, /forbidden phrases found: self-starter/);
  assert.equal(html, null, 'a refused letter must not reach the renderer');
});

test('an advisory phrase only the pass spells out is reported, and a drafted one only once', () => {
  const { run, html } = letter(
    { opening: 'I am a self–starter.', profile_intro: 'I can maybe help.' },
    { facts: { warn_phrases: ['self-starter', 'maybe'] } },
  );
  assert.equal(run.status, 0, describeSpawn(run));
  assert.ok(html, 'an advisory phrase must not stop the letter');
  assert.equal(run.stderr.match(/advisory phrase: self-starter/g)?.length, 1, run.stderr);
  assert.equal(run.stderr.match(/advisory phrase: maybe/g)?.length, 1, run.stderr);
});

test('a letter says what the pass rewrote, and says nothing when it rewrote nothing', () => {
  const rewritten = letter({ opening: 'I saved €50k — in a year.' }, { cv: 'I saved €50k in a year.\n' });
  assert.equal(rewritten.run.status, 0, describeSpawn(rewritten.run));
  assert.match(rewritten.run.stderr, /ATS normalization: \d+ replacements \(.*em-dash=\d+.*euro=1.*\)/);
  const clean = letter({ opening: 'I build systems.' });
  assert.equal(clean.run.status, 0, describeSpawn(clean.run));
  assert.doesNotMatch(clean.run.stderr, /ATS normalization/);
});

test('a second check reports only what the first did not', () => {
  const fact = { kind: 'title', value: 'Staff', line: 'Staff Engineer' };
  const other = { kind: 'title', value: 'Principal', line: 'Principal Engineer' };
  const coverage = { message: 'one span unread', spans: ['x'] };
  assert.equal(newFactWarnings({}, {}), null);
  assert.equal(newFactWarnings({ warnings: ['maybe'], advisoryFacts: [fact], coverage },
    { warnings: ['maybe'], advisoryFacts: [fact], coverage }), null);
  assert.deepEqual(newFactWarnings({ warnings: ['maybe'], advisoryFacts: [fact] },
    { warnings: ['maybe', 'perhaps'], advisoryFacts: [fact, other], coverage }),
  { warnings: ['perhaps'], advisoryFacts: [other], coverage });
});

test('an amount with the currency after it prints when cv.md or a plan answer states it', () => {
  // The pass prints `50 000 €` as `50 000 EUR`, which the gate reads as €50000.
  // Before the sources were read that way too, these letters were refused.
  const stated = 'I cut supplier costs by 50 000 € a year at Globex.';
  const backed = letter({ opening: stated }, { cv: 'Cut supplier costs by 50 000 € a year at Globex.\n' });
  assert.equal(backed.run.status, 0, describeSpawn(backed.run));
  assert.match(backed.html, /50 000 EUR/);
  const plan = 'In my first year, I will cut supplier costs by 50 000 €.';
  const planned = letter({ opening: plan }, { inputs: [plan] });
  assert.equal(planned.run.status, 0, describeSpawn(planned.run));
  // Read now that it prints as a code, so an amount no source states is refused.
  const madeUp = letter({ opening: stated });
  assert.equal(madeUp.run.status, 1, describeSpawn(madeUp.run));
  assert.match(madeUp.run.stderr, /metric-like claims absent from sources: €50000/);
});

test('a figure the pass rewrites still prints when a source backs it', () => {
  const body = printed(
    { opening: 'I saved €50k a year.', profile_intro: 'I took p99 from 900ms → 200ms.' },
    { cv: 'I saved €50k a year.\nI took p99 from 900ms → 200ms.\n', facts: { forbidden_phrases: ['self-starter'] } },
  );
  assert.match(body, /I saved EUR 50k a year\./);
  assert.match(body, /from 900ms to 200ms\./);
});
