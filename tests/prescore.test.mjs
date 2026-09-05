// tests/prescore.test.mjs — the zero-token heuristic pre-score gate (#3680).
//
// Two halves. The pure scoring functions are imported and exercised directly;
// the CLI paths that cannot be reached any other way (--log, the stderr warning,
// the exit codes, the opt-in flag) run the real binary in a hermetic temp dir
// with CAREER_OPS_ROOT pointed at it, and read back what was actually written.
//
// The properties worth naming, because each is a rule the gate is worthless
// without:
//
//   * UNKNOWN = 4. A signal with no evidence must not push a posting toward a
//     skip. An empty JD therefore scores exactly 4.0.
//   * A SKIP REQUIRES EVIDENCE, and COMP CANNOT VETO. Both are rules on the
//     VERDICT, so they are tested at an absurd --threshold 4.9 where no
//     arithmetic on the default weights could rescue them. The weight
//     inequality (1 - w_comp) * 5 >= DEFAULT_THRESHOLD is asserted as a third,
//     independent check.
//   * OFF BY DEFAULT, IN CODE. Without `pipeline.prescore.enabled: true` every
//     verdict is a proceed, whatever the score.
//   * THE DISCARD LOG IS THREE FIELDS. The interactive format in
//     modes/pipeline.md, which discard-analytics.mjs parses.
//
// All fixture data is fictional.
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, formatRunFailure, rmSync, ROOT, NODE } from './helpers.mjs';
import {
  WEIGHTS,
  DEFAULT_THRESHOLD,
  UNKNOWN_SCORE,
  SIGNAL_PRIORITY,
  GENERIC_TITLE_NOUNS,
  NON_SOFTWARE_TITLE_TERMS,
  prescore,
  detectTitle,
  normalizeRoleTitle,
  foldForCompare,
  configuredThreshold,
  parsePriorityOverrides,
  matchPriorityOverride,
  scoreTitle,
  scoreRequirements,
  scoreDomain,
  scoreComp,
  extractJdComp,
  profileFloor,
  sanitizeField,
  discardLogLine,
  discardReason,
  summaryLine,
  splitOperand,
} from '../prescore.mjs';

console.log('\nprescore.mjs — heuristic pre-score gate');

// ── Fixtures (fictional) ─────────────────────────────────────────────

const ENABLED = { pipeline: { prescore: { enabled: true } } };

const PROFILE = {
  target_roles: {
    primary: ['Senior AI Engineer', 'Staff ML Engineer'],
    archetypes: [
      { name: 'AI/ML Engineer', level: 'Senior/Staff', fit: 'primary' },
      { name: 'Solutions Architect', level: 'Mid-Senior', fit: 'adjacent' },
    ],
  },
  compensation: { target_range: '$150K-200K', currency: 'USD', minimum: '$120K' },
  ...ENABLED,
};

const CV = [
  '# Dana Okoro', '',
  '## Experience',
  'Built FastAPI services and shipped PyTorch models to production on Kubernetes.',
  'Owned the Terraform modules and the Airflow orchestration for the feature store.', '',
  '## Skills',
  'Python, PostgreSQL, Docker, Kubernetes, PyTorch, AWS, Terraform', '',
].join('\n');

const PROFILE_YML_BASE = [
  'target_roles:',
  '  primary:',
  '    - "Senior AI Engineer"',
  '    - "Staff ML Engineer"',
  '  archetypes:',
  '    - name: "AI/ML Engineer"',
  '      level: "Senior/Staff"',
  '      fit: "primary"',
  'compensation:',
  '  currency: "USD"',
  '  minimum: "$120K"',
  '',
].join('\n');
const PROFILE_YML = `${PROFILE_YML_BASE}pipeline:\n  prescore:\n    enabled: true\n`;

const STRONG_JD = [
  '# Northwind Labs', '',
  'Title: Senior AI Engineer, Retrieval', '',
  '## Requirements',
  '- Strong Python and PyTorch experience',
  '- Production Kubernetes and Docker',
  '- Comfortable with PostgreSQL and AWS',
  '- Experience with Terraform', '',
  '## Compensation',
  '$160,000 - $210,000 per year, plus equity.', '',
].join('\n');

const NURSE_JD = [
  '# Cedar Valley Clinic', '',
  'Title: Registered Nurse Practitioner', '',
  '## Requirements',
  '- Active RN license',
  '- BLS and ACLS certification',
  '- Comfortable with Epic charting',
  '- Two years of bedside experience', '',
  '## Compensation',
  '$62,000 - $78,000 per year.', '',
].join('\n');

// Everything the gate can see is perfect except the money: a real posting for a
// role the user wants, at a company underpaying for it.
const LOWBALL_JD = STRONG_JD.replace('$160,000 - $210,000 per year', '$60,000 - $70,000 per year');

// A posting generous with its nice-to-haves. Two must-haves, both covered by the
// CV; six nice-to-haves, none of them. Over the FLAT list that is 2 of 8 (25%,
// score 2); over must-haves only it is 2 of 2.
const PREFERRED_HEAVY_JD = [
  '# Northwind Labs', '',
  'Title: Senior AI Engineer', '',
  '## Requirements',
  '- Python',
  '- Kubernetes', '',
  '## Nice to have',
  '- Rust',
  '- Elixir',
  '- Haskell',
  '- Scala',
  '- Clojure',
  '- Erlang', '',
].join('\n');

// Built to land on raw 2.95, the value that must round UP to 3.0 and proceed:
// title 1 (no overlap), requirements 4 (2 of 4 must-haves), domain 4 (no
// occupation named either way), comp 4 (no figure stated).
//   0.35*1 + 0.35*4 + 0.10*4 + 0.20*4 = 0.35 + 1.40 + 0.40 + 0.80 = 2.95
const ROUNDING_JD = [
  '# Halberd Systems', '',
  'Title: Regional Operations Coordinator', '',
  '## Requirements',
  '- Python and Kubernetes',
  '- Rust and Elixir', '',
].join('\n');

const EUR_JD = STRONG_JD.replace('$160,000 - $210,000 per year', '85.000 - 95.000 EUR per year');

const BRIEF = [
  '# Dana Okoro — Triage Brief', '',
  '## Hard DQ Criteria', '',
  '- Anything requiring an active clinical license', '',
  '## Priority Override List — always return PASS regardless of score',
  'Companies to surface no matter what.',
  '- Cedar Valley Clinic — warm intro from a former colleague',
  '- Northwind Labs — long-standing interest',
  '- {Company name — reason}', '',
  '## Soft Red Flags', '',
  '- Anything else', '',
].join('\n');

const USD_FLOOR = profileFloor(PROFILE);

