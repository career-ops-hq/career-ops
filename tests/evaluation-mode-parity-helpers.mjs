// Shared by the inline locale gate and its regression tests. These are checks
// of mode documentation, not parsers for user reports or other Markdown files.
import { closeSync, constants, fstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isNestedCheckout } from '../lib/mjs-files.mjs';

// Shared inventory for the harness and regression suite. Remove a re-synced
// locale from FROZEN_EVALUATION_MODES here; keep it in KNOWN_EVALUATION_MODES.
export const FROZEN_EVALUATION_MODES = new Set([
  // modes/<lang>/oferta.md (#3669)
  'da/oferta.md', 'es/oferta.md', 'pl/oferta.md', 'pt/oferta.md', 'ua/oferta.md',
  // market-named evaluation modes (#3828)
  'de/angebot.md', 'fr/offre.md', 'hi/naukri.md', 'id/lowongan.md', 'it/annuncio.md',
  'ko/gonggo.md', 'nl/vacature.md', 'tr/is-ilani.md',
]);

// A known file that stops being discovered (renamed, or its A) block dropped)
// must fail instead of silently leaving the check. New files are also discovered.
export const KNOWN_EVALUATION_MODES = [
  'ar/fursah.md', 'da/oferta.md', 'de/angebot.md', 'es/oferta.md', 'fr/offre.md', 'hi/naukri.md',
  'id/lowongan.md', 'it/annuncio.md', 'ja/kyujin.md', 'ko/gonggo.md', 'nl/vacature.md', 'pl/oferta.md',
  'pt/oferta.md', 'ru/oferta.md', 'tr/is-ilani.md', 'ua/oferta.md', 'zh-TW/oferta.md', 'zh/oferta.md',
];

const REQUIRED_HEADINGS = ['A)', 'B)', 'C)', 'D)', 'E)', 'F)', 'G)', 'Risk Summary', 'H)'];
const REQUIRED_LABELS = ['Date', 'URL', 'Archetype', 'Score', 'Legitimacy', 'PDF'];

/** Read a mode or a Windows checkout's one-line symlink placeholder.
 * @param {string} root Repository root.
 * @param {string} path Repository-relative mode path.
 * @returns {string} UTF-8 source; external and non-regular files are rejected.
 */
export function readModeText(root, path) {
  const canonicalRoot = realpathSync(root);
  const checkInside = target => {
    const rel = relative(canonicalRoot, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`Mode path leaves the repository root: ${path}`);
    }
    return target;
  };
  const readRegular = target => {
    // Check a placeholder's lexical target before even probing its existence.
    // Then check the real path too, so an in-root symlink cannot escape.
    checkInside(target);
    const actual = checkInside(realpathSync(target));
    if (!statSync(actual).isFile()) throw new Error(`Mode path is not a regular file: ${path}`);
    // A FIFO swapped in after stat must not hang the harness. fstat checks the
    // opened descriptor before any bytes are read; normal mode reads are small.
    const fd = openSync(actual, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
      if (!fstatSync(fd).isFile()) throw new Error(`Mode path is not a regular file: ${path}`);
      return readFileSync(fd, 'utf8');
    } finally {
      closeSync(fd);
    }
  };
  const fullPath = resolve(canonicalRoot, path);
  const content = readRegular(fullPath);
  const pointer = content.trim();
  if (pointer.startsWith('..') && !/[\r\n]/.test(pointer)) {
    return readRegular(resolve(dirname(fullPath), pointer));
  }
  return content;
}

/** Discover evaluation modes by report content, independent of localized names.
 * @param {string} root Repository root.
 * @returns {string[]} Sorted paths relative to modes/; nested checkouts excluded.
 */
export function discoverEvaluationModes(root) {
  const found = [];
  for (const dir of readdirSync(join(root, 'modes'), { withFileTypes: true })) {
    const languageDir = join(root, 'modes', dir.name);
    // Match the earlier modeDocs walk's boundary (#3762). A copied checkout's
    // README may contain a report example, but it is not one of our modes.
    if (!dir.isDirectory() || isNestedCheckout(languageDir)) continue;
    for (const file of readdirSync(languageDir)) {
      if (file.endsWith('.md') && readModeText(root, `modes/${dir.name}/${file}`)
        .split(/\r?\n/).some(line => heading(line) === 'A)')) {
        found.push(`${dir.name}/${file}`);
      }
    }
  }
  return found.sort();
}

function withoutComments(text) {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, match => match.replace(/[^\r\n]/g, ' '));
}

// Keep the outer report fence: it is the actual output template in all current
// modes. Prose outside it and separate examples cannot supply missing sections.
function fenceParts(text) {
  const blocks = [];
  const visible = [];
  let opening = null;
  let body = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (opening) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === opening[0] && close[1].length >= opening.length) {
        blocks.push(body.join('\n'));
        opening = null;
        body = [];
      } else body.push(line);
    } else {
      const start = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (start && !(start[1][0] === '`' && start[2].includes('`'))) opening = start[1];
      else visible.push(line);
    }
  }
  return { blocks, visible };
}

function heading(line) {
  const match = line.match(/^ {0,3}##[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$/);
  if (!match) return null;
  return REQUIRED_HEADINGS.find(name => match[1] === name
    || (match[1].startsWith(name) && /^[ \t]/.test(match[1].slice(name.length)))) ?? null;
}

/** Missing or malformed parts of the single fenced report-format template.
 * @param {string} text Mode documentation, whose template H1 may be localized.
 * @returns {string[]} Empty only when the template satisfies the shared contract.
 */
export function structuralGaps(text) {
  const templates = fenceParts(withoutComments(text)).blocks
    .map(body => fenceParts(body).visible)
    .filter(lines => lines.some(line => heading(line) === 'A)'));
  if (templates.length !== 1) return [`expected one fenced report template, found ${templates.length}`];
  const lines = templates[0];
  const headings = lines.map(heading).filter(Boolean);
  const gaps = [];
  for (const name of REQUIRED_HEADINGS) {
    const count = headings.filter(value => value === name).length;
    if (count === 0) gaps.push(`## ${name}`);
    else if (count > 1) gaps.push(`duplicate ## ${name}`);
  }
  if (gaps.length === 0 && headings.join('|') !== REQUIRED_HEADINGS.join('|')) {
    gaps.push('report section order A)–G) → Risk Summary → H)');
  }
  // Machine Summary can precede A), so stop at the first H2, not just at A).
  const firstSection = lines.findIndex(line => /^ {0,3}##[ \t]+/.test(line));
  const header = lines.slice(0, firstSection);
  for (const label of REQUIRED_LABELS) {
    if (!header.some(line => new RegExp(`^ {0,3}\\*\\*${label}:\\*\\*(?:[ \\t]|$)`).test(line))) {
      gaps.push(`**${label}:** in report header`);
    }
  }
  return gaps;
}
