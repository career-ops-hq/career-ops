// tests/cv-visual/contact-row-wrap.spec.mjs — a wrapped contact row must never
// begin a line with the "|" separator.
//
// This is the render half of the invariant whose source half lives in
// tests/template-contact-row.test.mjs. That suite runs on a bare checkout with
// only Node (#1440) and so can only assert what the stylesheet SAYS; whether a
// rendered line actually starts with the separator is a question about
// Chromium, and only a browser can answer it. It lives here because this
// directory is already browser-gated by its own config (npm run test:cv-visual),
// which keeps the bare-Node suite green without a skip mechanism.
//
// Geometry, not extracted text: pdftotext reflows and would hide exactly the
// distinction under test. Each item's own client rects are compared against a
// Range over its text, and the leftover strip is the generated separator — that
// is how the separator is located despite having no DOM node of its own.
//
// Direction matters: in LTR the separator legitimately ends a line (that is the
// fix — it trails the item above rather than leading the one below), so the
// assertion is that it never LEADS one. Under html[lang="ar"] the row is
// reversed and the leading edge is the right one. Measured on upstream/main,
// the RTL case was the worst: cv-template.html, zh-minimal and resume-template
// led a line with the separator at every width tested.
import { test, expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listTemplates } from '../../cv-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Widths that straddle the wrap: the bug is width-dependent, so one viewport
// proves nothing. These bracket the A4 content box the PDF path renders into.
const WIDTHS = [520, 600, 680, 760, 840];

/** Synthetic, neutral payload whose long location forces the row to wrap. */
function payload(lang) {
  return {
    lang,
    page_format: 'a4',
    candidate: {
      name: 'Jordan Lee',
      phone: '+1 555 010 2048',
      email: 'candidate@example.com',
      linkedin: { url: 'https://linkedin.com/in/candidate', display: 'linkedin.com/in/candidate' },
      github: { url: 'https://github.com/candidate', display: 'github.com/candidate' },
      portfolio: { url: 'https://candidate.example.com', display: 'candidate.example.com' },
      // Long enough that the row must wrap at every width above; this is the
      // shape that exposed the bug, not a realistic location.
      location: 'Example City, Exampleland — open to relocation — fully remote — available immediately',
    },
    summary: 'Sample summary for layout testing; it describes no real candidate.',
    competencies: ['Sample Competency A', 'Sample Competency B'],
    experience: [],
    projects: [],
    education: [{ title: 'Example Degree', org: 'Example Institution', year: '2025' }],
    certifications: [],
    skills: [{ category: 'Sample Skills', items: ['Tool A', 'Tool B'] }],
  };
}

/** Every HTML template that renders a contact row (see the source-side suite). */
function contactRowTemplates() {
  const paths = listTemplates('cv').filter((t) => t.format === 'html').map((t) => t.path);
  paths.push(join(ROOT, 'templates', 'resume-template.html'));
  return paths
    .filter((p) => readFileSync(p, 'utf-8').includes('class="contact-row"'))
    .map((p) => ({ path: p, rel: relative(ROOT, p).replace(/\\/g, '/') }));
}

/**
 * For every visual line of the contact row, report what sits at its leading
 * edge: 'separator' (generated content) or 'item' (real text).
 */
async function lineLeaders(page) {
  return page.evaluate(() => {
    const row = document.querySelector('.contact-row');
    if (!row) return null;
    const rtl = getComputedStyle(row).direction === 'rtl';

    // One entry per box actually painted on a line, tagged by what it is.
    //
    // Both separator forms are recognised, which is what lets this assertion
    // fail against the structure it replaced: a separator that is its own
    // ELEMENT is identified by its text content, and one that is GENERATED has
    // no node, so it is identified as the strip of an item's box lying past
    // that item's text. Classifying only the generated form would quietly pass
    // on the very markup the fix removes.
    const SEPARATORS = new Set(['|', '·', '•', '-', '–', '—']);
    const boxes = [];
    for (const el of row.children) {
      const rects = [...el.getClientRects()];
      const range = document.createRange();
      range.selectNodeContents(el);
      const textRects = [...range.getClientRects()];
      if (!rects.length) continue;

      // An element whose whole content is a separator glyph IS a separator.
      const ownKind = SEPARATORS.has((el.textContent || '').trim()) ? 'separator' : 'item';

      for (const r of rects) {
        // Text rects belonging to this visual line.
        const onLine = textRects.filter((t) => Math.abs(t.top - r.top) < 2);
        if (onLine.length) {
          const left = Math.min(...onLine.map((t) => t.left));
          const right = Math.max(...onLine.map((t) => t.right));
          boxes.push({ y: r.top, left, right, kind: ownKind });
          // The generated separator is the strip of the element box lying past
          // its text on the logical trailing side (right in LTR, left in RTL).
          if (ownKind === 'item' && !rtl && r.right - right > 2) {
            boxes.push({ y: r.top, left: right, right: r.right, kind: 'separator' });
          }
          if (ownKind === 'item' && rtl && left - r.left > 2) {
            boxes.push({ y: r.top, left: r.left, right: left, kind: 'separator' });
          }
        } else {
          boxes.push({ y: r.top, left: r.left, right: r.right, kind: ownKind });
        }
      }
    }

    const lines = new Map();
    for (const b of boxes) {
      const key = Math.round(b.y);
      const cur = lines.get(key);
      // Leading edge: smallest x in LTR, largest in RTL.
      const better = !cur || (rtl ? b.right > cur.right : b.left < cur.left);
      if (better) lines.set(key, b);
    }
    return { rtl, leaders: [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b.kind) };
  });
}

for (const t of contactRowTemplates()) {
  for (const [label, lang] of [['ltr', 'en'], ['rtl-ar', 'ar']]) {
    test(`${t.rel} (${label}): no contact-row line starts with the separator`, async ({ page }) => {
      const dir = mkdtempSync(join(tmpdir(), 'co-contact-wrap-'));
      try {
        const input = join(dir, 'payload.json');
        const html = join(dir, 'cv.html');
        writeFileSync(input, JSON.stringify(payload(lang)));
        execFileSync(process.execPath, ['build-cv-html.mjs', input, html, t.path],
          { cwd: ROOT, stdio: 'pipe' });
        await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(() => document.fonts.ready);

        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 1485 });
          const measured = await lineLeaders(page);
          expect(measured, `${t.rel} rendered no .contact-row`).not.toBeNull();
          expect(
            measured.leaders,
            `at ${width}px a contact-row line begins with the separator: ${measured.leaders.join(',')}`
          ).not.toContain('separator');
        }
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    });
  }
}
