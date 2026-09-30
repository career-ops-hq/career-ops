#!/usr/bin/env node

/**
 * Offline compiler baseline for the structured JSON payload pipeline (#3523).
 *
 * PURPOSE
 *   `openai-tailor.mjs` still asks the model to emit a complete raw HTML
 *   document (see its system prompt: "Output the raw HTML starting with
 *   <!DOCTYPE html>"). `build-cv-html.mjs` already implements the intended
 *   architecture — the model emits a JSON payload and the builder owns every
 *   tag, class, and escape. This suite establishes that the compiler end of
 *   that migration is trustworthy BEFORE anything rewires the model.
 *
 *   Fully offline. No OpenAI call, no network, no API key. The payload is
 *   hardcoded and hyper-compliant on purpose: this suite tests the COMPILER,
 *   not the model's ability to produce one. A model-migration test belongs on
 *   the other side of the API call.
 *
 * WHAT IT PINS
 *   1. validatePayload(payload, 'html') -> zero errors on a conforming payload.
 *   2. All 29 template placeholders resolve. renderHtml() throws on any
 *      unresolved {{PLACEHOLDER}} (build-cv-html.mjs:683-685), so a clean
 *      render is itself the assertion — but we re-verify on the written file
 *      so the guarantee does not rest on one code path.
 *   3. Section partials (templates/sections/*.html) are actually used, and the
 *      LOCATION_BLOCK conditional resolves to PRESENT markup, not dropped.
 *   4. REGRESSION (#Q3): `bullets` as a string instead of an array. The builder
 *      coerces it to '' with no error and no warning anywhere — an empty <ul>
 *      ships on the CV. This test makes that failure mode loud.
 *
 * WHY #4 MATTERS FOR THE MIGRATION
 *   build-cv-html.mjs:374-376 —
 *       const bullets = Array.isArray(e.bullets)
 *         ? e.bullets.filter(Boolean).map(b => `<li>${escapeHtml(b)}</li>`).join('\n    ')
 *         : '';
 *   validatePayload never inspects `bullets`. An array-of-strings payload with
 *   one stringified bullets passes with zero errors and renders a bare <ul>.
 *   A model that emits bullets as prose — the single most likely shape slip in
 *   the HTML-to-JSON move — would produce exactly that, silently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validatePayload } from '../lib/cv-payload-schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILDER = join(ROOT, 'build-cv-html.mjs');
const TEMPLATE = join(ROOT, 'templates', 'cv-template.html');

// Every {{PLACEHOLDER}} in templates/cv-template.html. Kept as an explicit list
// rather than read from the file at runtime: the point is to pin the count, so
// a future placeholder added to the template FAILS this test instead of
// silently widening what "complete" means.
const ALL_PLACEHOLDERS = [
  'AWARDS', 'CERTIFICATIONS', 'COMPETENCIES', 'EDUCATION', 'EMAIL',
  'EXPERIENCE', 'INTERESTS', 'LANG', 'LINKEDIN_DISPLAY', 'LINKEDIN_URL',
  'LOCATION', 'NAME', 'PAGE_WIDTH', 'PHONE', 'PHOTO', 'PORTFOLIO_DISPLAY',
  'PORTFOLIO_URL', 'PROJECTS', 'SECTION_AWARDS', 'SECTION_CERTIFICATIONS',
  'SECTION_COMPETENCIES', 'SECTION_EDUCATION', 'SECTION_EXPERIENCE',
  'SECTION_INTERESTS', 'SECTION_PROJECTS', 'SECTION_SKILLS',
  'SECTION_SUMMARY', 'SKILLS', 'SUMMARY_TEXT',
];

/**
 * Hyper-compliant `html` payload.
 *
 * Key choices, each traceable to lib/cv-payload-schema.mjs:
 *   - education uses the HTML dialect {title, org, location, year, description}
 *     (line 33), NOT the LaTeX one {institution, degree, ...} (line 46). Mixing
 *     them is the #3523 silent-drop bug: the section renders nothing while
 *     validation still reports valid.
 *   - bullets is an explicit array of non-empty strings on every entry that has
 *     one. See the regression test below for what happens otherwise.
 *   - candidate uses the NESTED shape buildContactRow() actually reads
 *     (build-cv-html.mjs:603-613): c.linkedin.url / c.github.url /
 *     c.portfolio.url with .display siblings. The flat `linkedin_url` spelling
 *     that appears in the template's own placeholder names is NOT a payload key
 *     — those placeholders are consumed by the whole-block CONTACT_ROW_RE
 *     replacement at line 671, never by the substitutions map.
 *   - photo is a data: URL. prepareCandidatePhoto() (line 116) rejects an
 *     unsupported style outright and would otherwise read a file path off disk;
 *     a 1x1 PNG keeps the suite hermetic while still exercising {{PHOTO}}.
 */
