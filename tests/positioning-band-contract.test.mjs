// positioning_band is an optional evaluation contract (RFC #4720): a label that
// sits beside the 1-5 score and never changes it. Prompt prose is the behavior
// under test, so this suite pins the localized clauses that carry the rules,
// and checks that the Machine Summary parser keeps the new fields.
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseMachineSummary } from '../analyze-patterns.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\npositioning band - report and Machine Summary contract (#4720)');

const oferta = readFileSync(join(ROOT, 'modes/oferta.md'), 'utf8').replace(/\r\n/g, '\n');
const batch = readFileSync(join(ROOT, 'batch/batch-prompt.md'), 'utf8').replace(/\r\n/g, '\n');
const check = (ok, message) => (ok ? pass(message) : fail(message));

check(
  (batch.match(/^positioning_band: "\{challenge \| target \| safety_net \| out_of_scope \| unknown\}"$/gm) ?? []).length === 2,
  'positioning_band appears with the full enum in both batch Machine Summary examples',
);

for (const field of ['positioning_band_reason', 'positioning_band_evidence']) {
  check(
    (batch.match(new RegExp(`^${field}:`, 'gm')) ?? []).length === 2,
    `${field} appears in both batch Machine Summary examples`,
  );
}

check(
  ['role_family', 'seniority', 'required_experience', 'scope'].every((k) =>
    batch.split('\n').filter((l) => l === `  ${k}: "{supported | partial | unknown}"`).length === 2),
  'the four evidence inputs appear with supported / partial / unknown in both examples',
);

const rule = batch.split('\n').find((l) => l.startsWith('- `positioning_band` is an optional positioning label')) ?? '';
check(rule.length > 0, 'the positioning_band rule bullet exists in the Machine Summary rules');
check(
  rule.includes('sits **beside** the 1-5 `score` and **never changes it**')
    && rule.includes('never triggers an application, a tracker status, or a score change'),
  'the rule states the band never changes the score, an application or a tracker status',
);
check(
  ['`challenge`', '`target`', '`safety_net`', '`out_of_scope`', '`unknown`'].every((v) => rule.includes(v))
    && rule.includes('an easy role is **not** automatically a safety net'),
  'the rule defines all five values and keeps an easy role from becoming a safety net',
);
check(
  rule.includes('**never classify from the title alone**') && rule.includes('never infer missing experience or scope evidence')
    && rule.includes('never guess'),
  'the rule forbids title-only classification, inferred evidence and guessing',
);
check(
  rule.includes('Thresholds stay profile-defined') && rule.includes('`modes/_profile.md` or `config/profile.yml`'),
  'the rule keeps thresholds in the profile and names the profile inputs',
);
const order = ['(1) target archetype', '(2) required experience', '(3) responsibilities'];
check(
  order.every((s, i) => rule.includes(s) && (i === 0 || rule.indexOf(s) > rule.indexOf(order[i - 1]))),
  'the evidence inputs are listed in the agreed order',
);
check(
  rule.includes('(`role_family`)') && rule.includes('with required versus preferred gaps (`required_experience`)')
    && rule.includes('(`scope`)') && rule.includes('`seniority` records the resulting level band'),
  'each evidence key is tied to its input, and required versus preferred gaps are recorded under required_experience',
);
check(
  batch.includes('- `## Score Evidence`, followed by one line `**Positioning band:**')
    && batch.indexOf('`**Positioning band:**') < batch.indexOf('- `## Extracted Keywords`'),
  'the batch saved-report list places the Positioning band line after Score Evidence',
);

check(
  oferta.includes('After `## Score Evidence`, add one line `**Positioning band:**')
    && oferta.includes('challenge | target | safety_net | out_of_scope | unknown')
    && oferta.includes('never changes it') && oferta.includes('never classify from the title alone'),
  'the interactive mode adds one Positioning band line and defers the schema to batch-prompt.md',
);

const summary = parseMachineSummary([
  '## Machine Summary',
  '```yaml',
  'score: 3.8',
  'confidence: Medium',
  'positioning_band: challenge',
  'positioning_band_reason: "Aligned family, one scope band above the current level, with a stated experience floor gap."',
  'positioning_band_evidence:',
  '  role_family: supported',
  '  seniority: partial',
  '  required_experience: partial',
  '  scope: unknown',
  '```',
].join('\n'));

check(
  summary?.score === 3.8 && summary?.positioning_band === 'challenge'
    && summary?.positioning_band_reason?.startsWith('Aligned family')
    && summary?.positioning_band_evidence?.role_family === 'supported'
    && summary?.positioning_band_evidence?.seniority === 'partial'
    && summary?.positioning_band_evidence?.scope === 'unknown',
  'the downstream parser keeps the band, its reason and its four evidence states without touching the score',
);
