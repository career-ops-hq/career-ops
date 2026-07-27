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
  if (typeof text !== 'string') return '';
  if (mode === 'url') return text;
  const out = [];
  for (const ch of text) {
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
      case '\u00B1': out.push('$\\pm$'); break;
      case '\u2192': out.push('$\\rightarrow$'); break;
      default: out.push(ch);
    }
  }
  return out.join('');
}

/**
 * Validate and normalize URLs for \\href{} (not LaTeX-escaped).
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
  return url.replace(/[{}%$#\\~^]/g, '');
}
