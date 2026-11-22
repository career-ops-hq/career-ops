// A cover letter gets the wording check a CV gets, as notes and never as a stop.
//
// generate-pdf.mjs refuses a CV that carries stock wording the candidate never
// wrote. generate-cover-letter.mjs ran the fact gate only, so a draft kept
// "spearheaded" and the long dashes cover mode bans, and nothing said so. The
// letter is not refused (it quotes the posting), but the notes name the words.
//
// The script runs for real with the renderer stubbed (tests/fixtures), so no
// browser is needed.
//
// Run:  node --test tests/cover-letter-voice.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CAPTURE = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'cover-pdf-capture-register.mjs')).href;

/** Runs the script on a letter. `html` is what reached the renderer, if anything did. */
function letter(fields, { cv = 'Jane Doe builds systems.\n', inputs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cover-voice-'));
  try {
    mkdirSync(join(dir, 'output'));
    writeFileSync(join(dir, 'cv.md'), cv);
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

test('stock wording the candidate never wrote is named, and the letter still builds', () => {
  const { run, html } = letter({ opening: 'I spearheaded a payments platform and leveraged Postgres.' });
  assert.equal(run.status, 0, describeSpawn(run));
  assert.ok(html, 'a wording note must not stop the letter');
  assert.match(run.stderr, /Voice check warning for cover letter: .*"spearheaded"/);
  assert.match(run.stderr, /"leveraged"/);
  assert.match(run.stderr, /The PDF still builds/);
});

test('wording the CV already uses is the candidate\'s own and is not named', () => {
  const { run } = letter(
    { opening: 'I spearheaded a payments platform.' },
    { cv: 'Jane Doe spearheaded a payments platform at Acme.\n' },
  );
  assert.equal(run.status, 0, describeSpawn(run));
  assert.doesNotMatch(run.stderr, /Voice check/);
});

test('wording the candidate gave as an answer for this letter is not named', () => {
  const { run } = letter(
    { opening: 'I leveraged the cache to cut load.' },
    { inputs: ['I leveraged the cache to cut load.'] },
  );
  assert.equal(run.status, 0, describeSpawn(run));
  assert.doesNotMatch(run.stderr, /Voice check/);
});

test('a long dash in the draft is reported, and the PDF still builds', () => {
  const { run, html } = letter({ opening: 'I built the pipeline — and then I measured it.' });
  assert.equal(run.status, 0, describeSpawn(run));
  assert.ok(html, 'a dash note must not stop the letter');
  assert.match(run.stderr, /Voice check warning for cover letter: an em dash\./);
  assert.match(run.stderr, /Cover mode bans long dashes/);
});

test('a year range is a date, not a long dash', () => {
  const { run } = letter({ opening: 'I ran the platform team from 2021–2024.' });
  assert.equal(run.status, 0, describeSpawn(run));
  assert.doesNotMatch(run.stderr, /Voice check/);
});

test('a plain letter gets no wording note, so the template itself is not flagged', () => {
  const { run, html } = letter({
    opening: 'I saw the Backend Engineer opening and it caught my eye.',
    profile_intro: 'I fixed one slow query by caching it, and the dashboard stopped timing out.',
  });
  assert.equal(run.status, 0, describeSpawn(run));
  assert.ok(html);
  assert.doesNotMatch(run.stderr, /Voice check/);
});

test('a sentence with a long dash that the candidate gave as an answer is theirs and is not named', () => {
  const sentence = 'I built it \u2014 then measured it.';
  const { run } = letter({ opening: sentence }, { inputs: [sentence] });
  assert.equal(run.status, 0, describeSpawn(run));
  assert.doesNotMatch(run.stderr, /Voice check/);
});
