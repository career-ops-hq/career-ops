/**
 * ascii-fold.mjs — fold a name to ASCII for comparison against an ASCII target.
 *
 * Two places in the tree build a private key by DELETING every character
 * outside `[a-z0-9]` instead of folding it. The deletion is always wrong when
 * the thing being compared against is ASCII, because the accented letter has an
 * obvious ASCII counterpart that the target actually uses:
 *
 *   - verify-portals.mjs      "Telefónica"       -> "telefnica", never the real
 *                                                   Greenhouse slug "telefonica" (#2930)
 *   - providers/_trust-validator.mjs
 *                             "Société Générale" -> "socit gnrale", so the company
 *                                                   failed to match its own domain (#2924)
 *
 * WHY NFD IS RIGHT HERE AND WRONG IN foldStatusInput (tracker-utils.mjs, #2705):
 * there the fold must not collapse distinct identities — Żubr must never become
 * Zubr, because two different companies would merge. Here the comparison target
 * is ASCII by construction (a hostname, an ATS slug), so folding to the ASCII
 * base letter IS the intent: "telefonica" is the ASCII folding of "Telefónica".
 * Different question, different answer.
 *
 * A name with no Latin content at all (CJK, Cyrillic, Greek) folds to ''. That
 * is a real answer, not a failure: no ASCII target can contain it. Callers must
 * decide what '' means for them — see each call site.
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
 * @returns {string} Folded name, or '' when nothing Latin survives.
 */
export function asciiFold(value) {
  let out = String(value ?? '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
  for (const [re, to] of NON_DECOMPOSING_LATIN) out = out.replace(re, to);
  return out.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
