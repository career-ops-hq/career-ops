#!/usr/bin/env node
/**
 * skill-proof.mjs — Skill Proof Builder (#7221): map target skills to
 * concrete evidence in the candidate's GitHub repositories.
 *
 * Zero-LLM and deterministic. Target skills come from a JD (--jd), an
 * explicit list (--skills) or, by default, cv.md. For each repository in
 * scope it reads the git tree and a bounded set of files — root README,
 * dependency manifests, Dockerfiles and compose files — never general source
 * code. Every rule lives in skill-proof-core.mjs; this file is the GitHub
 * transport and the CLI.
 *
 * Transport and privacy reuse github-evidence.mjs: the user's existing,
 * already-authenticated `gh` CLI (no new token, no new dependency), the same
 * `candidate.github` normalization, and the same allowlist rule:
 *   - forks are never read (a fork proves no authorship)
 *   - a private repository is read only when it is listed in
 *     config/profile.yml → github_evidence.private_allowlist
 *   - a repository whose visibility cannot be read is skipped, and a skipped
 *     private repository is reported without its name
 *
 * Bounded: at most --max-repos repositories (default 30, most recently pushed
 * first), MAX_FILES_PER_REPO files each, MAX_FILE_BYTES per file. A rate-limit
 * response stops every further read; the report then says coverage is
 * incomplete and affected skills are UNABLE TO VERIFY, never NO EVIDENCE.
 *
 * Everything fetched is untrusted external content: data, never instructions
 * (AGENTS.md → "Untrusted External Content"). It is only matched against fixed
 * patterns and never sent to an LLM by this script.
 *
 * Usage:
 *   node skill-proof.mjs                          # skills from cv.md
 *   node skill-proof.mjs --jd jds/acme.md         # skills from a JD
 *   node skill-proof.mjs --skills "Node.js,PostgreSQL,Redis,Docker"
 *   node skill-proof.mjs --repo owner/a,owner/b   # only these repositories
 *   node skill-proof.mjs --max-repos 10 --json
 *
 * Writes output/skill-proof-{YYYY-MM-DD}.md and .json under the data root.
 *
 * Exit codes:
 *   0  report written (incomplete coverage is still 0: the report says so)
 *   1  usage or configuration error (no target skills, bad username or repo)
 *   2  a GitHub query failed before any repository could be listed
 *   3  gh is not installed or not authenticated; nothing written
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, getProfilePath, hasProfileOverride } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { flagValue, hasFlag, safeIntFlag, validateFlags } from './lib/cli-flags.mjs';
import { checkGh, defaultGhRunner, normalizeGithubUser, readPrivateAllowlist } from './github-evidence.mjs';
import { extractSkills } from './skill-extract.mjs';
import { extractJdSkills } from './jd-skill-gap.mjs';
import {
  MAX_FILE_BYTES, MAX_FILES_PER_REPO, MAX_REPOS, buildProofReport, fileSignals, pathSignals,
  renderProofMarkdown, selectCandidateFiles,
} from './skill-proof-core.mjs';

const KNOWN_FLAGS = ['--jd', '--skills', '--repo', '--max-repos', '--json', '--help', '-h'];
const VALUE_FLAGS = ['--jd', '--skills', '--repo', '--max-repos'];
const USAGE = `Usage:
  node skill-proof.mjs                          # target skills from cv.md
  node skill-proof.mjs --jd jds/acme.md         # target skills from a JD file
  node skill-proof.mjs --skills "Node.js,PostgreSQL,Redis,Docker"
  node skill-proof.mjs --repo owner/a,owner/b   # inspect only these repositories
  node skill-proof.mjs --max-repos 10           # default ${MAX_REPOS}
  node skill-proof.mjs --json                   # also print the JSON report

Maps each skill to evidence in your GitHub repositories (README, manifests,
Dockerfiles, compose files, file names) through your existing \`gh auth\`.
Levels: STRONG, PARTIAL, NO EVIDENCE, UNABLE TO VERIFY. Zero LLM calls.`;

export const EXIT_GH_UNAVAILABLE = 3;
export const EXIT_GH_QUERY_FAILED = 2;
export const REQUEST_PAUSE_MS = 100;

const REPO_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})\/[\w.-]{1,100}$/i;
const RATE_LIMIT_RE = /rate limit|HTTP 429|secondary rate/i;
const sleepSync = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

const OWN_REPOS_QUERY = 'query($login: String!, $first: Int!) { repositoryOwner(login: $login) { '
  + 'repositories(first: $first, ownerAffiliations: OWNER, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) { '
  + 'totalCount nodes { nameWithOwner isPrivate isFork isEmpty defaultBranchRef { name } } } } }';

const jsonOrNull = (s) => {
  try { return JSON.parse(s); } catch { return null; }
};
const firstLine = (s) => String(s ?? '').trim().split('\n')[0].slice(0, 200);

/** Error class for a failed gh call, without echoing stderr from a hidden repo. */
export function failureKind(res) {
  const err = String(res?.stderr || '');
  if (RATE_LIMIT_RE.test(err)) return 'rate limited';
  if (/HTTP 404|not found/i.test(err)) return 'not found';
  if (/HTTP 401|unauthorized|authentication/i.test(err)) return 'unauthorized';
  if (/HTTP 403|forbidden|permission/i.test(err)) return 'forbidden';
  if (/HTTP 409/.test(err)) return 'empty repository';
  return res?.signal ? `killed by ${res.signal}` : 'command failed';
}