const GOOD_PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: {
    name: 'Ada Lovelace',
    email: 'ada@example.invalid',
    phone: '+1 555 0100',
    location: 'Remote (EU)',
    linkedin: { url: 'https://www.linkedin.com/in/adalovelace', display: 'linkedin.com/in/adalovelace' },
    github: { url: 'https://github.com/adalovelace', display: 'github.com/adalovelace' },
    portfolio: { url: 'https://ada.example.invalid', display: 'ada.example.invalid' },
    photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    photo_style: 'rounded',
  },
  sections: {
    // Exercises the { ...DEFAULT_SECTION_TITLES, ...payload.sections } override
    // (build-cv-html.mjs:630) — a tailored report may retitle any section.
    experience: 'Relevant Experience',
  },
  summary: 'Analytical engine programmer with a record of formalising unstated requirements into executable specifications.',
  competencies: ['Algorithms', 'Compilers', 'Symbolic Computation', 'Technical Writing'],
  experience: [
    {
      company: 'Analytical Engine Works',
      role: 'Principal Programmer',
      location: 'London',
      dates: '1842 - 1843',
      bullets: [
        'Published Note G, the first published algorithm intended for machine execution.',
        'Formalised looping and branching semantics that the hardware did not yet implement.',
      ],
    },
    {
      company: 'Bernoulli Numbers Project',
      role: 'Research Collaborator',
      location: '',
      // Optional field deliberately blank: proves a blank optional renders as
      // an empty string and drops the LOCATION_BLOCK without dropping the entry.
      dates: '1840 - 1842',
      bullets: ['Derived the sequence now carried as the Bernoulli numbers.'],
    },
  ],
  projects: [
    {
      name: 'Note G',
      badge: '1843',
      description: 'A published algorithm for the Engine, including a diagram of the loop structure.',
      bullets: ['First published machine-intended algorithm.'],
      tech: ['Symbolic Logic'],
      url: 'https://ada.example.invalid/note-g',
    },
  ],
  education: [
    {
      title: 'Mathematics and Scientific Studies',
      org: 'Private Tuition',
      location: 'London',
      year: '1835',
      description: 'Advanced study of mathematics, logic, and astronomy under private tutors.',
    },
  ],
  certifications: [{ title: 'Analytical Society', org: 'University of London', year: '1838' }],
  awards: [{ title: 'Enchantress of Numbers', org: 'London Mathematical Society', year: '1843' }],
  interests: ['Music', 'Mathematics'],
  skills: [
    { category: 'Technical', items: ['Symbolic Logic', 'Algorithm Design'] },
    { category: 'Languages', items: ['English', 'French', 'Italian'] },
  ],
};

/** Render via the real CLI, exactly as a migration would invoke it. */
function render(payload, { label }) {
  const dir = mkdtempSync(join(tmpdir(), `cvhtml-${label}-`));
  const jsonPath = join(dir, 'payload.json');
  const outPath = join(dir, 'cv.html');
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8');
  const stdout = execFileSync(
    process.execPath,
    [BUILDER, jsonPath, outPath, TEMPLATE],
    { encoding: 'utf-8', cwd: ROOT },
  );
  return { html: readFileSync(outPath, 'utf-8'), outPath, dir, stdout };
}

// ---------------------------------------------------------------------------
// 1. Schema conformance
// ---------------------------------------------------------------------------

test('the compliant payload validates with zero errors', () => {
  const { errors, warnings } = validatePayload(GOOD_PAYLOAD, 'html');
  assert.deepEqual(errors, [], `unexpected errors: ${errors.join('; ')}`);
  assert.deepEqual(warnings, [], `unexpected warnings: ${warnings.join('; ')}`);
});

