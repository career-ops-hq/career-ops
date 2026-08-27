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

// `stem:` is the other half of the same question, and it exists because the two
// halves are NOT the same setting seen from two sides.
//
// `word:agent` says "agent, and nothing longer" — it rejects Agentforce.
// `stem:agent` says "a word that STARTS with agent" — it keeps Agentforce and
// Agentic, and drops Reagents, where the keyword lands mid-word.
// A bare `agent`, today's default, keeps all three.
//
// So a plain substring is not "the loose option"; it is two loosenesses at once,
// and only one of them is usually wanted. `stem:` lets an entry ask for the one
// it means. Under today's substring default that is already a narrowing rather
// than a no-op: it is what separates Agentforce from Reagents (#3103).
export const STEM_PREFIX = 'stem:';

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
// Same left boundary, no right one: the keyword must start a word, and the word
// may continue past it.
const stemPattern = (body) => new RegExp(`(?<!${WORD_CHAR})${body}`, 'u');

// `word:` and `stem:` mean the same thing wherever a keyword list is matched
// against text, so their handling lives here once rather than being copied into
// each compiler — the drift this module exists to prevent. Returns a matcher
// when `kw` carries a recognised prefix, or null when it is an ordinary keyword
// the caller compiles its own way (the title filter auto-anchors short
// acronyms and falls back to substring; the content filter goes straight to
// substring — see #3103, #3274).
//
// Explicit alphanumeric lookarounds rather than \b, because \b's meaning
// depends on the characters at the keyword's own edges: for `word:c++` a
// trailing \b would sit after "+" and assert the opposite of the intent.
// WORD_CHAR rather than [a-z0-9_]: an ASCII-only lookaround treats every
// accented letter as a separator, so `word:intern` matched inside "preintern"
// spelled with an accent and vetoed exactly the international titles this
// prefix exists to protect. \p{M} covers combining marks, so a decomposed "é"
// does not split a word either.
function compilePrefixedKeyword(kw) {
  if (kw.startsWith(WORD_PREFIX)) {
    const bare = kw.slice(WORD_PREFIX.length).trim();
    // A bare `word:` is a config typo. Matching NOTHING is the safe reading: as
    // a positive it simply contributes no match, while the alternative — an
    // empty pattern matching everything — would veto an entire scan from one
    // stray colon. Same trade as the "C++" note on scan.mjs's AND_SEPARATOR:
    // prefer a silent drop of one entry over a silent flood.
    if (!bare) return () => false;
    const re = anchoredPattern(escapeForRegExp(bare));
    return (lower) => re.test(lower);
  }
  if (kw.startsWith(STEM_PREFIX)) {
    const bare = kw.slice(STEM_PREFIX.length).trim();
    // Same reading as a bare `word:`: a stray prefix with nothing after it is a
    // typo, and matching nothing is the safe half of that trade.
    if (!bare) return () => false;
    const re = stemPattern(escapeForRegExp(bare));
    return (lower) => re.test(lower);
  }
  return null;
}

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
  const prefixed = compilePrefixedKeyword(kw);
  if (prefixed) return prefixed;
  if (/^[a-z]{2,3}$/.test(kw)) {
    // The same boundary as above, not \b: \b is ASCII-only, so "vp" matched
    // inside an accented word while `word:vp` did not. Two spellings of one
    // rule in one file is the drift this module was extracted to end.
    const re = anchoredPattern(kw);
    return (lower) => re.test(lower);
  }
  return (lower) => lower.includes(kw);
}

/**
 * Compile a lowercased `content_filter` keyword into a matcher.
 *
 * `content_filter` matches against the job DESCRIPTION, not the title, and its
 * default has always been a plain case-insensitive substring. That default is
 * why a bare negative `java` rejects every posting that merely mentions
 * "JavaScript", and `ios` rejects "curiosity" (#3274). Flipping the default is
 * a breaking change for every configured install — the same conclusion #3103
 * reached for `title_filter` — so the fix is opt-in: a `word:` or `stem:`
 * prefix asks for boundary-anchored matching on that one entry (identical
 * semantics to the title filter), and every other entry keeps the substring
 * behaviour byte-for-byte.
 *
 * Unlike compileKeyword(), there is no automatic anchoring of short keywords.
 * The title filter anchors 2-3 letter acronyms because "COO" inside
 * "Coordinator" is always wrong; a 2-3 letter run inside a paragraph of
 * description prose is routinely intended ("aws", "gcp", "sql", "go").
 *
 * @param {string} kw - already trimmed and lowercased.
 * @returns {(lower: string) => boolean}
 */
export function compileContentKeyword(kw) {
  return compilePrefixedKeyword(kw) ?? ((lower) => lower.includes(kw));
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
  // Each term keeps compileKeyword's own rule, so a short term like "vp" is
  // still matched on a word boundary and cannot hit "vp" inside another word.
  return compileAndGroup(keyword, compileKeyword);
}

