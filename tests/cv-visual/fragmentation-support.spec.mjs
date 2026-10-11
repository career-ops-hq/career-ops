// tests/cv-visual/fragmentation-support.spec.mjs — the CSS fragmentation
// properties every CV template's page-break guarantees rest on must actually
// be honoured by the Chromium this project renders PDFs with.
//
// Why this exists
// ---------------
// The templates buy their layout guarantees with three properties:
//
//   .project-tech                      break-before: avoid
//   .project-title, .section-title,
//   .job-company, .job-role, …         break-after:  avoid
//   .header, .skill-item, .edu-item,
//   .cert-item, .competency-tag        break-inside: avoid
//
// tests/template-page-breaks.test.mjs pins those declarations as an invariant
// over every discovered template, and deliberately does so as a CSS assertion
// because the suites under tests/ must run on a bare clone with only Node
// (#1440). Its own header puts it exactly right: "the rule is the contract; the
// render is how the rule was arrived at."
//
// The gap is that a stylesheet assertion cannot verify a renderer. It proves a
// declaration is PRESENT, never that it DOES anything — so if an engine ignored
// one, the guarantee would read as enforced in CI while shipping broken, and
// nothing in the repo would notice. That is not hypothetical: `break-before` and
// `break-after: avoid` are widely described as unimplemented for paged media in
// Chromium, and on that belief the shipped `.project-tech` rule looks inert.
//
// Measured, it is not. On Chromium 151.0.7922.34 / Playwright 1.63.0 all three
// properties are honoured, which is why this file verifies them rather than
// banning them. Had the ban been written instead, it would have deleted two
// working guards.
//
// How it keeps its teeth
// ----------------------
// Each case renders the SAME document twice — once without the property, once
// with it — and asserts the invariant the property promises is violated in the
// first render and held in the second. Nothing is assumed about where the page
// boundary lands: the filler is searched until the control actually violates
// the invariant, and a case whose control stops violating it FAILS rather than
// passing vacuously. So this cannot decay into a test that holds while the
// thing it describes has stopped being true: if a future Chromium drops one of
// these properties, the guarded render violates the invariant too and the case
// fails, naming the guarantee that just went silently inert.
//
// The invariants are measured over which PAGE each block landed on, not over
// what happens to open page 2. An earlier draft asked "does page 2 open with a
// body line", which conflated two different layouts — a break between a heading
// and its body (the artifact) and a break in the middle of a body (ordinary,
// permitted) — and so reported a working property as broken.
import { test, expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRIES = 4;
const BODY_LINES = 6;

// Monospace at a fixed line-height keeps the filler's effect on the page
// boundary predictable, so the search below converges in a handful of renders.
const LINES = (n, tag) => Array.from({ length: n },
  (_, i) => `<div>${tag}${i + 1}</div>`).join('');

/**
 * A document of stacked entries, each a HEAD, a multi-line BODY and a TAIL,
 * preceded by `pad` filler lines. Growing the pad walks the page boundary
 * through the entries one line at a time.
 *
 * Every block is its own line with a unique token, so the extracted text says
 * exactly which page each block landed on.
 */
function doc({ pad, css, wrap = false }) {
  const entry = (i) => {
    const head = `<div class="head">HEAD${i}</div>`;
    const body = `<div class="body">${LINES(BODY_LINES, `b${i}_`)}</div>`;
    const tail = `<div class="tail">TAIL${i}</div>`;
    return wrap
      ? `<div class="entry">${head}<div class="wrap">${body}${tail}</div></div>`
      : `<div class="entry">${head}${body}${tail}</div>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0.6in; }
    body { font: 12px/1.4 monospace; margin: 0; }
    .entry { margin-bottom: 10px; }
    .head { font-weight: bold; }
    ${css}
  </style></head><body>
    <div class="pad">${LINES(pad, 'p')}</div>
    ${Array.from({ length: ENTRIES }, (_, i) => entry(i + 1)).join('\n')}
  </body></html>`;
}

/**
 * Pages of extracted text.
 *
 * pdftotext writes the form feed immediately BEFORE the first line of the next
 * page, so splitting on it is correct while a `sed -n '1,/\f/p'`-style range
 * would wrongly report that first line as belonging to the page before it. A
 * trailing form feed leaves an empty final chunk, dropped here.
 */
function pages(pdfPath) {
  const chunks = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }).split('\f');
  if (chunks.length && !chunks[chunks.length - 1].trim()) chunks.pop();
  return chunks.map((c) => c.split('\n').map((l) => l.trim()).filter(Boolean));
}

/** Zero-based page index of each block's token. */
function blockPages(pgs) {
  const where = new Map();
  pgs.forEach((lines, pageIndex) => {
    for (const line of lines) {
      const token = line.split(/\s+/)[0];
      if (token && !where.has(token)) where.set(token, pageIndex);
    }
  });
  return where;
}

// ---- the three invariants, stated over block positions ----

/**
 * Every token the invariants read, in document order.
 *
 * Presence is asserted before any invariant runs, because an invariant that
 * cannot find a token has nothing to say about it — and three invariants that
 * each quietly skipped what they could not find would report "no violations"
 * for a render whose fixture content never reached the extracted text at all.
 * That is the vacuous pass this file exists to rule out, so it is checked rather
 * than assumed.
 */
function expectedTokens() {
  const out = [];
  for (let i = 1; i <= ENTRIES; i++) {
    out.push(`HEAD${i}`);
    for (let k = 1; k <= BODY_LINES; k++) out.push(`b${i}_${k}`);
    out.push(`TAIL${i}`);
  }
  return out;
}

/** Which expected tokens are absent from a render's extracted text. */
function missingTokens(pgs) {
  const at = blockPages(pgs);
  return expectedTokens().filter((t) => !at.has(t));
}

