// tests/title-filter-conflicts.test.mjs — a `title_filter` that lists the same
// title as both a positive and a negative can never keep it.
//
// buildTitleFilter() requires `hasPositive && !hasNegative`
// (title-keywords.mjs), so the positive entry looks like a target and is
// silently a no-op. The shipped example warns about this in prose; these
// assertions are what tell a reader whether THEIR list has the problem, and
// they run against the matcher the scanner itself uses rather than a copy.
//
// Asserted against the shipped template wherever the template is the thing
// under test, because that file is what every new install starts from.

import { readFileSync, rmSync, writeFileSync, mkdtempSync } from 'fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, warn, ROOT } from './helpers.mjs';
import { buildTitleFilter } from '../scan.mjs';
import { compileKeyword, foldAccents } from '../title-keywords.mjs';
import { findTitleFilterConflicts, representativeTitle } from '../lib/title-filter-conflicts.mjs';

console.log('\ntitle_filter conflicts — a positive the negatives veto');

// ── the updater ships the module doctor now imports ─────────────────
// doctor.mjs is a SYSTEM_PATHS file, so an upgrade checks out the new doctor
// over an install whose updater has no entry for lib/title-filter-conflicts.mjs
// -- and the install is left with a doctor that cannot load. Same shape as the
// check tests/jd-archive-wiring.test.mjs makes for check-jd-archive.mjs.
const updaterSrc = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
const systemBlock = (updaterSrc.match(/SYSTEM_PATHS\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1];
if (systemBlock.includes("'lib/title-filter-conflicts.mjs'")) {
  pass('lib/title-filter-conflicts.mjs is in SYSTEM_PATHS (shipped + updatable)');
} else {
  fail('lib/title-filter-conflicts.mjs is NOT in SYSTEM_PATHS — an upgraded install would get a doctor that cannot load');
}

// ── the shipped example is coherent ─────────────────────────────────
const cfg = yaml.load(readFileSync(join(ROOT, 'templates/portals.example.yml'), 'utf-8'));
const shipped = findTitleFilterConflicts(cfg.title_filter);
if (shipped.conflicts.length === 0) {
  pass('the shipped example has no positive that its own negatives veto');
} else {
  fail(`shipped example contradicts itself: ${JSON.stringify(shipped.conflicts)}`);
}

// ── the reported case: an internship target against the shipped negatives ──
const negatives = cfg.title_filter?.negative ?? [];
const withInternTarget = findTitleFilterConflicts({
  positive: ['Software Engineer Intern'],
  negative: negatives,
});
if (withInternTarget.conflicts.length === 1
    && withInternTarget.conflicts[0].negative === 'word:intern') {
  pass('an internship positive is reported, and the responsible entry is word:Intern');
} else {
  fail(`expected one conflict naming word:Intern, got ${JSON.stringify(withInternTarget.conflicts)}`);
}

// The acceptance table from the issue, stated directly against the real filter.
const targetFilter = buildTitleFilter({
  positive: [...(cfg.title_filter?.positive ?? []), 'Software Engineer Intern'],
  negative: negatives,
});
for (const [title, want] of [
  ['Software Engineer Intern', false],
  ['Software Engineer Internship', false],
]) {
  const got = targetFilter(title);
  if (got === want) pass(`"${title}" is still vetoed by the shipped negatives`);
  else fail(`"${title}" -> ${got}, expected ${want}`);
}

// ── the negative must not fire on a word that merely contains it ────
// "Internal Tools" is a shipped positive, so a title carrying it is kept only
// if `word:Intern` does NOT match inside "Internal". This is the case
// templates/portals.example.yml's prose calls out, asserted instead of
// described.
const bare = buildTitleFilter({ positive: [...(cfg.title_filter?.positive ?? [])], negative: negatives });
for (const title of ['Internal Tools Engineer', 'Internal Tools Developer']) {
  if (bare(title) === true) pass(`"${title}" is not vetoed (word:Intern does not match inside it)`);
  else fail(`"${title}" was vetoed by word:Intern`);
}
// The negative matcher on its own, without the positive side in the way: a
// title whose only relationship to the keyword is a substring must not match.
const internMatcher = compileKeyword('word:intern');
for (const title of ['internal tools engineer', 'international partnerships manager']) {
  if (!internMatcher(foldAccents(title))) pass(`word:intern does not match "${title}"`);
  else fail(`word:intern matched inside "${title}"`);
}

// ── a deliberate exclusion is left alone: the check only reports ────
// A positive that is intentionally unreachable — kept for a company override,
// say — must not be "fixed" by this module. It reports and nothing else, so the
// user's config object is untouched.
const reportOnly = { positive: ['Software Engineer Intern'], negative: ['word:Intern'] };
const before = JSON.stringify(reportOnly);
findTitleFilterConflicts(reportOnly);
if (JSON.stringify(reportOnly) === before) {
  pass('the check does not mutate the config it is handed');
} else {
  fail('findTitleFilterConflicts mutated its input');
}

// ── an AND-group is put back into one title before it is tested ─────
for (const [entry, want] of [
  ['director + engineering', 'director engineering'],
  ['software engineer intern', 'software engineer intern'],
  ['word:intern', 'intern'],
  ['stem:agent', 'agent'],
]) {
  const got = representativeTitle(entry);
  if (got === want) pass(`representativeTitle("${entry}") -> "${want}"`);
  else fail(`representativeTitle("${entry}") -> "${got}", expected "${want}"`);
}

// ── prefixes and AND-groups keep their real semantics here ──────────
// `word:intern` as a negative must NOT veto an AND-group whose terms only
// contain "intern" inside a longer word segment.
const andGroup = findTitleFilterConflicts({
  positive: ['internal + tools'],
  negative: ['word:intern'],
});
if (andGroup.conflicts.length === 0) {
  pass('an AND-group whose terms are not whole-word matches stays clean');
} else {
  fail(`false conflict on an AND-group: ${JSON.stringify(andGroup.conflicts)}`);
}

// `stem:` as a negative is the half that DOES start a word, so it catches the
// positive that begins with it — the pair is the documented distinction.
const stemPair = findTitleFilterConflicts({
  positive: ['agent'],
  negative: ['stem:agent'],
});
if (stemPair.conflicts.length === 1 && stemPair.conflicts[0].negative === 'stem:agent') {
  pass('stem:agent catches the "agent" positive it begins');
} else {
  fail(`stem: pair not reported: ${JSON.stringify(stemPair.conflicts)}`);
}

// ── a bare `word:` typo is not a "conflict" ────────────────────────
// compilePrefixedKeyword() reads a bare `word:` as "match nothing", which is a
// different problem with its own handling; listing it here would crowd the
// real signal with every typo.
const typo = findTitleFilterConflicts({ positive: ['word:'], negative: ['intern'] });
if (typo.conflicts.length === 0) {
  pass('a bare word: positive is not reported as a conflict');
} else {
  fail(`a typo was reported as a conflict: ${JSON.stringify(typo.conflicts)}`);
}

// ── no lists at all: nothing to say, no crash ──────────────────────
for (const input of [undefined, {}, { positive: [] }, { negative: [] }, { positive: ['a'] }]) {
  const r = findTitleFilterConflicts(input);
  if (r.conflicts.length === 0) pass(`no conflicts for ${JSON.stringify(input)}`);
  else fail(`unexpected conflicts for ${JSON.stringify(input)}: ${JSON.stringify(r.conflicts)}`);
}

// ── two positives against each other: the negative still wins ───────
// The check is per-positive, so a list where one target is reachable and
// another is not reports exactly one conflict rather than zero or two.
const mixed = findTitleFilterConflicts({
  positive: ['Software Engineer Intern', 'Platform Engineer'],
  negative: ['word:Intern'],
});
if (mixed.conflicts.length === 1 && mixed.conflicts[0].positive === 'software engineer intern') {
  pass('only the unreachable positive of a mixed list is reported');
} else {
  fail(`mixed list reported ${JSON.stringify(mixed.conflicts)}`);
}

// ── the verdict is scoped to a title, not to the entry ──────────────
// A bare "intern" positive also matches "Internal Tools Engineer", and
// `word:intern` does not veto that. So a conflict may not claim the entry is
// unreachable everywhere -- it reports the title it actually decided on.
const scoped = findTitleFilterConflicts({
  positive: ['intern', 'Internal Tools'],
  negative: ['word:Intern'],
});
const scopedEntry = scoped.conflicts.find((c) => c.positive === 'intern');
if (scopedEntry && scopedEntry.title === 'intern' && !/never|can never/.test(scopedEntry.reason)) {
  pass('a conflict reports the title it decided on and does not overclaim');
} else {
  fail(`conflict overstated its scope: ${JSON.stringify(scoped.conflicts)}`);
}
// ...and the sibling that IS reachable stays out of the report.
if (!scoped.conflicts.some((c) => c.positive === 'internal tools')) {
  pass('the reachable sibling positive is not reported');
} else {
  fail(`"internal tools" was reported: ${JSON.stringify(scoped.conflicts)}`);
}

// ── an AND-group reports the title it was flattened to ──────────────
const andGroupFlat = findTitleFilterConflicts({
  positive: ['director + engineering'],
  negative: ['word:director'],
});
if (
  andGroupFlat.conflicts.length === 1 &&
  andGroupFlat.conflicts[0].title === 'director engineering'
) {
  pass('an AND-group conflict names the flattened representative title');
} else {
  fail(`AND-group conflict: ${JSON.stringify(andGroupFlat.conflicts)}`);
}

// ── doctor --json surfaces the same verdict ─────────────────────────
// The unit tests above would still all pass if the wiring in doctor.mjs were
// deleted, so drive the real CLI and assert the key it emits. spawnSync keeps
// this honest: it is the doctor a user actually runs, not a re-import.
function doctorOn(dir, { json = true, env = {} } = {}) {
  const args = [join(ROOT, 'doctor.mjs'), '--target', dir];
  if (json) args.push('--json');
  const res = spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_CLI: 'claude', ...env },
  });
  if (res.error) return { error: res.error };
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