test('the html education dialect is the one accepted (the LaTeX keys are rejected by name)', () => {
  // Guards the #3523 failure mode directly: if the dialect tables ever collapse
  // into one another, this test catches it before a CV ships with no education.
  const texKeyed = {
    ...GOOD_PAYLOAD,
    education: [{ institution: 'Private Tuition', degree: 'Mathematics', dates: '1835' }],
  };
  const { errors } = validatePayload(texKeyed, 'html');
  assert.ok(
    errors.some(e => e.startsWith('education[0]:') && e.includes('missing required field')),
    `LaTeX education keys should fail html validation, got: ${JSON.stringify(errors)}`,
  );
});

// ---------------------------------------------------------------------------
// 2. Full render — all 29 placeholders
// ---------------------------------------------------------------------------

test('rendering resolves all 29 template placeholders with none left behind', (t) => {
  const { html, outPath, dir } = render(GOOD_PAYLOAD, { label: 'good' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // renderHtml() already throws on an unresolved placeholder, so reaching this
  // point proves the internal check passed. We re-assert on the written file so
  // the guarantee does not rest on a single code path.
  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  assert.equal(leftover, null, `unresolved placeholders: ${[...new Set(leftover || [])].join(', ')}`);

  // Per-placeholder: each of the 29 must be GONE from the output. A placeholder
  // absent from this list was never present in the template to begin with, so
  // compare against the template's own inventory rather than a hardcoded count.
  const templateSrc = readFileSync(TEMPLATE, 'utf-8');
  const inTemplate = [...new Set(templateSrc.match(/\{\{[A-Z_]+\}\}/g) || [])]
    .map(p => p.slice(2, -2)).sort();
  assert.deepEqual([...ALL_PLACEHOLDERS].sort(), inTemplate,
    `ALL_PLACEHOLDERS has drifted from the template. Template has ${inTemplate.length}: ${inTemplate.join(', ')}`);

  const stillPresent = ALL_PLACEHOLDERS.filter(p => new RegExp(`\\{\\{${p}\\}\\}`).test(html));
  assert.deepEqual(stillPresent, [], `placeholders left in output: ${stillPresent.join(', ')}`);
  assert.ok(outPath.endsWith('.html'));
});

test('the block-replaced contact row and photo carry real values', (t) => {
  const { html, dir } = render(GOOD_PAYLOAD, { label: 'contact' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // CONTACT_ROW_RE (line 671) rebuilds the row whole, so these come from
  // buildContactRow() rather than the substitutions map.
  assert.match(html, /class="contact-row"/);
  assert.ok(html.includes('ada@example.invalid'), 'email missing from contact row');
  assert.ok(html.includes('+1 555 0100'), 'phone missing from contact row');
  assert.ok(html.includes('linkedin.com/in/adalovelace'), 'linkedin display missing');
  assert.ok(html.includes('github.com/adalovelace'), 'github display missing');
  assert.ok(html.includes('Remote (EU)'), 'location missing from contact row');

  // Separators are conditional — a dropped field must not leave a dangling "|".
  const seps = html.match(/<span class="separator">\|<\/span>/g) || [];
  assert.equal(seps.length, 5, `expected 5 separators for 6 contact items, got ${seps.length}`);

  assert.match(html, /<img class="cv-photo cv-photo--rounded"/, '{{PHOTO}} not rendered');
  assert.ok(html.includes('Ada Lovelace'), 'NAME not rendered');
  assert.ok(html.includes('8.5in'), 'PAGE_WIDTH not applied for letter');
});

// ---------------------------------------------------------------------------
// 3. Section partials
// ---------------------------------------------------------------------------

test('section partials render, and LOCATION_BLOCK resolves PRESENT then drops', (t) => {
  const { html, dir } = render(GOOD_PAYLOAD, { label: 'partials' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Class names below come from templates/sections/*.html, NOT from the
  // built-in fallback builders — so their presence proves partials loaded.
  // templates/sections/experience.html:14-24
  assert.match(html, /<div class="job">/, 'experience partial not used');
  assert.match(html, /<span class="job-company">Analytical Engine Works<\/span>/);
  assert.match(html, /<div class="job-role">Principal Programmer<\/div>/);
  assert.match(html, /<span class="job-period">1842 - 1843<\/span>/);
  assert.match(html, /<div class="job-location">London<\/div>/, 'LOCATION_BLOCK should render PRESENT');

  // Entry 2 has location:'' -> the conditional must remove the block entirely
  // while keeping the entry. This is the "empty conditional text block dropout"
  // the baseline must rule out.
  assert.match(html, /<span class="job-company">Bernoulli Numbers Project<\/span>/,
    'entry with a blank optional field was dropped instead of its location block');
  assert.equal((html.match(/<div class="job-location">/g) || []).length, 1,
    'blank location should produce zero job-location blocks');

  // Other partials
  assert.match(html, /<div class="cert-table">/, 'certifications partial not used');
  assert.match(html, /<div class="award-table">/, 'awards partial not used');
  assert.match(html, /class="skill-item"/, 'skills partial not used');

  // Bullets became real list items.
  const li = html.match(/<li>/g) || [];
  assert.equal(li.length, 3, `expected 3 bullets (2 + 1), got ${li.length}`);
  assert.ok(html.includes('first published algorithm intended for machine execution'));
});

test('a retitled section from payload.sections overrides the default title', (t) => {
  const { html, dir } = render(GOOD_PAYLOAD, { label: 'sections' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.match(html, /Relevant Experience/, 'payload.sections override not applied');
});

// ---------------------------------------------------------------------------
// 4. REGRESSION: bullets as a string
// ---------------------------------------------------------------------------

test('REGRESSION: string bullets pass validation and silently render an empty <ul>', (t) => {
  // This is the failure mode the HTML->JSON migration is most likely to hit. A
  // model asked for JSON after years of HTML tends to emit bullets as prose.
  const bad = {
    ...GOOD_PAYLOAD,
    experience: [{
      company: 'Analytical Engine Works',
      role: 'Principal Programmer',
      dates: '1842 - 1843',
      bullets: 'Published Note G, the first published algorithm intended for machine execution.',
    }],
  };

  // (a) Validation does NOT catch it — zero errors, zero warnings.
  const { errors, warnings } = validatePayload(bad, 'html');
  assert.deepEqual(errors, [], 'string bullets are NOT validated — this is the gap');
  assert.deepEqual(warnings, [], 'string bullets produce no warning either — silent at every layer');

  // (b) Rendering succeeds — no throw, no non-zero exit.
  const { html, dir } = render(bad, { label: 'strbullets' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // (c) The entry survives, but its bullet list is empty. An empty <ul></ul>
  // ships on the CV: no error, no warning, no missing section.
  assert.match(html, /<span class="job-company">Analytical Engine Works<\/span>/,
    'the entry itself must still render');
  assert.match(html, /<ul>\s*<\/ul>/,
    'expected an empty <ul> — if this changes, bullets handling was fixed upstream');
  assert.ok(!html.includes('first published algorithm'),
    'the string content must NOT leak into the bullets list');
});

test('the harness catches string bullets via the guard it is meant to provide', () => {
  // The assertion above documents the compiler's current behaviour. This test
  // states the guard a migration must add BEFORE trusting a model-generated
  // payload: assert bullets is an array, so a stringified payload is rejected
  // rather than shipped as an empty bullet list.
  const guard = (payload) => {
    const problems = [];
    for (const [section, entries] of Object.entries(payload)) {
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, i) => {
        // Entries are objects in the list sections but bare strings in
        // competencies/interests, so the type check is load-bearing: `'bullets'
        // in 'Algorithms'` throws a TypeError.
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
        if ('bullets' in entry && !Array.isArray(entry.bullets)) {
          problems.push(`${section}[${i}].bullets must be an array`);
        }
      });
    }
    return problems;
  };

  assert.deepEqual(guard(GOOD_PAYLOAD), [], 'the compliant payload must pass the guard');
  assert.deepEqual(
    guard({ experience: [{ company: 'X', role: 'Y', bullets: 'prose' }] }),
    ['experience[0].bullets must be an array'],
    'the guard must reject prose bullets',
  );
});
