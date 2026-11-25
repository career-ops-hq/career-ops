#!/usr/bin/env node
/**
 * evidence-freshness.mjs — is the GitHub evidence behind an evaluation stale?
 *
 * `oferta`, `auto-pipeline` and batch workers score a JD against cv.md,
 * article-digest.md and the profile. GitHub activity reaches those files only
 * when the user runs `expand`, whose optional step (github-evidence.mjs) writes
 * output/github-evidence-{YYYY-MM-DD}.{md,json}. Nothing said how old that scan
 * was, so PRs merged after it were silently missing from the fit and a score
 * could understate it with no warning.
 *
 * Opt-in: off unless config/profile.yml sets evidence_freshness.enabled: true,
 * so nobody gets a GitHub call they did not ask for. Interactive evaluations run
 * it once before Block A; batch-runner.sh runs it once per batch run and hands
 * the result to every worker. When on, it reports:
 *   - the newest output/github-evidence-*.json and how many days old it is
 *   - how many PRs the user authored and merged since then in repos they do not
 *     own (owning a repo is not authorship, so github-evidence.mjs never counts
 *     those either), from ONE metadata-only `gh search prs` call through the
 *     user's existing gh auth (no new token, no repo names or titles kept)
 *   - a stale verdict against thresholds in config/profile.yml
 *
 * Read-only and never blocking: it writes nothing, never runs expand or
 * github-evidence.mjs, and exits 0 with JSON on stdout whatever happens. When
 * candidate.github is unset, gh is missing or logged out, or the query fails,
 * the status says so and `stale` is false.
 *
 * Config (config/profile.yml, all optional):
 *   evidence_freshness:
 *     enabled: true            # off unless set to true
 *     min_new_merged_prs: 5    # stale at this many merged PRs since the last scan
 *     max_age_days: 30         # stale when the last scan is older than this
 * With no scan on record, the evidence is stale as soon as the user has one
 * merged PR in someone else's repo.
 *
 * Usage:
 *   node evidence-freshness.mjs   # JSON on stdout, always exit 0
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, getProfilePath, hasProfileOverride } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { normalizeGithubUser } from './github-evidence.mjs';

const KNOWN_FLAGS = ['--help', '-h'];
const USAGE = `Usage:
  node evidence-freshness.mjs   # JSON on stdout, always exit 0

Says whether the newest output/github-evidence-*.json is stale: its age, and
the PRs you authored and merged since then in repos you do not own (one
metadata-only gh search through your existing gh auth). Read-only.
Opt-in: set config/profile.yml -> evidence_freshness.enabled: true.`;

export const DEFAULTS = Object.freeze({ enabled: false, minNewMergedPrs: 5, maxAgeDays: 30 });

/** One search page: the count is exact below this and shown as "100+" at it. */
export const QUERY_LIMIT = 100;

const SCAN_FILE_RE = /^github-evidence-(\d{4})-(\d{2})-(\d{2})\.json$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `evidence_freshness` from config/profile.yml, with the defaults filled in.
 * The check is on only when `enabled` is exactly true. A threshold that is not a
 * whole number of at least 1 keeps its default and is reported, so a typo never
 * switches a rule off.
 *
 * @param {object|null} profile - Parsed config/profile.yml.
 * @returns {{thresholds: {enabled: boolean, minNewMergedPrs: number, maxAgeDays: number}, warnings: string[]}}
 */
export function readThresholds(profile) {
  const thresholds = { ...DEFAULTS };
  const warnings = [];
  const raw = profile?.evidence_freshness;
  if (raw == null) return { thresholds, warnings };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('evidence_freshness is not a map; using the defaults');
    return { thresholds, warnings };
  }
  if (raw.enabled === true) thresholds.enabled = true;
  else if (raw.enabled != null && raw.enabled !== false) warnings.push('evidence_freshness.enabled is not true or false; the check stays off');
  for (const [key, prop] of [['min_new_merged_prs', 'minNewMergedPrs'], ['max_age_days', 'maxAgeDays']]) {
    if (raw[key] == null) continue;
    if (Number.isInteger(raw[key]) && raw[key] >= 1) thresholds[prop] = raw[key];
    else warnings.push(`evidence_freshness.${key} must be a whole number of at least 1; using ${DEFAULTS[prop]}`);
  }
  return { thresholds, warnings };
}