/**
 * Parse a comma-separated `owner/repo` list. Invalid entries are returned
 * separately so a typo is reported instead of silently widening scope.
 * @param {string|undefined} raw
 * @returns {{repos: string[], invalid: string[]}}
 */
export function parseRepoList(raw) {
  const repos = [];
  const invalid = [];
  for (const part of String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const clean = part.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '');
    (REPO_RE.test(clean) ? repos : invalid).push(REPO_RE.test(clean) ? clean : part);
  }
  return { repos, invalid };
}

/**
 * The repositories to inspect, each with visibility and default branch.
 * Forks, unreadable-visibility repos and private non-allowlisted repos are
 * left out and recorded in `skipped` (private ones without their name).
 *
 * @param {string} user
 * @param {Function} runGh
 * @param {{maxRepos?: number, repos?: string[], allowlist?: Set<string>}} [opts]
 * @returns {{status: 'ok'|'failed', targets: object[], skipped: object[], total: number|null, rateLimited: boolean, detail?: string}}
 */
export function discoverRepos(user, runGh, { maxRepos = MAX_REPOS, repos = [], allowlist = new Set() } = {}) {
  const targets = [];
  const skipped = [];
  const hiddenInputRepos = new Set();
  let rateLimited = false;
  const hide = (repo, inputName) => {
    if (repo) hiddenInputRepos.add(repo.toLowerCase());
    if (inputName) hiddenInputRepos.add(inputName.toLowerCase());
  };
  const admit = ({ repo, isPrivate, isFork, branch, empty, inputName = null }) => {
    const key = repo.toLowerCase();
    if (typeof isPrivate !== 'boolean' || typeof isFork !== 'boolean') {
      hide(repo, inputName);
      skipped.push({ repo: null, reason: 'visibility or fork flag could not be read' });
      return;
    }
    if (isPrivate && !allowlist.has(key)) {
      hide(repo, inputName);
      skipped.push({ repo: null, reason: 'private, not in github_evidence.private_allowlist' });
      return;
    }
    if (isFork === true) {
      if (isPrivate) hide(repo, inputName);
      skipped.push({ repo: isPrivate ? null : repo, reason: 'fork (never evidence)' });
      return;
    }
    if (empty) { skipped.push({ repo, reason: 'empty repository' }); return; }
    targets.push({ repo, visibility: isPrivate ? 'private' : 'public', branch: branch || null });
  };

  if (repos.length) {
    for (const name of repos.slice(0, maxRepos)) {
      if (rateLimited) break;
      const res = runGh(['api', `repos/${name}`, '--jq', '{name: .full_name, private: .private, fork: .fork, branch: .default_branch}']);
      const m = res.status === 0 ? jsonOrNull(res.stdout) : null;
      if (!m || typeof m !== 'object') {
        if (RATE_LIMIT_RE.test(res.stderr || '')) rateLimited = true;
        hide(name, name);
        skipped.push({ repo: null, reason: `metadata read ${failureKind(res)}` });
        continue;
      }
      admit({ repo: typeof m.name === 'string' ? m.name : name, isPrivate: m.private, isFork: m.fork, branch: m.branch, inputName: name });
    }
    return { status: 'ok', targets, skipped, hiddenInputRepos, total: repos.length, rateLimited };
  }

  const res = runGh(['api', 'graphql', '-f', `query=${OWN_REPOS_QUERY}`, '-f', `login=${user}`, '-F', `first=${maxRepos}`]);
  const conn = res.status === 0 ? jsonOrNull(res.stdout)?.data?.repositoryOwner?.repositories : null;
  if (!Array.isArray(conn?.nodes)) {
    return {
      status: 'failed', targets, skipped, hiddenInputRepos, total: null, rateLimited: RATE_LIMIT_RE.test(res.stderr || ''),
      detail: res.status === 0 ? 'repository list returned no repositories' : `repository list failed: ${firstLine(res.stderr) || failureKind(res)}`,
    };
  }
  for (const n of conn.nodes) {
    if (typeof n?.nameWithOwner !== 'string') continue;
    admit({ repo: n.nameWithOwner, isPrivate: n.isPrivate, isFork: n.isFork, branch: n.defaultBranchRef?.name, empty: n.isEmpty === true });
  }
  return { status: 'ok', targets, skipped, hiddenInputRepos, total: Number.isFinite(conn.totalCount) ? conn.totalCount : null, rateLimited };
}

