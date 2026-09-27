/**
 * candidate-identity.test.mjs — the CV contact block comes from config/profile.yml.
 *
 * Regression guard for a real data-loss path: the identity used to be a literal
 * in generate-master-cvs.mjs, which is a SYSTEM_PATHS file. `update-system.mjs
 * apply` restores system files from upstream, so an update overwrote the literal
 * and every generated CV silently lost the candidate's contact details — no
 * error, just a CV with no name on it. These tests pin the loader's contract so
 * that cannot regress quietly, and assert on the generator too, since a loader
 * nobody calls would pass every test here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  loadCandidateIdentity,
  readCandidateBlock,
  missingFields,
  displayFor,
  PLACEHOLDER_IDENTITY,
  PROFILE_PATH,
} from '../lib/candidate-identity.mjs';

const FIXTURE = mkdtempSync(join(tmpdir(), 'cops-identity-'));

function profile(name, body) {
  const p = join(FIXTURE, name);
  writeFileSync(p, body);
  return p;
}

test('reads every field out of the candidate block', () => {
  const p = profile('full.yml', [
    'candidate:',
    '  full_name: "Ada Lovelace"',
    '  email: "ada@example.com"',
    '  phone: "+44-20-7946-0000"',
    '  location: "London, UK"',
    '  linkedin: "https://linkedin.com/in/adalovelace"',
    '  portfolio_url: "https://ada.example.com"',
    '',
  ].join('\n'));

  assert.deepEqual(loadCandidateIdentity(p), {
    name: 'Ada Lovelace',
    phone: '+44-20-7946-0000',
    email: 'ada@example.com',
    linkedin: { url: 'https://linkedin.com/in/adalovelace', display: 'linkedin.com/in/adalovelace' },
    portfolio: { url: 'https://ada.example.com', display: 'ada.example.com' },
    location: 'London, UK',
  });
});

test('link display drops the scheme but the href keeps it', () => {
  // generate_cv_pdf.py only prefixes a scheme when one is absent, so a display
  // with a scheme would render as text the reader sees. The href must keep it.
  assert.equal(displayFor('https://linkedin.com/in/x'), 'linkedin.com/in/x');
  assert.equal(displayFor('http://example.com/'), 'example.com');
  assert.equal(displayFor(''), '');
  assert.equal(displayFor(null), '');
});

test('linkedin stays a flat string, not an object', () => {
  // prepare-application.mjs regex-reads `linkedin` for ATS autofill; an object
  // form silently produces an empty field on the application.
  const p = profile('flat.yml', 'candidate:\n  linkedin: "https://linkedin.com/in/ada"\n');
  const raw = readFileSync(p, 'utf8');
  assert.match(raw, /^\s*linkedin:\s*"https:\/\/linkedin\.com\/in\/ada"\s*$/m);
  assert.equal(typeof readCandidateBlock(p).linkedin, 'string');
});

test('a missing profile yields placeholders, not a crash', () => {
  const id = loadCandidateIdentity(join(FIXTURE, 'does-not-exist.yml'));
  assert.equal(id.name, PLACEHOLDER_IDENTITY.name);
  assert.equal(id.email, PLACEHOLDER_IDENTITY.email);
  assert.equal(id.linkedin.url, '');
});

test('a malformed profile degrades instead of throwing', () => {
  // The profile is the user's file to fix; a CV generator must not lose the run.
  const p = profile('bad.yml', 'candidate:\n  full_name: "unclosed\n   - [oops\n');
  assert.equal(loadCandidateIdentity(p).name, PLACEHOLDER_IDENTITY.name);
});

test('one absent field does not blank the others', () => {
  const p = profile('partial.yml', 'candidate:\n  full_name: "Grace Hopper"\n  email: "g@example.com"\n');
  const id = loadCandidateIdentity(p);
  assert.equal(id.name, 'Grace Hopper');
  assert.equal(id.email, 'g@example.com');
  assert.equal(id.phone, PLACEHOLDER_IDENTITY.phone);
});

test('missingFields names the profile key, not the internal one', () => {
  const p = profile('holes.yml', 'candidate:\n  email: "g@example.com"\n');
  const missing = missingFields(loadCandidateIdentity(p));
  assert.ok(missing.includes('candidate.full_name'), 'reports full_name, not name');
  assert.ok(!missing.includes('candidate.name'));
  assert.ok(!missing.includes('candidate.email'), 'a filled field is not reported');
  assert.ok(missing.includes('candidate.portfolio_url'));
});

test('a fully populated profile reports nothing missing', () => {
  const p = profile('complete.yml', [
    'candidate:',
    '  full_name: "Grace Hopper"',
    '  email: "g@example.com"',
    '  phone: "+1-202-555-0000"',
    '  location: "Arlington, VA"',
    '  linkedin: "https://linkedin.com/in/gracehopper"',
    '  portfolio_url: "https://grace.example.com"',
    '',
  ].join('\n'));
  assert.deepEqual(missingFields(loadCandidateIdentity(p)), []);
});

test('the generator carries no hardcoded identity any more', () => {
  // The whole point: the literal that an update used to clobber is gone, and the
  // script reads the user layer instead.
  const src = readFileSync(new URL('../generate-master-cvs.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\+\d[\d\s-]{7,}/, 'no hardcoded phone number');
  assert.doesNotMatch(src, /[\w.+-]+@[\w-]+\.[\w.]+/, 'no hardcoded email address');
  assert.match(src, /loadCandidateIdentity/, 'reads identity from the user layer');
});

test('the real config/profile.yml resolves a complete identity', () => {
  // Guards the wiring in this checkout, not just the loader in isolation: if
  // someone renames a key in profile.yml, the CV loses the field and this fails.
  if (!existsSync(PROFILE_PATH)) return; // template clone — nothing to assert
  const missing = missingFields(loadCandidateIdentity(PROFILE_PATH));
  assert.deepEqual(missing, [], `config/profile.yml is missing: ${missing.join(', ')}`);
});

// --- Rendered-output guard ---------------------------------------------------
//
// Everything above proves the identity is READ. These prove it SURVIVES the
// render, which is a separate failure: buildContactRow() can drop a field, or
// linkify it without its scheme, long after the loader is perfect. A loader
// test cannot see either. Seam copied from tests/cv-named-templates.test.mjs:133.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE = process.execPath;

const RENDER_FIXTURE = profile('render.yml', [
  'candidate:',
  '  full_name: "Ada Lovelace"',
  '  email: "ada@example.com"',
  '  phone: "+44-20-7946-0000"',
  '  linkedin: "https://linkedin.com/in/adalovelace"',
  '',
].join('\n'));

// Headline is deliberately absent: it is not a key the HTML builder reads, so
// including it only adds a validation warning to the output we are reading.
function renderHtml() {
  const payload = {
    lang: 'en',
    page_format: 'A4',
    candidate: loadCandidateIdentity(RENDER_FIXTURE),
    summary: 'A summary line, so the payload is not degenerate.',
    experience: [{ company: 'Acme', role: 'Engineer', bullets: ['Did a thing.'] }],
    projects: [],
    education: [],
    skills: [{ category: 'Core', items: ['Testing'] }],
  };
  const input = join(FIXTURE, 'render-payload.json');
  const output = join(FIXTURE, 'render-payload.html');
  writeFileSync(input, JSON.stringify(payload));
  execFileSync(NODE, ['build-cv-html.mjs', input, output], { cwd: ROOT, encoding: 'utf-8' });
  return readFileSync(output, 'utf-8');
}

test('the rendered CV shows the email as a real mailto: link', () => {
  const html = renderHtml();
  assert.match(html, /href="mailto:ada@example\.com"/, 'email is not a mailto: link');
  assert.match(html, />ada@example\.com</, 'email is linkified but not visible to the reader');
});

test('the mailto href keeps its scheme', () => {
  // The exact failure the LinkedIn href had: linkified, but stripped of the
  // scheme, so generate_cv_pdf.py reads it as a relative path and the PDF
  // silently loses the annotation. Assert the href verbatim, not just "some
  // href exists".
  const href = renderHtml().match(/href="(mailto:[^"]*)"/);
  assert.ok(href, 'no mailto: link rendered at all');
  assert.equal(href[1], 'mailto:ada@example.com');
});

test('the rendered CV shows the phone as a tel: link', () => {
  // The second contact link, so a change to buildContactRow cannot take out
  // one and leave the other asserted.
  assert.match(renderHtml(), /href="tel:\+44-20-7946-0000"/);
});

test('the real profile email is the address the CV will publish', () => {
  // Pinned, not just structural. The trap: a missing email key does NOT blank
  // the contact row, it falls back to PLACEHOLDER_IDENTITY and renders a real,
  // clickable mailto:you@example.com on a CV someone might send. The two tests
  // above catch the key going missing; this one catches the wrong address
  // reaching the page. The rest of this file runs on a fixture precisely so
  // that pinning a real address stays a one-line, deliberate exception.
  if (!existsSync(PROFILE_PATH)) return; // template clone — nothing to assert
  assert.equal(
    loadCandidateIdentity(PROFILE_PATH).email,
    'career.shivanand@gmail.com',
    'the contact address changed — update this expectation to match config/profile.yml',
  );
});
