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
// proves nothing.
//
// 679 is not a round number and is the important one: A4 at 8.27in less two
// 0.6in margins is 7.07in = 679px at 96dpi, which is the width the PDF is
// actually laid out at. Measuring only at wider viewports left the width every
// user's CV renders at untested — I went looking for a defect at paper width and
// could not tell a real one from an artifact because this spec never covered it.
const PAPER_WIDTH = 679;
const WIDTHS = [PAPER_WIDTH, 520, 600, 680, 760, 840];

/**
 * Synthetic, neutral payload whose long location forces the row to wrap.
 *
 * `portfolioDisplay` selects the second thing that can break a contact row.
 * zh-minimal sets `a { overflow-wrap: anywhere; word-break: break-word }`, which
 * the generated ::after inherits — a break mechanism no whitespace is involved
 * in, so the no-break space does not cover it. It only engages when the content
 * would otherwise overflow, so an ordinary-length URL never reaches it and the
 * path went untested until a long unbroken value was tried.
 */
function payload(lang, portfolioDisplay = 'candidate.example.com') {
  return {
    lang,
    page_format: 'a4',
    candidate: {
      name: 'Jordan Lee',
      phone: '+1 555 010 2048',
      email: 'candidate@example.com',
      linkedin: { url: 'https://linkedin.com/in/candidate', display: 'linkedin.com/in/candidate' },
      github: { url: 'https://github.com/candidate', display: 'github.com/candidate' },
      portfolio: { url: 'https://candidate.example.com', display: portfolioDisplay },
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

    // Two rects share a visual line when their vertical extents overlap by more
    // than half the shorter one. Comparing `top` for near-equality instead looks
    // right and is not: an item's border box and its text's line box start at
    // different y whenever line-height exceeds the font size, which is the
    // normal case for a block-level flex item. That mismatch reported a text
    // rect as "not on this line" and so called an ordinary item a separator,
    // turning templates/ats red — a template whose .contact-row is a column and
    // which generates no separator at all.
    const sameLine = (a, b) => {
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return overlap > Math.min(a.height, b.height) * 0.5;
    };

    const boxes = [];
    for (const el of row.children) {
      const rects = [...el.getClientRects()];
      const range = document.createRange();
      range.selectNodeContents(el);
      const textRects = [...range.getClientRects()];
      if (!rects.length) continue;

      // Whether this item generates a separator at all, asked of the engine
      // rather than inferred from geometry: a template with no ::after must
      // never yield a separator box, however its line boxes happen to measure.
      const after = getComputedStyle(el, '::after').content;
      const hasGenerated = Boolean(after) && after !== 'none' && after !== 'normal';

      // An element whose whole content is a separator glyph IS a separator.
      const ownKind = SEPARATORS.has((el.textContent || '').trim()) ? 'separator' : 'item';

      for (const r of rects) {
        // Text rects belonging to this visual line.
        const onLine = textRects.filter((t) => sameLine(t, r));
        if (onLine.length) {
          const left = Math.min(...onLine.map((t) => t.left));
          const right = Math.max(...onLine.map((t) => t.right));
          boxes.push({ y: r.top, left, right, kind: ownKind });
          // The generated separator is the strip of the element box lying past
          // its text on the logical trailing side (right in LTR, left in RTL).
          if (ownKind === 'item' && hasGenerated && !rtl && r.right - right > 2) {
            boxes.push({ y: r.top, left: right, right: r.right, kind: 'separator' });
          }
          if (ownKind === 'item' && hasGenerated && rtl && left - r.left > 2) {
            boxes.push({ y: r.top, left: r.left, right: left, kind: 'separator' });
          }
        } else if (ownKind === 'separator' || hasGenerated) {
          // None of this element's own text is on this line, so everything
          // painted here is its generated content: the separator travelled onto
          // a line of its own. Tagging it `ownKind` instead would call it an
          // item and let exactly the case this spec exists to catch pass
          // silently, since the line's leading edge would read as ordinary text.
          boxes.push({ y: r.top, left: r.left, right: r.right, kind: 'separator' });
        }
        // Otherwise the element paints no text and generates nothing on this
        // line — an empty contact item, which contributes no leading edge.
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

// One unbroken token long enough that it must overflow the row, which is the
// only condition under which overflow-wrap engages.
const LONG_PORTFOLIO = 'candidate.example.com/portfolio/'
  + 'a-very-long-unbroken-path-segment-that-cannot-wrap-normally-at-all';

for (const t of contactRowTemplates()) {
  for (const [label, lang] of [['ltr', 'en'], ['rtl-ar', 'ar']]) {
    for (const [valueLabel, portfolio] of [['short url', undefined], ['long unbroken url', LONG_PORTFOLIO]]) {
      test(`${t.rel} (${label}, ${valueLabel}): no contact-row line starts with the separator`, async ({ page }) => {
        const dir = mkdtempSync(join(tmpdir(), 'co-contact-wrap-'));
        try {
          const input = join(dir, 'payload.json');
          const html = join(dir, 'cv.html');
          writeFileSync(input, JSON.stringify(payload(lang, portfolio)));
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
              `at ${width}px${width === PAPER_WIDTH ? ' (A4 paper width)' : ''} a contact-row line `
              + `begins with the separator: ${measured.leaders.join(',')}`
            ).not.toContain('separator');
          }
        } finally {
          rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
      });
    }
  }
}