/**
 * Read the selected repositories: one tree call each, then the bounded file
 * reads. Never throws; a failed call becomes a coverage gap, and a rate-limit
 * response stops every later call.
 *
 * @param {object[]} targets - From discoverRepos.
 * @param {Function} runGh
 * @param {{maxFiles?: number, maxBytes?: number, pause?: Function, rateLimited?: boolean}} [opts]
 * @returns {{signals: object[], coverage: object}}
 */
export function collectRepoSignals(targets, runGh, {
  maxFiles = MAX_FILES_PER_REPO, maxBytes = MAX_FILE_BYTES, pause = sleepSync, rateLimited = false,
} = {}) {
  const run = (args) => {
    try {
      return runGh(args);
    } catch (err) {
      return { status: null, signal: null, stdout: '', stderr: String(err?.message ?? err) };
    }
  };
  const signals = [];
  const coverage = { reposScanned: 0, filesRead: 0, treesTruncated: 0, reposCapped: 0, oversizedSkipped: 0, rateLimited, gaps: [] };
  const gap = (t, detail, path = null) => coverage.gaps.push({
    repo: t.visibility === 'public' ? t.repo : null,
    detail,
    ...(path && t.visibility === 'public' ? { path } : {}),
  });
  const hitLimit = (res) => {
    if (RATE_LIMIT_RE.test(res.stderr || '')) coverage.rateLimited = true;
    return coverage.rateLimited;
  };

  for (const t of targets) {
    if (coverage.rateLimited) { gap(t, 'not read: rate limit reached earlier'); continue; }
    const ref = encodeURIComponent(t.branch ?? 'HEAD');
    const tree = run(['api', `repos/${t.repo}/git/trees/${ref}?recursive=1`]);
    if (tree.status !== 0 && /HTTP 409/.test(tree.stderr || '')) { coverage.reposScanned += 1; continue; }
    const body = tree.status === 0 ? jsonOrNull(tree.stdout) : null;
    if (!Array.isArray(body?.tree)) {
      hitLimit(tree);
      gap(t, tree.status === 0 ? 'tree read returned output that is not a tree' : `tree read ${failureKind(tree)}`);
      continue;
    }
    coverage.reposScanned += 1;
    if (body.truncated === true) coverage.treesTruncated += 1;
    const blobs = body.tree.filter((e) => e?.type === 'blob' && typeof e.path === 'string');
    signals.push(...pathSignals(t.repo, blobs.map((e) => e.path)));

    const { selected, capped, oversized } = selectCandidateFiles(blobs, { maxFiles, maxBytes });
    if (capped) coverage.reposCapped += 1;
    coverage.oversizedSkipped += oversized.length;
    for (const path of selected) {
      if (coverage.rateLimited) break;
      pause(REQUEST_PAUSE_MS);
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const res = run(['api', `repos/${t.repo}/contents/${encoded}?ref=${ref}`, '-H', 'Accept: application/vnd.github.raw']);
      if (res.status !== 0) {
        if (hitLimit(res)) { gap(t, 'file reads stopped: rate limited'); break; }
        gap(t, `file read ${failureKind(res)}`, path);
        continue;
      }
      const text = String(res.stdout ?? '');
      if (text.length > maxBytes) { coverage.oversizedSkipped += 1; continue; }
      coverage.filesRead += 1;
      signals.push(...fileSignals(t.repo, path, text));
    }
  }
  return { signals, coverage };
}

