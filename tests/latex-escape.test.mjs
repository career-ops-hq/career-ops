// tests/latex-escape.test.mjs — escapeLatex/sanitizeUrl regressions.
//
// 1. OT1 glyph substitution: pdflatex's default text encoding has no glyph for
//    <, >, or | — they silently print as ¡, ¿, and an em-dash, so a bullet like
//    "Cut p99 latency to <100ms" rendered "¡100ms" in every compiled CV. The
//    escaper must emit the \textless/\textgreater/\textbar commands instead.
// 2. mailto duplication: sanitizeUrl() prefixes bare addresses with mailto:,
//    and the template used to add its own mailto: on top, producing a broken
//    \href{mailto:mailto:...} link in every generated PDF. The contract is that
//    sanitizeUrl's output already carries its scheme.
import { pass, fail } from './helpers.mjs';
import { escapeLatex, sanitizeUrl } from '../lib/latex-escape.mjs';

console.log('\nlatex-escape — OT1-unsafe glyphs and mailto scheme handling');

const escaped = escapeLatex('Cut p99 latency to <100ms, >2x throughput on the a|b split');
escaped.includes('\\textless{}100ms') && escaped.includes('\\textgreater{}2x') && escaped.includes('a\\textbar{}b')
  ? pass('escapeLatex converts < > | to their text commands')
  : fail(`escapeLatex left OT1-unsafe glyphs raw: ${escaped}`);

!/[<>|]/.test(escaped)
  ? pass('no raw < > | survive escaping')
  : fail(`raw OT1-unsafe glyph survived: ${escaped}`);

sanitizeUrl('test@example.com') === 'mailto:test@example.com'
  ? pass('sanitizeUrl prefixes a bare address with mailto:')
  : fail(`sanitizeUrl bare-address handling changed: ${sanitizeUrl('test@example.com')}`);

sanitizeUrl('mailto:test@example.com') === 'mailto:test@example.com'
  ? pass('sanitizeUrl keeps an explicit mailto: single')
  : fail(`sanitizeUrl doubled an explicit mailto: ${sanitizeUrl('mailto:test@example.com')}`);

// Template contract: cv-template.tex must not prepend its own mailto: —
// sanitizeUrl's output already carries the scheme.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const tex = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'cv-template.tex'), 'utf-8');
!tex.includes('\\href{mailto:{{EMAIL_URL}}}')
  ? pass('cv-template.tex does not double the mailto: scheme')
  : fail('cv-template.tex still wraps {{EMAIL_URL}} in a second mailto:');
