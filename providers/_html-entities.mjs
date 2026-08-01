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
// The hex/decimal alternatives are matched separately (not "#x?[0-9a-fA-F]+")
// so a decimal entity can never absorb trailing hex letters — "&#1a2;" no
// longer silently parses as codepoint 1 and drops "a2"; it just fails to
// match and passes through untouched, same as any other malformed entity.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** @param {string} s */
export function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // A lone surrogate half (0xD800-0xDFFF) is a valid codepoint per spec —
      // fromCodePoint won't throw for it — but it's not a valid Unicode scalar
      // value, so we still reject it defensively rather than emit an
      // ill-formed string.
      const valid = Number.isFinite(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}
