// tests/nbsp-french-punctuation.test.mjs — normalizeTextForATS() flattens a
// stray NBSP to a plain space for ATS safety (#1728), but French typography
// requires an espace insécable immediately before :;!? — and this pass runs
// on the raw HTML string BEFORE page.setContent(), so an NBSP flattened here
// can never become "unbreakable" again once Chromium lays out the page.
// #3961 follow-up: a negative lookahead exempts NBSP directly before :;!?
// from the flatten, so it survives into the rendered PDF's line-breaking.
import { pass, fail } from './helpers.mjs';
import { normalizeTextForATS } from '../generate-pdf.mjs';

console.log('\nnormalizeTextForATS — French espace insécable before :;!?');

const NBSP = ' ';

function bumpedNbsp(html) {
  return normalizeTextForATS(html).replacements.nbsp || 0;
}

// NBSP directly before each of :;!? survives untouched.
for (const punct of [':', ';', '!', '?']) {
  const html = `<div>Expirée${NBSP}${punct} Certified Ethical Hacker</div>`;
  const { html: out, replacements } = normalizeTextForATS(html);
  if (out.includes(`Expirée${NBSP}${punct}`)) {
    pass(`NBSP before "${punct}" is preserved`);
  } else {
    fail(`NBSP before "${punct}" was flattened: ${JSON.stringify(out)}`);
  }
  if (!replacements.nbsp) {
    pass(`NBSP before "${punct}" is not counted as a replacement`);
  } else {
    fail(`NBSP before "${punct}" was still counted as a replacement`);
  }
}

// An NBSP anywhere else — mid-sentence, before a letter, at the very end of
// the string — is still flattened exactly as before this change.
{
  const html = `<div>10${NBSP}000 $ (a pasted figure)</div>`;
  const { html: out, replacements } = normalizeTextForATS(html);
  if (out.includes('10 000')) {
    pass('an unrelated NBSP (mid-number) is still flattened to a plain space');
  } else {
    fail(`unrelated NBSP was not flattened: ${JSON.stringify(out)}`);
  }
  if (replacements.nbsp === 1) {
    pass('the flattened NBSP is still counted in the replacements tally');
  } else {
    fail(`expected nbsp:1 in replacements, got ${JSON.stringify(replacements)}`);
  }
}

// An NBSP followed by ordinary text, not punctuation, is flattened even when
// a :;!? appears later in the same string — the lookahead must be anchored
// immediately after the NBSP, not "somewhere ahead of it".
{
  const html = `<div>word${NBSP}not-punctuation: rest</div>`;
  const { html: out } = normalizeTextForATS(html);
  if (out.includes('word not-punctuation:')) {
    pass('NBSP not immediately before :;!? is flattened even when punctuation follows later');
  } else {
    fail(`unexpected output: ${JSON.stringify(out)}`);
  }
}