/**
 * The page a token landed on. Throws rather than returning undefined: with
 * presence asserted up front, an absent token means the fixture or the
 * extraction changed shape, and swallowing that is what made the old
 * `!== undefined` guards able to pass an unchecked render.
 */
function pageOf(at, token) {
  const p = at.get(token);
  if (p === undefined) {
    throw new Error(`token ${token} is absent from the extracted text, which `
      + 'should have been caught by the presence assertion before any invariant ran');
  }
  return p;
}

/** A heading left on the page before the body it introduces. */
function orphanedHeadings(pgs) {
  const at = blockPages(pgs);
  const bad = [];
  for (let i = 1; i <= ENTRIES; i++) {
    if (pageOf(at, `HEAD${i}`) < pageOf(at, `b${i}_1`)) bad.push(`HEAD${i}`);
  }
  return bad;
}

/** A trailing block pushed past the end of the body it belongs to. */
function strandedTails(pgs) {
  const at = blockPages(pgs);
  const bad = [];
  for (let i = 1; i <= ENTRIES; i++) {
    if (pageOf(at, `TAIL${i}`) > pageOf(at, `b${i}_${BODY_LINES}`)) bad.push(`TAIL${i}`);
  }
  return bad;
}

/** A box declared atomic whose contents did not all land on one page. */
function splitWraps(pgs) {
  const at = blockPages(pgs);
  const bad = [];
  for (let i = 1; i <= ENTRIES; i++) {
    const pages = [
      ...Array.from({ length: BODY_LINES }, (_, k) => `b${i}_${k + 1}`),
      `TAIL${i}`,
    ].map((t) => pageOf(at, t));
    if (new Set(pages).size > 1) bad.push(`wrap${i}`);
  }
  return bad;
}

async function render(page, dir, html, tag) {
  const pdf = join(dir, `${tag}.pdf`);
  await page.setContent(html, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  writeFileSync(pdf, await page.pdf({
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    preferCSSPageSize: true,
  }));
  return pages(pdf);
}

/**
 * One property, verified against the renderer.
 *
 * `violations` returns the blocks breaking the invariant the property is meant
 * to prevent. The filler is searched until the control render violates it, so
 * the control is always proven to reproduce the artifact before the guarded
 * render is judged — which is what stops a passing result from being vacuous.
 */
function fragmentationCase({ name, guarantee, css, wrap = false, violations }) {
  test(`Chromium honours ${name} — ${guarantee}`, async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), 'co-frag-'));
    try {
      const tried = [];
      let control = null;
      let pad = 0;

      // Every expected token must be in the extracted text before anything is
      // asked about where it landed. Without this, a render whose fixture
      // content never reached the text would report no violations and the
      // placement check below would pass having checked nothing.
      const requireAllTokens = (pgs, what) => {
        const missing = missingTokens(pgs);
        expect(missing,
          `${what}: ${missing.length} of ${expectedTokens().length} fixture tokens are absent `
          + `from the extracted text (${missing.slice(0, 8).join(', ')}`
          + `${missing.length > 8 ? `, +${missing.length - 8} more` : ''}). `
          + 'Nothing can be concluded about page placement from a render that is missing content, '
          + 'so this is a failure rather than a skip.'
        ).toEqual([]);
      };

      // 36–60 brackets the A4 content box at this font; step 1 so every
      // boundary position between and inside entries is visited.
      for (let p = 36; p <= 60; p += 1) {
        const pgs = await render(page, dir, doc({ pad: p, css: '', wrap }), `ctl-${p}`);
        requireAllTokens(pgs, `unguarded render at pad=${p}`);
        if (pgs.length < 2) continue;
        const bad = violations(pgs);
        tried.push(`${p}:${bad.length ? bad.join('+') : '-'}`);
        if (bad.length) { control = { pgs, bad }; pad = p; break; }
      }

      // A control that no longer reproduces the artifact would make the
      // assertion below vacuous, so it is a failure, not a skip.
      expect(control,
        `no filler length in 36..60 made the UNGUARDED render violate "${guarantee}", so this `
        + `case can no longer verify anything about ${name}. Violations seen per pad: ${tried.join(' ')}`
      ).not.toBeNull();

      const guarded = await render(page, dir, doc({ pad, css, wrap }), `fix-${pad}`);
      requireAllTokens(guarded, `guarded render at pad=${pad}`);
      expect(
        violations(guarded),
        `at pad=${pad} the unguarded render violated "${guarantee}" at ${control.bad.join('+')}, `
        + `and applying \`${css.trim()}\` did not fix it. The property had no effect, so every `
        + `template guarantee resting on ${name} is silently inert in this renderer.`
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}

// `.project-tech { break-before: avoid }` — a tech line must never open a page
// with no description above it to say which project it belongs to.
fragmentationCase({
  name: 'break-before: avoid',
  guarantee: 'a trailing block is not pushed past the body it belongs to',
  css: '.tail { break-before: avoid; page-break-before: avoid; }',
  violations: strandedTails,
});

// `.project-title`, `.section-title`, `.job-company` … { break-after: avoid } —
// a heading must never be the last thing on a page.
fragmentationCase({
  name: 'break-after: avoid',
  guarantee: 'a heading is not left on the page before its body',
  css: '.head { break-after: avoid; page-break-after: avoid; }',
  violations: orphanedHeadings,
});

// `.header`, `.skill-item`, `.edu-item` … { break-inside: avoid } — the one
// property whose support was never in question, pinned so a regression in it is
// not mistaken for a template bug.
fragmentationCase({
  name: 'break-inside: avoid',
  guarantee: 'a box declared atomic is not split across pages',
  css: '.wrap { break-inside: avoid; page-break-inside: avoid; }',
  wrap: true,
  violations: splitWraps,
});
