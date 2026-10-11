// tests/generate-pdf-hyphen-nowrap.test.mjs — normalizeTextForATS keeps each
// hyphenated word on one line (#4908). A line break after a hard hyphen splits
// the term in the PDF text layer ("go-" / "to-market"), so the ATS loses it.
// The string checks always run; the layout check renders in headless Chromium
// and is skipped with a warning where Chromium is not installed.
import { pass, fail, warn, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\ngenerate-pdf.mjs — hyphenated words stay on one line (#4908)');

const NOWRAP = (w) => `<span style="white-space:nowrap">${w}</span>`;
const doc = (head, body) => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

let browser;
try {
  const { normalizeTextForATS } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
  const norm = (html) => normalizeTextForATS(html);

  const body = norm(doc('', '<p>Led go-to-market and cross-functional work.</p>'));
  if (body.html.includes(`Led ${NOWRAP('go-to-market')} and ${NOWRAP('cross-functional')} work.`)) pass('wraps each hyphenated word in body text');
  else fail(`body text not wrapped: ${body.html}`);
  if (body.replacements['hyphen-nowrap'] === 2) pass('counts the wraps as hyphen-nowrap');
  else fail(`hyphen-nowrap count wrong: ${JSON.stringify(body.replacements)}`);

  const head = norm(doc('<title>Mary-Jane Example — CV</title><style>.a-b { color: red; }</style>', '<p>Plain text.</p>'));
  if (head.html.includes('<title>Mary-Jane Example - CV</title>')) pass('leaves <title> text without markup (still normalizes its dash)');
  else fail(`title changed: ${head.html}`);
  if (head.html.includes('.a-b { color: red; }')) pass('leaves <style> untouched');
  else fail('style changed');

  const attrs = norm(doc('', '<a href="https://example.com/jobs/data-driven-role" class="contact-link">example.com/jordan-example</a><script>var x = "end-to-end";</script>'));
  if (attrs.html.includes('href="https://example.com/jobs/data-driven-role" class="contact-link"')) pass('leaves tag attributes untouched');
  else fail(`attributes changed: ${attrs.html}`);
  if (attrs.html.includes(`>${NOWRAP('example.com/jordan-example')}</a>`)) pass('wraps visible link text that contains a hyphenated word');
  else fail(`link text wrong: ${attrs.html}`);
  if (attrs.html.includes('var x = "end-to-end";')) pass('leaves <script> untouched');
  else fail('script changed');

  const edge = norm(doc('', '<p>2020-2024 · a - b · -leading trailing- · x--y · ' + 'a'.repeat(30) + '-' + 'b'.repeat(20) + '</p>'));
  if (edge.html.includes(NOWRAP('2020-2024'))) pass('wraps a hyphenated range');
  else fail(`range not wrapped: ${edge.html}`);
  if (!/nowrap">(a|-leading|trailing-|x--y)</.test(edge.html) && edge.html.includes(' a - b ') && edge.html.includes('x--y')) pass('leaves spaced dashes, edge hyphens and double hyphens alone');
  else fail(`edge cases wrapped: ${edge.html}`);
  if (edge.html.includes('a'.repeat(30) + '-' + 'b'.repeat(20)) && !edge.html.includes(NOWRAP('a'.repeat(30) + '-' + 'b'.repeat(20)))) pass('leaves a run over the length cap breakable');
  else fail('long token wrapped');

  // The span covers the whole whitespace-delimited run, so a symbol next to
  // the hyphenated part stays inside it.
  const runs = norm(doc('', '<p>Cut costs 30-40% and grew ARR by $1-2M with cross-functional, data-driven teams.</p>'));
  if (['30-40%', '$1-2M', 'cross-functional,', 'data-driven'].every((r) => runs.html.includes(NOWRAP(r)))) pass('wraps the whole run, including adjacent %, $ and punctuation');
  else fail(`runs not wrapped whole: ${runs.html}`);

  // The fact gate reads the normalized HTML and turns tags into spaces; a span
  // edge inside "30-40%" would read as "40 %" and block a truthful CV.
  const { verifyFacts } = await import(pathToFileURL(join(ROOT, 'verify-cv-facts.mjs')).href);
  const factDir = mkdtempSync(join(tmpdir(), 'career-ops-hyphen-facts-'));
  try {
    writeFileSync(join(factDir, 'cv.md'), '# Jordan Example\n\n- Cut costs 30-40% and grew ARR by $1-2M with cross-functional, data-driven teams.\n');
    const facts = verifyFacts(runs.html, { sourcePaths: ['cv.md'], configPath: 'missing.yml', cwd: factDir });
    if (facts.verdict !== 'block' && facts.invented.length === 0) pass('the fact gate still matches figures inside a wrapped run');
    else fail(`fact gate blocked the wrapped CV: ${JSON.stringify(facts.invented)}`);
  } finally {
    rmSync(factDir, { recursive: true, force: true });
  }

  const bold = norm(doc('', '<p>Built a **self-serve** platform.</p>'));
  if (bold.html.includes(`<strong>${NOWRAP('self-serve')}</strong>`)) pass('wraps inside markdown bold without breaking the <strong> tag');
  else fail(`bold interplay wrong: ${bold.html}`);

  const unicode = norm(doc('', '<p>Équipe franco-allemande.</p>'));
  if (unicode.html.includes(NOWRAP('franco-allemande.'))) pass('wraps non-ASCII hyphenated words');
  else fail(`unicode word not wrapped: ${unicode.html}`);

  // A `>` inside a quoted attribute value must not end the tag early.
  const quoted = norm(doc('', '<a title="a > b-c" href="#">go-to-market</a>'));
  if (quoted.html.includes(`<a title="a > b-c" href="#">${NOWRAP('go-to-market')}</a>`)) pass('a > inside a quoted attribute does not split the tag');
  else fail(`quoted attribute corrupted: ${quoted.html}`);

  // Plain-text and foreign content gets no markup.
  const plain = norm(doc('', '<textarea>end-to-end</textarea><select><option>full-time</option></select><svg><text>e-mail</text></svg><p>self-serve</p>'));
  if (plain.html.includes('<textarea>end-to-end</textarea>') && plain.html.includes('<option>full-time</option>') && plain.html.includes('<text>e-mail</text>') && plain.html.includes(NOWRAP('self-serve'))) pass('leaves <textarea>, <option> and <svg> text unwrapped, and resumes after them');
  else fail(`plain/foreign content wrapped: ${plain.html}`);
  const noBody = norm('<html><head><title>Mary-Jane Example</title></head><p>end-to-end</p></html>');
  if (noBody.html.includes('<title>Mary-Jane Example</title>') && noBody.html.includes(NOWRAP('end-to-end'))) pass('leaves <title> plain even when <body> is omitted');
  else fail(`title wrapped without <body>: ${noBody.html}`);

  // A quote inside a comment is not an attribute value, and normalization
  // carries on past the comment as it did before (#4908 review).
  const comment = norm(doc('', "<!-- Jordan's CV --><p>Led go-to-market \u2014 **30%** growth</p><p>Jordan's team</p>"));
  if (comment.html.includes(`<!-- Jordan's CV --><p>Led ${NOWRAP('go-to-market')} - <strong>30%</strong> growth</p>`)) pass('a quote inside a comment does not swallow the text after it');
  else fail(`comment swallowed text: ${comment.html}`);
  const options = norm(doc('', '<select><option>full-time<option>part-time</select><datalist><option>on-site</datalist><p>end-to-end</p>'));
  if (options.html.includes('<option>full-time<option>part-time</select><datalist><option>on-site</datalist>') && options.html.includes(NOWRAP('end-to-end'))) pass('an unclosed <option> ends at the next tag');
  else fail(`unclosed option handling wrong: ${options.html}`);

  // CJK has no spaces, so a run is a whole clause: wrap only the hyphenated
  // Latin word inside it, never the clause, and never CJK-only text.
  const CLAUSE = '主导B2B-SaaS产品的市场进入策略制定与执行并带领八人团队完成年度销售目标';
  const cjk = norm(doc('', `<li>${CLAUSE}</li><li>负责${'产品'.repeat(25)}的B2B-SaaS业务</li><li>八人-团队</li>`));
  if (cjk.html.includes(`<li>主导${NOWRAP('B2B-SaaS')}产品的`) && cjk.html.includes(`的${NOWRAP('B2B-SaaS')}业务</li>`) && cjk.html.includes('<li>八人-团队</li>')) pass('wraps only the Latin word inside a CJK clause, at any clause length');
  else fail(`CJK clause wrapping wrong: ${cjk.html}`);

  // A quote opens an attribute value only after `=`: an apostrophe in an
  // unquoted value must not stop the text after it from being normalized.
  const unquoted = norm(doc('', "<p><a title=don't href=#>x</a> Led go-to-market \u2014 it's done</p>"));
  if (unquoted.html.includes(`<a title=don't href=#>x</a> Led ${NOWRAP('go-to-market')} - it's done`)) pass('an apostrophe in an unquoted attribute does not swallow the text after it');
  else fail(`unquoted attribute swallowed text: ${unquoted.html}`);

  // A masked <script> next to a hyphenated word stays outside the span.
  const masked = norm(doc('', '<p>see-also<script>var a = 1;</script> tail</p>'));
  if (masked.html.includes(`${NOWRAP('see-also')}<script>var a = 1;</script> tail`)) pass('keeps an adjacent <script> outside the span');
  else fail(`script pulled into span: ${masked.html}`);

  // Raw-text elements print markup literally.
  const raw = norm(doc('', '<xmp>end-to-end</xmp><noscript>full-time</noscript><p>self-serve</p>'));
  if (raw.html.includes('<xmp>end-to-end</xmp><noscript>full-time</noscript>') && raw.html.includes(NOWRAP('self-serve'))) pass('leaves raw-text elements (<xmp>, <noscript>) unwrapped');
  else fail(`raw-text element wrapped: ${raw.html}`);

  const fragment = norm('<li>end-to-end delivery</li>');
  if (fragment.html === `<li>${NOWRAP('end-to-end')} delivery</li>`) pass('treats a fragment with no <body> as body');
  else fail(`fragment wrong: ${fragment.html}`);

  // Layout: in a narrow column, no line may break right after a hyphen.
  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    warn(`hyphen layout check skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }
  if (browser) {
    const page = await browser.newPage();
    const breaksAfterHyphen = async (html) => {
      await page.setContent(html);
      return page.evaluate(() => {
        let n = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        for (let t = walker.nextNode(); t; t = walker.nextNode()) textNodes.push(t);
        for (const t of textNodes) {
          for (let i = 0; i < t.data.length - 1; i++) {
            if (t.data[i] !== '-' || !/\S/.test(t.data[i + 1])) continue;
            const at = document.createRange(); at.setStart(t, i); at.setEnd(t, i + 1);
            const next = document.createRange(); next.setStart(t, i + 1); next.setEnd(t, i + 2);
            if (next.getBoundingClientRect().top > at.getBoundingClientRect().top + 2) n++;
          }
        }
        return n;
      });
    };
    const prose = 'Led go-to-market and engineering-led cross-functional data-driven work. '.repeat(12);
    const html = doc('<style>p { width: 173px; font: 11pt Arial; }</style>', `<p>${prose}</p>`);
    const before = await breaksAfterHyphen(html);
    const after = await breaksAfterHyphen(norm(html).html);
    if (before > 0 && after === 0) pass(`no line breaks after a hyphen once normalized (${before} before)`);
    else fail(`line breaks after a hyphen: ${before} before, ${after} after`);

    // A CJK clause must still wrap inside its column once normalized.
    await page.setContent(norm(doc('<style>li { width: 360px; font: 11px sans-serif; }</style>', `<ul><li>${CLAUSE}</li></ul>`)).html);
    const overflow = await page.evaluate(() => { const li = document.querySelector('li'); return li.scrollWidth - li.clientWidth; });
    if (overflow <= 0) pass('a normalized CJK clause still wraps inside its column');
    else fail(`normalized CJK clause overflows its column by ${overflow}px`);
  }
} catch (e) {
  fail(`hyphen nowrap tests crashed: ${e.message}`);
} finally {
  await browser?.close();
}