/**
 * The newest github-evidence scan for this user, or null when there is none.
 *
 * Files are taken newest date first. One that does not parse as a JSON object,
 * or that records a different `user`, is skipped: it is not a scan of this
 * account. `since` is the lower bound for "merged after the scan": the file's
 * modification time when it falls on the file's own date (the time the scan was
 * written), otherwise the start of that local day, so PRs merged earlier on the
 * scan day are not counted as new right after a scan.
 *
 * @param {string} dataRoot
 * @param {string} user - Normalized GitHub username.
 * @returns {{date: string, file: string, since: string}|null}
 */
export function findLatestScan(dataRoot, user) {
  const dir = join(dataRoot, 'output');
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .map((name) => ({ name, m: name.match(SCAN_FILE_RE) }))
    .filter(({ m }) => m && isCalendarDate(+m[1], +m[2], +m[3]))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const { name, m } of candidates) {
    const path = join(dir, name);
    let doc;
    try {
      doc = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
    if (typeof doc.user === 'string' && doc.user.toLowerCase() !== user.toLowerCase()) continue;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    let since = isoSeconds(new Date(+m[1], +m[2] - 1, +m[3]));
    try {
      const mtime = statSync(path).mtime;
      if (localToday(mtime) === date) since = isoSeconds(mtime);
    } catch {
      // Unreadable metadata: keep the start of the scan's day.
    }
    return { date, file: `output/${name}`, since };
  }
  return null;
}

// GitHub search takes `YYYY-MM-DDTHH:MM:SSZ`; milliseconds are dropped (rounding down).
const isoSeconds = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

function isCalendarDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), never negative. */
export function daysBetween(from, to) {
  const utc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.max(0, Math.round((utc(to) - utc(from)) / DAY_MS));
}

/**
 * The single gh call: PRs the user authored that were merged (after `since`,
 * when there is a scan), excluding repos the user owns. One search page, so one
 * request; only the repository field is asked for, and only the count is kept.
 */
export function searchArgs(user, since) {
  const args = ['search', 'prs', '--author', user, '--merged'];
  if (since) args.push('--merged-at', `>=${since}`);
  args.push('--limit', String(QUERY_LIMIT), '--json', 'repository', '--', `-user:${user}`);
  return args;
}

/**
 * The real gh runner. Injectable, so tests never spawn gh or reach the network.
 * Bounded, so a hung gh never holds up an evaluation.
 */
export function defaultGhRunner(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
  return {
    status: res.status,
    signal: res.signal ?? null,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    notFound: res.error?.code === 'ENOENT',
  };
}

// gh exits 4 when it has no credentials; a bad or expired token comes back as a 401.
const AUTH_FAILURE = /auth login|not logged|bad credentials|401 unauthorized|HTTP 401|authentication/i;
const firstLine = (s) => String(s ?? '').trim().split('\n')[0];

/**
 * Run the search and classify the outcome.
 *
 * @returns {{ok: true, count: number, truncated: boolean}
 *   | {ok: false, status: 'gh-unavailable'|'gh-query-failed', detail: string}}
 */