const eq = (label, actual, expected) => {
  if (Object.is(actual, expected)) pass(label);
  else fail(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const ok = (label, condition, detail = '') => {
  if (condition) pass(label);
  else fail(`${label}${detail ? ` — ${detail}` : ''}`);
};

const deepEq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(label);
  else fail(`${label} — expected ${e}, got ${a}`);
};

// ── 1. Weight invariants ─────────────────────────────────────────────

{
  const sum = WEIGHTS.title + WEIGHTS.requirements + WEIGHTS.domain + WEIGHTS.comp;
  eq('the four signal weights sum to 1.0', Math.round(sum * 100) / 100, 1);

  // With the default weights and threshold, a posting scoring the compensation
  // floor of 1 and a perfect 5 on everything else clears the gate on arithmetic
  // alone. The verdict rules below make it hold at any threshold; this pins the
  // defaults, so raising WEIGHTS.comp to 0.5 turns it red.
  const worstCaseWithPerfectFit = (1 - WEIGHTS.comp) * 5;
  ok(
    'comp can never reject alone: (1 - w_comp) * 5 >= the default threshold',
    worstCaseWithPerfectFit >= DEFAULT_THRESHOLD,
    `(1 - ${WEIGHTS.comp}) * 5 = ${worstCaseWithPerfectFit}, threshold ${DEFAULT_THRESHOLD}`,
  );

  deepEq('the tie-break order is title, requirements, domain, comp', [...SIGNAL_PRIORITY], ['title', 'requirements', 'domain', 'comp']);
}

// ── 2. Strong fit proceeds ───────────────────────────────────────────

{
  const result = prescore({ jdText: STRONG_JD, cvText: CV, profile: PROFILE });
  eq('a strong fit proceeds', result.verdict, 'proceed');
  eq('a matching primary target role scores the title 5', result.signals.title.score, 5);
  eq('full must-have coverage scores 5', result.signals.requirements.score, 5);
  eq('a software occupation noun scores the domain 5', result.signals.domain.score, 5);
  eq('a band above the floor scores comp 5', result.signals.comp.score, 5);
  eq('a perfect posting scores exactly 5.0', result.score, 5);
  eq('a strong fit names no dominant negative', result.dominantNegative, null);
  eq('a strong fit needs no override', result.override, null);
  eq('the summary line of a clean proceed carries no reason', summaryLine(result), 'prescore 5.0/5 proceed');
}

// ── 3. Obvious no skips, and says why ────────────────────────────────

{
  const result = prescore({ jdText: NURSE_JD, cvText: CV, profile: PROFILE });
  eq('an off-profile posting skips', result.verdict, 'skip');
  eq('the title of an off-profile posting scores 1', result.signals.title.score, 1);
  eq('zero must-have coverage scores 1', result.signals.requirements.score, 1);
  eq('a non-software occupation scores the domain 1', result.signals.domain.score, 1);
  eq('a skip carries no override', result.override, null);
  ok(
    'the dominant-negative reason quotes the posting title',
    String(result.dominantNegative?.reason ?? '').includes('Registered Nurse Practitioner'),
    JSON.stringify(result.dominantNegative),
  );
  ok(
    'the summary line is one line naming the verdict and the reason',
    !summaryLine(result).includes('\n') && summaryLine(result).startsWith('prescore 1.0/5 skip: title: '),
    summaryLine(result),
  );

  // TIE-BREAK. title and requirements share a weight, so `title: 1` and
  // `requirements: 1` both lose exactly 0.35 * 4 = 1.4 here, more than domain
  // (0.4) or comp (0.8). Which one is named cannot be left to object key order.
  const titleLoss = result.signals.title.weight * (5 - result.signals.title.score);
  const reqLoss = result.signals.requirements.weight * (5 - result.signals.requirements.score);
  eq('title and requirements lose the same weighted score here', titleLoss, reqLoss);
  eq('and the tie breaks to title, per SIGNAL_PRIORITY', result.dominantNegative?.signal, 'title');
}

// ── 4. Comp never rejects alone ──────────────────────────────────────

{
  const result = prescore({ jdText: LOWBALL_JD, cvText: CV, profile: PROFILE });
  eq('a band below the floor scores comp 1', result.signals.comp.score, 1);
  eq('a strong fit with a lowball band still proceeds', result.verdict, 'proceed');
  eq('and comp is named as the dominant negative', result.dominantNegative?.signal, 'comp');

  // The rule, not the arithmetic: at a threshold no weighting could satisfy, a
  // comp-only negative must STILL proceed.
  const gated = prescore({ jdText: LOWBALL_JD, cvText: CV, profile: PROFILE, threshold: 4.9 });
  ok('the absurd threshold really is above the score', gated.score < 4.9, `scored ${gated.score}`);
  eq('comp-only negative proceeds even at threshold 4.9', gated.verdict, 'proceed');
  eq('and reports the comp-only override', gated.override, 'comp-only');
  eq('with a readable reason', gated.overrideReason, 'comp cannot veto');
}

// ── 5. A skip requires evidence ──────────────────────────────────────

{
  eq('the unknown score is 4', UNKNOWN_SCORE, 4);

  const result = prescore({ jdText: '', cvText: CV, profile: PROFILE });
  eq('an empty JD proceeds', result.verdict, 'proceed');
  eq('an empty JD names no dominant negative', result.dominantNegative, null);
  // Scoring unknowns as a neutral 3 gives 3.0, which still "proceeds" against
  // the 3.0 gate, so the verdict alone cannot catch that mutation.
  eq('four unknown signals total exactly 4.0', result.score, 4);
  for (const name of ['title', 'requirements', 'domain', 'comp']) {
    eq(`the ${name} signal of an empty JD is flagged unknown`, result.signals[name].unknown, true);
  }

  const gated = prescore({ jdText: '', cvText: CV, profile: PROFILE, threshold: 4.9 });
  ok('the absurd threshold really is above the all-unknown score', gated.score < 4.9, `scored ${gated.score}`);
  eq('an all-unknown posting proceeds even at threshold 4.9', gated.verdict, 'proceed');
  eq('and reports the no-evidence override', gated.override, 'no-evidence');
  eq('with the reason the design names', gated.overrideReason, 'no evidence against');
}

// ── 6. Operational fail-open ─────────────────────────────────────────

{
  // profile.yml and cv.md are what "fit" MEANS here. Without either, the gate
  // declines to filter rather than filtering on the half it can still see.
  const noProfile = prescore({ jdText: NURSE_JD, cvText: CV, profile: null });
  eq('a missing profile proceeds even on an off-profile posting', noProfile.verdict, 'proceed');
  eq('and says the gate was not configured', noProfile.override, 'not-configured');
  ok('naming the missing file', String(noProfile.overrideReason).includes('config/profile.yml'), noProfile.overrideReason);
  eq('a missing profile leaves the title unknown', noProfile.signals.title.unknown, true);

  const noCv = prescore({ jdText: NURSE_JD, cvText: '', profile: PROFILE });
  eq('a missing cv.md proceeds too', noCv.verdict, 'proceed');
  ok('naming cv.md', String(noCv.overrideReason).includes('cv.md'), noCv.overrideReason);
  eq('a missing cv.md leaves requirements unknown', noCv.signals.requirements.unknown, true);

  // A signal that throws is contained and reported, never a crash and never a
  // score that argues for a skip.
  const exploding = prescore({
    jdText: STRONG_JD,
    cvText: CV,
    profile: { ...PROFILE, get target_roles() { throw new Error('boom'); } },
  });
  eq('a throwing signal falls back to unknown', exploding.signals.title.unknown, true);
  eq('and the run still proceeds', exploding.verdict, 'proceed');
  ok('and the failure is recorded as a warning', exploding.warnings.length > 0, JSON.stringify(exploding.warnings));
}

// ── 7. Off by default, enforced in code ──────────────────────────────

{
  const { pipeline: _pipeline, ...withoutFlag } = PROFILE;
  const disabled = prescore({ jdText: NURSE_JD, cvText: CV, profile: withoutFlag });
  eq('without pipeline.prescore.enabled an off-profile posting still proceeds', disabled.verdict, 'proceed');
  eq('and is reported as disabled', disabled.override, 'disabled');
  ok('naming the key to set', String(disabled.overrideReason).includes('pipeline.prescore.enabled'), disabled.overrideReason);
  eq('the score is still computed for inspection', disabled.score, 1);
  eq('and so are the signals', disabled.signals.title.score, 1);

  const explicitFalse = prescore({ jdText: NURSE_JD, cvText: CV, profile: { ...withoutFlag, pipeline: { prescore: { enabled: false } } } });
  eq('enabled: false is the same as absent', explicitFalse.override, 'disabled');

  const enabled = prescore({ jdText: NURSE_JD, cvText: CV, profile: { ...withoutFlag, ...ENABLED } });
  eq('enabled: true lets the same posting skip', enabled.verdict, 'skip');
}

// ── 8. Rounding ──────────────────────────────────────────────────────

{
  const result = prescore({ jdText: ROUNDING_JD, cvText: CV, profile: PROFILE });
  deepEq(
    'the rounding fixture really scores 1 / 4 / 4 / 4',
    [result.signals.title.score, result.signals.requirements.score, result.signals.domain.score, result.signals.comp.score],
    [1, 4, 4, 4],
  );
  // 2.95 must round UP to 3.0 and clear the 3.0 gate. Number(raw.toFixed(1))
  // rounds a neighbouring value the other way (3.45 -> 3.4), which is why the
  // rounding is Math.round(raw * 10) / 10.
  eq('raw 2.95 rounds to 3.0', result.score, 3);
  eq('and 3.0 clears the 3.0 gate', result.verdict, 'proceed');
}

// ── 9. Requirements: must-haves only ─────────────────────────────────

{
  const scored = scoreRequirements(PREFERRED_HEAVY_JD, CV);
  eq('coverage is computed over must-haves only', scored.score, 5);
  ok('and the evidence says so', scored.evidence.includes('2 of 2 must-have'), scored.evidence);

  // A bullet that carries its own nice-to-have marker inside a must-have block
  // is a nice-to-have, not four must-haves the CV then fails.
  const inlineNiceToHave = scoreRequirements('# Role\n\n## Requirements\n- Python\n- Nice to have: Rust, Scala, Elixir, Kotlin\n', CV);
  ok('a "Nice to have:" bullet under Requirements does not count as must-haves', inlineNiceToHave.evidence.includes('1 of 1 must-have'), inlineNiceToHave.evidence);

  // A posting that states only nice-to-haves has named no must-have, which is
  // not the same as naming must-haves the CV misses.
  const preferredOnly = scoreRequirements('# Role\n\n## Nice to have\n- Rust\n- Elixir\n', CV);
  eq('a posting with only nice-to-haves leaves requirements unknown', preferredOnly.unknown, true);
  eq('and scores the unknown 4', preferredOnly.score, UNKNOWN_SCORE);

  // The documented fail-open: lowercase bullets extract nothing.
  const lowercase = scoreRequirements('# Role\n\n## Requirements\n- python and kubernetes experience\n', CV);
  eq('lowercase bullets extract nothing and fail open to unknown', lowercase.unknown, true);
}

// ── 10. Priority override list and the company ───────────────────────

{
  const entries = parsePriorityOverrides(BRIEF);
  deepEq('the override list is parsed from the brief', entries, ['Cedar Valley Clinic', 'Northwind Labs']);
  eq('an unedited template placeholder is skipped', entries.includes('{Company name'), false);

  eq('matching is case-insensitive', matchPriorityOverride('cedar valley clinic', entries), 'Cedar Valley Clinic');
  eq('an entry matches inside a longer company name', matchPriorityOverride('Cedar Valley Clinic, Inc.', entries), 'Cedar Valley Clinic');
  eq('but a shorter company does not match a longer entry', matchPriorityOverride('Cedar', entries), null);
  eq('an unlisted company does not match', matchPriorityOverride('Halberd Systems', entries), null);

  // The posting that skips on every other test.
  const overridden = prescore({ jdText: NURSE_JD, cvText: CV, profile: PROFILE, company: 'Cedar Valley Clinic', priorityCompanies: entries });
  eq('a priority-list company proceeds despite a 1.0 score', overridden.verdict, 'proceed');
  eq('and is reported as a priority-list override', overridden.override, 'priority-list');
  eq('the score itself is unchanged', overridden.score, 1);
  eq('the company is echoed back', overridden.company, 'Cedar Valley Clinic');

  const notOverridden = prescore({ jdText: NURSE_JD, cvText: CV, profile: PROFILE, company: 'Halberd Systems', priorityCompanies: entries });
  eq('a company not on the list still skips', notOverridden.verdict, 'skip');

  // modes/pipeline.md hands the company over as a `Company:` line in the JD
  // file rather than on the command line.
  const labelled = prescore({ jdText: `Company: Cedar Valley Clinic\n${NURSE_JD}`, cvText: CV, profile: PROFILE, priorityCompanies: entries });
  eq('a Company: line in the JD reaches the priority list when no company is given', labelled.override, 'priority-list');
  eq('and is echoed back as the company', labelled.company, 'Cedar Valley Clinic');
  const explicitWins = prescore({ jdText: `Company: Cedar Valley Clinic\n${NURSE_JD}`, cvText: CV, profile: PROFILE, company: 'Halberd Systems', priorityCompanies: entries });
  eq('an explicit company wins over the Company: line', explicitWins.company, 'Halberd Systems');
  eq('and so the posting is not overridden', explicitWins.verdict, 'skip');
}

// ── 11. Title detection ──────────────────────────────────────────────

{
  eq('an explicit --title wins', detectTitle('# Acme\n\nTitle: Cook\n', 'Staff ML Engineer'), 'Staff ML Engineer');
  eq('a labelled title line is preferred over the heading', detectTitle('# Acme Corp\n\nRole: Staff ML Engineer\n'), 'Staff ML Engineer');
  eq('a markdown heading is used when nothing is labelled', detectTitle('# Senior AI Engineer\n\nWe are hiring.\n'), 'Senior AI Engineer');
  eq('the first non-empty line is the last resort', detectTitle('\n\nSenior AI Engineer\nWe are hiring.\n'), 'Senior AI Engineer');
  eq('an empty JD yields no title', detectTitle(''), null);
  // A capture whose whitespace was collapsed to one line has no title to
  // detect; returning the posting itself would turn the title signal into a
  // body-text search.
  const blob = 'Northwind Labs Senior AI Engineer Apply now We are hiring a Senior AI Engineer to build retrieval systems Requirements Python Kubernetes';
  eq('a one-line blob yields no title rather than the whole posting', detectTitle(blob), null);
  eq('a labelled title longer than a title is ignored too', detectTitle('Job Title: Senior AI Engineer Apply now Share this job About us we build many things'), null);

  // The shape a scraped capture usually has: the COMPANY as the `# ` heading and
  // the role in a later, unlabelled heading.
  eq('a later role heading beats a leading company heading', detectTitle('# Northwind Labs\n\n## Senior AI Engineer\n\nWe are hiring.\n'), 'Senior AI Engineer');
  eq('a section heading is never mistaken for the title', detectTitle('# Northwind Labs\n\n## About the role\n\n## Staff ML Engineer\n'), 'Staff ML Engineer');
  eq('with no title-shaped heading anywhere the first heading still wins', detectTitle('# Northwind Labs\n\n## Benefits\n\nWe are hiring.\n'), 'Northwind Labs');
  eq('in a plain-text export the role line beats the company line', detectTitle('Northwind Labs\nSenior AI Engineer\nRemote, full time\n'), 'Senior AI Engineer');

  // ROLE_NOUN_RE is English vocabulary, so a non-English role heading passes no
  // check and the company heading would be returned as the title. The known
  // company name is the mitigation that needs no per-language noun list.
  const ruJd = '# ИнтерфейсТех\n\n## Медицинская сестра\n';
  eq('with no company hint a non-English JD falls back to the first heading', detectTitle(ruJd), 'ИнтерфейсТех');
  eq('with the company hint the same JD returns the other heading', detectTitle(ruJd, null, 'ИнтерфейсТех'), 'Медицинская сестра');
  const frJd = '# Lumière Systèmes\n\n## Ingénieur en Apprentissage Automatique\n';
  eq('a French role heading is excluded the same way', detectTitle(frJd, null, 'Lumière Systèmes'), 'Ingénieur en Apprentissage Automatique');
  eq('an English JD with a title-shaped heading ignores the company hint', detectTitle('# Northwind Labs\n\n## Senior AI Engineer\n', null, 'Northwind Labs'), 'Senior AI Engineer');
  eq('when every heading is the company it is still returned', detectTitle('# Acme Corp\n\nWe are hiring.\n', null, 'Acme Corp'), 'Acme Corp');

  // A section or ATS metadata heading is no more likely to be the role than
  // the company heading is.
  const structuralJd = '# Acme Corp\n\n## About the Company\nText.\n\n## Visa Sponsorship\nText.\n\n## Benefits\nText.\n';
  eq('a section heading is skipped in favour of one not known to be structural', detectTitle(structuralJd, null, 'Acme Corp'), 'Visa Sponsorship');
  const metadataJd = '# Acme Corp\n\n## Location\nBerlin.\n\n## Visa Sponsorship\nText.\n\n## Department\nEngineering.\n';
  eq('an ATS metadata heading (Location) is skipped the same way', detectTitle(metadataJd, null, 'Acme Corp'), 'Visa Sponsorship');
  eq('when only metadata headings remain the first non-company one still wins', detectTitle('# Acme Corp\n\n## Location\nBerlin.\n\n## Department\nX.\n', null, 'Acme Corp'), 'Location');
  eq('when every heading is structural the first one is still returned', detectTitle('# About the role\n\n## Benefits\n'), 'About the role');
  // "Location" is also a real job title, so the metadata list is consulted
  // only by the fallback, never by the title-shaped check.
  eq('"Location Manager" as a title-shaped heading is unaffected', detectTitle('# Acme Studios\n\n## Location Manager\n', null, 'Acme Studios'), 'Location Manager');
}

// ── 12. Title normalization and tiers ────────────────────────────────

{
  deepEq('a slash separates tokens', normalizeRoleTitle('AI/ML Engineer').tokens, ['ai', 'ml', 'engineer']);
  deepEq('"machine learning" contracts to ml', normalizeRoleTitle('Machine Learning Engineer').tokens, ['ml', 'engineer']);
  deepEq('"swe" expands to software engineer, both generic', normalizeRoleTitle('Senior SWE').tokens, ['software', 'engineer']);
  deepEq('a hyphen separates and "front end" rejoins', normalizeRoleTitle('Front-End Developer').tokens, ['frontend', 'developer']);
  deepEq('"site reliability" contracts to sre', normalizeRoleTitle('Site Reliability Engineer').tokens, ['sre', 'engineer']);
  deepEq('function words are dropped', normalizeRoleTitle('Head of Data').tokens, ['data']);

  const targets = { primary: PROFILE.target_roles.primary, archetypes: ['AI/ML Engineer', 'Solutions Architect'] };
  eq('a decorated primary title scores 5', scoreTitle('Senior AI Engineer, Retrieval (Remote)', targets).score, 5);
  eq('an archetype name scores 4', scoreTitle('Solutions Architect', targets).score, 4);
  eq('a shared specialty token scores 3', scoreTitle('Senior ML Platform Engineer', targets).score, 3);
  eq('a shared generic token alone scores 1', scoreTitle('Senior Sales Engineer', targets).score, 1);
  eq('a bare generic title does not match a primary by containment', scoreTitle('Engineer', targets).score, 1);
  eq('no target roles leaves the title unknown', scoreTitle('Senior AI Engineer', { primary: [], archetypes: [] }).unknown, true);
  eq(
    'a lowercase "machine learning engineer" matches the AI/ML archetype',
    scoreTitle('machine learning engineer', { primary: ['Senior Data Engineer'], archetypes: ['AI/ML Engineer'] }).score,
    4,
  );

  // GENERIC_TITLE_NOUNS: role-matcher.mjs's BASELINE_TOKENS minus the four
  // family words that are real fit signal.
  deepEq(
    'GENERIC_TITLE_NOUNS is BASELINE_TOKENS minus backend, frontend, platform and product',
    [...GENERIC_TITLE_NOUNS].sort(),
    ['analyst', 'architect', 'consultant', 'designer', 'developer', 'engineer', 'full', 'fullstack', 'manager', 'services', 'software', 'specialist', 'stack', 'systems'],
  );
  const backend = scoreTitle('Backend Developer II', { primary: ['Senior Backend Engineer'], archetypes: [] });
  eq('"Backend Developer" shares a real family word with "Backend Engineer"', backend.score, 3);
  ok('and the evidence names it', backend.evidence.includes('backend'), backend.evidence);
  eq('"Financial Analyst" vs "Data Analyst" shares only the generic suffix: no overlap', scoreTitle('Financial Analyst', { primary: ['Data Analyst'], archetypes: [] }).score, 1);
  eq('"Sales Architect" vs "Solutions Architect": no overlap', scoreTitle('Sales Architect', { primary: ['Solutions Architect'], archetypes: [] }).score, 1);
  eq('"Product Designer" vs "Product Manager" shares real signal on "product"', scoreTitle('Product Designer', { primary: ['Product Manager'], archetypes: [] }).score, 3);
  eq('"SWE" does not share "software" with an unrelated software-titled role', scoreTitle('Senior SWE', { primary: ['Staff Software Architect'], archetypes: [] }).score, 1);

  const companyFirst = prescore({
    jdText: STRONG_JD.replace('Title: Senior AI Engineer, Retrieval', '## Senior AI Engineer, Retrieval'),
    cvText: CV,
    profile: PROFILE,
  });
  eq('an unlabelled company-then-role capture still scores the title 5', companyFirst.signals.title.score, 5);
}

// ── 13. Non-Latin and mixed-script text ──────────────────────────────

{
  const RU_PRIMARY = 'Младший фронтенд-разработчик';
  const RU_NURSE = 'Медицинская сестра';
  const RU_COMPANY = 'ИнтерфейсТех';

  eq('a Latin accent folds onto its base', foldForCompare('Lumière Systèmes'), 'lumiere systemes');
  eq('a stacked Vietnamese accent folds fully', foldForCompare('Kỹ sư phần mềm'), 'ky su phan mem');
  ok('a Cyrillic string folds to non-empty text', foldForCompare(RU_PRIMARY).length > 0, foldForCompare(RU_PRIMARY));
  ok('two different Cyrillic strings fold to different text', foldForCompare(RU_PRIMARY) !== foldForCompare(RU_NURSE));
  eq('whitespace-only folds to empty', foldForCompare('   '), '');

  // Combining marks carry meaning outside Latin script and are not separators.
  eq('a Devanagari phrase survives folding whole', foldForCompare('वरिष्ठ सॉफ्टवेयर इंजीनियर'), 'वरिष्ठ सॉफ्टवेयर इंजीनियर');
  ok('a Devanagari anusvara is kept, so कंपनी and कपनी stay different', foldForCompare('कंपनी') !== foldForCompare('कपनी'));
  ok('a dakuten is kept, so バックエンド and ハックエンド stay different', foldForCompare('バックエンド') !== foldForCompare('ハックエンド'));

  const ruTargets = { primary: [RU_PRIMARY], archetypes: [] };
  eq('an exact Cyrillic title match scores 5', scoreTitle(RU_PRIMARY, ruTargets).score, 5);
  eq('a different Cyrillic title scores 1', scoreTitle(RU_NURSE, ruTargets).score, 1);

  // A shared Latin token inside two different non-Latin titles is partial
  // overlap, never identity.
  ok('mixed-script titles sharing one Latin token fold to different keys', foldForCompare('Врач AI') !== foldForCompare('Инженер AI'));
  eq('and score the partial-overlap tier on the shared token', scoreTitle('Инженер AI', { primary: ['Врач AI'], archetypes: [] }).score, 3);

  eq('a Cyrillic company matches its own priority-list entry', matchPriorityOverride(RU_COMPANY, [RU_COMPANY]), RU_COMPANY);
  eq('and not an unrelated Cyrillic entry', matchPriorityOverride(RU_NURSE, [RU_COMPANY]), null);
  eq('a different mixed-script company sharing only "AI" does not match', matchPriorityOverride('Инженер AI Компани', ['Врач AI Компани']), null);
  eq('detectTitle does not mistake a mixed-script heading sharing "AI" for the company', detectTitle('# Тех AI\n\n## Финанс AI\n', null, 'Тех AI'), 'Финанс AI');

  const overridden = prescore({
    jdText: `# ${RU_COMPANY}\n\n## ${RU_NURSE}\n`, cvText: '# CV\n', profile: { target_roles: { primary: [RU_PRIMARY] }, ...ENABLED },
    company: RU_COMPANY, priorityCompanies: [RU_COMPANY],
  });
  eq('a Cyrillic priority-list company proceeds end to end', overridden.override, 'priority-list');
}

// ── 14. Domain ───────────────────────────────────────────────────────

{
  eq('a software occupation noun scores 5', scoreDomain('Senior AI Engineer, Retrieval').score, 5);
  eq('an engineering title with a healthcare word still scores 5', scoreDomain('Nurse Scheduling Platform Engineer').score, 5);
  eq('a healthcare occupation scores 1', scoreDomain('Registered Nurse Practitioner').score, 1);
  // Qualifiers are not occupations: "software", "security" and "data" in a
  // title do not make it a software job.
  eq('"Software Sales Representative" scores 1', scoreDomain('Software Sales Representative').score, 1);
  eq('"Security Guard" scores 1', scoreDomain('Security Guard').score, 1);
  const clerk = scoreDomain('Data Entry Clerk');
  eq('"Data Entry Clerk" is no evidence either way', clerk.score, UNKNOWN_SCORE);
  eq('and is not flagged unknown', clerk.unknown, false);
  eq('no title is unknown', scoreDomain(null).unknown, true);

  // Every denylist term names a non-software occupation on its own.
  const missed = NON_SOFTWARE_TITLE_TERMS.filter((term) => scoreDomain(`Senior ${term}`).score !== 1);
  deepEq('every NON_SOFTWARE_TITLE_TERMS entry scores 1 as a title', missed, []);
}

// ── 15. Compensation extraction ──────────────────────────────────────

{
  const none = extractJdComp('We offer a competitive package.');
  eq('no figure at all yields an empty annual list', none.annual.length, 0);
  eq('and no non-annual figure', none.nonAnnual, null);

  const ordered = extractJdComp('Signing bonus $5,000. Base $150,000.');
  deepEq('figures come back in document order', ordered.annual.map((f) => f.raw), ['$5,000', '$150,000']);

  for (const [label, text] of [['an hourly rate', '$85 - $95 per hour'], ['a /day rate', 'Contract rate: $800/day'], ['a /wk rate', '$1,200/wk']]) {
    const comp = extractJdComp(text);
    eq(`${label} lands in nonAnnual`, comp.nonAnnual !== null && comp.annual.length === 0, true);
  }

  const cases = [
    ['a US band with symbol', 'Base salary: $160,000 - $210,000 per year.', 160000, 210000, 'USD'],
    ['a EUR band with trailing code and European grouping', 'Wir bieten 85.000 - 95.000 EUR pro Jahr.', 85000, 95000, 'EUR'],
    ['a space-grouped French range with "et"', 'Entre 75 000 EUR et 90 000 EUR par an.', 75000, 90000, 'EUR'],
    ['a French "à" range', '75 000 EUR à 95 000 EUR par an.', 75000, 95000, 'EUR'],
    ['a German "bis" range', 'Gehalt: 80.000 bis 100.000 EUR pro Jahr.', 80000, 100000, 'EUR'],
    ['a plain six-digit figure', '$150000 per year, negotiable.', 150000, 150000, 'USD'],
    ['a single space-grouped figure', 'CTC: 45 000 EUR per year.', 45000, 45000, 'EUR'],
    ['an LPA range', 'CTC 22-28 LPA.', 2200000, 2800000, 'INR'],
    ['a single LPA figure', 'Compensation: 12 LPA, negotiable.', 1200000, 1200000, 'INR'],
    ['a k-suffixed band', 'EUR 80k-100k', 80000, 100000, 'EUR'],
  ];
  for (const [label, text, min, max, currency] of cases) {
    const f = extractJdComp(text).annual[0];
    deepEq(`${label} is read as ${min}-${max} ${currency}`, [f?.min, f?.max, f?.currency], [min, max, currency]);
  }

  const open = extractJdComp('Salary starts at $100k+, depending on experience.').annual[0];
  eq('"$100k+" is an open band', open?.open, true);
  eq('and its raw text keeps the plus', open?.raw, '$100k+');
  eq('a closed band is not open', extractJdComp('$120,000 - $150,000').annual[0]?.open, false);

  // The pathological input for a two-bound pattern is a long digit run that
  // is NOT followed by the keyword, so every split of the run is tried.
  const t0 = performance.now();
  extractJdComp(`${'9'.repeat(20000)} per year, no currency stated`);
  const ms = performance.now() - t0;
  ok('a 20,000-digit run with no LPA after it is scanned in under 50 ms', ms < 50, `${ms.toFixed(1)} ms`);
}

// ── 16. Compensation scoring ─────────────────────────────────────────

{
  const score = (text, floor = USD_FLOOR) => scoreComp(extractJdComp(text), floor);

  eq('the profile floor is parsed from compensation.minimum', USD_FLOOR?.value, 120000);
  eq('a profile with no minimum has no floor', profileFloor({ compensation: {} }), null);
  const noFloor = score('$150,000', null);
  ok('no floor is unknown, saying so', noFloor.unknown && noFloor.evidence.includes('no compensation.minimum'), noFloor.evidence);
  const tbd = scoreComp(extractJdComp('$150,000'), profileFloor({ compensation: { minimum: 'TBD' } }));
  ok('an unreadable minimum is unknown and quoted', tbd.unknown && tbd.evidence.includes('TBD'), tbd.evidence);
  eq('a floor written in LPA is scaled by 100,000', profileFloor({ compensation: { minimum: '18 LPA' } })?.value, 1800000);
  eq('and defaults to INR', profileFloor({ compensation: { minimum: '18 LPA' } })?.currency, 'INR');

  eq('no figure is unknown', score('Competitive package.').unknown, true);
  ok('an hourly rate is unknown, naming it', score('The rate is $85 - $95 per hour.').evidence.includes('non-annual'));
  eq('a band below the floor scores 1', score('$60,000 - $70,000').score, 1);
  eq('a band within 10% of the floor scores 3', score('$118,000 - $126,000').score, 3);
  eq('a band clearing the floor scores 5', score('$160,000 - $210,000').score, 5);

  // Figures that are not the salary.
  const funding = score('We raised $10 million in Series A. Base salary: $180,000 - $220,000 per year.');
  eq('a funding round read at the wrong magnitude is not the band', funding.score, 5);
  ok('and the evidence quotes the salary band', funding.evidence.includes('$180,000 - $220,000'), funding.evidence);
  eq('a signing bonus beside the salary is not the band', score('$5,000 signing bonus. Base pay $155,000.').score, 5);
  const budgetOnly = score('Perks: $2,000 annual learning budget.');
  eq('a learning budget with no salary is unknown', budgetOnly.unknown, true);
  ok('and the evidence names the small figure', budgetOnly.evidence.includes('$2,000'), budgetOnly.evidence);
  const ote = score('$120,000 base, up to $170,000 OTE.', profileFloor({ compensation: { minimum: '$150K' } }));
  eq('the largest comparable figure is the band', ote.score, 5);
  ok('and the evidence quotes it', ote.evidence.includes('$170,000'), ote.evidence);
  eq('a figure in another currency does not compete', score('€2,000 conference budget. Salary $150,000.').score, 5);
  ok('a band entirely in another currency is unknown', score('85.000 - 95.000 EUR').unknown);

  eq('an open band starting above the floor scores 5', score('Base $130k+ plus equity').score, 5);
  const openBelow = score('Salary starts at $100k+');
  eq('an open band starting below the floor is unknown', openBelow.unknown, true);
  ok('with no top to compare', openBelow.evidence.includes('no top'), openBelow.evidence);

  const lpaFloor = profileFloor({ compensation: { minimum: '18 LPA' } });
  eq('a below-floor LPA posting scores 1 against an LPA floor', score('CTC 10-12 LPA.', lpaFloor).score, 1);

  const eur = prescore({ jdText: EUR_JD, cvText: CV, profile: PROFILE });
  eq('a currency mismatch leaves comp unknown end to end', eur.signals.comp.unknown, true);
  eq('and never becomes the dominant negative', eur.dominantNegative, null);
}

// ── 17. Threshold resolution ─────────────────────────────────────────

{
  eq('the default threshold is 3.0', prescore({ jdText: STRONG_JD, cvText: CV, profile: PROFILE }).threshold, DEFAULT_THRESHOLD);
  const raised = prescore({ jdText: NURSE_JD, cvText: CV, profile: PROFILE, threshold: 5 });
  eq('an explicit --threshold is echoed back', raised.threshold, 5);
  eq('raising the threshold keeps an evidence-backed skip a skip', raised.verdict, 'skip');
  const withGate = (gate_threshold) => ({ ...PROFILE, pipeline: { prescore: { enabled: true, gate_threshold } } });
  eq('pipeline.prescore.gate_threshold is honoured', prescore({ jdText: NURSE_JD, cvText: CV, profile: withGate(4.95) }).threshold, 4.95);
  eq('a quoted gate_threshold is parsed', prescore({ jdText: STRONG_JD, cvText: CV, profile: withGate('4.5') }).threshold, 4.5);

  // A score is only ever 0-5, so a configured gate outside that range does not
  // tighten the filter; it repurposes it silently.
  for (const bad of [6, -1, 'aggressive', Infinity, '4.5garbage']) {
    eq(`an out-of-range or malformed gate_threshold (${String(bad)}) falls back to the default`, prescore({ jdText: STRONG_JD, cvText: CV, profile: withGate(bad) }).threshold, DEFAULT_THRESHOLD);
    eq(`configuredThreshold reports ${String(bad)} as invalid`, configuredThreshold(withGate(bad)).valid, false);
  }
  eq('an absent gate_threshold is not an error', configuredThreshold(PROFILE).valid, true);
  eq('an absent gate_threshold yields no value', configuredThreshold(PROFILE).value, null);
  eq('a padded numeric string is accepted', configuredThreshold(withGate(' 3.5 ')).value, 3.5);
}

// ── 18. Operand splitting ────────────────────────────────────────────

{
  eq('a bare dash is the stdin operand', splitOperand(['-', '--summary']).operand, '-');
  eq('-h is a flag, not a file name', splitOperand(['-h']).operand, null);
  eq('a value flag does not donate its value as the operand', splitOperand(['--title', 'Staff ML Engineer', 'jd.md']).operand, 'jd.md');
  eq('--company does not donate its value either', splitOperand(['--company', 'Northwind Labs', 'jd.md']).operand, 'jd.md');
  eq('the =form keeps the operand', splitOperand(['--title=Staff ML Engineer', 'jd.md']).operand, 'jd.md');
}

// ── 19. Discard-log line shape and sanitization ──────────────────────

{
  const line = discardLogLine('2026-01-02T03:04:05.000Z', 'https://example.invalid/1', 'pre-score 1.0/5: title: no overlap');
  eq('a discard row ends in a newline', line.endsWith('\n'), true);
  eq('a discard row has exactly three tab-separated fields', line.trimEnd().split('\t').length, 3);
  eq('a missing URL becomes the sentinel dash', discardLogLine('T', null, 'r').split('\t')[1], '-');
  // One tab in a scraped title would turn a three-field row into the
  // four-field batch shape, whose columns discard-analytics.mjs assigns
  // differently.
  eq('a tab inside the reason is flattened so the row stays three fields', discardLogLine('T', 'u', 'a\tb\nc').trimEnd().split('\t').length, 3);
  eq('a tab inside the URL is flattened too', discardLogLine('T', 'https://x.invalid/a\tb', 'r').trimEnd().split('\t').length, 3);
  eq('sanitizeField collapses tabs, CR and LF to single spaces', sanitizeField('a\tb\r\nc   d'), 'a b c d');
  eq('sanitizeField turns an em dash into a hyphen', sanitizeField('Engineer — Backend'), 'Engineer - Backend');
  eq('and an en dash too', sanitizeField('9–13 years'), '9-13 years');

  const skipped = prescore({ jdText: NURSE_JD, cvText: CV, profile: PROFILE });
  ok('the log reason names the pass that produced it', discardReason(skipped).startsWith('pre-score 1.0/5: title: '), discardReason(skipped));

  // Evidence strings interpolate untrusted JD text, so the "no em-dashes"
  // promise has to survive a title that carries one.
  const dashy = prescore({ jdText: '# Acme\n\n## Senior Engineer — Platform Reliability\n', cvText: '# CV\n', profile: { target_roles: { primary: ['Registered Nurse'] }, ...ENABLED } });
  ok('a title with an em dash reaches the summary line hyphenated', summaryLine(dashy).includes('Senior Engineer - Platform Reliability') && !summaryLine(dashy).includes('—'), summaryLine(dashy));
  ok('and the discard reason too', !discardReason(dashy).includes('—'), discardReason(dashy));
}

// ── 20. CLI ──────────────────────────────────────────────────────────

{
  const dir = mkdtempSync(join(tmpdir(), 'co-prescore-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    mkdirSync(join(dir, 'modes'), { recursive: true });
    writeFileSync(join(dir, 'cv.md'), CV);
    writeFileSync(join(dir, 'config', 'profile.yml'), PROFILE_YML);
    writeFileSync(join(dir, 'modes', '_brief.md'), BRIEF);
    writeFileSync(join(dir, 'skip.md'), NURSE_JD);
    writeFileSync(join(dir, 'proceed.md'), STRONG_JD);
    writeFileSync(join(dir, 'labelled.md'), `Title: Registered Nurse Practitioner\nCompany: Cedar Valley Clinic\n\n${NURSE_JD.replace('Title: Registered Nurse Practitioner\n', '')}`);
    writeFileSync(join(dir, 'url-labelled.md'), `URL: https://halberd.example/jobs/3\n${NURSE_JD}`);

    const logPath = join(dir, 'data', 'discard.log');
    const rows = () => (existsSync(logPath) ? readFileSync(logPath, 'utf-8').split('\n').filter(Boolean) : []);
    const cli = (...args) => run(NODE, [join(ROOT, 'prescore.mjs'), ...args], { cwd: dir, env: { ...process.env, CAREER_OPS_ROOT: dir } });

    // A proceed verdict must leave no trace, even with --log asked for.
    const proceedOut = cli('proceed.md', '--url', 'https://northwind.example/jobs/1', '--summary', '--log');
    if (proceedOut === null) fail(`prescore.mjs on a proceeding JD failed${formatRunFailure()}`);
    else {
      ok('the CLI reports proceed for a strong fit', proceedOut.startsWith('prescore 5.0/5 proceed'), proceedOut);
      eq('a proceed verdict writes no discard row', existsSync(logPath), false);
    }

    const skipOut = cli('skip.md', '--url', 'https://cedar.example/jobs/9', '--summary', '--log');
    if (skipOut === null) fail(`prescore.mjs on a skipping JD failed${formatRunFailure()}`);
    else {
      ok('the CLI reports skip for an off-profile posting', skipOut.includes('skip: title: '), skipOut);
      eq('a skip verdict writes exactly one discard row', rows().length, 1);
      const fields = (rows()[0] ?? '').split('\t');
      eq('the discard row is three tab-separated fields', fields.length, 3);
      ok('field 1 is an ISO 8601 timestamp', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(fields[0]), fields[0]);
      eq('field 2 is the posting URL', fields[1], 'https://cedar.example/jobs/9');
      ok('field 3 is self-describing so the pass is identifiable', /^pre-score 1\.0\/5: title: /.test(fields[2] ?? ''), fields[2]);
    }

    const noUrlOut = cli('skip.md', '--summary', '--log');
    if (noUrlOut === null) fail(`prescore.mjs without --url failed${formatRunFailure()}`);
    else {
      eq('a second skip appends rather than overwrites', rows().length, 2);
      eq('a skip with no --url logs the sentinel dash', rows()[1]?.split('\t')[1], '-');
    }

    // --company reaches the priority list in modes/_brief.md, and an override
    // writes NO discard row: the posting was not filtered.
    const overrideOut = cli('skip.md', '--company', 'Cedar Valley Clinic', '--url', 'https://cedar.example/jobs/9', '--summary', '--log');
    if (overrideOut === null) fail(`prescore.mjs --company failed${formatRunFailure()}`);
    else {
      ok('a priority-list company proceeds from the CLI', overrideOut.includes('proceed (priority list'), overrideOut);
      eq('and a priority override writes no discard row', rows().length, 2);
    }

    // The same through the Company: line modes/pipeline.md prepends to the file.
    const labelledOut = cli('labelled.md', '--summary', '--log');
    if (labelledOut === null) fail(`prescore.mjs on a labelled JD failed${formatRunFailure()}`);
    else {
      ok('a Company: line in the file reaches the priority list', labelledOut.includes('proceed (priority list'), labelledOut);
      eq('and writes no discard row either', rows().length, 2);
    }

    // And the URL: line, so the documented command carries no external text.
    const urlOut = cli('url-labelled.md', '--summary', '--log');
    if (urlOut === null) fail(`prescore.mjs on a URL-labelled JD failed${formatRunFailure()}`);
    else {
      eq('a URL: line in the file is logged as the posting URL', rows()[2]?.split('\t')[1], 'https://halberd.example/jobs/3');
    }
    const urlFlagOut = cli('url-labelled.md', '--url', 'https://halberd.example/jobs/4', '--summary', '--log');
    if (urlFlagOut === null) fail(`prescore.mjs --url over a URL: line failed${formatRunFailure()}`);
    else eq('an explicit --url wins over the URL: line', rows()[3]?.split('\t')[1], 'https://halberd.example/jobs/4');

    // --threshold reaches the CLI. Lowered rather than raised: raising it above
    // a clean posting's score cannot flip the verdict, because that posting has
    // no signal with evidence against it and rule 1 proceeds regardless.
    const gatedOut = cli('skip.md', '--summary', '--threshold', '0');
    const rowsBeforeGate = rows().length;
    if (gatedOut === null) fail(`prescore.mjs --threshold failed${formatRunFailure()}`);
    else ok('--threshold reaches the CLI and flips the verdict', gatedOut.includes('proceed'), gatedOut);

    const jsonOut = cli('skip.md');
    if (jsonOut === null) fail(`prescore.mjs exited non-zero on a skip verdict${formatRunFailure()}`);
    else {
      try {
        const parsed = JSON.parse(jsonOut);
        eq('the JSON branch reports the verdict', parsed.verdict, 'skip');
        eq('the JSON branch reports discardLogged', parsed.discardLogged, false);
        for (const key of ['score', 'threshold', 'verdict', 'signals', 'dominantNegative', 'override', 'overrideReason', 'warnings', 'discardLogged']) {
          ok(`the JSON payload carries "${key}"`, key in parsed);
        }
      } catch {
        fail(`prescore.mjs JSON output was not parseable: ${jsonOut.slice(0, 200)}`);
      }
    }

    // Opt-in enforced by the binary: without the key, --log writes nothing.
    writeFileSync(join(dir, 'config', 'profile.yml'), PROFILE_YML_BASE);
    const disabledOut = cli('skip.md', '--url', 'https://cedar.example/jobs/9', '--summary', '--log');
    if (disabledOut === null) fail(`prescore.mjs with the gate disabled failed${formatRunFailure()}`);
    else {
      ok('a profile.yml without pipeline.prescore.enabled reports the gate as disabled', disabledOut.startsWith('prescore 1.0/5 proceed (gate disabled'), disabledOut);
      eq('and a disabled gate writes no discard row even with --log', rows().length, rowsBeforeGate);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 21. CLI fail-open and exit codes ─────────────────────────────────

{
  const dir = mkdtempSync(join(tmpdir(), 'co-prescore-badcfg-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'cv.md'), CV);
    writeFileSync(join(dir, 'jd.md'), NURSE_JD);

    const spawn = (args, cwd = dir) => spawnSync(NODE, [join(ROOT, 'prescore.mjs'), ...args], {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: cwd },
    });

    // Malformed YAML. spawnSync rather than run(): the warning goes to stderr,
    // which run() only surfaces when the child fails, and this child exits 0.
    writeFileSync(join(dir, 'config', 'profile.yml'), 'target_roles: [unclosed\n  primary: "x"\n');
    const broken = spawn(['jd.md', '--summary']);
    eq('a malformed profile.yml still exits 0', broken.status, 0);
    ok('and proceeds', String(broken.stdout).includes('proceed'), String(broken.stdout));
    ok('and warns once on stderr', String(broken.stderr).trim().split('\n').length === 1, JSON.stringify(broken.stderr));
    ok('naming the file', String(broken.stderr).includes('config/profile.yml'), String(broken.stderr));

    // YAML that parses cleanly but to the wrong SHAPE. A list satisfies
    // `typeof === 'object'`, so without an Array check it would read as a
    // configured profile.
    writeFileSync(join(dir, 'config', 'profile.yml'), '- Senior AI Engineer\n- Staff ML Engineer\n');
    const listProfile = spawn(['jd.md', '--summary']);
    eq('a list-valued profile.yml still exits 0', listProfile.status, 0);
    ok('and proceeds rather than filtering on a profile that names nothing', String(listProfile.stdout).includes('proceed (no usable config/profile.yml'), String(listProfile.stdout));
    ok('and warns that it did not parse to a mapping', String(listProfile.stderr).includes('mapping'), String(listProfile.stderr));

    // Out-of-range configured gate: announced, not applied.
    writeFileSync(join(dir, 'config', 'profile.yml'), `${PROFILE_YML_BASE}pipeline:\n  prescore:\n    enabled: true\n    gate_threshold: 6\n`);
    const badGate = spawn(['jd.md', '--summary']);
    eq('an out-of-range configured gate still exits 0', badGate.status, 0);
    ok(
      'an out-of-range configured gate is announced on stderr',
      String(badGate.stderr).includes('gate_threshold') && String(badGate.stderr).includes(String(DEFAULT_THRESHOLD)),
      JSON.stringify(badGate.stderr),
    );

    eq('an unknown flag is a usage error (exit 1)', spawn(['jd.md', '--bogus']).status, 1);
    eq('a malformed --threshold is a usage error (exit 1)', spawn(['jd.md', '--threshold', 'high']).status, 1);
    eq('an unreadable JD exits 2', spawn(['no-such-file.md', '--summary']).status, 2);

    // Log-append failure: exit 3, and the JSON still reports discardLogged
    // false. data/ is made a FILE so the mkdir and the append cannot succeed.
    const blocked = mkdtempSync(join(tmpdir(), 'co-prescore-blocked-'));
    try {
      mkdirSync(join(blocked, 'config'), { recursive: true });
      writeFileSync(join(blocked, 'cv.md'), CV);
      writeFileSync(join(blocked, 'config', 'profile.yml'), PROFILE_YML);
      writeFileSync(join(blocked, 'jd.md'), NURSE_JD);
      writeFileSync(join(blocked, 'data'), 'not a directory\n');

      const r = spawn(['jd.md', '--log'], blocked);
      eq('a skip that cannot be logged exits 3', r.status, 3);
      ok('and says the posting must be treated as PROCEED', String(r.stderr).includes('PROCEED'), String(r.stderr));
      try {
        const parsed = JSON.parse(String(r.stdout));
        eq('and the payload still reports discardLogged false', parsed.discardLogged, false);
        eq('while the verdict itself is unchanged', parsed.verdict, 'skip');
      } catch {
        fail(`prescore.mjs exit-3 stdout was not parseable JSON: ${String(r.stdout).slice(0, 200)}`);
      }
    } finally {
      rmSync(blocked, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
