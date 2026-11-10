// modes/pipeline.md and modes/auto-pipeline.md must agree on which CV artifact
// a processed offer produces. pipeline.md says it "executes the full
// auto-pipeline", so the CV-output choice belongs to auto-pipeline Step 3,
// which routes on `cv.output_format`. When pipeline.md instead spells out its
// own `auto_pdf_score_threshold` gate and never mentions `cv.output_format`,
// a profile set to `text` still gets HTML/PDF artifacts from the inbox path
// while an identical single-URL run correctly gets markdown only (#3910).
//
// The two files are prose read by an agent, not code, so nothing but this
// check keeps them from drifting again: it pins every value
// config/profile.example.yml declares for `cv.output_format` to the same
// destination mode file in both, pins each format to *its own* file rather
// than to the set of three, pins the promise that the non-default routes skip
// both HTML and the PDF whatever the score, and pins the score gate to sit
// downstream of the routing rather than in front of it.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\npipeline / auto-pipeline cv.output_format parity');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const profileExample = read('config/profile.example.yml');
const autoPipeline = read('modes/auto-pipeline.md');
const pipeline = read('modes/pipeline.md');

// The example profile is the contract for what the key may hold: the quoted
// values on (and under) the `output_format:` line are the legal ones.
const declaredLine = profileExample
  .split(/\r?\n/)
  .find((line) => /^\s*output_format\s*:/.test(line)) ?? '';
const declaredFormats = [...new Set([...declaredLine.matchAll(/"([a-z]+)"/g)].map((m) => m[1]))];

if (declaredFormats.length >= 3 && ['html', 'latex', 'text'].every((f) => declaredFormats.includes(f))) {
  pass(`config/profile.example.yml declares cv.output_format values: ${declaredFormats.join(', ')}`);
} else {
  fail(`config/profile.example.yml no longer declares html/latex/text for cv.output_format (found: ${declaredFormats.join(', ') || 'none'})`);
}

// Each non-default value routes to its own mode file; anything else is the
// default HTML/PDF route. Asserting only that all three names appear somewhere
// is too weak: swapping `"latex"` → `modes/text.md` and `"text"` →
// `modes/latex.md` leaves the same three strings in the file and stays green.
// Pair each route cue with the destination that follows it instead.
const routes = [
  { label: '"latex"', cue: /"latex"/, mode: 'modes/latex.md' },
  { label: '"text"', cue: /"text"/, mode: 'modes/text.md' },
  { label: 'default', cue: /otherwise/i, mode: 'modes/pdf.md' },
];

// Where a route lands = the first `modes/<name>.md` after the cue that selects it.
const targetOf = (block, cue) => {
  const at = block.search(cue);
  if (at === -1) return null;
  return /modes\/[a-z-]+\.md/.exec(block.slice(at))?.[0] ?? null;
};

const mispairings = (block) => routes
  .map((route) => ({ ...route, got: targetOf(block, route.cue) }))
  .filter((route) => route.got !== route.mode)
  .map((route) => `${route.label} → ${route.got ?? 'nothing'} (expected ${route.mode})`);

