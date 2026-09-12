// tests/cover-letter-signature.test.mjs — the optional cover-letter sign-off
// block (`letter.signature`): a valediction rendered over the signing name.
//
// The key is optional and additive: a payload that does not set it must render
// byte-identical to before the feature existed, so every pre-existing payload
// is untouched. The value is either a plain string (used as the valediction,
// name defaulting to the candidate) or `{ valediction, name }`. Both lines are
// HTML-escaped independently; the <br> separator is template markup emitted
// between them, never injected into escaped content.
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { buildHtml } from '../generate-cover-letter.mjs';

console.log('\nCover letter signature block');

// The shipped base template, passed explicitly so an installed template pack
// or profile default cannot redirect resolution mid-test.
const TEMPLATE = join(ROOT, 'templates', 'cover-letter-template.html');

const basePayload = {
  candidate: { name: 'Jane Doe' },
  letter: {
    role_title: 'Head of Applied AI',
    opening: 'CLOSING_MARKER opening sentence.',
    profile_intro: 'Profile intro.',
  },
};

function render(signature) {
  const letter = { ...basePayload.letter };
  if (signature !== undefined) letter.signature = signature;
  return buildHtml({ ...basePayload, letter }, TEMPLATE);
}

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Backward compatibility: unset key changes nothing ----------------------
const withoutSignature = render(undefined);
check('unset signature renders no signature markup',
  withoutSignature.includes('class="signature"'), false);
check('unset signature leaves no {{SIGNATURE_BLOCK}} token behind',
  withoutSignature.includes('{{SIGNATURE_BLOCK}}'), false);

// null and empty string are as unset as an absent key — a payload generator
// that emits `"signature": null` must not change the output.
check('null signature renders byte-identical to an absent key',
  render(null) === withoutSignature, true);
check('empty-string signature renders byte-identical to an absent key',
  render('') === withoutSignature, true);

// --- String form: valediction over the candidate name -----------------------
const stringForm = render('Sincerely,');
check('string signature renders the valediction over the candidate name',
  stringForm.includes('<p class="signature">Sincerely,<br>Jane Doe</p>'), true);

// The sign-off belongs at the end of the letter, after the body text.
const sigIdx = stringForm.indexOf('class="signature"');
const openingIdx = stringForm.indexOf('CLOSING_MARKER');
check('signature block renders after the letter body',
  sigIdx !== -1 && openingIdx !== -1 && sigIdx > openingIdx, true);

// --- Object form ------------------------------------------------------------
check('object signature renders its own valediction and name',
  render({ valediction: 'Best regards,', name: 'J. Doe, PhD' })
    .includes('<p class="signature">Best regards,<br>J. Doe, PhD</p>'), true);

check('object signature without a name falls back to the candidate name',
  render({ valediction: 'Kind regards,' })
    .includes('<p class="signature">Kind regards,<br>Jane Doe</p>'), true);

check('object signature with only a name renders the name alone',
  render({ name: 'J. Doe' }).includes('<p class="signature">J. Doe</p>'), true);

// --- Escaping ---------------------------------------------------------------
// Both lines pass through escapeHtml; only the <br> the template emits between
// them may survive as markup.
const escaped = render({ valediction: 'With <3 & "thanks",', name: "O'Brien <script>" });
check('valediction and name are HTML-escaped',
  escaped.includes('With &lt;3 &amp; &quot;thanks&quot;,<br>O&#39;Brien &lt;script&gt;'), true);
check('unescaped payload markup never reaches the output',
  escaped.includes('<script>'), false);