export function countNewMergedPrs(user, since, runGh) {
  const res = runGh(searchArgs(user, since));
  if (res.notFound) {
    return { ok: false, status: 'gh-unavailable', detail: 'gh is not installed (not found on PATH)' };
  }
  if (res.status !== 0) {
    if (res.status === 4 || AUTH_FAILURE.test(res.stderr)) {
      return { ok: false, status: 'gh-unavailable', detail: 'gh is installed but not logged in to github.com' };
    }
    const detail = firstLine(res.stderr) || (res.signal ? `killed by ${res.signal}` : `exit ${res.status}`);
    return { ok: false, status: 'gh-query-failed', detail: `gh search prs failed: ${detail}` };
  }
  let rows;
  try {
    rows = JSON.parse(res.stdout);
  } catch {
    return { ok: false, status: 'gh-query-failed', detail: 'gh search prs returned output that is not JSON' };
  }
  if (!Array.isArray(rows)) return { ok: false, status: 'gh-query-failed', detail: 'gh search prs did not return a list' };
  // The query already excludes the user's repos; this re-checks it.
  const own = `${user.toLowerCase()}/`;
  const count = rows.filter((r) => !String(r?.repository?.nameWithOwner ?? '').toLowerCase().startsWith(own)).length;
  return { ok: true, count, truncated: rows.length >= QUERY_LIMIT };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ago = (days) => (days === 0 ? 'today' : `${plural(days, 'day')} ago`);

/**
 * Pure verdict.
 *
 * @param {object} input
 * @param {string|null} input.lastScan - YYYY-MM-DD, or null when no scan is on record.
 * @param {number|null} input.daysSince
 * @param {number} input.newMergedPrs
 * @param {boolean} input.truncated - The count reached QUERY_LIMIT.
 * @param {{minNewMergedPrs: number, maxAgeDays: number}} input.thresholds
 * @returns {{stale: boolean, reason: string, notice: string|null}}
 */
export function judge({ lastScan, daysSince, newMergedPrs, truncated, thresholds }) {
  const count = truncated ? `${QUERY_LIMIT}+` : String(newMergedPrs);
  const prs = `${count} merged PR${count === '1' ? '' : 's'}`;
  if (!lastScan) {
    if (newMergedPrs === 0) {
      return { stale: false, reason: 'no GitHub evidence scan on record, and no merged PRs in other people\'s repos for one to find', notice: null };
    }
    return {
      stale: true,
      reason: `no GitHub evidence scan on record, and ${prs} in other people's repos`,
      notice: `No GitHub evidence scan on record; ${prs} in other people's repos. Scores may understate fit.`,
    };
  }
  const byCount = truncated || newMergedPrs >= thresholds.minNewMergedPrs;
  const byAge = daysSince > thresholds.maxAgeDays;
  const parts = [
    `${prs} since the last scan (stale at ${thresholds.minNewMergedPrs})`,
    `last scan ${ago(daysSince)} (stale after ${plural(thresholds.maxAgeDays, 'day')})`,
  ];
  if (!byCount && !byAge) return { stale: false, reason: `within thresholds: ${parts.join('; ')}`, notice: null };
  return {
    stale: true,
    reason: [byCount && parts[0], byAge && parts[1]].filter(Boolean).join('; '),
    notice: `Last GitHub evidence scan: ${lastScan} (${ago(daysSince)}); ${prs} since. Scores may understate fit.`,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────

/**
 * The CLI body, every outside effect injectable for tests.
 *
 * @returns {number} Always 0: this check informs an evaluation, it never stops one.
 */
export function runCli({
  dataRoot = getCareerOpsRoot(), runGh = defaultGhRunner,
  profilePath = hasProfileOverride() ? getProfilePath() : getProfilePath(dataRoot),
  now = new Date(), stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s),
} = {}) {
  // Every status prints the same keys in the same order; a field this run could
  // not fill is null (false for the two flags).
  const base = {
    status: null, stale: false, reason: null, notice: null, user: null,
    lastScan: null, scanFile: null, daysSince: null, newMergedPrs: null, newMergedPrsTruncated: false,
  };
  let thresholds = { ...DEFAULTS };
  const emit = (fields) => {
    const { minNewMergedPrs, maxAgeDays } = thresholds;
    stdout(`${JSON.stringify({ ...base, ...fields, thresholds: { minNewMergedPrs, maxAgeDays } }, null, 2)}\n`);
    return 0;
  };

  if (!existsSync(profilePath)) return emit({ status: 'no-github', reason: 'config/profile.yml not found' });
  let profile;
  try {
    profile = loadYaml(readFileSync(profilePath, 'utf8')) || {};
  } catch (err) {
    return emit({ status: 'no-github', reason: `config/profile.yml is not valid YAML: ${firstLine(err.message)}` });
  }
  const read = readThresholds(profile);
  thresholds = read.thresholds;
  for (const w of read.warnings) stderr(`evidence-freshness: ${w}\n`);
  if (!thresholds.enabled) return emit({ status: 'disabled', reason: 'the check is opt-in and evidence_freshness.enabled is not true in config/profile.yml' });

  const user = normalizeGithubUser(profile?.candidate?.github);
  if (!user) {
    return emit({ status: 'no-github', reason: 'config/profile.yml -> candidate.github is not set to a GitHub username or profile link' });
  }

  const today = localToday(now);
  const scan = findLatestScan(dataRoot, user);
  const scanFields = {
    user,
    lastScan: scan?.date ?? null,
    scanFile: scan?.file ?? null,
    daysSince: scan ? daysBetween(scan.date, today) : null,
  };
  const found = countNewMergedPrs(user, scan?.since ?? null, runGh);
  if (!found.ok) return emit({ ...scanFields, status: found.status, reason: `${found.detail}; freshness not checked` });
  const verdict = judge({
    lastScan: scanFields.lastScan, daysSince: scanFields.daysSince,
    newMergedPrs: found.count, truncated: found.truncated, thresholds,
  });
  return emit({
    status: 'ok', ...scanFields,
    newMergedPrs: found.count, newMergedPrsTruncated: found.truncated, ...verdict,
  });
}

if (isMainModule(import.meta.url)) {
  validateFlags(process.argv.slice(2), KNOWN_FLAGS, USAGE);
  process.exitCode = runCli();
}
