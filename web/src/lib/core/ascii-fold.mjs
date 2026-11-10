/**
 * ascii-fold.mjs — algorithm mirror of the core's `lib/ascii-fold.mjs`.
 *
 * WHY A COPY EXISTS AT ALL: the same reason normalize-text-key.mjs and
 * url-key.mjs carry one. The core lives in the user's career-ops checkout and
 * is resolved at runtime via careerOpsRoot(), which the web bundle cannot
 * import from; and an install predating a given core file would not have it at
 * all. Keep the body byte-for-byte aligned with `lib/ascii-fold.mjs` — the
 * parity test in tests/lib/ascii-fold.test.mjs fails the build if they drift.
 *
 * WHAT IT IS FOR HERE: turning a company name into a DOMAIN GUESS
 * (app/api/logo/route.ts). That is the exact case the core module's docstring
 * describes — the comparison target is ASCII by construction, so folding to the
 * ASCII base letter is the intent, and DELETING the accented letter is always
 * wrong. "Telefónica" resolves telefonica.com, never telefnica.com.
 *
 * Never reinstate a bare `[^a-z0-9]` strip here. That is the defect this file
 * exists to end, and it has now been reintroduced independently three times
 * (#2930 verify-portals, #2924 _trust-validator, and the logo resolver).
 */

/**
 * Latin letters that do NOT decompose under NFD, so stripping combining marks
 * alone still deletes them. Lowercase only; `asciiFold` lowercases first.
 */
// A stroke or bar through a letter is part of the GLYPH, not a combining
// mark, so NFD leaves it and the [^a-z0-9] strip below then deletes the letter
// outright — the failure this whole module exists to stop, surviving inside
// it. Unlike the hostname case there is no substring luck here: "Işık" derived
// "isk" and never "isik", so --add probed a slug no board uses.
// ŋ is "ng", not "n" — the plausible one-to-one mapping is the wrong one.
// (CodeRabbit, reviewing #2927.)
const NON_DECOMPOSING_LATIN = [
  [/ø/g, 'o'], [/æ/g, 'ae'], [/œ/g, 'oe'], [/ß/g, 'ss'],
  [/đ/g, 'd'], [/ł/g, 'l'], [/þ/g, 'th'], [/ð/g, 'd'],
  [/ħ/g, 'h'], [/ı/g, 'i'], [/ŋ/g, 'ng'], [/ŧ/g, 't'],
  [/ĸ/g, 'k'], [/ſ/g, 's'],
];

/**
 * Lowercase and fold a name to ASCII letters, digits and single spaces.
 *
 * @param {string} value - Raw display name.
 * @param {{punctuation?: 'space'|'delete'}} [options] - How residual punctuation
 *   is treated; see the note in the body. Word-level callers care, slug-style
 *   callers do not.
 * @returns {string} Folded name, or '' when nothing Latin survives.
 */
export function asciiFold(value, { punctuation = 'space' } = {}) {
  let out = String(value ?? '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
  for (const [re, to] of NON_DECOMPOSING_LATIN) out = out.replace(re, to);
  // 'space' (default) turns residual punctuation into a separator, so
  // "Smith&Jones" becomes two words. 'delete' removes it, so it stays one.
  //
  // NOT cosmetic, which is why this is an option and not a harmonization
  // (#3040). A caller that then matches WORDS gains words it never had:
  //
  //   Smith&Jones   space  -> "smith jones"  words: [smith, jones]
  //                 delete -> "smithjones"   words: [smithjones]
  //
  // and `smith` substring-matches smithfield.com, so a
  // company/hostname mismatch that should be flagged silently is not.
  // Slug-style callers that collapse spaces converge either way; word-level
  // callers do not, so the caller states which it needs.
  //
  // The 'delete' class is `[^a-z0-9 ]` with a LITERAL space, not `\s`: a tab or
  // newline is removed rather than collapsed, matching the behaviour
  // _trust-validator.mjs had before it moved here.
  out = punctuation === 'delete'
    ? out.replace(/[^a-z0-9 ]/g, '')
    : out.replace(/[^a-z0-9\s]/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}
