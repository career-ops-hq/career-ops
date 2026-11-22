// tests/browser-extract-unavailable.test.mjs — telling a taken-down posting from
// a page that did not render. Both leave the cleaned `text` empty; only the first
// is terminal. The verdict comes from liveness-core's classifyLiveness, so the
// phrase list lives in one place. The readDom() cases need headless Chromium and
// are skipped with a warning when it cannot launch (the test job installs with
// --ignore-scripts), and fail under `test-all.mjs --needs browser`, which the
// tool-suites CI job runs.
import { pass, fail, toolUnavailable, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nbrowser-extract.mjs (unavailable posting vs unrendered page)');

let browser;
try {
  const { jdFailure, normalizeJd, readDom } = await import(pathToFileURL(join(ROOT, 'browser-extract.mjs')).href);

  const longJd = 'Responsibilities include analysing product data. '.repeat(10);

  const gone = jdFailure({ url: 'https://x.example/j/1', text: '', bodyText: 'Acme Careers\nThis job is no longer available.' }, 12000);
  if (gone?.code === 'unavailable') pass('empty text whose raw body says "no longer available" is unavailable, not empty_text');
  else fail(`expected unavailable, got ${JSON.stringify(gone)}`);

  const loading = jdFailure({ url: 'https://x.example/j/2', text: '', bodyText: 'Loading…' }, 12000);
  if (loading?.code === 'empty_text' && loading.body_text === 'Loading…') pass('an unrendered shell stays empty_text and exposes the raw body');
  else fail(`expected empty_text with body_text, got ${JSON.stringify(loading)}`);

  const generic = jdFailure({ url: 'https://x.example/j/3', text: '', bodyText: 'Page not found' }, 12000);
  if (generic?.code === 'empty_text') pass('a bare "page not found" is not treated as a taken-down posting');
  else fail(`generic error was classified: ${JSON.stringify(generic)}`);

  const quoting = jdFailure({ url: 'https://x.example/j/4', text: `${longJd} We are no longer accepting applications from agencies.`, bodyText: '' }, 12000);
  if (quoting === null) pass('a full-length JD that quotes takedown wording is not reclassified');
  else fail(`a real JD was rejected: ${JSON.stringify(quoting)}`);

  // readDom() hands over at most ~4003 chars (2000 head + marker + 2000 tail);
  // normalizeJd() must not truncate that sample and lose the tail.
  const sample = `${'x'.repeat(2000)}\n…\n${'y'.repeat(1979)}This job is no longer available.`;
  const tail = normalizeJd({ title: 'T', text: longJd, bodyText: sample }, 'https://x.example/j/5');
  if (tail.bodyText.includes('no longer available.') && tail.bodyText.length === sample.length) pass('normalizeJd keeps the whole head+tail body sample');
  else fail(`body sample was cut: ${tail.bodyText.length} of ${sample.length} chars`);

  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    toolUnavailable('browser', `readDom unavailable-page tests skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }
  if (browser) {
    const page = await browser.newPage();
    const classify = async (html) => {
      await page.setContent(html);
      const raw = await readDom(page);
      return jdFailure(normalizeJd(raw, 'https://x.example/job/9'), 12000);
    };

    // The banner sits in <header>, which readDom() strips from `text`.
    const inHeader = await classify('<body><header>This job is no longer available.</header><main></main></body>');
    if (inHeader?.code === 'unavailable') pass('end to end: a banner in the stripped <header> is classified unavailable');
    else fail(`header banner not detected: ${JSON.stringify(inHeader)}`);

    // Long leading content pushes the footer banner past the first 4000 chars.
    const filler = '<p>Cookie settings and site navigation links for visitors.</p>'.repeat(120);
    const inFooter = await classify(`<body><main></main>${filler}<footer>This position has been filled.</footer></body>`);
    if (inFooter?.code === 'unavailable') pass('end to end: a footer banner beyond the first 4000 characters is still detected');
    else fail(`footer banner not detected: ${JSON.stringify(inFooter)}`);

    const shell = await classify('<body><main></main></body>');
    if (shell?.code === 'empty_text') pass('end to end: an empty shell with no takedown copy stays empty_text');
    else fail(`empty shell misclassified: ${JSON.stringify(shell)}`);
  }
} catch (e) {
  fail(`browser-extract unavailable test crashed: ${e.message}`);
} finally {
  if (browser) await browser.close();
}
