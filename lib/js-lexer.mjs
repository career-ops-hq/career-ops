// @ts-check
// lib/js-lexer.mjs — a small one-pass JavaScript lexer for plugin-audit.
//
// The audit decides what a plugin loads from tokens, never from text, so it
// reads source the way Node does: comments are comments, a string is a string
// (with escapes and line continuations decoded to the value Node loads), a
// template literal nests, and a regex literal is told from a division by the
// token before it. Each reading is one pass that never backtracks, so time
// grows with the size of the source and not with how many keywords it holds.
//
// It is not a parser, and some things only a parser can decide: a `/` after a
// word that may be a name (`of`, `await`, `yield`), after `++` or `--`, or
// after `}` is a regex or a division depending on the grammar around it, and
// in CommonJS `<!--` and a line-leading `-->` start a comment that an ES
// module does not have. A wrong guess is not bounded by anything: a regex read
// as a division can open a template or a comment that swallows the rest of the
// file, and a division read as a regex can swallow a line. So where the tokens
// do not settle it, the lexer does not guess. It lexes the file once per
// combination of readings (a "run"), and the caller reports what any run loads.
// The number of runs is capped at MAX_RUNS; past it `capped` is set and the
// caller must treat the file as not fully read.
//
// A run is incomplete when it ends inside a template literal or a block comment.
// Node rejects such a file, so an incomplete run is not what Node runs, and a
// caller that has a complete run can drop it. When every run is incomplete the
// file is unreadable.

/**
 * @typedef {{ t: 'ident'|'punct'|'string'|'tpl'|'num'|'regex', v: string, pos: number, open?: boolean, hdr?: boolean }} Token
 * `v` is the cooked value for an identifier or a string: `require` is
 * `require`, and a string's escapes and line continuations are decoded. `tpl`
 * is a chunk of a template literal that has substitutions (`open` is true when
 * the chunk ends in `${`); a template with none is a plain `string`. On a `)`,
 * `hdr` is true when it closes the header of `if`, `while`, `for` or `with`.
 * @typedef {{ tokens: Token[], incomplete: boolean }} Run
 */

/** The most runs one file may take. Past it the lexer stops and sets `capped`. */
export const MAX_RUNS = 32;

const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$‌‍]/u;
const SPACE = /\s/;
const PUNCT = />>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.(?!\d)|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|\*\*|[\s\S]/y;
const NUMBER = /(?:0[xXoObB][\da-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?)/y;
const REGEX_FLAGS = /[\p{ID_Continue}$]*/uy;

// A `/` after one of these starts a regex, not a division.
const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends', 'default']);
// ...except these three, which are also ordinary names (`let of = 4; of / 2`),
// so a `/` after one is either.
const MAY_BE_A_NAME = new Set(['of', 'yield', 'await']);
// `(` after one of these opens a header, so a `/` after its `)` is a regex.
const HEADER_KEYWORD = new Set(['if', 'while', 'for', 'with']);

// What a `/` can be, from the tokens before it.
const DIVISION = 0;
const REGEX = 1;
const EITHER = 2;

const isLineTerminator = (c) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const isDigit = (c) => c >= 48 && c <= 57;
const isHex = (c) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isSpace = (c) => c === 32 || (c >= 9 && c <= 13) || (c > 127 && SPACE.test(String.fromCharCode(c)));
const isPropertyMark = (t) => t !== undefined && t.t === 'punct' && (t.v === '.' || t.v === '?.' || t.v === '#');

/** @param {string} src @param {number} i */
function isIdentStartAt(src, i) {
  const c = src.charCodeAt(i);
  if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95) return true;
  if (c === 92) return src.charCodeAt(i + 1) === 117;
  if (c < 128) return false;
  return ID_START.test(String.fromCodePoint(/** @type {number} */ (src.codePointAt(i))));
}

/**
 * Decode the escape whose backslash is at src[i - 1]. Returns the text it
 * stands for and the index after it. Escapes JavaScript would reject are kept
 * as the character, which is what a lenient reader would produce.
 * @param {string} src @param {number} i
 * @returns {{ s: string, next: number }}
 */
