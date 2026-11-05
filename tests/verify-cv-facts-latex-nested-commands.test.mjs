// tests/verify-cv-facts-latex-nested-commands.test.mjs — a LaTeX command
// nested in another command's argument must not survive stripMarkup.
//
// The LaTeX strip in stripMarkup ran once, and its argument capture stops at
// the first `}`. In `\resumeItem{Built UI using \textbf{Next.js} and ...}` the
// outer match swallowed the inner `\textbf{` into its captured text, and a
// replacement is never rescanned, so "textbf" reached the claim patterns. The
// tool pattern then read "using textbf Next.js" and blocked a truthful CV with
// `non-metric facts absent from sources: tool=textbf`: every bullet that bolded
// a term right after "using" failed the gate.
import { pass, fail } from './helpers.mjs';
import { factClaims, stripMarkup, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nverify-cv-facts — nested LaTeX commands are unwrapped');

const texDocument = body => [
  '\\documentclass[letterpaper,11pt]{article}',
  '\\usepackage{titlesec}',
  '\\newcommand{\\resumeItem}[1]{\\item\\small{{#1 \\vspace{-2pt}}}}',
  '% a comment using \\textbf{Ignored} stays out of the text',
  '\\begin{document}',
  body,
  '\\end{document}',
  '',
].join('\n');

const BOLD_AFTER_USING = texDocument([
  '\\section{Experience}',
  '\\resumeItemListStart',
  // Each bullet ends in a period: two \\resumeItem bullets with no closing
  // punctuation are joined into one clause by stripMarkup, a separate issue.
  '  \\resumeItem{Built UI using \\textbf{Next.js} and \\textbf{TypeScript}.}',
  '  \\resumeItem{Shipped services using \\emph{\\textbf{Go}} on \\textbf{Kubernetes}.}',
  '\\resumeItemListEnd',
].join('\n'));

// stripMarkup leaves no command name behind, at any nesting depth.
const plain = stripMarkup(BOLD_AFTER_USING);
if (!/textbf|emph|resumeItem/.test(plain)) pass('nested command names are stripped');
else fail(`a command name survived stripMarkup: ${JSON.stringify(plain)}`);

if (plain.includes('Built UI using Next.js and TypeScript')
  && plain.includes('Shipped services using Go on Kubernetes')) pass('the bullet text survives intact');
else fail(`bullet text was mangled: ${JSON.stringify(plain)}`);

// The preamble and comments stay out, as before the fix.
if (!/titlesec|Ignored|vspace/.test(plain)) pass('preamble and comments are still dropped');
else fail(`preamble or comment text leaked: ${JSON.stringify(plain)}`);

// No tool claim is named after a LaTeX command.
const toolValues = factClaims(plain).filter(claim => claim.kind === 'tool').map(claim => claim.value);
if (!toolValues.some(value => /textbf|emph/.test(value))) pass('no tool claim is named after a LaTeX command');
else fail(`tool claims named after a command: ${JSON.stringify(toolValues)}`);

// End to end through verifyFacts: a truthful .tex CV passes, and a tool the
// source does not back still blocks (the fix did not blind the gate).
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-latex-nested-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));
  writeFileSync(source, [
    '- Built UI using Next.js and TypeScript.',
    '- Shipped services using Go on Kubernetes.',
    '',
  ].join('\n'));

  const truthful = verifyFacts(BOLD_AFTER_USING, { sourcePaths: [source], configPath: config });
  const truthfulTools = truthful.unsupportedFacts.filter(claim => claim.kind === 'tool').map(claim => claim.value);
  if (!truthfulTools.includes('textbf')) pass('no unsupported tool claim named textbf');
  else fail(`tool=textbf reported: ${JSON.stringify(truthful.unsupportedFacts)}`);
  if (truthful.verdict === 'pass' && truthful.unsupportedFacts.length === 0) pass('a truthful .tex CV with bold after "using" passes');
  else fail(`expected a clean pass, got ${truthful.verdict} ${JSON.stringify(truthful.unsupportedFacts)}`);

  const invented = verifyFacts(
    texDocument('\\resumeItem{Built UI using \\textbf{Next.js} and \\textbf{Svelte}}'),
    { sourcePaths: [source], configPath: config },
  );
  const inventedTools = invented.unsupportedFacts.filter(claim => claim.kind === 'tool').map(claim => claim.value);
  if (invented.verdict === 'block' && inventedTools.includes('svelte') && !inventedTools.includes('textbf')) {
    pass('a bolded tool the source does not back still blocks, by its own name');
  } else {
    fail(`expected a block on svelte only, got ${invented.verdict} ${JSON.stringify(inventedTools)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
