#!/usr/bin/env node
/**
 * upskill.mjs — Aggregate skill-gap analyzer for career-ops (#1520, phase 1)
 *
 * Reads the tracker + every linked evaluation report, extracts skill tokens
 * from each report's gaps (Machine Summary hard_stops/soft_gaps + Gap table),
 * removes anything already present in cv.md / config/profile.yml, and emits a
 * weighted, tiered gap map as JSON for the `upskill` mode to narrate.
 *
 * Weighting: each report contributes (5.0 − score) per skill it names — a
 * 2.1/5 report says more about your gaps than a 4.5/5 one. A skill is counted
 * once per report (presence), not once per mention, so one ranty report can't
 * dominate the map.
 *
 * Tiers are fixed, explainable thresholds over the share of low-fit
 * (score < 4.0) reports naming the gap — NOT quantiles, which are noise at
 * the 5–20 report sample sizes this tool sees.
 *
 * Run: node upskill.mjs            (JSON to stdout)
 *      node upskill.mjs --summary  (human-readable table)
 *      node upskill.mjs --min-reports 3
 *      node upskill.mjs --self-test
 */

import { readFileSync, existsSync, statSync, realpathSync, writeFileSync, symlinkSync, rmSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { validateFlags } from './lib/cli-flags.mjs';

import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CAREER_OPS = getCareerOpsRoot();
const APPS_FILE = resolveTrackerPath(CAREER_OPS);
const CV_FILE = join(CAREER_OPS, 'cv.md');
const PROFILE_FILE = join(CAREER_OPS, 'config/profile.yml');

// Canonical reports-root containment. A tracker link resolves to a candidate
// path; accept it only if it stays inside the repo's reports/ directory. Two
// layers: a cheap lexical traversal guard (no stat) rejects a crafted link like
// reports/../../etc/passwd, which join() collapses to a repo-relative path that
// no longer starts with reports/; then realpath canonicalization rejects a
// symlink whose target escapes reports/ (a lexical-only check would follow it).
// realpathSync throws ENOENT/ENOTDIR for a not-yet-created candidate or a
// missing reports root — both are non-fatal: a missing candidate falls through
// to the downstream read (which returns null, preserving prior semantics), a
// missing root means there are simply no reports. Only genuinely unexpected
// errors rethrow, matching readTextIfExists. Identical to the guard in
// analyze-patterns.mjs so both sites behave the same.
function withinReports(candidate) {
  const repoRelative = relative(CAREER_OPS, candidate).split(sep).join('/');
  if (!repoRelative.startsWith('reports/') || repoRelative.includes('..')) return false;
  let realRoot;
  try {
    realRoot = realpathSync(join(CAREER_OPS, 'reports'));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
  let realCandidate;
  try {
    realCandidate = realpathSync(candidate);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return true;
    throw err;
  }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  return realCandidate === realRoot || realCandidate.startsWith(rootWithSep);
}

// Read a file, returning null when it does not exist. A pre-flight existsSync
// costs a full stat per report and races with the read (#2385); attempting the
// read and handling the missing-file error costs the same as a bare read.
function readTextIfExists(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}

// Bump when extraction rules change in a way that would make gap lists from
// older runs non-comparable. The upskill mode's diff-vs-previous section only
// compares reports with the same schema_version, so a regex change can't
// masquerade as "gap closed".
// v2 (2026-08-30): the marketing/GTM vocabulary block in skill-extract.mjs and
// the company-name exclusion below both change WHICH skills a report yields, so
// a v1 gap list and a v2 one are not comparable — a gap "appearing" in v2 may
// simply be a word the v1 vocabulary could not see, and a gap "closing" may be
// an employer name that v1 mistook for a skill.
export const SCHEMA_VERSION = 2;

// Reports below this global score count as "low fit" — the population whose
// gaps matter most. Matches the apply threshold in Ethical Use (CLAUDE.md).
const LOW_FIT_SCORE = 4.0;

// Skill vocabulary + canonical extractor moved to skill-extract.mjs (#1896) so
// upskill, jd-skill-gap, and analyze-patterns share ONE source of truth. Re-
// exported here so existing importers of extractSkills keep working unchanged.
import { extractSkills } from './skill-extract.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
export { extractSkills };

// --- Known-skills text assembly ---
// The known-skills set is built by running extractSkills() over cv.md and
// config/profile.yml. Feeding those files in RAW means every skill named in a
// COMMENT registers as a skill the user has, and is then suppressed from the
// gap map — silently, permanently, and with no way to tell "suppressed because
// known" from "never appeared".
//
// The failure is inverted, which is what makes it nasty: a comment written to
// record that the user does NOT have something is the thing that makes this
// believe they do. Realistic triggers, all ordinary config hygiene:
//
//   # not using Kubernetes anymore, moved to ECS
//   # considering a Snowflake migration in 2027
//   # removed the CISSP line 2026-07-05, was never accurate
//
// Both helpers below are pure and exported for unit testing.

/**
 * Text of a YAML config with comments removed, for skill extraction.
 *
 * Parsing and re-serializing drops comments for free — no regex has to guess
 * whether a `#` is a comment or lives inside a quoted string. Keys are kept
 * alongside values: the reported bug is about comments, and dropping keys
 * would silently narrow what counts as known (`skills: {Python: expert}` puts
 * the skill in key position), which is a different behaviour change than the
 * one being fixed here.
 *
 * An unparseable file falls back to the raw text — the previous behaviour —
 * so a malformed profile degrades to "slightly over-eager" rather than
 * "no known skills at all", which would flood the gap map with false gaps.
 *
 * That fallback re-opens the exact hole this function closes: the raw text
 * still carries its comments, so an unparseable profile can register
 * `# not using Kubernetes anymore` as a known skill again. Degrading is still
 * the right default, but doing it SILENTLY is what made the original bug
 * expensive — "suppressed because known" was indistinguishable from "never
 * appeared". `onParseFailure` lets the caller say so out loud. Omit it and the
 * function stays pure, which is how the self-tests use it.
 *
 * @param {string} raw
 * @param {(err: Error) => void} [onParseFailure]  called before falling back
 * @returns {string}
 */
export function yamlValueText(raw, onParseFailure) {
  if (!raw) return '';
  let doc;
  try {
    doc = yamlLoad(raw);
  } catch (err) {
    if (onParseFailure) onParseFailure(err);
    return raw;
  }
  const out = [];
  // YAML anchors/aliases can produce a genuinely cyclic object graph
  //   root: &a
  //     self: *a
  // which js-yaml resolves into a real JS cycle (doc.root.self === doc.root).
  // An unguarded walk chases that forever and dies with a RangeError, killing
  // the whole run — the parse try/catch above cannot help, because the throw
  // happens here, not in yamlLoad(). The WeakSet also collapses a non-cyclic
  // alias reused in several places, which is harmless: the caller turns this
  // into a Set of skills, so emitting a value once is sufficient.
  const seen = new WeakSet();
  const walk = (node) => {
    if (node == null) return;
    const t = typeof node;
    if (t === 'string' || t === 'number' || t === 'boolean') { out.push(String(node)); return; }
    if (t !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [k, v] of Object.entries(node)) { out.push(String(k)); walk(v); }
  };
  walk(doc);
  return out.join('\n');
}

/**
 * Markdown with HTML comments removed. `cv.md` ships from a template carrying
 * `<!-- ... -->` guidance, and users leave their own notes in the same form.
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripMarkdownComments(raw) {
  return String(raw ?? '').replace(/<!--[\s\S]*?-->/g, '\n');
}

/**
 * The text the known-skills set is extracted from. Single definition so the
 * aggregate and targeted paths cannot drift — the drift class #1896 exists to
 * prevent.
 *
 * @param {string} cvRaw       raw cv.md (or cv-example.md)
 * @param {string} profileRaw  raw config/profile.yml
 * @param {(err: Error) => void} [onProfileParseFailure]  forwarded to yamlValueText
 * @returns {string}
 */
export function knownSkillsText(cvRaw, profileRaw, onProfileParseFailure) {
  return [
    stripMarkdownComments(cvRaw),
    yamlValueText(profileRaw, onProfileParseFailure),
  ].join('\n');
}

/**
 * The one warning for an unparseable profile, shared by both CLI paths so they
 * cannot word it differently or forget it independently.
 *
 * stderr, not stdout: stdout carries the JSON contract that the `upskill` mode
 * and any downstream tooling parse, and a warning line there would break it.
 *
 * @param {Error} err
 */
function warnProfileUnparseable(err) {
  const detail = String(err?.message ?? '').split('\n')[0];
  console.error(
    `upskill: warning — config/profile.yml could not be parsed (${detail}). ` +
    'Falling back to its raw text, so comments in it may still register as ' +
    'known skills and be suppressed from the gap map. Fix the YAML to restore ' +
    'comment-aware extraction.'
  );
}

/**
 * Contents of an OPTIONAL file, or '' when it cannot be read as one.
 *
 * `existsSync(p) ? readFileSync(p) : ''` looks safe and is not: existsSync is
 * true for a DIRECTORY, and reading that path throws EISDIR. Aggregate mode had
 * no try/catch around those reads, so a `cv.md/` directory — or any unreadable
 * path — killed the run instead of degrading to empty input. The targeted path
 * already swallowed read errors, so the two disagreed about the same files.
 *
 * Both now share this one reader. Missing, unreadable, and not-a-file all
 * collapse to '', which is what "optional" is supposed to mean.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function readOptionalText(filePath) {
  try {
    if (!statSync(filePath).isFile()) return '';
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// --- Machine Summary + Gap table parsing ---
// Mirrors analyze-patterns.mjs (duplicated by design, see header comment).
function parseMachineSummary(content) {
  const fenceMatch = content.match(/##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i);
  if (!fenceMatch) return null;
  const raw = fenceMatch[1].trim();
  if (!raw) return null;
  try {
    const parsed = yamlLoad(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return [];
  return [String(value).trim()].filter(Boolean);
}

/**
 * Parse one report file into { score, gapText, hasMachineSummary }.
 * gapText concatenates every gap description (hard stops, soft gaps, Gap
 * table rows) — the haystack the skill tokenizer runs over.
 */
export function parseReportGaps(content) {
  const gapDescriptions = [];
  let score = null;
  let hasMachineSummary = false;

  const summary = parseMachineSummary(content);
  if (summary) {
    hasMachineSummary = true;
    if (typeof summary.score === 'number' && Number.isFinite(summary.score)) score = summary.score;
    gapDescriptions.push(...normalizeList(summary.hard_stops));
    gapDescriptions.push(...normalizeList(summary.soft_gaps));
  }

  const plain = content.replace(/\*\*/g, '');
  if (score === null) {
    const glMatch = plain.match(/\|\s*(?:Global)\s*\|\s*([\d.]+)\/5\s*\|/i);
    if (glMatch) score = parseFloat(glMatch[1]);
  }

  const gapTableMatch = content.match(/\|\s*Gap\s*\|\s*Severity\s*\|.*?\n\|[-|\s]+\n([\s\S]*?)(?:\n\n|\n##|\n\*\*|$)/i);
  if (gapTableMatch) {
    for (const row of gapTableMatch[1].split('\n').filter(r => r.startsWith('|'))) {
      const cols = row.split('|').map(s => s.trim()).filter(Boolean);
      if (cols.length >= 2) gapDescriptions.push(cols[0]);
    }
  }

  return { score, gapText: gapDescriptions.join('\n'), hasMachineSummary };
}

/**
 * Normalized lookup key for a company name. Lowercased and whitespace-collapsed
 * so a tracker cell (`  Snowflake `) matches an extracted skill token
 * (`Snowflake`).
 *
 * @param {string} name
 * @returns {string}
 */
export function companyKey(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Pure aggregation over parsed reports. Exported for self-testing.
 *
 * @param {Array<{num:number|string, score:number|null, gapText:string}>} reports
 * @param {Set<string>} knownSkills — canonical names already in cv/profile
 * @param {Set<string>} [companyNames] — normalized names of companies the user
 *   has evaluated (see companyKey). A skill token that IS one of them is an
 *   employer being cited, not a skill being demanded.
 */
export function aggregateGaps(reports, knownSkills, companyNames = new Set()) {
  const scored = reports.filter(r => Number.isFinite(r.score));
  const lowFit = scored.filter(r => r.score < LOW_FIT_SCORE);
  const totalLowFit = lowFit.length;

  // Accept either an already-normalized set or raw tracker cells.
  const companyLookup = new Set([...companyNames].map(companyKey).filter(Boolean));

  const bySkill = new Map();
  const excludedCounts = new Map();
  const companyCounts = new Map();

  for (const report of reports) {
    const skills = extractSkills(report.gapText);
    for (const skill of skills) {
      if (knownSkills.has(skill)) {
        excludedCounts.set(skill, (excludedCounts.get(skill) || 0) + 1);
        continue;
      }
      // A company from the user's OWN pipeline appearing in gap prose is
      // almost always provenance, not demand — a report logging a recurring
      // gap names the sibling companies where it was logged before ("4th
      // occurrence: <company>, <company>, now here"), and the extractor cannot
      // tell that from a JD asking for the tool of the same name.
      //
      // Checked AFTER known-skills so a company that is also a genuine known
      // skill stays in the bucket that says "you already have this". Counted
      // and reported rather than dropped: this module's own history (see the
      // known-skills header above) is that a silent suppression is
      // indistinguishable from "never appeared", which is what made the
      // original bug expensive.
      if (companyLookup.has(companyKey(skill))) {
        companyCounts.set(skill, (companyCounts.get(skill) || 0) + 1);
        continue;
      }
      if (!bySkill.has(skill)) {
        bySkill.set(skill, { skill, reports: 0, lowFitReports: 0, weightedScore: 0, sources: [] });
      }
      const entry = bySkill.get(skill);
      entry.reports += 1;
      entry.sources.push(report.num);
      const weight = Number.isFinite(report.score) ? Math.max(0, 5.0 - report.score) : 1.0;
      entry.weightedScore += weight;
      if (Number.isFinite(report.score) && report.score < LOW_FIT_SCORE) entry.lowFitReports += 1;
    }
  }

  const gaps = [...bySkill.values()].map(g => {
    const share = totalLowFit > 0 ? g.lowFitReports / totalLowFit : 0;
    // Fixed thresholds — each tier is explainable in one sentence
    // ("named in 4/9 low-fit reports"), which quantiles at N=5–20 are not.
    let tier = 'Low';
    if (share >= 0.5 && g.lowFitReports >= 3) tier = 'Critical';
    else if (share >= 0.3 && g.lowFitReports >= 2) tier = 'High';
    else if (g.lowFitReports >= 2) tier = 'Medium';
    return {
      ...g,
      lowFitShare: Math.round(share * 100) / 100,
      weightedScore: Math.round(g.weightedScore * 100) / 100,
      tier,
    };
  }).sort((a, b) => b.weightedScore - a.weightedScore || b.reports - a.reports);

  const excludedAsKnown = [...excludedCounts.entries()]
    .map(([skill, reports]) => ({ skill, reports }))
    .sort((a, b) => b.reports - a.reports);

  const excludedAsCompanyName = [...companyCounts.entries()]
    .map(([skill, reports]) => ({ skill, reports }))
    .sort((a, b) => b.reports - a.reports);

  return { gaps, excludedAsKnown, excludedAsCompanyName, totalLowFit };
}

/**
 * Targeted-mode gap analysis for a single JD (#1739): which JD skills are gaps
 * vs. already known from the CV/profile.
 *
 * Uses the SAME canonicalization as the aggregate path (extractSkills on both
 * sides, canonical-to-canonical comparison) so a known CV skill is suppressed
 * and a real gap surfaces. The previous inline implementation matched raw
 * lowercased regex tokens with substring `.includes()`, which (a) never matched
 * symbol skills like `c\+\+`/`\.net` and (b) over-suppressed via substrings
 * (`go` ⊂ `mongodb`, `sql` ⊂ `postgresql`, `java` ⊂ `javascript`) — inverting the
 * result on every skill (#1851). Emits canonical names, matching aggregate mode.
 *
 * @param {string} jdText - the target job description text
 * @param {string} knownText - cv + profile text (already-known skills)
 * @returns {{ gaps: string[], excludedAsKnown: string[], knownSkills: string[] }}
 */
export function computeTargetedGaps(jdText, knownText) {
  const known = extractSkills(knownText);
  const gaps = [];
  const excludedAsKnown = [];
  for (const skill of extractSkills(jdText)) {
    (known.has(skill) ? excludedAsKnown : gaps).push(skill);
  }
  return { gaps, excludedAsKnown, knownSkills: [...known].sort() };
}

// --- Main ---
function analyze(minReports) {
  if (!existsSync(APPS_FILE)) {
    return { error: 'No applications tracker found. Run some evaluations first.' };
  }

  const lines = readFileSync(APPS_FILE, 'utf-8').split('\n');
  const colmap = resolveColumns(lines);
  const rows = lines.map(l => parseTrackerRow(l, colmap)).filter(Boolean);

  let reportsLinked = 0;
  let reportsRead = 0;
  let reportsWithMachineSummary = 0;
  const parsedReports = [];
  // Every company the user has evaluated, linked report or not — a row with no
  // report still names an employer that can turn up in someone else's gap prose.
  // '?' is the tracker's locale-invariant marker for an unknown end employer
  // (see AGENTS.md) and names nothing, so it is skipped.
  const companyNames = new Set(
    rows.map(r => companyKey(r.company)).filter(name => name && name !== '?')
  );

  for (const row of rows) {
    const linkMatch = (row.report || '').match(/\]\(([^)]+)\)/);
    if (!linkMatch) continue;
    reportsLinked += 1;
    // Tracker links are normalized relative to the tracker file's directory
    // (see merge-tracker.mjs); resolve against it, with a root-relative fallback.
    // The read is attempted directly instead of probing with existsSync first,
    // which costs a full stat per report and races with the read (#2385).
    const candidates = new Set([join(dirname(APPS_FILE), linkMatch[1]), join(CAREER_OPS, linkMatch[1])]);
    let content = null;
    for (const p of candidates) {
      if (!withinReports(p)) continue;
      content = readTextIfExists(p);
      if (content !== null) break;
    }
    if (content === null) continue;
    reportsRead += 1;
    const { score, gapText, hasMachineSummary } = parseReportGaps(content);
    if (hasMachineSummary) reportsWithMachineSummary += 1;
    const trackerScore = parseFloat(row.score);
    parsedReports.push({
      num: row.num,
      score: Number.isFinite(trackerScore) ? trackerScore : score,
      gapText,
    });
  }

  const scoredCount = parsedReports.filter(r => Number.isFinite(r.score)).length;
  if (scoredCount < minReports) {
    return {
      error: `Not enough data: ${scoredCount}/${minReports} scored reports. Evaluate more offers and come back.`,
      current: scoredCount,
      threshold: minReports,
    };
  }

  const knownText = knownSkillsText(
    readOptionalText(CV_FILE),
    readOptionalText(PROFILE_FILE),
    warnProfileUnparseable,
  );
  const knownSkills = extractSkills(knownText);

  const { gaps, excludedAsKnown, excludedAsCompanyName, totalLowFit } =
    aggregateGaps(parsedReports, knownSkills, companyNames);

  return {
    schema_version: SCHEMA_VERSION,
    metadata: {
      reportsLinked,
      reportsRead,
      reportsWithMachineSummary,
      reportsScored: scoredCount,
      lowFitReports: totalLowFit,
      lowFitScoreThreshold: LOW_FIT_SCORE,
      knownSkillCount: knownSkills.size,
      trackedCompanyCount: companyNames.size,
    },
    gaps,
    excludedAsKnown,
    excludedAsCompanyName,
    knownSkills: [...knownSkills].sort(),
  };
}

function printSummary(result) {
  if (result.error) {
    console.log(`upskill: ${result.error}`);
    return;
  }
  const m = result.metadata;
  console.log(`UPSKILL GAP MAP (schema v${result.schema_version})`);
  console.log(`Reports: ${m.reportsRead}/${m.reportsLinked} read, ${m.reportsScored} scored, ${m.lowFitReports} low-fit (<${m.lowFitScoreThreshold}), ${m.reportsWithMachineSummary} with Machine Summary`);
  console.log('');
  if (result.gaps.length === 0) {
    console.log('No skill gaps detected across your evaluated reports.');
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('TIER', 10)}${pad('SKILL', 22)}${pad('REPORTS', 9)}${pad('LOW-FIT', 9)}WEIGHTED`);
    for (const g of result.gaps) {
      console.log(`${pad(g.tier, 10)}${pad(g.skill, 22)}${pad(g.reports, 9)}${pad(`${g.lowFitReports}/${result.metadata.lowFitReports}`, 9)}${g.weightedScore}`);
    }
  }
  if (result.excludedAsKnown.length > 0) {
    console.log('');
    console.log(`Excluded (already in cv.md/profile): ${result.excludedAsKnown.map(e => e.skill).join(', ')}`);
  }
  // Printed, never silent: if one of these is genuinely a tool the user needs
  // rather than an employer they cited, this line is how they find out.
  if (result.excludedAsCompanyName?.length > 0) {
    console.log('');
    console.log(`Excluded (company in your tracker, not a skill): ${result.excludedAsCompanyName.map(e => e.skill).join(', ')}`);
  }
}

// --- Self-test (pure functions, no filesystem) ---
function runSelfTest() {
  const failures = [];

  // The extractSkills canonicalization/boundary fixtures now live with the
  // module in tests/skill-extract.test.mjs (#1896). upskill's self-test keeps
  // the aggregation/suppression/targeted checks that are upskill's own logic.

  // Over-suppression guard: cv "Java" must NOT swallow a "JavaScript" gap,
  // and cv "AWS" must not swallow GCP/Azure. This is the failure mode the
  // "cv skill never appears as gap" acceptance test cannot see.
  const cvSkills = extractSkills('Expert in Java and AWS.');
  if (cvSkills.has('JavaScript')) failures.push('cv "Java" wrongly matched JavaScript');
  const { gaps: g1 } = aggregateGaps(
    [{ num: 1, score: 2.0, gapText: 'Missing JavaScript and GCP experience' }],
    cvSkills
  );
  const gapNames = g1.map(g => g.skill);
  if (!gapNames.includes('JavaScript')) failures.push('JavaScript gap suppressed by cv "Java"');
  if (!gapNames.includes('GCP')) failures.push('GCP gap suppressed by cv "AWS"');

  // Known-skill exclusion (the acceptance criterion itself)
  const { gaps: g2, excludedAsKnown: ex2 } = aggregateGaps(
    [{ num: 2, score: 3.0, gapText: 'Needs Java and Kubernetes' }],
    extractSkills('Java developer')
  );
  if (g2.some(g => g.skill === 'Java')) failures.push('known skill Java appeared as gap');
  if (!ex2.some(e => e.skill === 'Java')) failures.push('excludedAsKnown missing Java');
  if (!g2.some(g => g.skill === 'Kubernetes')) failures.push('Kubernetes gap missing');

  // Weighting: low score contributes more; presence counted once per report
  const { gaps: g3 } = aggregateGaps(
    [
      { num: 3, score: 2.0, gapText: 'Kubernetes Kubernetes Kubernetes' },
      { num: 4, score: 4.5, gapText: 'Kubernetes' },
    ],
    new Set()
  );
  const k = g3.find(g => g.skill === 'Kubernetes');
  if (!k) failures.push('Kubernetes not aggregated');
  else {
    if (k.reports !== 2) failures.push(`presence not deduped per report (reports=${k.reports})`);
    if (Math.abs(k.weightedScore - 3.5) > 1e-9) failures.push(`weightedScore expected 3.5, got ${k.weightedScore}`);
  }

  // Tiering: 3/5 low-fit reports naming a skill → Critical; 1/5 → Low
  const lowFitReports = [
    { num: 10, score: 2.0, gapText: 'Terraform' },
    { num: 11, score: 2.5, gapText: 'Terraform' },
    { num: 12, score: 3.0, gapText: 'Terraform and Spark' },
    { num: 13, score: 3.5, gapText: 'nothing here' },
    { num: 14, score: 3.9, gapText: 'nothing here' },
  ];
  const { gaps: g4 } = aggregateGaps(lowFitReports, new Set());
  const terraform = g4.find(g => g.skill === 'Terraform');
  const spark = g4.find(g => g.skill === 'Spark');
  if (terraform?.tier !== 'Critical') failures.push(`Terraform tier expected Critical, got ${terraform?.tier}`);
  if (spark?.tier !== 'Low') failures.push(`Spark tier expected Low, got ${spark?.tier}`);

  // parseReportGaps: Machine Summary + Gap table + score fallback
  const parsed = parseReportGaps(`
# 042 - Acme

| Gap | Severity | Mitigation |
|-----|----------|------------|
| No Kafka experience | soft gap | Learn it |

## Machine Summary

\`\`\`yaml
score: 3.2
hard_stops: []
soft_gaps:
  - "Limited Airflow exposure"
\`\`\`
`);
  if (parsed.score !== 3.2) failures.push(`report score expected 3.2, got ${parsed.score}`);
  if (!parsed.hasMachineSummary) failures.push('hasMachineSummary false');
  if (!/Kafka/.test(parsed.gapText)) failures.push('Gap table row not captured');
  if (!/Airflow/.test(parsed.gapText)) failures.push('soft_gaps not captured');

  // Targeted mode (#1851): known-skill suppression must be canonical-to-canonical,
  // never raw-token substring matching. The old inline path inverted every skill —
  // CV skills shown as gaps, real gaps hidden. This is the exact reproduction from
  // the bug report.
  {
    const { gaps, excludedAsKnown } = computeTargetedGaps(
      'Kubernetes, C++, .NET, Java, SQL, Go, LLMs',        // JD asks for
      'k8s, C++, .NET, JavaScript, PostgreSQL, MongoDB, LLMs' // CV already has
    );
    const gapSet = new Set(gaps);
    const exSet = new Set(excludedAsKnown);
    for (const g of ['Java', 'SQL', 'Go']) {
      if (!gapSet.has(g)) failures.push(`targeted: ${g} should be a gap (got ${gaps.join(',')})`);
      if (exSet.has(g)) failures.push(`targeted: real gap ${g} wrongly suppressed as known`);
    }
    for (const k of ['Kubernetes', 'C++', '.NET', 'LLMs']) {
      if (!exSet.has(k)) failures.push(`targeted: ${k} should be excluded as known (got ${excludedAsKnown.join(',')})`);
      if (gapSet.has(k)) failures.push(`targeted: known skill ${k} wrongly reported as gap`);
    }
  }

  // Targeted --url-text path (#1894): the fetched page text must reach
  // computeTargetedGaps as a plain STRING. It used to be run through normalizeJd
  // (which wants the { title, text } DOM object), yielding { text: '' } and then
  // a `text.matchAll is not a function` crash. Guard both halves: a realistic
  // multi-line JD string produces the right gaps, and the source no longer feeds
  // the raw string to normalizeJd.
  {
    const jdText = 'Requirements:\n- Kubernetes and Go\n- 5+ years experience';
    const { gaps } = computeTargetedGaps(jdText, 'Python, AWS'); // must not throw on a string
    if (!gaps.includes('Kubernetes') || !gaps.includes('Go')) {
      failures.push(`url-text: multi-line JD string should yield Kubernetes+Go gaps (got ${gaps.join(',')})`);
    }
    const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf-8');
    if (/normalizeJd\(\s*targetText/.test(selfSrc)) {
      failures.push('url-text: upskill.mjs still passes the raw fetched string to normalizeJd (regression, #1894)');
    }
    if (!/compactText\(targetText\)/.test(selfSrc)) {
      failures.push('url-text: fetched text should be normalized with compactText (string->string), #1894');
    }
  }

  // Reports-root containment: a legit link stays inside reports/, a crafted
  // traversal link escapes root and must be rejected before any read. join()
  // collapses '..' at the call site, so the candidate is already absolute here.
  {
    const legit = join(CAREER_OPS, 'reports', '042-acme-2026-01-01.md');
    if (!withinReports(legit)) failures.push('containment: legit reports/ path wrongly rejected');
    const escape = join(CAREER_OPS, 'reports/../../../etc/passwd');
    if (withinReports(escape)) failures.push('containment: traversal path escaped reports/ (path-traversal guard broken)');
    const sibling = join(CAREER_OPS, 'reports-evil', 'x.md');
    if (withinReports(sibling)) failures.push('containment: reports-prefixed sibling dir wrongly accepted');
  }

  // Symlink-escape + missing-file graceful degradation (#2655). realpath
  // canonicalization must reject a symlink whose target resolves OUTSIDE
  // reports/ (a lexical-only guard would follow it), while a real file inside
  // reports/ still passes and a missing candidate degrades gracefully (the
  // downstream read returns null) rather than throwing.
  {
    const reportsDir = join(CAREER_OPS, 'reports');
    if (existsSync(reportsDir)) {
      const tag = `__co2655-${process.pid}-${Date.now()}`;
      const realReport = join(reportsDir, `${tag}-real.md`);
      const escapeLink = join(reportsDir, `${tag}-escape.md`);
      const missing = join(reportsDir, `${tag}-missing.md`);
      // Missing candidate must not throw and must stay accepted so the
      // downstream read returns null (pre-#2385 existsSync-removal semantics).
      try {
        if (!withinReports(missing)) failures.push('containment: missing report file wrongly rejected (should degrade to a null read, not a hard skip)');
      } catch (err) {
        failures.push(`containment: missing report file threw instead of degrading gracefully (${err.code || err.message})`);
      }
      try {
        writeFileSync(realReport, '# real report\n');
        if (!withinReports(realReport)) failures.push('containment: real file inside reports/ wrongly rejected');
        // Symlink whose target resolves outside reports/ (this module file);
        // its lexical path is under reports/ but realpath escapes and must be
        // rejected. symlinkSync often needs privilege on Windows — skip the
        // assertion (do not fail) when the platform refuses.
        let symlinkCreated = false;
        try {
          symlinkSync(fileURLToPath(import.meta.url), escapeLink);
          symlinkCreated = true;
        } catch (err) {
          if (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'ENOSYS') {
            console.log(`upskill self-test: skipping symlink-escape assertion (platform refused symlink creation: ${err.code})`);
          } else {
            throw err;
          }
        }
        if (symlinkCreated && withinReports(escapeLink)) {
          failures.push('containment: symlink escaping reports/ was accepted (realpath containment broken)');
        }
      } finally {
        rmSync(realReport, { force: true });
        rmSync(escapeLink, { force: true });
      }
    }
  }

  // --- known-skills text: comments must never register as known skills ---
  // A comment recording that the user does NOT have something must not make it
  // count as known and suppress it from the gap map.
  {
    const profile = [
      'candidate:',
      '  full_name: "Test User"',
      '# We dropped Kubernetes last year and never picked up Terraform.',
      'skills:',
      '  - Python',
    ].join('\n');
    const cv = '# CV\n\n<!-- template note: list Snowflake if you have used it -->\n\n## Skills\nSQL, AWS\n';

    const leaked = extractSkills([cv, profile].join('\n'));
    if (!leaked.has('Kubernetes') || !leaked.has('Snowflake')) {
      failures.push('known-skills: fixture no longer reproduces the raw-concat leak — rewrite it, not the fix');
    }

    const fixed = extractSkills(knownSkillsText(cv, profile));
    for (const ghost of ['Kubernetes', 'Terraform', 'Snowflake']) {
      if (fixed.has(ghost)) failures.push(`known-skills: "${ghost}" leaked from a comment`);
    }
    for (const real of ['Python', 'SQL', 'AWS']) {
      if (!fixed.has(real)) failures.push(`known-skills: real skill "${real}" was dropped`);
    }

    // A skill in KEY position stays known — dropping keys would silently narrow
    // what counts as known, a different behaviour change than removing comments.
    if (!extractSkills(yamlValueText('skills:\n  Python: expert\n')).has('Python')) {
      failures.push('known-skills: key-position skill dropped');
    }

    // Parsing beats regex-stripping: a '#' inside a quoted string is not a comment.
    if (!extractSkills(yamlValueText('note: "uses C# daily"\n')).has('C#')) {
      failures.push('known-skills: "#" inside a quoted string was treated as a comment');
    }

    // Unparseable YAML degrades to the raw text (previous behaviour). Returning
    // nothing would empty the known-skills set and flood the map with false gaps.
    if (!yamlValueText('key: [unclosed\n  bad: : :').includes('unclosed')) {
      failures.push('known-skills: unparseable YAML should fall back to raw text');
    }

    // ...but that fallback re-exposes the bug, so it must not be silent. The
    // caller has to be told, or a malformed profile quietly reinstates exactly
    // the suppression this fix removes.
    {
      const badProfile = '# We dropped Kubernetes.\nkey: [unclosed\n  bad: : :';
      let notified = 0;
      const text = yamlValueText(badProfile, () => { notified++; });
      if (notified !== 1) {
        failures.push(`known-skills: unparseable YAML must notify the caller exactly once (got ${notified})`);
      }
      if (!text.includes('unclosed')) {
        failures.push('known-skills: notifying must not change the raw-text fallback');
      }
      // The leak the warning exists to announce — assert it is real, so this
      // test cannot pass because the fixture stopped being malformed.
      if (!extractSkills(text).has('Kubernetes')) {
        failures.push('known-skills: malformed-YAML fixture no longer leaks — rewrite it, not the warning');
      }
      // Valid YAML must stay quiet: a warning on every run is noise, and noise
      // is how a real one gets ignored.
      let spurious = 0;
      yamlValueText('skills:\n  - Python\n', () => { spurious++; });
      if (spurious !== 0) {
        failures.push('known-skills: valid YAML must not emit a parse-failure warning');
      }
      // knownSkillsText must forward the callback — the CLI paths rely on it,
      // and a dropped forward would silently disable both warnings at once.
      let forwarded = 0;
      knownSkillsText('# CV\n', badProfile, () => { forwarded++; });
      if (forwarded !== 1) {
        failures.push(`known-skills: knownSkillsText must forward the parse-failure callback (got ${forwarded})`);
      }
    }

    if (stripMarkdownComments('a <!-- x --> b').includes('x')) {
      failures.push('known-skills: markdown comment not stripped');
    }

    // A YAML alias can produce a genuinely cyclic object. Without a visited-set
    // the walk recurses until the stack dies, taking the whole run with it —
    // and the parse try/catch cannot help, because the throw is in the walk.
    const cyclicYaml = 'root: &a\n  name: Python\n  self: *a\n';
    // Load ONCE and compare within that graph — two separate loads produce two
    // independent object trees, so a cross-load identity check never holds and
    // would assert nothing.
    const cyclicDoc = yamlLoad(cyclicYaml);
    if (cyclicDoc?.root?.self !== cyclicDoc?.root) {
      failures.push('known-skills: cyclic fixture no longer produces a cycle — rewrite it, not the guard');
    }
    try {
      if (!extractSkills(yamlValueText(cyclicYaml)).has('Python')) {
        failures.push('known-skills: cyclic YAML lost a real value');
      }
    } catch (e) {
      failures.push(`known-skills: cyclic YAML alias threw (${e.constructor.name}) instead of terminating`);
    }

    // Optional files: missing, unreadable, and not-a-file must all read as ''.
    if (readOptionalText(join(CAREER_OPS, 'no-such-file-xyz.md')) !== '') {
      failures.push('readOptionalText: a missing file should read as empty');
    }
    if (readOptionalText(CAREER_OPS) !== '') {
      failures.push('readOptionalText: a DIRECTORY should read as empty, not throw EISDIR');
    }
  }

  if (failures.length > 0) {
    console.error(`upskill self-test failed: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('upskill self-test OK (extraction, suppression guards, weighting, tiering, report parsing, known-skills comment handling)');
  process.exit(0);
}

// Helper function to enforce egress guard against SSRF (Private/Loopback IPs)
const dnsCache = new Map();

async function validateUrlSecurity(urlString) {
  const dns = await import('dns/promises');
  const url = new URL(urlString.endsWith('.') ? urlString.slice(0, -1) : urlString);
  const hostname = url.hostname;

  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('Access denied: Localhost or internal domain target detected.');
  }

  let addresses;
  if (dnsCache.has(hostname)) {
    addresses = dnsCache.get(hostname);
  } else {
    addresses = await dns.resolve(hostname).catch(() => []);
    const lookupRes = await dns.lookup(hostname).catch(() => null);
    if (lookupRes) addresses.push(lookupRes.address);
    dnsCache.set(hostname, addresses);
  }

  for (const ip of addresses) {
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(ip)) {
      throw new Error(`Access denied: Egress guard blocked private target IP ${ip}`);
    }
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fd00:')) {
      throw new Error(`Access denied: Egress guard blocked private target IPv6 ${ip}`);
    }
  }
  return url.toString();
}

// --- CLI ---
// Everything below runs ONLY when upskill.mjs is the process entry point.
//
// Without this guard the module tail was unconditional, so `import
// { knownSkillsText } from './upskill.mjs'` re-parsed the IMPORTER's argv and ran
// one of these branches. That made the pure helpers above un-unit-testable despite
// their "exported for unit testing" docblocks — every assertion about them had to
// live inside --self-test.
//
// Under tests/ it also broke the harness, because test-all.mjs imports discovered
// suites IN-PROCESS and they therefore share its argv. Both branches were
// reachable, and both were measured by pinning isMain to true:
//   - ordinary argv → the aggregate branch walked the tracker and every linked
//     report, then dumped a 68-line JSON gap map into the middle of the suite
//     output.
//   - argv containing --self-test → runSelfTest() ran and EXITED. test-all died
//     on the spot with exit 0, no summary line, and every later section silently
//     skipped: a forged green, which is the exact failure its own source guard
//     rejects a discovered suite for.
//
// Same shape as the other CLIs in this repo (add-entry.mjs, detect-reposts.mjs,
// contacts.mjs, check-table-freshness.mjs, ...), and now literally the same code:
// lib/is-main-module.mjs. The hand-rolled comparison this comment used to describe
// accepted a real defect — reached through a SYMLINK the two sides never matched,
// so the CLI printed nothing and exited 0 — on the premise that every caller uses
// the real path. That premise did not hold (#3170): a symlinked checkout, a ~/bin
// shim and macOS's own tmpdir all take it. The helper realpaths both sides.
const isMain = isMainModule(import.meta.url);

// An unrecognized or mistyped flag (e.g. `--min-report` for `--min-reports`)
// used to fall through silently: the aggregate branch just ran with its
// default MIN_REPORTS, reporting a gap map for a threshold nobody asked for.
// Handled via lib/cli-flags.mjs's validateFlags() (#2775), same shape as
// doctor.mjs (#2874) — checked before --self-test/--url-text/--min-reports
// are read, and before --help, so `--help --bogus` still errors.
const KNOWN_FLAGS = ['--min-reports', '--summary', '--url-text', '--self-test', '--help', '-h'];

// Only --min-reports and --url-text take their value as the next argv token.
const VALUE_FLAGS = ['--min-reports', '--url-text'];

const USAGE = `Usage:
  node upskill.mjs                        # aggregate skill-gap map (JSON)
  node upskill.mjs --summary              # human-readable table
  node upskill.mjs --min-reports <n>      # minimum scored reports required (default 5)
  node upskill.mjs --url-text <url|path>  # targeted gap analysis vs one JD (URL or local file)
  node upskill.mjs <url>                  # same as --url-text <url>
  node upskill.mjs --self-test            # run the pure-function self-tests
  node upskill.mjs --help                 # show this message`;

if (isMain) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS });
  if (args.includes('--self-test')) runSelfTest();

  // ====== SECURE TARGETED MODE PHASE 2a IMPLEMENTATION ======
  const urlTextIdx = args.indexOf('--url-text');
  const directUrl = args.find(arg => arg.startsWith('http://') || arg.startsWith('https://'));

  if (urlTextIdx !== -1 || directUrl) {
    (async () => {
      let targetText = '';
      const inputSource = urlTextIdx !== -1 ? args[urlTextIdx + 1] : directUrl;

      if (!inputSource) {
        console.error('Error: Please provide a valid URL or file path after --url-text');
        process.exit(1);
      }

      if (inputSource.startsWith('http://') || inputSource.startsWith('https://')) {
        let browser;
        try {
          const secureUrl = await validateUrlSecurity(inputSource);
          const { chromium } = await import('playwright');
          browser = await chromium.launch({ headless: true });
          const page = await browser.newPage();

          await page.route('**/*', async (route) => {
            const requestUrl = route.request().url();
            try {
              await validateUrlSecurity(requestUrl);
              await route.continue();
            } catch (err) {
              console.error(`Security Violation on Redirect: ${err.message}`);
              await route.abort('blockedbyclient');
              process.exit(1);
            }
          });

          await page.goto(secureUrl, { waitUntil: 'networkidle', timeout: 30000 });
          targetText = await page.innerText('body');
        } catch (err) {
          console.warn('Playwright extraction failed or blocked, trying fallback WebFetch...', err.message);
          try {
            const secureUrl = await validateUrlSecurity(inputSource);
            // validateUrlSecurity only vets the initial URL; a redirect could still
            // steer the fetch at an internal host (SSRF). The Playwright path
            // re-validates per hop, but this plain fetch must refuse redirects
            // outright — fail closed rather than follow an unvetted Location (#1851).
            const res = await fetch(secureUrl, { signal: AbortSignal.timeout(30000), redirect: 'error' });
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            targetText = await res.text();
          } catch (fetchErr) {
            console.error(`Fatal: Failed to fetch JD from URL: ${fetchErr.message}`);
            process.exit(1);
          }
        } finally {
          if (browser) await browser.close();
        }

        // Whitespace-collapse + length-cap the fetched page text. Use compactText
        // (string -> string), NOT normalizeJd: normalizeJd expects the { title,
        // text } DOM-read object and returns { url, title, text }, so feeding it
        // the innerText/fetch STRING silently produced { text: '' } — destroying
        // the JD and then throwing `text.matchAll is not a function` downstream
        // (#1894). compactText is the string-in/string-out helper this wants.
        try {
          const { compactText } = await import('./browser-extract.mjs');
          targetText = compactText(targetText);
        } catch (e) {}
      } else {
        // Same failure class readOptionalText was introduced for, one branch
        // over. `existsSync(p)` is TRUE for a DIRECTORY, so the readFileSync
        // that followed threw EISDIR — and it threw inside this async IIFE,
        // which has no catch and no .catch(), so the process died on an
        // unhandled rejection printing a raw stack trace instead of the message
        // below. An unreadable file (EACCES) failed identically.
        //
        // Reuse the one reader rather than adding a second guarded read: it
        // already collapses missing / not-a-file / unreadable to ''. The
        // difference here is that this input is REQUIRED, so '' is fatal
        // instead of "optional file absent".
        //
        // An empty-but-readable file lands in the same branch deliberately.
        // It used to compute a gap map from an empty JD and exit 0, which
        // reads as "no gaps found" when it means "no input was read".
        targetText = readOptionalText(inputSource);
        if (!targetText.trim()) {
          console.error(`Fatal: Target file is missing, unreadable, or empty: ${inputSource}`);
          process.exit(1);
        }
      }

      // Assemble the known-skills text (cv + profile), matching aggregate mode.
      // Targeted mode additionally falls back to cv-example.md when cv.md is absent
      // so a fresh checkout still produces a meaningful comparison.
      const profileRaw = readOptionalText(PROFILE_FILE);
      let cvRaw = readOptionalText(CV_FILE);
      // Fall back to the shipped example when cv.md is absent OR unreadable, so a
      // fresh checkout still produces a meaningful comparison. Keyed on the read
      // result rather than existsSync: a cv.md that exists but cannot be read is,
      // for this purpose, the same as one that is not there.
      if (!cvRaw) cvRaw = readOptionalText(join(CAREER_OPS, 'cv-example.md'));

      const { gaps: gapList, excludedAsKnown, knownSkills } =
        computeTargetedGaps(
          targetText,
          knownSkillsText(cvRaw, profileRaw, warnProfileUnparseable),
        );

      console.log(JSON.stringify({
        mode: 'targeted',
        source: inputSource,
        gaps: gapList.map(skill => ({ skill })),
        excludedAsKnown: excludedAsKnown.map(skill => ({ skill })),
        knownSkills,
      }, null, 2));

      process.exit(0);
    })().catch((err) => {
      // Terminal handler for the whole branch. The local-file read above is now
      // guarded, and the URL fetch has its own try/catch, but everything after
      // them — knownSkillsText, computeTargetedGaps, the JSON.stringify — runs
      // bare. A throw there would end the process on an unhandled rejection,
      // dumping a raw stack trace instead of the single `Fatal:` line the rest
      // of this branch promises (and that tests/upskill-targeted-input.test.mjs
      // asserts). What this restores is the DIAGNOSTIC, not the status: Node
      // already exits 1 on an unhandled rejection, so the exit code was never
      // the part that was wrong.
      console.error(`Fatal: targeted analysis failed: ${err?.message ?? err}`);
      process.exit(1);
    });
  } else {
    // ====== ORIGINAL AGGREGATE MODE PIPELINE ======
    const minReportsIdx = args.indexOf('--min-reports');
    const MIN_REPORTS = (() => {
      if (minReportsIdx === -1 || args[minReportsIdx + 1] === undefined) return 5;
      const n = parseInt(args[minReportsIdx + 1], 10);
      return Number.isNaN(n) || n < 1 ? 5 : n;
    })();

    const result = analyze(MIN_REPORTS);
    if (args.includes('--summary')) {
      printSummary(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  }
}
