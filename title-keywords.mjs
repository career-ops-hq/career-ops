// title-keywords.mjs — one definition of how a `title_filter` keyword matches a
// job title, imported by every path that filters titles.
//
// It lives in its own module because there are two such paths and they must not
// drift: scan.mjs (the main pipeline) and openrouter-runner.mjs (the no-Claude
// path, which deliberately does not import scan.mjs because scan.mjs creates
// data/ at import time). Same reason user-agent.mjs and profile-language.mjs
// are separate modules rather than exports of a bigger one.
//
// The repo has already paid for a mirror once: tests/profile-keywords-parity
// exists because web/ carries a copy of the keyword logic and the copy was
// wrong. A second copy of THIS logic would repeat that, so there is one.

// Opt-in whole-word matching for a keyword too long to get it automatically.
// Chosen over widening the 2-3 char rule to every single-word keyword, because
// the right-hand boundary is exactly what a NEGATIVE usually wants to keep:
// "crypto" is meant to catch "Cryptocurrency" and "fellows" to catch
// "Fellowship", and anchoring the whole list would silently stop both. So the
// list says which entries want it, one entry at a time.
//
// The prefix cannot collide with a real keyword: a job title never contains a
// colon-suffixed "word", and an entry is one keyword, not a sentence.
export const WORD_PREFIX = 'word:';

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One definition of "inside a word", used by BOTH branches below. Anything else
// reintroduces, inside this module, exactly the drift the module exists to
// prevent: the acronym branch used ASCII \b while the `word:` branch had been
// made Unicode-aware, so `vp` still matched inside an accented word.
//
// String.raw, not a plain template literal: `\p` is not a recognised string
// escape, so an ordinary template drops the backslash and the class degenerates
// to the literal characters p, {, L, } — no error, and the anchor is simply off.
const WORD_CHAR = String.raw`[\p{L}\p{M}\p{N}_]`;
const anchoredPattern = (body) => new RegExp(`(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})`, 'u');

/**
 * Compile a lowercased keyword into a matcher.
 *
 * Short all-letter acronyms (2-3 chars: cfo, coo, sdr, bdr, gsi…) match on WORD
 * BOUNDARIES so "COO" does not match "Coordinator". A `word:` prefix asks for
 * the same treatment explicitly, at any length: `word:intern` rejects
 * "Operations Intern" and leaves "Internal Tools" and "International
 * Partnerships Manager" alone. Multi-word phrases and keywords containing
 * non-letters (".NET", "SAP ", "L&D") keep fast, permissive substring matching.
 *
 * @param {string} kw - already trimmed and lowercased.
 * @returns {(lower: string) => boolean}
 */
export function compileKeyword(kw) {
  if (kw.startsWith(WORD_PREFIX)) {
    const bare = kw.slice(WORD_PREFIX.length).trim();
    // A bare `word:` is a config typo. Matching NOTHING is the safe reading: as
    // a positive it simply contributes no match, while the alternative — an
    // empty pattern matching every title — would veto an entire scan from one
    // stray colon. Same trade as the "C++" note on scan.mjs's AND_SEPARATOR:
    // prefer a silent drop of one entry over a silent flood.
    if (!bare) return () => false;
    // Explicit alphanumeric lookarounds rather than \b, because \b's meaning
    // depends on the characters at the keyword's own edges: for `word:c++` a
    // trailing \b would sit after "+" and assert the opposite of the intent.
    // WORD_CHAR rather than [a-z0-9_]: an ASCII-only lookaround treats every
    // accented letter as a separator, so `word:intern` matched inside
    // "preintern" spelled with an accent and vetoed exactly the international
    // titles this prefix exists to protect. \p{M} covers combining marks, so a
    // decomposed "é" does not split a word either.
    const re = anchoredPattern(escapeForRegExp(bare));
    return (lower) => re.test(lower);
  }
  if (/^[a-z]{2,3}$/.test(kw)) {
    // The same boundary as above, not \b: \b is ASCII-only, so "vp" matched
    // inside an accented word while `word:vp` did not. Two spellings of one
    // rule in one file is the drift this module was extracted to end.
    const re = anchoredPattern(kw);
    return (lower) => re.test(lower);
  }
  return (lower) => lower.includes(kw);
}

