// A cover letter gets the text pass a CV gets. modes/_writing.md promises it for
// candidate prose, and without it the PDF printed a draft's **bold** with its
// asterisks. Runs the real script up to the render, so a call that stops
// reaching the renderer fails here, not on someone's letter.
//
// Run:  node --test tests/cover-letter-ats-normalize.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CAPTURE = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'cover-pdf-capture-register.mjs')).href;

/** The body of the HTML generate-cover-letter.mjs hands to the renderer. */
function printed(fields) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cover-ats-'));
  try {
    mkdirSync(join(dir, 'output'));
    writeFileSync(join(dir, 'cv.md'), 'Jane Doe builds systems.\n');
    const payload = {
      candidate: { name: 'Jane Doe' },
      letter: { role_title: 'Engineer', opening: 'Opening.', profile_intro: 'Profile.', ...fields },
      output_path: 'output/letter.pdf',
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
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', COVER_HTML_CAPTURE: capture },
    });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    const html = readFileSync(capture, 'utf-8');
    return html.slice(html.indexOf('<body'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