// The " + " split, separated from the per-term rule because there are now two
// kinds of keyword that share the group syntax and disagree only about how a
// single term matches: a `title_filter.positive` entry (compileKeyword) and a
// `domain_filter` entry (compileDomainKeyword, below). Reimplementing the split
// for the second one is the drift this module exists to prevent, and leaving it
// out is worse than it looks: a user who learned " + " on title_filter and
// tried it on domain_filter would get an entry that silently never matches,
// which in a board gate costs an entire board rather than one row.
function compileAndGroup(keyword, compileTerm) {
  if (!AND_SEPARATOR.test(keyword)) return compileTerm(keyword);
  const terms = keyword.split(AND_SEPARATOR).map(t => t.trim()).filter(Boolean);
  if (terms.length === 0) return compileTerm(keyword);
  const matchers = terms.map(compileTerm);
  return (lower) => matchers.every(m => m(lower));
}

// Normalize defensively: a malformed keyword list (a null, numeric, or
// otherwise non-string entry in the YAML) must not crash the scan via
// k.toLowerCase(). Shared by both builders below — a second copy is how a
// null entry ends up crashing one scanner and not the other.
function normalizeKeywords(arr, compile) {
  return (Array.isArray(arr) ? arr : [])
    .filter(k => typeof k === 'string')
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0)
    .map(compile);
}

/**
 * Compile one `domain_filter` entry into a matcher.
 *
 * A domain keyword answers a different question from a title keyword — "is this
 * employer in my industry" rather than "is this the right role" — and it is
 * read at a different granularity: the board gate in scan-ats-full.mjs decides
 * a whole catalogue on one match (#3105). The default differs for that reason.
 *
 * A plain entry here means `word:`. Measured over 546 reverse-sweep postings on
 * 249 boards, a plain substring admitted 32 boards of which 28 were junk, and
 * 25 of those came from `defi` landing inside a longer word. What the junk has
 * in common is that the domain term STARTS that word, so only the right-hand
 * anchor closes it:
 *
 *   defi   -> Deficiência, Defiance, Software Defined, Product Definition
 *   solana -> Solanaceae          crypto -> Cryptography
 *
 * `stem:` reaches exactly one of those (Indefinido, where the term lands
 * mid-word) and is the wrong default here, notwithstanding the "a domain list
 * is a list of stems by nature" reasoning on #3105 that this corrects: the
 * 4/7 split re-measured on #3297 is the same finding from the title side.
 *
 * The asymmetry is what settles it. A false positive admits an entire
 * catalogue while a false negative costs one board, and the run summary counts
 * skipped boards, so the loose direction is the one that fails silently.
 *
 * `word:` charges for that, and the charge is a real one: it drops "Digital
 * AssetS", "Smart ContractS" and "CryptoCURRENCY", which are genuine finds
 * rather than noise. An entry that needs a longer form asks for it with
 * `stem:`, one entry at a time, the way `title_filter` asks for the opposite —
 * and `stem:digital asset` carries no junk risk, because no unrelated word
 * begins with it. Both prefixes are honoured here, so the vocabulary a user
 * learned on title_filter is the same one; only which end of it is free
 * changes.
 *
 * @param {string} kw - already trimmed and lowercased.
 * @returns {(lower: string) => boolean}
 */
export function compileDomainKeyword(kw) {
  return compileAndGroup(kw, compileDomainTerm);
}

function compileDomainTerm(term) {
  if (term.startsWith(WORD_PREFIX) || term.startsWith(STEM_PREFIX)) return compileKeyword(term);
  // Delegated rather than pattern-matched here on purpose: what `word:` MEANS
  // is defined once, above, including the lookarounds that make it Unicode-safe
  // (the whole reason "Deficiência" is a case this has to get right). This is a
  // statement about which default a domain keyword gets, not a second
  // implementation of the anchor. It also subsumes the 2-3 letter acronym rule
  // — `evm` and `dao` were already anchored, and now agree with everything else
  // rather than being an exception a reader has to hold.
  return compileKeyword(WORD_PREFIX + term);
}

/**
 * Compile a `domain_filter` list into one predicate, or null when the feature
 * is off.
 *
 * Null rather than an always-true predicate: the gate is opt-in (#3105), and
 * "no domain_filter configured" has to be distinguishable from "configured and
 * everything matches" — the caller reports the gate in its run summary only
 * when it actually ran, and an always-true predicate would make a config typo
 * look like a working gate that happened to admit every board.
 *
 * @param {unknown} domainKeywords - the raw `domain_filter` value from portals.yml.
 * @returns {((title: string) => boolean) | null}
 */
export function buildDomainFilter(domainKeywords) {
  const matchers = normalizeKeywords(domainKeywords, compileDomainKeyword);
  if (matchers.length === 0) return null;
  return (title) => {
    const lower = String(title ?? '').toLowerCase();
    return matchers.some(m => m(lower));
  };
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
  // AND-groups are a POSITIVE-side feature only. On the negative side an entry
  // is a veto, and " + " there would read as "reject when both appear", which
  // is a different and much easier thing to write as two entries.
  const positive = normalizeKeywords(titleFilter?.positive, compilePositiveKeyword);
  const negative = normalizeKeywords(titleFilter?.negative, compileKeyword);

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