// An AND-group: " + " (whitespace-delimited) between terms means EVERY term
// must appear in the title, in any order. `title_filter.positive` is otherwise
// matched by compileKeyword — a plain substring, EXCEPT for a 2-3 letter
// keyword ("AI", "ML", "VP") or a `word:`-prefixed one, both of which are
// anchored so they cannot hit inside another word. Either way an entry
// expresses one exact spelling and nothing else, and real titles vary in
// separator and word order:
//
//   "Director of Engineering" misses  Director - Software Engineering
//                                     Director Engineering (Mobile Platform)
//                                     Senior Director, Platform Engineering
//
// The combinations are {level} x {, - of none} x {optional domain word}: no
// hand-maintained list of literal spellings converges, and every miss is
// silent — the summary reports one "filtered by title" count that cannot tell
// a well-tuned filter from a leaking one (#2544).
//
// The separator REQUIRES surrounding whitespace on purpose. A bare split('+')
// would turn the perfectly ordinary keyword "C++" into "c", which matches
// almost every title — trading a silent drop for a silent flood.
// Exported because a caller that must reason about the TERMS of a group — the
// dead-positive guard in tests/title-filter-word-prefix.test.mjs — has to split
// them exactly as this file does, and a second copy of the rule is the drift
// this module was extracted to end.
export const AND_SEPARATOR = /\s+\+\s+/;

/**
 * Compile one `positive` entry into a matcher.
 *
 * Entries without " + " keep their exact previous behaviour, so existing
 * configs are unaffected.
 *
 * @param {string} keyword - already trimmed and lowercased.
 * @returns {(lower: string) => boolean}
 */
export function compilePositiveKeyword(keyword) {
  if (!AND_SEPARATOR.test(keyword)) return compileKeyword(keyword);
  const terms = keyword.split(AND_SEPARATOR).map(t => t.trim()).filter(Boolean);
  if (terms.length === 0) return compileKeyword(keyword);
  // Each term keeps compileKeyword's own rule, so a short term like "vp" is
  // still matched on a word boundary and cannot hit "vp" inside another word.
  const matchers = terms.map(compileKeyword);
  return (lower) => matchers.every(m => m(lower));
}

/**
 * Compile a whole `title_filter` into one predicate.
 *
 * This lives here, rather than in scan.mjs beside its main caller, because
 * openrouter-runner.mjs filters titles too and cannot import scan.mjs. It used
 * to keep a second implementation, and the two had drifted in three separate
 * ways: an empty positive list meant "accept everything" here and "reject
 * everything" there, AND-groups worked only here, and a non-string YAML entry
 * was dropped here but coerced into a real keyword there. One shared predicate
 * removes the class rather than those three instances.
 *
 * @param {{positive?: unknown, negative?: unknown}} [titleFilter]
 * @returns {(title: string) => boolean}
 */
export function buildTitleFilter(titleFilter) {
  // Normalize defensively: a malformed title_filter (a null, numeric, or otherwise
  // non-string entry in the YAML) must not crash the scan via k.toLowerCase().
  const normalize = (arr, compile) => (Array.isArray(arr) ? arr : [])
    .filter(k => typeof k === 'string')
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0)
    .map(compile);
  // AND-groups are a POSITIVE-side feature only. On the negative side an entry
  // is a veto, and " + " there would read as "reject when both appear", which
  // is a different and much easier thing to write as two entries.
  const positive = normalize(titleFilter?.positive, compilePositiveKeyword);
  const negative = normalize(titleFilter?.negative, compileKeyword);

  return (title) => {
    // String(), not `title || ''`: openrouter-runner used String(title ?? '')
    // before both paths were merged here, and scan.mjs threw on a truthy
    // non-string. Consolidating on scan.mjs's version would have carried that
    // throw onto a path that never had it, where it aborts jobs.filter and
    // drops a whole company's results for one malformed title.
    const lower = String(title ?? '').toLowerCase();
    // An empty positive list is "no positive constraint", not "match nothing":
    // a negative-only title_filter is a legitimate config that rejects a few
    // roles and keeps the rest.
    const hasPositive = positive.length === 0 || positive.some(m => m(lower));
    const hasNegative = negative.some(m => m(lower));
    return hasPositive && !hasNegative;
  };
}
