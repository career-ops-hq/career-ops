// #2284 — `ats-score` scores the candidate behind the CV, not the CV's
// parseability (that is `ats`/`verify-ats.mjs`, #2064). The checks here pin the
// parts of the mode that are load-bearing for a score: the fairness constraint,
// the MIT notice the rubric is derived under, the contributions lookup that
// drives the heaviest category, and the fixed link-quality table.
//
// The repo-wide `gh api` class check at the bottom is not ats-score specific,
// but it exists because this mode's lookup is the one that broke on it.
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { isUnderNestedCheckout } from '../lib/mjs-files.mjs';

console.log('\nats-score mode (#2284)');

const readMode = (rel) => readFileSync(join(ROOT, rel), 'utf-8');
const atsScoreMode = readMode('modes/ats-score.md');

if (
  /never.{0,10}depend on:.{0,10}name, gender/i.test(atsScoreMode) &&
  /hiring-agent/i.test(atsScoreMode) &&
  /MIT licensed/i.test(atsScoreMode) &&
  /Open Source \(0-35/i.test(atsScoreMode) &&
  /Self Projects \(0-30/i.test(atsScoreMode) &&
  /Production \(0-25/i.test(atsScoreMode) &&
  /Technical Skills \(0-10/i.test(atsScoreMode) &&
  /interview-prep\/ats-score\.md.{0,20}create if missing/i.test(atsScoreMode) &&
  /do not overwrite prior runs/i.test(atsScoreMode)
) {
  pass('ats-score mode includes fairness constraint, HackerRank attribution, all 4 scoring categories, and append-only output rule');
} else {
  fail('ats-score mode missing required elements (fairness constraint, HackerRank attribution, scoring categories, or append-only output rule)');
}

// The calibration note needs the candidate's OWN target archetypes, which live
// in `_profile.md`. `_shared.md`'s archetype table classifies a JD ("Key signals
// in JD") and this mode never reads a JD — and `_shared.md` is not in the
// standalone group SKILL.md loads for `ats-score`, so pointing there names a
// table the mode never has in context and silently drops the calibration.
if (
  /`_profile\.md` carries the candidate's own target archetypes and is already in context/.test(atsScoreMode) &&
  !/_shared\.md/.test(atsScoreMode)
) {
  pass('ats-score calibration note points at _profile.md archetypes (loaded for standalone modes), not the JD-side _shared.md table');
} else {
  fail('ats-score calibration note must cite `_profile.md`\'s archetype table — `_shared.md` is not loaded for standalone modes and its table classifies JDs, not candidates');
}

// The contributions lookup drives the heaviest-weighted category, so it must
// stay on the query-string form (which works), stay public-only (the token can
// otherwise reach private repos a real ATS never sees), and keep excluding
// self-owned PRs from the external count.
const searchQueries = atsScoreMode.match(/search\/issues\?q=[^"'`\s]*/g) ?? [];
const atsScoreLookup = {
  'uses the query-string form, not `-f` (which POSTs and 404s)':
    /gh api "search\/issues\?q=author:\{username\}\+type:pr/.test(atsScoreMode),
  'scopes every contributions search to public results':
    searchQueries.length > 0 && searchQueries.every((q) => q.includes('is:public')),
  'excludes self-owned repos from the external contribution count':
    /is:public\+-user:\{username\}/.test(atsScoreMode),
  'falls back to public events so commit-only contributors are not scored 0':
    /users\/\{username\}\/events\/public/.test(atsScoreMode),
};
const atsScoreLookupMissing = Object.entries(atsScoreLookup).filter(([, ok]) => !ok).map(([k]) => k);
if (atsScoreLookupMissing.length === 0) {
  pass('ats-score contributions lookup is pinned: working query form, public-only, self-owned PRs excluded, commit-only fallback');
} else {
  fail(`ats-score contributions lookup regressed: ${atsScoreLookupMissing.join('; ')}`);
}

// The link-quality adjustment feeds a score, so it has to be a function, not a
// judgement call: four mutually exclusive rows with fixed multipliers. A range
// ("0.5 to 0.7") means identical evidence can produce different totals.
const atsScoreLinkTable = atsScoreMode.slice(
  atsScoreMode.indexOf('**Link penalty'),
  atsScoreMode.indexOf('### Production'),
);
if (
  /\| yes \| yes \| 1\.15 \|/.test(atsScoreLinkTable) &&
  /\| yes \| no \| 0\.80 \|/.test(atsScoreLinkTable) &&
  /\| no \| yes \| 0\.70 \|/.test(atsScoreLinkTable) &&
  /\| no \| no \| 0\.60 \|/.test(atsScoreLinkTable) &&
  !/\d\s*to\s*0?\.\d/.test(atsScoreLinkTable)
) {
  pass('ats-score link-quality table covers all 4 link/demo combinations with fixed multipliers (no ranges)');
} else {
  fail('ats-score link-quality table must cover all 4 link/demo combinations with fixed multipliers, not ranges');
}

// Each project's multiplier has to bite. Handing every project the full 0-30
// band and clamping the sum afterwards lets a second strong project absorb the
// first one's link penalty (two projects at 30 with a 0.80 multiplier give 48,
// which clamps back to 30), so the raw scores are bounded to 30 BEFORE the
// multipliers are applied.
if (
  /bound them before they become points/.test(atsScoreLinkTable) &&
  /scale every one of them by 30 divided by that sum/.test(atsScoreLinkTable) &&
  /apply each project's multiplier to its own bounded score/.test(atsScoreLinkTable) &&
  !/No adjusted project score may exceed 30/.test(atsScoreMode)
) {
  pass('ats-score bounds per-project allocations to 30 before applying multipliers, so a link penalty cannot be absorbed by another project');
} else {
  fail('ats-score must bound the raw per-project scores to 30 BEFORE applying multipliers — clamping the sum afterwards lets one project erase another\'s link penalty');
}

// MIT requires the copyright and permission notice travel with the derived work,
// and the rubric is a close adaptation of hiring-agent's two prompt files.
if (
  /Copyright \(c\) 2025 HackerRank/.test(atsScoreMode) &&
  /Permission is hereby granted, free of charge/.test(atsScoreMode) &&
  /THE SOFTWARE IS PROVIDED "AS IS"/.test(atsScoreMode)
) {
  pass('ats-score carries the full hiring-agent MIT notice, not just a license name-drop');
} else {
  fail('ats-score must carry the full MIT copyright + permission notice for hiring-agent');
}

// #2284 — `gh api` switches from GET to POST the moment a `-f`/`-F` param is
// supplied, and GET-only endpoints (search/issues, search/code) answer POST
// with a 404. A prescribed command that always 404s reads fine in review and
// only breaks when a user actually runs the mode, so pin the shape here.
// Modes only ever READ from the GitHub API, so a bare `-f` is a bug; an
// explicit `-X GET` (or `-X POST`, should a write ever be intended) is fine.
const ghApiFieldRe = /\bgh api\b[^\n`]*/g;
const ghApiPostByAccident = [];
// `{ recursive: true }` descends on Node's side, so there is no per-directory
// decision to guard — a checkout under modes/ is filtered out of the RESULT
// instead, or that other tree's modes get scanned as if they were ours (#3762).
const modeDocs = readdirSync(join(ROOT, 'modes'), { recursive: true })
  .filter((p) => typeof p === 'string' && p.endsWith('.md'))
  .filter((p) => !isUnderNestedCheckout(join(ROOT, 'modes'), p));
for (const f of modeDocs) {
  const rel = `modes/${f.split(/[\\/]/).join('/')}`;
  for (const cmd of readMode(rel).match(ghApiFieldRe) ?? []) {
    const sendsFields = /\s(?:-f|-F|--field|--raw-field)[\s=]/.test(cmd);
    const pinsMethod = /\s(?:-X|--method)\s/.test(cmd);
    if (sendsFields && !pinsMethod) ghApiPostByAccident.push(`${rel}: ${cmd.trim()}`);
  }
}
if (ghApiPostByAccident.length === 0) {
  pass('no mode prescribes a `gh api` call that -f silently turns into a POST (use a query string, or pin -X GET)');
} else {
  fail(`mode(s) prescribe \`gh api\` with -f and no explicit method, which POSTs and 404s on GET-only endpoints: ${ghApiPostByAccident.join(' | ')}`);
}
