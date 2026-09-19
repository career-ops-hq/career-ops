// tests/cv-consent-footer.test.mjs — the opt-in GDPR/RODO consent footer
// ({{CONSENT}} placeholder + .cv-consent CSS) must behave the same way across
// every shipped HTML CV template: present and escaped when set, byte-identical
// to a pre-consent layout when absent.
//
// The empty-render defect this guards against is the one the local PoC shipped
// before the empty-render fix: a stray horizontal line at the bottom of every
// CV because the .cv-consent div carried a border-top even when its content
// was empty. The :empty { display: none } rule closes that gap, and this suite
// pins it down so a future template edit cannot silently reintroduce it.
//
// Mirrors the {{PHOTO}} opt-in slot pattern (#264): absent ⇒ unchanged layout.
import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { stripEmptySections } from '../cv-sections-core.mjs';

console.log('\nCV consent footer ({{CONSENT}} + .cv-consent)');

const TEMPLATES = [
  { file: 'templates/cv-template.html', label: 'base' },
  { file: 'templates/resume-template.html', label: 'resume' },
  { file: 'templates/cv-template.compact.html', label: 'compact' },
  { file: 'templates/cv-template.executive.html', label: 'executive' },
  { file: 'templates/cv-template.jake.html', label: 'jake' },
  { file: 'templates/cv-template.leadership.html', label: 'leadership' },
  { file: 'templates/cv-template.modern.html', label: 'modern' },
];

const CONSENT_TEXT = 'I consent to the processing of my personal data for recruitment purposes (GDPR Art. 6(1)(a)).';

// Minimal payload — every optional section populated so stripEmptySections is
// a no-op and the consent assertions are not entangled with section stripping.
const PAYLOAD = {
  lang: 'en',
  page_format: 'a4',
  candidate: {
    name: 'Jane Smith',
    email: 'jane@example.com',
    location: 'Berlin, Germany',
  },
  summary: 'Platform engineer.',
  competencies: ['Platform engineering'],
  experience: [{ company: 'Example GmbH', role: 'Staff Engineer', dates: '2023 - Present', bullets: ['Cut deploy time.'] }],
  projects: [{ name: 'Open Source Thing', description: 'A tool.' }],
  education: [{ title: 'BSc CS', org: 'Example University', year: '2018' }],
  certifications: [],
  awards: [],
  skills: [{ category: 'Languages', items: ['Go'] }],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-consent-footer-'));
const inputWith = join(dir, 'payload-with.json');
const inputWithout = join(dir, 'payload-without.json');
writeFileSync(inputWith, JSON.stringify({ ...PAYLOAD, consent: CONSENT_TEXT }));
writeFileSync(inputWithout, JSON.stringify(PAYLOAD));

for (const { file, label } of TEMPLATES) {
  const path = join(ROOT, file);
  const html = readFileSync(path, 'utf-8');

  // (a) Template carries the placeholder and the CSS rule.
  if (html.includes('{{CONSENT}}')) pass(`${label}: template carries {{CONSENT}} placeholder`);
  else fail(`${label}: template is missing {{CONSENT}} placeholder`);

  if (/\.cv-consent\s*\{/.test(html)) pass(`${label}: template carries .cv-consent CSS rule`);
  else fail(`${label}: template is missing .cv-consent CSS rule`);

  if (/\.cv-consent:empty\s*\{\s*display:\s*none\s*;?\s*\}/.test(html)) {
    pass(`${label}: template carries .cv-consent:empty { display: none } guard`);
  } else {
    fail(`${label}: template is missing .cv-consent:empty { display: none } guard — empty consent will render a stray border-top`);
  }

  // (b) Rendering WITH consent escapes the text and emits it inside the div.
  const outputWith = join(dir, `${label}-with.html`);
  try {
    execFileSync(NODE, ['build-cv-html.mjs', inputWith, outputWith, path], { cwd: ROOT, encoding: 'utf-8' });
    const rendered = readFileSync(outputWith, 'utf-8');
    if (rendered.includes('cv-consent')) pass(`${label}: rendered output contains the cv-consent div`);
    else fail(`${label}: rendered output is missing the cv-consent div`);

    if (rendered.includes(CONSENT_TEXT)) pass(`${label}: consent text reaches the rendered output`);
    else fail(`${label}: consent text is missing from the rendered output`);

    // HTML escaping: a payload with <script> must not inject a tag.
    const xssPayload = JSON.stringify({ ...PAYLOAD, consent: '<script>alert(1)</script>' });
    const xssInput = join(dir, `${label}-xss.json`);
    writeFileSync(xssInput, xssPayload);
    const xssOutput = join(dir, `${label}-xss.html`);
    execFileSync(NODE, ['build-cv-html.mjs', xssInput, xssOutput, path], { cwd: ROOT, encoding: 'utf-8' });
    const xssRendered = readFileSync(xssOutput, 'utf-8');
    if (!xssRendered.includes('<script>alert(1)</script>')) pass(`${label}: consent text is HTML-escaped (no <script> injection)`);
    else fail(`${label}: consent text was NOT escaped — <script> tag reached the output`);
  } catch (e) {
    fail(`${label}: build-cv-html.mjs crashed on WITH-consent render — ${e.message}`);
  }

  // (c) Rendering WITHOUT consent: the div is present but empty, and the
  // :empty CSS rule hides it. The rendered HTML must contain the empty div
  // (so the CSS can target it) but must NOT contain any consent text.
  const outputWithout = join(dir, `${label}-without.html`);
  try {
    execFileSync(NODE, ['build-cv-html.mjs', inputWithout, outputWithout, path], { cwd: ROOT, encoding: 'utf-8' });
    const rendered = readFileSync(outputWithout, 'utf-8');
    if (/<div class="cv-consent"><\/div>/.test(rendered)) {
      pass(`${label}: empty consent renders as <div class="cv-consent"></div> (CSS hides it)`);
    } else {
      fail(`${label}: empty consent div is not in the expected shape — CSS :empty guard cannot target it`);
    }

    if (!rendered.includes(CONSENT_TEXT)) pass(`${label}: no consent text leaks into the output when payload.consent is absent`);
    else fail(`${label}: consent text leaked into the output despite absent payload.consent`);
  } catch (e) {
    fail(`${label}: build-cv-html.mjs crashed on WITHOUT-consent render — ${e.message}`);
  }

  // (d) The consent div survives an all-empty section strip and the closing
  // </body></html> skeleton is intact. The strip must not eat the footer.
  const EMPTY = { competencies: [], experience: [], projects: [], education: [], certifications: [], awards: [], interests: [], skills: [] };
  const stripped = stripEmptySections(html, EMPTY, 'html');
  if (stripped.includes('{{CONSENT}}')) pass(`${label}: consent div survives an all-empty section strip`);
  else fail(`${label}: consent div was swallowed by the section strip`);

  if (stripped.trimEnd().endsWith('</body>\n</html>')) pass(`${label}: closing skeleton survives an all-empty strip`);
  else fail(`${label}: closing skeleton was swallowed — check the <!-- END --> sentinel`);
}