// Step 3 of auto-pipeline is the canonical statement of the rule.
const step3 = autoPipeline.split(/^## Step 3\b/m)[1]?.split(/^## /m)[0] ?? '';
const step3Mispaired = mispairings(step3);

if (step3.includes('cv.output_format') && step3Mispaired.length === 0) {
  pass('modes/auto-pipeline.md Step 3 routes latex → latex.md, text → text.md, default → pdf.md');
} else {
  fail(`modes/auto-pipeline.md Step 3 is no longer the routing rule (${
    [step3.includes('cv.output_format') ? null : 'missing cv.output_format', ...step3Mispaired]
      .filter(Boolean).join('; ')
  })`);
}

// Ordering is the part that actually fixes #3910: the score gate may narrow the
// default HTML route, never override a profile that asked for text or latex.
const formatAt = pipeline.indexOf('cv.output_format');
const gateAt = pipeline.indexOf('auto_pdf_score_threshold');

// pipeline.md must defer to that rule instead of restating a PDF-only one. Its
// routing lives between the first mention of the key and the gate that may only
// narrow the default route, so that span is what gets checked for pairing.
const pipelineRouting = formatAt !== -1 && gateAt > formatAt ? pipeline.slice(formatAt, gateAt) : '';
const pipelineMispaired = mispairings(pipelineRouting);

if (formatAt !== -1 && pipelineMispaired.length === 0) {
  pass('modes/pipeline.md routes CV output on cv.output_format to the same three mode files');
} else {
  fail(`modes/pipeline.md ignores cv.output_format when choosing the CV artifact (${
    [formatAt === -1 ? 'missing cv.output_format' : null, ...pipelineMispaired]
      .filter(Boolean).join('; ')
  })`);
}

// Ordering alone is only word order. Without an explicit promise, an agent that
// reads the gate and sees a qualifying score can still hand a `text` profile a
// PDF, so the non-default routes have to be stated as unconditional.
const guarantee = pipelineRouting
  .split(/(?<=\.)\s/)
  .find((sentence) => /never/i.test(sentence) && /PDF/.test(sentence));

// The promise has to cover HTML as well as the PDF: `text` is markdown only,
// so a sentence that forbids just the PDF still lets the default route's HTML
// preview reach a `text` profile. Requiring the word `HTML` anywhere in the
// sentence is not enough either — "still write the HTML preview but never
// produce a PDF" contains it and would pass — so pin the negation itself to
// span both artifacts.
//
// Spanning both artifacts is still not the whole promise. "never produce HTML
// or a PDF below the threshold" spans both and inverts the fix: under the gate
// the routes are honoured, over it the artifacts come back, which is #3910
// through the same door. So the promise also has to be stated as independent
// of the score and must carry no qualifier that makes it conditional on one.
// Both checks read the promise clause only (from `never` to the em dash that
// starts the tracker instruction), so wording downstream of it — "mark PDF ❌
// … only in the tracker" — cannot redden this by accident.
const promise = guarantee ? guarantee.slice(guarantee.search(/never/i)).split(/\s[—–-]\s/)[0] : '';
const CONDITIONAL = /\b(?:below|under|above|over|beneath|when|if|unless|only|threshold)\b/i;
const SCORE_INDEPENDENT = /\b(?:whatever|regardless of|no matter|independent of)\s+(?:the\s+)?score\b/i;

const coversBoth = /never\s+produce[^.]*\bHTML\b[^.]*\bPDF\b/i.test(promise);
const unconditional = coversBoth && !CONDITIONAL.test(promise) && SCORE_INDEPENDENT.test(promise);

if (unconditional && /latex/.test(guarantee) && /text/.test(guarantee)) {
  pass('modes/pipeline.md states the latex and text routes never produce HTML or a PDF, whatever the score');
} else {
  fail(`modes/pipeline.md no longer says the latex/text routes skip both HTML and the PDF regardless of score, so auto_pdf_score_threshold can override cv.output_format (${
    !guarantee ? 'no unconditional promise found'
      : `${coversBoth ? 'promise is conditional on the score' : 'promise does not span both HTML and the PDF'}, found instead: ${promise.trim().slice(0, 120)}`
  })`);
}

if (formatAt !== -1 && gateAt !== -1 && formatAt < gateAt) {
  pass('modes/pipeline.md resolves cv.output_format before applying auto_pdf_score_threshold');
} else if (gateAt === -1) {
  fail('modes/pipeline.md no longer documents auto_pdf_score_threshold — the configurable PDF gate lost its home');
} else {
  fail('modes/pipeline.md applies the auto_pdf_score_threshold gate before resolving cv.output_format, so a `text` profile can still be forced into a PDF');
}
