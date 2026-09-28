// tests/apply-mode-tailored-cv.test.mjs — the apply mode's two load-bearing
// contracts: which document supplies an experience field, and what has to be
// true before the action that commits a step.
//
// Both failures these cover are silent. A form filled from cv.md contradicts the
// resume stapled to it, and nothing errors. A required control left unset is
// reported by the ATS as a validation error the run has already called filled.
//
// Prose is asserted with whitespace normalized, because modes/apply.md is
// hard-wrapped: a probe that reads correctly in the file can straddle a line
// break and never match. A prose anchor that silently stops matching is the
// worst shape for a check like this, since it passes forever afterwards.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\napply mode: tailored-CV source and the pre-action sweep');

const flat = readFileSync(join(ROOT, 'modes/apply.md'), 'utf-8').replace(/\s+/g, ' ');
const has = (probe) => flat.includes(probe.replace(/\s+/g, ' '));

const ok = (name, condition, why) => (condition ? pass(name) : fail(`${name} — ${why}`));

// ── Step 4b: the tailored CV, resolved without a manifest lookup ────────────
ok('Step 4b exists', has('## Step 4b — Resolve the tailored CV'),
  'the step that decides which document supplies experience fields is gone');

ok('Step 4b resolves the bundle by computing its path',
  has('application-artifacts.mjs --report'),
  'the deterministic resolver is unnamed, so the step has to guess at a location');

ok('Step 4b still knows about the flat-layout manifest', has('data/pdf-index.tsv'),
  'the fallback for an application with no bundle is gone');

// The two negatives. Both strings were in modes/apply.md before the rewrite, so
// neither passes vacuously: an earlier draft resolved the CV through a
// document-kind column data/pdf-index.tsv does not have, and claimed a cover
// letter for one report is a separate row when the writer replaces the row.
ok('Step 4b claims no document-kind column', !has('whose `kind` is `cv`'),
  'generate-pdf.mjs writes no kind column, so that lookup cannot succeed');

ok('Step 4b does not claim a cover letter gets its own manifest row',
  !has('a cover letter for the same report is its own'),
  'updatePDFManifest drops earlier rows for a report, so the cover letter REPLACES the CV row');

ok('the tailored CV outranks cv.md', has('the tailored CV wins'),
  'the precedence rule is what stops the form reading as two resumes spliced together');

ok('Step 6 does not send generation back to cv.md',
  !has('generate response from the report + cv.md'),
  'the pre-fix wording, which routed new answers around the tailored CV');

ok('the field-source table is not the pre-fix pair',
  !has('(`config/profile.yml` / `cv.md`)'),
  'the pre-fix wording, which never mentioned the tailored CV');

// ── The cv.md fallback, stated the same way everywhere ──────────────────────
// Step 4b's own table says cv.md supplies a whole section the tailored CV omits.
// Two other steps consume those sources, and both once said cv.md applies only
// where no tailored CV exists at all. That reading turns a tailored CV that drops
// an education block into evidence the candidate has no degree, which in the
// knock-out pre-scan manufactures a mismatch that is not there.
//
// Asserted as a class rather than per site. Pinning the 2 known sentences would
// leave the next consumer of these sources free to restate the same restriction,
// which is how it got into 2 places to begin with.
ok('the cv.md fallback is never narrowed to "no tailored CV at all"',
  !has('only when no tailored CV exists') && !has('`cv.md` only when there is none'),
  'a consumer of the Step 4b sources contradicts the Step 4b table');

ok('every consumer of the Step 4b sources names its precedence',
  (flat.match(/at the Step 4b precedence/g) || []).length === 2,
  'the knock-out pre-scan and the new-question path must each say which source wins');

ok('the whole-section fallback is still the rule it defers to',
  has('`cv.md` — the fallback, never the default'),
  'the table row the other 2 sites point at');

// ── Step 7b: the pre-action required-field sweep ────────────────────────────
ok('Step 7b exists', has('## Step 7b — Pre-action required-field sweep'),
  'the sweep that catches a required control the run never surveyed is gone');

// The heading alone is not the contract. Pinning only it leaves every
// load-bearing instruction deletable with this suite still green, which is the
// failure the sweep exists to catch, one level up.
for (const [name, probe, why] of [
  ['the inventory', 'List every required control',
    'without it the sweep checks the fields it remembers filling, not the ones the page requires'],
  ['the value readback', 'Read back the current value of each',
    'a filled-looking React field whose value never registered passes otherwise'],
  ['state over value for selections', 'Read state rather than value wherever a control has one',
    'an unchecked checkbox reports value="on" and every radio carries a value, so a non-empty value is not a selection'],
  ['unchecked as a valid answer', 'unchecked is the answer and the field is not missing',
    'without it the sweep treats a deliberate No on a boolean question as an unfilled field'],
  ['the repeat-until-stable pass', 'Repeat 1-4 until the list stops changing',
    'one pass surveys the form as it was, and a fill can create required controls'],
  ['the action gate', 'Click Save, Next or Continue only once a full pass adds no new required control',
    'the inventory is advisory unless something blocks the action on it'],
  ['Submit staying the candidate\'s click', "Submit is the candidate's click, never the agent's",
    'widening the gate to name Submit reads as authorization to click it, which contradicts the prepare-don\'t-submit flow this whole mode is built on'],
  ['the multi-step final Submit', 'Before every Save, Next, Continue, or Submit on a multi-step form',
    'a multi-step form ends in Submit, so a Save/Next/Continue-only clause leaves the one action that cannot be undone unswept'],
  ['the stop-and-ask covering every action', 'stop and ask before Save, Next, Continue, or Submit',
    'a gate that only blocks Save lets an unanswerable required field through on the final Submit'],
]) ok(`Step 7b pins ${name}`, has(probe), why);

// Pinning Step 7b's own wording is not enough. The rule reaches the agent through
// the step summary at the top and through the ATS quirk sections at the bottom,
// and BOTH restated it as Save-and-Submit-only while Step 7b itself named four
// actions. A consumer that narrows the rule it points at is the same defect this
// suite already guards at Step 4b, so it is guarded here as a class.
ok('no consumer narrows the sweep to Save and Submit alone',
  !has('non-empty before Save/Submit') && !has('before Save or Submit'),
  'a summary or quirk line that names only Save and Submit lets Next and Continue commit a step unswept');
