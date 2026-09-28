// tests/cv-education-location.test.mjs — an education entry's optional `location`
// renders on the HTML CV, mirroring how an experience entry's `location` already
// does. The LaTeX education schema has carried `location` since it shipped; the
// HTML one did not, so a payload with education[].location was dropped and the
// #3523 key validator warned "unrecognised key location" on every render.
//
// End-to-end through the real builder because build-cv-html.mjs exports nothing.
// Covers both render paths: the shipped section partial (templates/sections/) and
// the built-in builder (a template copy with no sections/ dir beside it).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, run, NODE, ROOT, lastRunFailure } from './helpers.mjs';
import { ENTRY_FIELD_SPECS } from '../lib/cv-payload-schema.mjs';

console.log('\nbuild-cv-html.mjs — education entry location renders (HTML)');

const BASE = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Edu Location', email: 'edu@example.com' },
  summary: 'Summary.',
  competencies: ['Competency'],
  experience: [{ company: 'Corp', role: 'Engineer', dates: '2024', bullets: ['Did a thing'] }],
  education: [
    { title: 'B.S. Computer Science', org: 'State University', location: 'Berkeley, CA', year: '2020' },
    { title: 'M.S. Computer Science', org: 'Other University', year: '2022' },
  ],
  skills: [{ category: 'Languages', items: 'Node' }],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-edu-loc-'));

// Build PAYLOAD through the template at templateArg (or the default) and return
// { html, stderr }, or null when the build failed (already reported).
function build(label, payload, templateArg) {
  const input = join(dir, `${label}.json`);
  const output = join(dir, `${label}.html`);
  writeFileSync(input, JSON.stringify(payload));
  const args = [join(ROOT, 'build-cv-html.mjs'), input, output];
  if (templateArg) args.push(templateArg);
  const stdout = run(NODE, args);
  if (stdout === null) {
    const f = lastRunFailure();
    fail(`${label}: build-cv-html.mjs crashed (exit ${f?.status}) - ${(f?.stderr || '').trim().split('\n').pop()}`);
    return null;
  }
  if (!existsSync(output)) {
    fail(`${label}: build-cv-html.mjs exited 0 but wrote no output file`);
    return null;
  }
  return { html: readFileSync(output, 'utf-8'), stdout };
}

// A copy of the default template with no sections/ dir beside it, so
// loadSectionPartials() finds nothing and the built-in builder runs.
function templateWithoutPartials() {
  const noPartialDir = join(dir, 'no-partials');
  mkdirSync(noPartialDir, { recursive: true });
  const dest = join(noPartialDir, 'cv-template.html');
  cpSync(join(ROOT, 'templates', 'cv-template.html'), dest, { recursive: false });
  return dest;
}

try {
  // 1 — the schema now lists `location` as a known education key.
  if (ENTRY_FIELD_SPECS.html.education.known.includes('location')) {
    pass('schema: html education known keys include "location"');
  } else {
    fail(`schema: html education known keys missing "location" (${ENTRY_FIELD_SPECS.html.education.known.join(', ')})`);
  }

  for (const [label, templateArg] of [
    ['partial', null],
    ['builtin', templateWithoutPartials()],
  ]) {
    const present = build(`${label}-present`, BASE, templateArg);
    if (present) {
      if (/<div class="edu-location">\s*Berkeley, CA\s*<\/div>/.test(present.html)) {
        pass(`${label}: edu-location renders the city when location is set`);
      } else {
        fail(`${label}: edu-location not rendered for the entry with a location`);
      }
      // The second entry has no location — exactly one .edu-location in the doc.
      const count = (present.html.match(/class="edu-location"/g) || []).length;
      if (count === 1) pass(`${label}: only the entry with a location gets an edu-location div`);
      else fail(`${label}: expected 1 edu-location div, found ${count}`);
      // #3523 validator must not warn about `location` now that it is known.
      if (/unrecognised key.*location/i.test(present.stdout)) {
        fail(`${label}: validator still warns about the education location key`);
      } else {
        pass(`${label}: no "unrecognised key location" warning`);
      }
    }

    const noLoc = build(`${label}-absent`, {
      ...BASE,
      education: [{ title: 'B.S. Computer Science', org: 'State University', year: '2020' }],
    }, templateArg);
    if (noLoc) {
      if (noLoc.html.includes('class="edu-location"')) {
        fail(`${label}: edu-location div rendered when no entry has a location`);
      } else {
        pass(`${label}: no edu-location div when no entry has a location`);
      }
    }

    // The location value must reach the page as text, never as markup — the
    // builder routes it through escapeHtml() in both paths, and only this
    // assertion keeps a future refactor from dropping that call for this field.
    const injected = build(`${label}-escape`, {
      ...BASE,
      education: [{ title: 'B.S. Computer Science', org: 'State University', location: '<script>alert(1)</script>', year: '2020' }],
    }, templateArg);
    if (injected) {
      if (injected.html.includes('<script>alert(1)</script>')) {
        fail(`${label}: education location reached the output as raw markup`);
      } else if (injected.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;')) {
        pass(`${label}: education location is HTML-escaped in the output`);
      } else {
        fail(`${label}: education location neither escaped nor raw in the output — check the render`);
      }
    }
  }
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