function readEscape(src, i) {
  const c = src.charCodeAt(i);
  switch (c) {
    case 110: return { s: '\n', next: i + 1 };
    case 116: return { s: '\t', next: i + 1 };
    case 114: return { s: '\r', next: i + 1 };
    case 98: return { s: '\b', next: i + 1 };
    case 102: return { s: '\f', next: i + 1 };
    case 118: return { s: '\v', next: i + 1 };
    case 13: return { s: '', next: src.charCodeAt(i + 1) === 10 ? i + 2 : i + 1 };
    case 10: case 0x2028: case 0x2029: return { s: '', next: i + 1 };
    case 120: // \xHH
      if (isHex(src.charCodeAt(i + 1)) && isHex(src.charCodeAt(i + 2))) return { s: String.fromCharCode(parseInt(src.slice(i + 1, i + 3), 16)), next: i + 3 };
      return { s: 'x', next: i + 1 };
    case 117: { // \uHHHH or \u{H...}
      if (src.charCodeAt(i + 1) === 123) {
        // Read the hex digits and look for the brace right after them, rather
        // than searching ahead for a `}`: with none, that search would cross the
        // rest of the file for every `\u{`.
        let j = i + 2;
        while (isHex(src.charCodeAt(j))) j++;
        if (j > i + 2 && src.charCodeAt(j) === 125) {
          let k = i + 2;
          while (k < j - 1 && src.charCodeAt(k) === 48) k++;
          if (j - k <= 6 && parseInt(src.slice(k, j), 16) <= 0x10ffff) return { s: String.fromCodePoint(parseInt(src.slice(k, j), 16)), next: j + 1 };
        }
      } else if ([1, 2, 3, 4].every((k) => isHex(src.charCodeAt(i + k)))) {
        return { s: String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16)), next: i + 5 };
      }
      return { s: 'u', next: i + 1 };
    }
    default:
      if (c >= 48 && c <= 55) { // legacy octal, and \0
        let j = i + 1;
        const max = c <= 51 ? 3 : 2;
        while (j - i < max && src.charCodeAt(j) >= 48 && src.charCodeAt(j) <= 55) j++;
        return { s: String.fromCharCode(parseInt(src.slice(i, j), 8)), next: j };
      }
      return { s: src[i] ?? '', next: i + 1 };
  }
}

/**
 * What a `/` is, from the tokens before it.
 * @param {Token[]} tokens
 */
function slashKind(tokens) {
  const prev = tokens[tokens.length - 1];
  if (!prev) return REGEX;
  switch (prev.t) {
    case 'num': case 'string': case 'regex': return DIVISION;
    case 'tpl': return prev.open ? REGEX : DIVISION;
    case 'ident':
      // `a.in / 2`, `this.#of / 2`: a keyword after a dot or `#` is a property name.
      if (isPropertyMark(tokens[tokens.length - 2])) return DIVISION;
      if (!REGEX_AFTER_KEYWORD.has(prev.v)) return DIVISION;
      return MAY_BE_A_NAME.has(prev.v) ? EITHER : REGEX;
    default:
      if (prev.v === ')') return prev.hdr ? REGEX : DIVISION;
      // After `}` it depends on whether the brace closed a block or an
      // expression (`{} / 2`, `function () {} / 2`, `L: {} /x/`); after `++` or
      // `--` on whether it was postfix or prefix (`k++ / 2`, `++/x/.lastIndex`).
      if (prev.v === '}' || prev.v === '++' || prev.v === '--') return EITHER;
      return prev.v === ']' ? DIVISION : REGEX;
  }
}

/**
 * Lex `src`. Returns the runs, the first of which (every ambiguous site read as
 * the plainer reading) is also exposed as `tokens`, and a `lineOf` that maps a
 * source position to its 1-based line.
 *
 * `html` says whether `<!--` and a line-leading `-->` may be comments, which is
 * so in CommonJS and not in an ES module.
 *
 * @param {string} src
 * @param {{ html?: boolean }} [options]
 * @returns {{ tokens: Token[], runs: Run[], capped: boolean, lineOf: (pos: number) => number }}
 */