// A handful of sandboxes refuse to spawn the running interpreter at all
// (EBUSY/EACCES from execPath). That is an environment limit, not a verdict on
// the code, so it warns loudly instead of reporting a failure that CI -- which
// can always spawn -- would never reproduce.
const SPAWN_BLOCKED = new Set(['EBUSY', 'EACCES', 'EPERM']);
function spawnBlocked(err) {
  return err && SPAWN_BLOCKED.has(err.code);
}

const CONFLICTING = [
  'title_filter:',
  '  positive:',
  '    - Software Engineer Intern',
  '    - Platform Engineer',
  '  negative:',
  '    - word:Intern',
  '',
].join('\n');
const COHERENT = [
  'title_filter:',
  '  positive:',
  '    - Platform Engineer',
  '  negative:',
  '    - word:Intern',
  '',
].join('\n');

const scratch = mkdtempSync(join(tmpdir(), 'co-title-conflicts-'));
try {
  writeFileSync(join(scratch, 'portals.yml'), CONFLICTING);
  const res = doctorOn(scratch);
  if (spawnBlocked(res.error)) {
    warn(`doctor could not be spawned in this environment (${res.error.code}); integration path not exercised here`);
  } else if (res.error) {
    fail(`doctor could not be run: ${res.error.message}`);
  } else if (res.status !== 0) {
    fail(`doctor exited ${res.status}: ${res.stderr}`);
  } else {
    let payload;
    try {
      payload = JSON.parse(res.stdout);
    } catch (err) {
      payload = null;
      fail(`doctor --json did not print JSON: ${err.message}`);
    }
    const reported = payload && payload.titleFilterConflicts;
    if (
      Array.isArray(reported) &&
      reported.length === 1 &&
      reported[0].positive === 'software engineer intern' &&
      reported[0].negative === 'word:intern'
    ) {
      pass('doctor --json reports the conflicting positive the CLI is asked about');
    } else {
      fail(`doctor --json titleFilterConflicts was ${JSON.stringify(reported)}`);
    }
  }

  // A coherent config must omit the key entirely rather than emit [].
  writeFileSync(join(scratch, 'portals.yml'), COHERENT);
  const clean = doctorOn(scratch);
  if (spawnBlocked(clean.error)) {
    warn(`doctor could not be spawned in this environment (${clean.error.code}); clean-config key omission not exercised here`);
  } else if (clean.error || clean.status !== 0) {
    fail(`doctor on a clean config failed: ${clean.error?.message ?? clean.stderr}`);
  } else {
    const payload = JSON.parse(clean.stdout);
    if (!('titleFilterConflicts' in payload)) {
      pass('a clean title_filter omits the key instead of emitting an empty list');
    } else {
      fail(`clean config still emitted titleFilterConflicts: ${JSON.stringify(payload.titleFilterConflicts)}`);
    }
  }

  // The ordinary run must say it too. `--json` alone would leave a user running
  // plain `doctor` with a conflict their config cannot action.
  //
  // Non-blocking is asserted by DIFFERENCE rather than by exit code: this temp
  // root is missing the user-layer prerequisites, so `doctor` exits non-zero
  // whatever we do here. Running the same root twice, changing only the
  // title_filter, isolates the one thing under test -- the conflict must add a
  // warning line and change nothing else about the verdict.
  writeFileSync(join(scratch, 'portals.yml'), COHERENT);
  const humanClean = doctorOn(scratch, { json: false });
  writeFileSync(join(scratch, 'portals.yml'), CONFLICTING);
  const human = doctorOn(scratch, { json: false });
  if (spawnBlocked(human.error) || spawnBlocked(humanClean.error)) {
    warn(`doctor could not be spawned in this environment (${(human.error || humanClean.error).code}); human-readable warning not exercised here`);
  } else if (human.error || humanClean.error) {
    fail(`plain doctor could not be run: ${(human.error || humanClean.error).message}`);
  } else if (!/never keeps a title/.test(human.stdout)) {
    fail('plain doctor did not surface the conflict as a warning');
  } else if (/never keeps a title/.test(humanClean.stdout)) {
    fail('plain doctor warned about a title_filter that is coherent');
  } else if (human.status !== humanClean.status) {
    fail(`the conflict changed the verdict (exit ${humanClean.status} -> ${human.status}); it must be non-blocking`);
  } else {
    pass('plain doctor surfaces the conflict as a non-blocking warning');
  }

  // CAREER_OPS_PORTALS picks the file the scanner reads, so the diagnosis has to
  // follow it rather than always reading root/portals.yml.
  writeFileSync(join(scratch, 'alt.yml'), CONFLICTING);
  writeFileSync(join(scratch, 'portals.yml'), COHERENT);
  const overridden = doctorOn(scratch, { env: { CAREER_OPS_PORTALS: join(scratch, 'alt.yml') } });
  if (spawnBlocked(overridden.error)) {
    warn(`doctor could not be spawned in this environment (${overridden.error.code}); CAREER_OPS_PORTALS override not exercised here`);
  } else if (overridden.error || overridden.status !== 0) {
    fail(`doctor under CAREER_OPS_PORTALS failed: ${overridden.error?.message ?? overridden.stderr}`);
  } else {
    const payload = JSON.parse(overridden.stdout);
    const reported = payload.titleFilterConflicts;
    if (Array.isArray(reported) && reported.length === 1) {
      pass('doctor reads the portals file CAREER_OPS_PORTALS selects');
    } else {
      fail(`override was ignored; titleFilterConflicts was ${JSON.stringify(reported)}`);
    }
  }

  // ...and the inverse: a conflict in the DEFAULT file must not be reported when
  // the override points at a coherent one, or the diagnosis is about a file the
  // scan never opens.
  writeFileSync(join(scratch, 'clean-alt.yml'), COHERENT);
  writeFileSync(join(scratch, 'portals.yml'), CONFLICTING);
  const shadowed = doctorOn(scratch, { env: { CAREER_OPS_PORTALS: join(scratch, 'clean-alt.yml') } });
  if (spawnBlocked(shadowed.error)) {
    warn(`doctor could not be spawned in this environment (${shadowed.error.code}); override shadowing not exercised here`);
  } else if (shadowed.error || shadowed.status !== 0) {
    fail(`doctor under a coherent override failed: ${shadowed.error?.message ?? shadowed.stderr}`);
  } else {
    const payload = JSON.parse(shadowed.stdout);
    if (!('titleFilterConflicts' in payload)) {
      pass('a conflict in the default portals.yml is not reported when the override points elsewhere');
    } else {
      fail(`reported a conflict from the inactive default file: ${JSON.stringify(payload.titleFilterConflicts)}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
}

