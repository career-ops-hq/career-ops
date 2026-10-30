// tests/ascii-fold-punctuation.test.mjs — the punctuation option is a
// behaviour switch, not a spelling preference (#3040).
//
// _trust-validator.mjs and lib/ascii-fold.mjs carried the same folding table
// with one difference in the final class: 'delete' removes residual
// punctuation, 'space' turns it into a separator. Unifying them without the
// option would have silently loosened the trust validator, because its
// word-level check matches any word of 3+ characters:
//
//   Smith&Jones   space  -> [smith, jones]   `smith` matches smithfield.com
//                 delete -> [smithjones]     no match, flag fires
//
// Fewer false penalties is the safe direction in general; on a legitimacy
// validator the flag NOT firing is the failure that costs something.
//
// Run:  node --test tests/ascii-fold-punctuation.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asciiFold } from '../lib/ascii-fold.mjs';
import { companyMatchesHostname, asciiFoldForHostname } from '../providers/_trust-validator.mjs';

test("'space' separates on punctuation, 'delete' does not", () => {
  assert.equal(asciiFold("Smith&Jones"), 'smith jones');
  assert.equal(asciiFold("Smith&Jones", { punctuation: 'delete' }), 'smithjones');
  assert.equal(asciiFold("O'Brien"), 'o brien');
  assert.equal(asciiFold("O'Brien", { punctuation: 'delete' }), 'obrien');
});

test("'space' is the default, so existing callers are unchanged", () => {
  assert.equal(asciiFold('Société Générale'), 'societe generale');
  assert.equal(asciiFold('Telefónica'), 'telefonica');
  assert.equal(asciiFold('Ørsted'), 'orsted');
});

test("'delete' uses a literal space, so a tab is removed not collapsed", () => {
  // `[^a-z0-9 ]` vs `[^a-z0-9\s]` — the second difference between the two
  // folds, and the one the issue's design note did not mention.
  assert.equal(asciiFold('a\tb', { punctuation: 'delete' }), 'ab');
  assert.equal(asciiFold('a\tb'), 'a b');
});

test('the trust validator still uses delete — the loosening did not sneak in', () => {
  assert.equal(asciiFoldForHostname("Smith&Jones"), 'smithjones');
  // The consequence, asserted end to end rather than via the fold alone:
  // an unrelated hostname that merely shares one half of the name must still
  // be flagged as a mismatch.
  assert.equal(companyMatchesHostname('Smith&Jones', 'smithfield.com'), false,
    'punctuation-as-space would have made `smith` match smithfield.com');
  // ...while the company's own domain still matches.
  assert.equal(companyMatchesHostname('Smith&Jones', 'smithjones.com'), true);
});

test('a name with no Latin content still folds to empty', () => {
  for (const name of ['楽天', 'Сбербанк', 'Ελλάκτωρ']) {
    assert.equal(asciiFold(name, { punctuation: 'delete' }), '');
    assert.equal(asciiFold(name), '');
  }
});
