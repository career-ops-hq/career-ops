// tests/cv-visual/project-widow-token.spec.mjs — `style.project_break_inside:
// avoid` must actually remove the one-word widow it exists to remove.
//
// The defect
// ----------
// `.project-tech { break-before: avoid }` keeps a tech line attached to its
// description. When the page boundary would fall between them, Chromium honours
// that by moving the description's LAST LINE across too. A description ending in
// one short word therefore opens the next page as a lone word above its tech
// line, with the project title left behind on the page before:
//
//     hackathon.
//     Tool A | Tool B | Tool C | github.com/example/sample
//
// Keeping the whole entry together removes it. That is what the token does.
//
// Why a render test, and why differential
// ---------------------------------------
// tests/theme-style.test.mjs already pins the token's CONTRACT — that every
// template reads `var(--project-break-inside, <its own default>)`, legacy alias
// first, declared on :root only. What it cannot establish is that setting the
// token changes the rendered PDF, because a stylesheet assertion cannot verify a
// renderer (the lesson #4716 exists to encode).
//
// So this renders the same payload twice: once as shipped, once with the token
// injected the way theme-style.mjs delivers a profile override — a later :root
// block — and asserts the widow is present in the first and absent in the second.
//
// It cannot pass vacuously. The fixture is searched until the UNSET render
// actually reproduces the widow; if no shape does, the test FAILS with the shapes
// it tried rather than passing on an assertion with nothing to prove. Both
// directions were verified before this was committed: with the token applied the
// widow is gone, and with a value the property does not accept it comes back.
//
// Page cost is deliberately NOT asserted. Whether keeping entries whole costs a
// page depends on how close a given CV already sits to its page budget — it cost
// nothing on every synthetic shape measured here and a page on a real CV
// measured by the maintainer. That is a documented trade-off of opting in, not an
// invariant a test can pin.
import { test, expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveTemplate } from '../../cv-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = resolveTemplate('cv', 'standard');

const SENTENCE = 'Sample description text used only to exercise wrapping and the position '
  + 'of the page boundary; it describes no real project, result, or employer.';
// Every description ends on this one short word, so a page opening with it alone
// is unambiguously the widow rather than an ordinary mid-paragraph break.
const WIDOW = 'hackathon.';

/** Synthetic payload; `projects` and `descLen` move the page boundary. */
function payload({ projects, descLen }) {
  return {
    lang: 'en', page_format: 'a4',
    candidate: {
      name: 'Jordan Lee', phone: '+1 555 010 2048', email: 'candidate@example.com',
      linkedin: { url: 'https://linkedin.com/in/candidate', display: 'linkedin.com/in/candidate' },
      location: 'Toronto, Canada',
    },
    summary: SENTENCE,
    competencies: ['Sample Competency A', 'Sample Competency B', 'Sample Competency C'],
    experience: [{
      company: 'Example Organization', role: 'Example Role', location: 'Remote',
      dates: '2024.01 - 2026.01', bullets: Array.from({ length: 4 }, () => SENTENCE),
    }],
    projects: Array.from({ length: projects }, (_, i) => ({
      name: `Example Project ${i + 1}`, badge: '',
      tech: 'Tool A | Tool B | Tool C | github.com/example/sample',
      description: Array.from({ length: descLen }, () => SENTENCE).join(' ') + ' ' + WIDOW,
    })),
    education: [{ title: 'Example Degree', org: 'Example Institution', year: '2025' }],
    certifications: [], skills: [{ category: 'Sample Skills', items: ['Tool A', 'Tool B', 'Tool C'] }],
  };
}

/**
 * Pages of extracted text.
 *
 * pdftotext writes the form feed immediately BEFORE the first line of the next
 * page, so splitting on it is correct while a `sed -n '1,/\f/p'`-style range
 * would wrongly attribute that first line to the page before it.
 */
function pdfPages(pdfPath) {
  const chunks = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }).split('\f');
  if (chunks.length && !chunks[chunks.length - 1].trim()) chunks.pop();
  return chunks.map((c) => c.split('\n').map((l) => l.trim()).filter(Boolean));
}

/** Any page after the first whose entire opening line is the sentinel word. */
const hasWidow = (pages) => pages.slice(1).some((p) => (p[0] || '').trim() === WIDOW);

test('style.project_break_inside: avoid removes the one-word project widow', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'co-widow-'));
  try {
    const build = (shape) => {
      const input = join(dir, 'payload.json');
      const html = join(dir, 'cv.html');
      writeFileSync(input, JSON.stringify(payload(shape)));
      execFileSync(process.execPath, ['build-cv-html.mjs', input, html, TEMPLATE],
        { cwd: ROOT, stdio: 'pipe' });
      return readFileSync(html, 'utf-8');
    };

    const render = async (html, tag) => {
      const file = join(dir, `${tag}.html`);
      const pdf = join(dir, `${tag}.pdf`);
      writeFileSync(file, html);
      await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready);
      writeFileSync(pdf, await page.pdf({
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        preferCSSPageSize: true,
      }));
      return pdfPages(pdf);
    };

    // Find a shape whose UNSET render actually shows the widow, so the
    // assertion below has something to prove.
    const tried = [];
    let shape = null;
    let unset = null;
    for (const projects of [6, 7, 8]) {
      for (const descLen of [2, 3]) {
        const pages = await render(build({ projects, descLen }), `unset-${projects}-${descLen}`);
        tried.push(`${projects}/${descLen}:${pages.length}p${hasWidow(pages) ? ' WIDOW' : ''}`);
        if (hasWidow(pages)) { shape = { projects, descLen }; unset = pages; break; }
      }
      if (shape) break;
    }

    expect(shape,
      'no fixture shape reproduced the one-word widow with the token unset, so this test '
      + `can no longer verify anything. Shapes tried: ${tried.join(' ')}`).not.toBeNull();

    // The override arrives exactly as theme-style.mjs delivers a profile token:
    // a later :root block, which is why the token may only be declared on :root.
    const override = '<style id="career-ops-dynamic-theme">\n'
      + ':root { --project-break-inside: avoid; }\n</style>';
    const set = await render(
      build(shape).replace(/<\/head>/i, `${override}\n</head>`),
      `set-${shape.projects}-${shape.descLen}`
    );

    expect(
      hasWidow(set),
      `with --project-break-inside: avoid the widow is still there. Unset opened page 2 with `
      + `"${unset[1]?.[0]}"; set opened page 2 with "${set[1]?.[0]}". The token had no effect on `
      + `the render, so the opt-in is inert however well its CSS contract reads.`
    ).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
