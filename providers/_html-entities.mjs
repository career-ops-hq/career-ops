// @ts-check
import { ENTITIES, LEGACY_NAMES } from './_html-entity-table.mjs';

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
  // URL punctuation and whitespace for the default (title) decoder. Attribute mode
  // reads the full table in _html-entity-table.mjs, not this one.
  colon: ':', sol: '/',
  Tab: '\t', NewLine: '\n',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D', middot: '·', euro: '€',
};

// HTML maps the numeric references 0x80-0x9F to windows-1252; five of them have no mapping and stay C1 controls.
const WINDOWS_1252_C1 = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
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

// The default mode: a reference with its semicolon, the decimal and hex forms as separate
// alternatives. An HTML parser also decodes a numeric reference in an attribute value with no
// semicolon (`&#58//x` is `://x`), so a caller that inspects an attribute needs `bareNumeric`.
const STRICT_REF = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;
// Attribute mode reads the whole WHATWG table (_html-entity-table.mjs). A name decodes when it
// ends in a semicolon and is in the table. Otherwise the longest legacy name that prefixes it
// decodes with no semicolon, unless an alphanumeric or `=` follows it (`&amp=1`, `&ampx` and
// `&notit;` stay as written). Each run of name characters starts at its own `&`, so one pass is linear.
const ATTRIBUTE_REF = /&(?:(#[xX][0-9a-fA-F]+|#[0-9]+);?|([a-zA-Z][a-zA-Z0-9]*)(;?))/g;
const LEGACY_MAX = 6;

/**
 * @param {string} s
 * @param {{bareNumeric?: boolean, text?: boolean}} [opts] `text` reads the
 *   references the way the tokenizer's data state does: with `bareNumeric`, a
 *   legacy name with no semicolon decodes whatever follows it (`&quothttps` is
 *   `"https`), where an attribute value keeps it as written.
 */
export function decodeEntities(s, { bareNumeric = false, text = false } = {}) {
  if (bareNumeric) return s.replace(ATTRIBUTE_REF, (m, numeric, name, semi, at) => {
    if (numeric === undefined) {
      if (semi && Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
      for (let n = Math.min(name.length, LEGACY_MAX); n >= 2; n--) {
        const head = name.slice(0, n);
        if (!LEGACY_NAMES.has(head)) continue;
        const next = n < name.length ? name[n] : s[at + m.length];
        if (text) return ENTITIES[head] + name.slice(n) + semi;
        return next !== undefined && /[A-Za-z0-9=]/.test(next) ? m : ENTITIES[head];
      }
      return m;
    }
    const isHex = numeric[1] === 'x' || numeric[1] === 'X';
    const code = parseInt(numeric.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    // An attribute caller sees what the browser sees: NUL, a surrogate and a
    // code point past U+10FFFF become U+FFFD, and every other reference
    // decodes, a leading C0 control included (the URL parser strips it).
    if (code >= 0x80 && code <= 0x9f) return WINDOWS_1252_C1[code - 0x80];
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
  });
  return s.replace(STRICT_REF, (m, ref) => {
    if (ref[0] === '#') {
      const isHex = ref[1] === 'x' || ref[1] === 'X';
      const code = parseInt(ref.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // Anything outside the emittable set is left exactly as written. Raw
      // `&#0;` in a title is visible and inert; a decoded NUL is neither.
      return isEmittableCodePoint(code) ? String.fromCodePoint(code) : m;
    }
    // Letter entities are CASE-SENSITIVE: `&Eacute;` is É, not é. Looking the
    // name up lowercased would make every uppercase entry unreachable and
    // silently decode `&Eacute;` to the lowercase letter. Only the XML five and
    // nbsp are matched case-insensitively, which is where legacy pages really do
    // write `&AMP;`.
    if (Object.hasOwn(NAMED_ENTITIES, ref)) return NAMED_ENTITIES[ref];
    const lower = ref.toLowerCase();
    return CASE_INSENSITIVE_NAMES.has(lower) ? NAMED_ENTITIES[lower] : m;
  });
}