/**
 * Target skills and where they came from.
 * @returns {{skills: string[], source: string, note?: string}|{error: string}}
 */
export function resolveTargetSkills({ args, dataRoot, cwd = process.cwd() }) {
  if (hasFlag(args, '--skills')) {
    const skills = String(flagValue(args, '--skills') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return skills.length ? { skills, source: 'flag' } : { error: '--skills needs a comma-separated list of skills' };
  }
  if (hasFlag(args, '--jd')) {
    const raw = String(flagValue(args, '--jd') ?? '');
    const candidates = isAbsolute(raw) ? [raw] : [join(dataRoot, raw), resolve(cwd, raw)];
    const path = candidates.find((p) => {
      try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
    });
    if (!path) return { error: `JD file not found: ${raw}` };
    const text = readFileSync(path, 'utf8');
    const fromSections = extractJdSkills(text);
    if (fromSections.length) return { skills: fromSections, source: `jd:${relative(dataRoot, path) || raw}` };
    const whole = [...extractSkills(text)];
    return whole.length
      ? { skills: whole, source: `jd:${relative(dataRoot, path) || raw}`, note: 'No requirements section was recognized; skills were taken from the whole JD text.' }
      : { error: 'No skills could be extracted from the JD. Pass --skills explicitly.' };
  }
  const cvPath = join(dataRoot, 'cv.md');
  if (!existsSync(cvPath)) return { error: 'No --jd or --skills given and cv.md was not found in the data root.' };
  const skills = [...extractSkills(readFileSync(cvPath, 'utf8'))];
  return skills.length ? { skills, source: 'cv.md' } : { error: 'No known skills were found in cv.md. Pass --skills explicitly.' };
}

function loadProfile(path) {
  if (!existsSync(path)) return null;
  return loadYaml(readFileSync(path, 'utf8')) || {};
}

/**
 * The CLI body, with every outside effect injectable for tests.
 * @returns {number} Exit code.
 */
export function runCli({
  args = [], dataRoot = getCareerOpsRoot(), runGh = defaultGhRunner,
  profilePath = hasProfileOverride() ? getProfilePath() : getProfilePath(dataRoot),
  today = localToday(), stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s),
  pause = sleepSync, cwd = process.cwd(),
} = {}) {
  if (args.includes('--help') || args.includes('-h')) { stdout(`${USAGE}\n`); return 0; }
  const asJson = args.includes('--json');

  let profile;
  try {
    profile = loadProfile(profilePath);
  } catch (err) {
    stderr(`skill-proof: config/profile.yml is not valid YAML: ${String(err.message).split('\n')[0]}\n`);
    return 1;
  }
  const { repos, invalid: badRepos } = parseRepoList(flagValue(args, '--repo'));
  if (badRepos.length) {
    stderr(`skill-proof: --repo takes owner/name entries; not accepted: ${badRepos.join(', ')}\n`);
    return 1;
  }
  const user = normalizeGithubUser(profile?.candidate?.github) ?? (repos.length ? repos[0].split('/')[0] : null);
  if (!user) {
    stderr('skill-proof: config/profile.yml → candidate.github is missing or is not a GitHub username (or pass --repo owner/name).\n');
    return 1;
  }
  const maxRepos = Math.max(1, Math.min(100, safeIntFlag(flagValue(args, '--max-repos'), MAX_REPOS)));
  const target = resolveTargetSkills({ args, dataRoot, cwd });
  if (target.error) { stderr(`skill-proof: ${target.error}\n`); return 1; }
  if (target.note) stderr(`skill-proof: ${target.note}\n`);
  const { allowlist, invalid } = readPrivateAllowlist(profile);
  if (invalid.length) stderr(`skill-proof: ignoring github_evidence.private_allowlist entries that are not "owner/repo": ${invalid.join(', ')}\n`);

  let gh;
  try {
    gh = checkGh(runGh);
  } catch (err) {
    stderr(`skill-proof: ${err.message}. Nothing written.\n`);
    if (asJson) stdout(`${JSON.stringify({ status: 'gh-query-failed', detail: err.message })}\n`);
    return EXIT_GH_QUERY_FAILED;
  }
  if (!gh.ok) {
    stderr(`skill-proof: ${gh.detail}. Nothing written.\n`);
    if (asJson) stdout(`${JSON.stringify({ status: 'gh-unavailable', reason: gh.reason, detail: gh.detail })}\n`);
    return EXIT_GH_UNAVAILABLE;
  }

  const discovery = discoverRepos(user, runGh, { maxRepos, repos, allowlist });
  if (discovery.status === 'failed') {
    stderr(`skill-proof: ${discovery.detail}. Nothing written.\n`);
    if (asJson) stdout(`${JSON.stringify({ status: 'gh-query-failed', detail: discovery.detail })}\n`);
    return EXIT_GH_QUERY_FAILED;
  }
  const { signals, coverage } = collectRepoSignals(discovery.targets, runGh, { pause, rateLimited: discovery.rateLimited });
  coverage.reposSkipped = discovery.skipped;
  coverage.reposListed = discovery.total;
  for (const s of discovery.skipped) {
    if (/^metadata read|could not be read/.test(s.reason)) coverage.gaps.push({ repo: s.repo, detail: s.reason });
  }
  if (coverage.rateLimited) stderr('skill-proof: GitHub rate limit reached; the report marks coverage as incomplete.\n');

  const hidden = discovery.hiddenInputRepos || new Set();
  const shownRepos = repos.filter((r) => !hidden.has(r.toLowerCase()));
  const report = buildProofReport({
    user,
    generatedAt: today,
    inputs: { source: target.source, skills: target.skills, repos: repos.length ? shownRepos : null },
    scope: { maxRepos, maxFilesPerRepo: MAX_FILES_PER_REPO, maxFileBytes: MAX_FILE_BYTES, readsSourceCode: false },
    coverage,
    targetSkills: target.skills,
    signals,
  });

  const outDir = join(dataRoot, 'output');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `skill-proof-${today}.json`);
  const mdPath = join(outDir, `skill-proof-${today}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, `${renderProofMarkdown(report)}\n`);
  stderr(`Wrote ${relative(dataRoot, mdPath)}\nWrote ${relative(dataRoot, jsonPath)}\n`);
  if (asJson) stdout(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  process.exitCode = runCli({ args });
}

