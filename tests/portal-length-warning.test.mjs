/**
 * portal-length-warning.test.mjs — warn-only length check for the CV headline
 * and the output PDF filename (#5629). Fixtures are synthetic.
 */
import { pathToFileURL } from 'url';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

const { warnLongPortalFields, normalizeTextForATS } = await import(
  pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href
);

console.log('\nPortal length warning (#5629)');

const page = (inner, attrs = 'class="header-title"') => `<html><body><div ${attrs}>${inner}</div></body></html>`;

// Run the check with console.warn captured; returns { result, printed, threw }.
function run(html, out = '/tmp/cv.pdf') {
  const original = console.warn;
  const printed = [];
  console.warn = (m) => { printed.push(String(m)); };
  try {
    return { result: warnLongPortalFields(html, out), printed, threw: false };
  } catch {
    return { result: [], printed, threw: true };
  } finally {
    console.warn = original;
  }
}

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

{
  const r = run(page('a'.repeat(64)));
  check('a headline of exactly 64 characters does not warn', r.result.length === 0 && r.printed.length === 0, JSON.stringify(r.result));
}
{
  const r = run(page('b'.repeat(65)));
  check('a headline over 64 characters warns, naming its length',
    r.result.length === 1 && /headline is 65 characters/.test(r.result[0]) && r.printed.length === 1, JSON.stringify(r.result));
}
{
  const r = run(page('Short Title'), `/tmp/${'c'.repeat(70)}.pdf`);
  check('an output filename over 64 characters warns',
    r.result.length === 1 && /filename is 74 characters/.test(r.result[0]), JSON.stringify(r.result));
}
check('a missing headline does not warn', run('<html><body><p>none</p></body></html>').result.length === 0, 'warned');
check('class need not be the first attribute',
  run(page('d'.repeat(65), 'id="headline" class="x header-title"')).result.length === 1, 'no warning');
{
  const long = `<div class="sub-header-title">${'e'.repeat(90)}</div>`;
  check('sub-header-title is not the headline',
    run(long + page('Short')).result.length === 0 && run(long).result.length === 0, 'warned');
}
check('data-class="header-title" is not the headline',
  run(`<div data-class="header-title" class="other">${'h'.repeat(90)}</div>`).result.length === 0, 'warned');
check('entities are decoded before counting code points',
  run(page('&#x1F600;'.repeat(8))).result.length === 0
    && run(page('&amp;'.repeat(64))).result.length === 0
    && run(page('&#128512;'.repeat(65))).result.length === 1, 'wrong count');
check('nested tags inside the headline are not counted',
  run(page(`<span>${'f'.repeat(64)}</span>`)).result.length === 0, 'warned');
{
  const html = page(`short <div>inner</div> ${'i'.repeat(70)}`);
  const r = run(html);
  check('text after a nested div still counts toward the headline length',
    r.result.length === 1 && /headline is 82 characters/.test(r.result[0]), JSON.stringify(r.result));
}
{
  const html = page(`${'g'.repeat(62)}…`);
  const before = run(html).result.length;
  const after = run(normalizeTextForATS(html).html);
  check('the length is measured after ATS normalization (62 letters + ellipsis is 63, prints as 65)',
    before === 0 && after.result.length === 1 && /65 characters/.test(after.result[0]), `before=${before} after=${JSON.stringify(after.result)}`);
}
check('the check never throws', !run('', '').threw && !run(page('x'), undefined).threw, 'threw');