export function lexJs(src, { html = false } = {}) {
  const n = src.length;

  // A regex body that reaches the end of its line without closing is rescanned
  // from every later `/`, which is quadratic on a line of ` /[ /[ /[`. Where a
  // scan from (position, in-class or not) is known to fail, any scan that
  // reaches the same pair fails with it, so each pair is walked once.
  /** @type {Uint8Array|null} */
  let failMark = null;
  /** @param {number} from @param {boolean} mark */
  const walkRegex = (from, mark) => {
    let j = from;
    let cls = 0;
    while (j < n) {
      const bit = 1 << cls;
      if (failMark !== null && (failMark[j] & bit)) return -1;
      if (mark) /** @type {Uint8Array} */ (failMark)[j] |= bit;
      const e = src.charCodeAt(j);
      if (isLineTerminator(e)) return -1;
      if (e === 92) {
        if (isLineTerminator(src.charCodeAt(j + 1))) return -1;
        j += 2;
        continue;
      }
      if (e === 91) cls = 1;
      else if (e === 93) cls = 0;
      else if (e === 47 && cls === 0) return j + 1;
      j++;
    }
    return -1;
  };
  /** The index just past a regex body that starts at `from`, or -1 if its line ends first. @param {number} from */
  const scanRegex = (from) => {
    const end = walkRegex(from, false);
    if (end < 0) {
      if (failMark === null) failMark = new Uint8Array(n);
      walkRegex(from, true);
    }
    return end;
  };

  /**
   * One lexing pass. `prefix` fixes the first readings; any later ambiguous
   * site takes the plainer one (0). `choices` is every reading made.
   * @param {number[]} prefix
   */
  const lexRun = (prefix) => {
    /** @type {Token[]} */
    const tokens = [];
    /** @type {boolean[]} */
    const parens = [];
    /** @type {boolean[]} */
    const braces = []; // true when the brace opened a template substitution
    /** @type {number[]} */
    const choices = [];
    let incomplete = false;
    let lineStart = true; // only whitespace and comments so far on this line
    let i = 0;
    if (src.startsWith('#!')) while (i < n && !isLineTerminator(src.charCodeAt(i))) i++;

    const decide = () => {
      const c = choices.length < prefix.length ? prefix[choices.length] : 0;
      choices.push(c);
      return c;
    };
    /** @param {Token} tok */
    const push = (tok) => { tokens.push(tok); lineStart = false; };

    /** Read a template chunk from `from`; returns the cooked text and whether it stopped at `${`. */
    const readTemplate = (/** @type {number} */ from) => {
      let j = from;
      let out = '';
      let run = j;
      while (j < n) {
        const c = src.charCodeAt(j);
        if (c === 96) { out += src.slice(run, j); return { v: out, next: j + 1, open: false, closed: true }; }
        if (c === 36 && src.charCodeAt(j + 1) === 123) { out += src.slice(run, j); return { v: out, next: j + 2, open: true, closed: true }; }
        if (c === 92) {
          out += src.slice(run, j);
          const e = readEscape(src, j + 1);
          out += e.s;
          j = run = e.next;
        } else j++;
      }
      return { v: out + src.slice(run, n), next: n, open: false, closed: false };
    };
    /** Push the template chunk that starts at `from`. */
    const template = (/** @type {number} */ from, /** @type {number} */ pos, /** @type {boolean} */ first) => {
      const chunk = readTemplate(from);
      if (!chunk.closed) incomplete = true;
      if (first && !chunk.open) push({ t: 'string', v: chunk.v, pos });
      else push({ t: 'tpl', v: chunk.v, pos, open: chunk.open });
      if (chunk.open) braces.push(true);
      return chunk.next;
    };

    while (i < n) {
      const c = src.charCodeAt(i);
      if (isLineTerminator(c)) { lineStart = true; i++; continue; }
      if (isSpace(c)) { i++; continue; }

      if (c === 47) { // '/'
        const d = src.charCodeAt(i + 1);
        if (d === 47) { i += 2; while (i < n && !isLineTerminator(src.charCodeAt(i))) i++; continue; }
        if (d === 42) {
          const end = src.indexOf('*/', i + 2);
          if (end < 0) { incomplete = true; i = n; continue; }
          // A comment that spans a line break counts as one for `-->`.
          if (html && !lineStart) for (let k = i + 2; k < end; k++) if (isLineTerminator(src.charCodeAt(k))) { lineStart = true; break; }
          i = end + 2;
          continue;
        }
        const kind = slashKind(tokens);
        if (kind !== DIVISION) {
          const body = scanRegex(i + 1);
          // With no closing slash on its line it is not a regex, so there is nothing to choose.
          if (body >= 0 && (kind === REGEX || decide() === 1)) {
            REGEX_FLAGS.lastIndex = body;
            REGEX_FLAGS.test(src);
            const end = REGEX_FLAGS.lastIndex;
            push({ t: 'regex', v: src.slice(i, end), pos: i });
            i = end;
            continue;
          }
        }
      }

      if (c === 34 || c === 39) { // string
        let j = i + 1;
        let out = '';
        let run = j;
        while (j < n) {
          const e = src.charCodeAt(j);
          if (e === c) break;
          if (e === 92) { out += src.slice(run, j); const esc = readEscape(src, j + 1); out += esc.s; j = run = esc.next; }
          else if (e === 10 || e === 13) break;
          else j++;
        }
        out += src.slice(run, j);
        push({ t: 'string', v: out, pos: i });
        i = j < n && src.charCodeAt(j) === c ? j + 1 : j;
        continue;
      }

      if (c === 96) { i = template(i + 1, i, true); continue; }

      if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
        NUMBER.lastIndex = i;
        NUMBER.test(src);
        push({ t: 'num', v: src.slice(i, NUMBER.lastIndex), pos: i });
        i = NUMBER.lastIndex;
        continue;
      }

      if (isIdentStartAt(src, i)) {
        let j = i;
        let out = '';
        let run = j;
        while (j < n) {
          const e = src.charCodeAt(j);
          if ((e >= 65 && e <= 90) || (e >= 97 && e <= 122) || isDigit(e) || e === 36 || e === 95) { j++; continue; }
          if (e === 92 && src.charCodeAt(j + 1) === 117) {
            out += src.slice(run, j);
            const esc = readEscape(src, j + 1);
            out += esc.s;
            j = run = esc.next;
            continue;
          }
          if (e > 127) {
            const cp = /** @type {number} */ (src.codePointAt(j));
            if (ID_CONTINUE.test(String.fromCodePoint(cp))) { j += cp > 0xffff ? 2 : 1; continue; }
          }
          break;
        }
        out += src.slice(run, j);
        push({ t: 'ident', v: out, pos: i });
        i = j;
        continue;
      }

      if (c === 125 && braces[braces.length - 1] === true) { // '}' closing a ${ substitution
        braces.pop();
        i = template(i + 1, i, false);
        continue;
      }

      // `<!--` starts a line comment in CommonJS, and so does `-->` as the first
      // thing on a line. Whether this file is CommonJS is not known here, so
      // the html option makes it a reading to choose.
      if (html && ((c === 60 && src.startsWith('<!--', i)) || (c === 45 && lineStart && src.startsWith('-->', i))) && decide() === 1) {
        while (i < n && !isLineTerminator(src.charCodeAt(i))) i++;
        continue;
      }

      PUNCT.lastIndex = i;
      PUNCT.test(src);
      const p = src.slice(i, PUNCT.lastIndex);
      /** @type {Token} */
      const tok = { t: 'punct', v: p, pos: i };
      if (p === '(') {
        const prev = tokens[tokens.length - 1];
        const before = tokens[tokens.length - 2];
        // `a.if(x) / 2` calls a method named if: it is not a header.
        parens.push(!!prev && prev.t === 'ident' && !isPropertyMark(before) && (HEADER_KEYWORD.has(prev.v) || (prev.v === 'await' && !!before && before.t === 'ident' && before.v === 'for')));
      }
      else if (p === ')') tok.hdr = parens.pop() ?? false;
      else if (p === '{') braces.push(false);
      else if (p === '}') braces.pop();
      push(tok);
      i = PUNCT.lastIndex;
    }
    // A substitution still open at the end of the file swallowed the rest of it.
    if (braces.includes(true)) incomplete = true;
    return { tokens, incomplete, choices };
  };

  /** @type {Run[]} */
  const runs = [];
  /** @type {number[][]} */
  const pending = [[]];
  let capped = false;
  while (pending.length) {
    if (runs.length >= MAX_RUNS) { capped = true; break; }
    const prefix = /** @type {number[]} */ (pending.pop());
    const r = lexRun(prefix);
    runs.push({ tokens: r.tokens, incomplete: r.incomplete });
    // Every queued prefix becomes a run, so stop once the queue can only end in the cap:
    // queuing a copy per ambiguous slash first is quadratic memory on hostile input.
    if (runs.length + pending.length + r.choices.length - prefix.length > MAX_RUNS) { capped = true; break; }
    // Every site past the fixed prefix took the plainer reading; queue the other.
    for (let j = prefix.length; j < r.choices.length; j++) pending.push(r.choices.slice(0, j).concat(1));
  }

  // Line starts, built once, so a position maps to a line by binary search.
  /** @type {number[]} */
  const starts = [0];
  for (let k = 0; k < n; k++) {
    const e = src.charCodeAt(k);
    if (e === 13) { if (src.charCodeAt(k + 1) === 10) k++; starts.push(k + 1); }
    else if (e === 10 || e === 0x2028 || e === 0x2029) starts.push(k + 1);
  }
  /** @param {number} pos 1-based line of a source position */
  const lineOf = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  return { tokens: runs[0].tokens, runs, capped, lineOf };
}
