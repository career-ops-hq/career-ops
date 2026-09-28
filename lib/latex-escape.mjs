/**
 * Shared LaTeX escaping for career-ops CV scripts.
 */

/**
 * Escape user text for insertion into LaTeX macro arguments.
 *
 * @param {string} text
 * @param {'text'|'url'} [mode='text']
 * @returns {string}
 */
export function escapeLatex(text, mode = 'text') {
  // Blank out only truly absent/structural values, and coerce scalars — the
  // same rule #2641 applied to escapeHtml, which this function mirrors.
  // `typeof text !== 'string' -> ''` silently dropped NUMBERS: a payload with
  // `year: 2019` or `dates: 2024` (JSON numbers, not strings) rendered an empty
  // \resumeSubheading date field while the section stayed present, so the .tex
  // shipped without employment dates or graduation years — and the builder
  // still reported "valid": true and exited 0.
  if (text === null || text === undefined || typeof text === 'object') return '';
  const value = String(text);
  if (mode === 'url') return value;
  const out = [];
  for (const ch of value) {
    switch (ch) {
      case '\\': out.push('\\textbackslash{}'); break;
      case '{': case '}': out.push('\\' + ch); break;
      case '^': out.push('\\textasciicircum{}'); break;
      case '~': out.push('\\textasciitilde{}'); break;
      case '_': out.push('\\_'); break;
      case '&': out.push('\\&'); break;
      case '%': out.push('\\%'); break;
      case '$': out.push('\\$'); break;
      case '#': out.push('\\#'); break;
      // With pdflatex's default OT1 encoding these three have no glyph in the
      // text font: < and > print as inverted ¡/¿ and | as an em-dash, so
      // "p99 <100ms" renders "p99 ¡100ms". The text commands are safe in all
      // encodings.
      case '<': out.push('\\textless{}'); break;
      case '>': out.push('\\textgreater{}'); break;
      case '|': out.push('\\textbar{}'); break;
      case '\u00B1': out.push('$\\pm$'); break;
      case '\u2192': out.push('$\\rightarrow$'); break;
      default: out.push(ch);
    }
  }
  return out.join('');
}

/**
 * Validate and normalize URLs for \\href{} (escaped for hyperref, not with
 * escapeLatex()).
 *
 * `%`, `#`, `~` and `&` are ordinary URL characters (percent-encoding,
 * fragments, `~user` paths, query strings), so they are escaped for hyperref,
 * which writes the literal characters into the link. The first three used to
 * be deleted, which pointed the link somewhere else: `example.com/test%C3%A9`
 * became `example.com/testC3A9`, while the HTML CV kept the real URL. `&`
 * went through raw, and build-cv-latex.mjs puts project links inside the
 * argument of \resumeProjectHeading, where a raw `&` (or `%`, or `#`) stops
 * pdflatex. \href accepts `\%`, `\#`, `\~` and `\&` both there and at top
 * level. `{ } \ ^ $` are still dropped.
 *
 * @param {string} url
 * @returns {string}
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string') return '';
  url = url.trim();
  if (!url) return '';
  const allowedSchemes = ['mailto:', 'http:', 'https:'];
  const hasScheme = allowedSchemes.some(s => url.toLowerCase().startsWith(s));
  if (!hasScheme) {
    if (url.includes('@') && !url.includes('/')) {
      url = 'mailto:' + url;
    } else {
      url = 'https://' + url;
    }
  }
  return url.replace(/[{}$\\^]/g, '').replace(/[%#~&]/g, (ch) => `\\${ch}`);
}
