// tests/cv-named-templates.test.mjs — the shipped named CV templates
// (compact, executive, jake, leadership, modern) must each behave like the base
// template, not merely look different.
//
// A template is not "just CSS" here: cv-templates.mjs discovers it by filename
// and validates its placeholders, build-cv-html.mjs fills it, and
// cv-sections-core.mjs strips its optional sections by MARKER MATCHING. A
// variant that renders beautifully but omits `<!-- AWARDS -->` silently drops a
// candidate's awards, and one that omits the trailing `<!-- END -->` sentinel
// leaves a bare "Skills" heading on every CV that has no skills list (#2515 /
// #2516). Both are invisible in a screenshot, so they are pinned here.
//
// The ATS assertions are the same ones the base template's header comment
// documents as non-negotiable: no bundled variable woff2 fonts (their glyph
// advances make PDF text extractors inject spaces inside words, so "Germany"
// extracts as "Germ any") and ligatures disabled (headless Chromium otherwise
// emits U+FB01/FB02 and a literal keyword search for "verification" misses
// "veriﬁcation"). A decorative variant is exactly where that discipline is
// most likely to be dropped.
import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { listTemplates, resolveTemplate, validateTemplate } from '../cv-templates.mjs';
import { stripEmptySections } from '../cv-sections-core.mjs';

console.log('\nNamed CV templates (compact / executive / jake / leadership / modern)');

const NAMED = [
  { name: 'compact', displayName: 'Compact' },
  { name: 'executive', displayName: 'Executive' },
  { name: 'jake', displayName: 'Jake' },
  { name: 'leadership', displayName: 'Leadership' },
  { name: 'modern', displayName: 'Modern' },
];

// Every optional section empty: each marker must be gone and the document must
// still close. Awards and skills are the two that regressed historically.
// `experience` is deliberately POPULATED here while every other optional
// section is empty. It is the canary for an over-reaching strip: it sits in the
// middle of the document, so a boundary that runs too far takes it out and the
// `{{EXPERIENCE}}` assertion below catches it. Since #2504 experience is itself
// strippable, which makes the canary stronger rather than obsolete — the
// all-empty case (experience included) is covered against all nine shipped
// templates in tests/cv-optional-sections.test.mjs.
const EMPTY = { competencies: [], experience: [{ company: 'Canary' }], projects: [], education: [], certifications: [], awards: [], skills: [] };
const MARKERS = ['CORE COMPETENCIES', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS', 'AWARDS', 'SKILLS'];

const PAYLOAD = {
  lang: 'en',
  page_format: 'a4',
  candidate: {
    name: 'Jane Smith',
    email: 'jane@example.com',
    location: 'Berlin, Germany',
    linkedin: { url: 'https://linkedin.com/in/janesmith', display: 'linkedin.com/in/janesmith' },
  },
  summary: 'Platform engineer who ships verification tooling.',
  competencies: ['Platform engineering', 'Distributed systems'],
  experience: [{
    company: 'Example GmbH',
    role: 'Staff Engineer',
    location: 'Berlin',
    dates: '2023 - Present',
    bullets: ['Cut deploy time from 40 minutes to 4.'],
  }],
  projects: [{ name: 'Open Source Thing', description: 'A tool people use.' }],
  education: [{ title: 'BSc Computer Science', org: 'Example University', year: '2018' }],
  certifications: [],
  awards: [],
  skills: [{ category: 'Languages', items: ['Go', 'TypeScript'] }],
};

const listed = listTemplates('cv');
const dir = mkdtempSync(join(tmpdir(), 'cv-named-templates-'));
const input = join(dir, 'payload.json');
writeFileSync(input, JSON.stringify(PAYLOAD));

for (const { name, displayName } of NAMED) {
  const file = join(ROOT, 'templates', `cv-template.${name}.html`);

  // --- Discovery + placeholder contract ------------------------------------
  const entry = listed.find((item) => item.name === name);
  if (entry?.displayName === displayName) pass(`${name}: discoverable as "${displayName}"`);
  else fail(`${name}: expected displayName "${displayName}", got "${entry?.displayName}"`);

  let resolved = null;
  try { resolved = resolveTemplate('cv', name); } catch (e) { resolved = e.message; }
  if (resolved === file) pass(`${name}: resolves to its own file`);
  else fail(`${name}: resolve returned ${resolved}`);

  const valid = validateTemplate(file, 'cv');
  if (valid.ok) pass(`${name}: carries the required placeholders`);
  else fail(`${name}: missing placeholders ${valid.missing.join(', ')}`);

  const html = readFileSync(file, 'utf-8');

  // --- Optional sections vanish, document survives -------------------------
  const stripped = stripEmptySections(html, EMPTY, 'html');
  const leftover = MARKERS.filter((m) => stripped.includes(`<!-- ${m} -->`));
  if (leftover.length === 0) pass(`${name}: every empty section is stripped`);
  else fail(`${name}: sections left behind with no content: ${leftover.join(', ')}`);

  if (stripped.includes('{{EXPERIENCE}}')) pass(`${name}: stripping leaves {{EXPERIENCE}} intact`);
  else fail(`${name}: stripping swallowed the experience section`);

  if (stripped.trimEnd().endsWith('</body>\n</html>')) pass(`${name}: closing skeleton survives an all-empty strip`);
  else fail(`${name}: closing skeleton was swallowed — check the <!-- END --> sentinel`);

  if (stripEmptySections(html, {
    competencies: ['x'], experience: [{ company: 'e' }], projects: [{ name: 'p' }],
    education: [{ degree: 'd' }], certifications: [{ title: 'c' }],
    awards: [{ title: 'a' }], skills: [{ category: 's', items: 'x' }],
  }, 'html') === html) pass(`${name}: a fully populated payload strips nothing`);
  else fail(`${name}: strip removed content from a populated payload`);

  // --- ATS discipline ------------------------------------------------------
  if (!/\.woff2/.test(html)) pass(`${name}: no bundled woff2 fonts (clean PDF text extraction)`);
  else fail(`${name}: references a bundled woff2 font — extraction injects spaces inside words`);

  // Both properties, as the base template does it: font-variant-ligatures is
  // the standard switch, font-feature-settings the belt-and-braces one for
  // fonts that expose liga/clig directly.
  const ligaturesOff = /font-variant-ligatures:\s*none/.test(html)
    && /font-feature-settings:[^;]*"liga"\s*0/.test(html);
  if (ligaturesOff) pass(`${name}: ligatures disabled`);
  else fail(`${name}: does not disable ligatures — "verification" extracts as "veriﬁcation"`);

  // --- Renders a real payload ----------------------------------------------
  const output = join(dir, `${name}.html`);
  try {
    execFileSync(NODE, ['build-cv-html.mjs', input, output, file], { cwd: ROOT, encoding: 'utf-8' });
    const rendered = readFileSync(output, 'utf-8');
    const unfilled = rendered.match(/\{\{[A-Z_]+\}\}/g) || [];
    if (unfilled.length === 0) pass(`${name}: renders a payload with no unfilled placeholders`);
    else fail(`${name}: left ${unfilled.length} placeholder(s) unfilled: ${[...new Set(unfilled)].join(', ')}`);

    if (rendered.includes('Jane Smith') && rendered.includes('Example GmbH')) pass(`${name}: payload content reaches the output`);
    else fail(`${name}: rendered output is missing payload content`);
  } catch (e) {
    fail(`${name}: build-cv-html.mjs crashed — ${e.message}`);
  }
}
