import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const oferta = readFileSync(join(ROOT, 'modes', 'oferta.md'), 'utf8');
const apply = readFileSync(join(ROOT, 'modes', 'apply.md'), 'utf8');
const batch = readFileSync(join(ROOT, 'batch', 'batch-prompt.md'), 'utf8');

console.log('\nFixed-term contract disclosure (#4534)');

function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(`${label}: ${detail}`);
}

const signal = oferta.match(/\*\*16\. Fixed-Term Contract Disclosure\*\*[\s\S]*?(?=\n### Output format:)/)?.[0] ?? '';
check('oferta defines standalone Signal 16', Boolean(signal), 'missing Signal 16 section');
check(
  'signal recognizes explicit fixed-term and duration wording',
  ['18 month contract', '6-month contract', '2 year contract', 'fixed-term contract position', 'temporary position', 'term position']
    .every((phrase) => signal.includes(phrase)),
  'one or more required explicit examples are absent',
);
check(
  'signal rejects unrelated bare contract language',
  ['customer contracts', 'contract management', 'contract law', 'contractor-status', 'unqualified `contract position`']
    .every((phrase) => signal.includes(phrase)),
  'false-positive exclusions are incomplete',
);
check(
  'signal preserves stated duration and remains separate from classification mismatch',
  /preserve it verbatim/i.test(signal) && /separate from Signal 6/i.test(signal),
  'duration preservation or Signal 6 boundary is missing',
);
check(
  'signal is informational and cannot alter scoring or recommendation',
  /never changes the 1–5 Global Score/i.test(signal)
    && /High Confidence \/ Proceed with Caution \/ Suspicious tier/i.test(signal)
    && /application recommendation/i.test(signal)
    && /never blocks or discourages/i.test(signal),
  'non-scoring/non-blocking contract is incomplete',
);
check(
  'negotiation prompt is bounded and evidence-aware',
  /benefits coverage/i.test(signal)
    && /renewal uncertainty/i.test(signal)
    && /transition risk/i.test(signal)
    && /verify current benchmarks/i.test(signal)
    && /Never state or invent a percentage premium, market rate, entitlement, or legal conclusion/i.test(signal),
  'negotiation safeguards are incomplete',
);

const applyStep = apply.match(/## Step 5e — Fixed-term contract disclosure[\s\S]*?(?=\n\*\*Applying to several roles)/)?.[0] ?? '';
check('apply has a fixed-term preflight step', Boolean(applyStep), 'missing Step 5e');
check(
  'apply warns before drafting and then continues',
  /Before drafting answers/i.test(applyStep)
    && /Warn once and continue immediately/i.test(applyStep)
    && /never require acknowledgment/i.test(applyStep),
  'warn-before-answer or continuation behavior is missing',
);
check(
  'apply never fills, blocks, or invents terms',
  /Never auto-answer or alter a form field/i.test(applyStep)
    && /never block or discourage/i.test(applyStep)
    && /Never invent a duration, percentage premium, market rate, entitlement/i.test(applyStep),
  'apply safety boundary is incomplete',
);

check(
  'batch prompt carries Signal 16 and keeps it informational',
  /16\. \*\*Fixed-Term Contract Disclosure\*\*/.test(batch)
    && /Signals 10-16 never change the tier/.test(batch),
  'batch parity or non-scoring wording is missing',
);
check(
  'risk and machine summaries expose the fixed-term result',
  oferta.includes('| Fixed-term contract | Fixed-term disclosure signal in Block G (Signal 16) |')
    && batch.match(/\| Fixed-term contract \|/g)?.length === 2
    && batch.match(/fixed_term: "\{detected \| not_detected \| not_evaluated\}"/g)?.length === 2,
  'human or machine summary field is missing',
);
