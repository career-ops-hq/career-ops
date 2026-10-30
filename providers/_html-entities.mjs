// @ts-check
// Minimal HTML entity decoder shared by the scraping providers whose sources
// return raw HTML (as opposed to a JSON API). Handles named entities (&amp;,
// &lt;, …) and numeric entities (&#252; / &#xfc;).
//
// Previously duplicated verbatim across deutschebahn.mjs and hecklerkoch.mjs
// (CodeRabbit finding on #1555) — same drift risk flagged separately on
// successfactors.mjs/dassault.mjs/softgarden.mjs/rheinmetall.mjs (#1639),
// where a numeric-entity range guard drifted out of sync between copies:
// checking only Number.isFinite still lets String.fromCodePoint throw a
// RangeError for a code point above 0x10FFFF (e.g. `&#99999999;`), crashing
// the entire parse for a single malformed/adversarial entity. Centralized
// here so the guard can't diverge again.
//
// The guard drifted a third time before this file caught up with it: the
// jobvite provider (#2623) grew its own copy that was STRICTER than this one,
// rejecting code points that are legal to construct but not legal to emit.
// That strictness is now here, in isEmittableCodePoint below, which is the
// point of a shared decoder — the improvement should not have had to live in
// one provider.
//
// A fourth round (#2790) migrated the seven RSS/XML providers — jobspresso,
// higheredjobs, nodesk, larajobs, personio, teamtailor, weworkremotely — that
// had never been in scope for any of the above. Their private copies guarded
// only with a try/catch, which catches the RangeError above 0x10FFFF and
// nothing else, so NUL, the C0 controls, lone surrogates and the
// noncharacters decoded into job titles; the catch then returned '', deleting
// the malformed reference rather than leaving it visible.
//
// Each round has migrated whichever copies were in front of the contributor at
// the time, which is why there were four. tests/providers/rss-entity-decoding
// .test.mjs now asserts at the source level that no importer of this module
// also declares its own decoder, so the next re-introduction fails on the
// commit that adds it instead of drifting quietly for a year.
//
// The hex/decimal alternatives are matched separately (not "#x?[0-9a-fA-F]+")
// so a decimal entity can never absorb trailing hex letters — "&#1a2;" no
// longer silently parses as codepoint 1 and drops "a2"; it just fails to
// match and passes through untouched, same as any other malformed entity.
// The XML five plus nbsp, then the Latin-1 letter entities. The letters are not
// decoration: a European board writes `D&eacute;veloppeur` and `Fran&ccedil;ais`
// in its HTML, and leaving those literal puts `D&eacute;veloppeur` in a job
// title, the tracker, and every document generated from it. Providers that
// needed them grew private tables instead, which is the drift this module
// exists to end — so they belong here rather than in the next scraper.
//
// Unknown names still pass through untouched (see decodeEntities), so this list
// is a floor, not a closed set.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  // French / Portuguese / Spanish / German / Nordic letters, lower and upper.
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', szlig: 'ß',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  Ntilde: 'Ñ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý',
  // Punctuation these same pages emit around titles.
  deg: '°', hellip: '…', laquo: '«', raquo: '»', ndash: '–', mdash: '—',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D', middot: '·', euro: '€',
};

const CASE_INSENSITIVE_NAMES = new Set(['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp']);

/**
 * Whether a numeric reference names a code point this decoder will emit.
 *
 * The set is XML 1.0 §2.2 Char. That standard is used rather than a bare
 * `code <= 0x10FFFF` bound because the bound only prevents fromCodePoint from
 * throwing — it says nothing about whether the result is safe to put in a job
 * title. It admits NUL, the C0 controls, and the two noncharacters U+FFFE and
 * U+FFFF, all of which fromCodePoint will happily emit.
 *
 * That matters because of where the output goes. A decoded title is not
 * displayed and discarded: it is written to the scan history, the pipeline, the
 * tracker, and every document generated downstream. A NUL or a lone surrogate
 * entering there is not a rendering artefact — it truncates C-string-backed
 * consumers, produces ill-formed UTF-8 on serialization, and is tedious to
 * trace back to one malformed entity in one posting weeks later. The feed host
 * controls this input, so "no legitimate page does that" is not a guarantee.
 *
 * Tab, LF and CR are explicitly kept: they are legal per §2.2, they appear in
 * real postings, and the callers already normalize whitespace.
 *
 * NaN needs no separate guard — it fails every comparison below — so this one
 * predicate subsumes the previous Number.isFinite / >= 0 / <= 0x10FFFF /
 * surrogate checks, and fromCodePoint cannot throw on what survives it.
 *
 * Deliberately NOT done here: the HTML5 windows-1252 remap of C1 references
 * (`&#146;` → U+2019). Those code points are legal under §2.2, so they pass
 * through and decode to the raw C1 control exactly as before. Adding that
 * mapping is a real improvement for the HTML providers, but it changes output
 * rather than rejecting bad input, so it belongs in its own change.
 *
 * @param {number} code
 */
function isEmittableCodePoint(code) {
  return code === 0x9 || code === 0xa || code === 0xd
    || (code >= 0x20 && code <= 0xd7ff)
    || (code >= 0xe000 && code <= 0xfffd)
    || (code >= 0x10000 && code <= 0x10ffff);
}

/** @param {string} s */
export function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // Anything outside the emittable set is left exactly as written. Raw
      // `&#0;` in a title is visible and inert; a decoded NUL is neither.
      return isEmittableCodePoint(code) ? String.fromCodePoint(code) : m;
    }
    // Letter entities are CASE-SENSITIVE: `&Eacute;` is É, not é. Looking the
    // name up lowercased would make every uppercase entry unreachable and
    // silently decode `&Eacute;` to the lowercase letter. Only the XML five and
    // nbsp are matched case-insensitively, which is where legacy pages really do
    // write `&AMP;`.
    if (Object.hasOwn(NAMED_ENTITIES, body)) return NAMED_ENTITIES[body];
    const lower = body.toLowerCase();
    return CASE_INSENSITIVE_NAMES.has(lower) ? NAMED_ENTITIES[lower] : m;
  });
}
