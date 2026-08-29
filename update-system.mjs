#!/usr/bin/env node

/**
 * update-system.mjs — Safe auto-updater for career-ops
 *
 * Updates ONLY system layer files (modes, scripts, dashboard, templates).
 * NEVER touches user data (cv.md, profile.yml, _profile.md, data/, reports/).
 *
 * Usage:
 *   node update-system.mjs check      # Check if update available
 *   node update-system.mjs apply      # Apply update (after user confirms)
 *   node update-system.mjs apply --force
 *                                     # …and overwrite system files this
 *                                     # install edited locally (#2337). Without
 *                                     # it those files are kept and listed.
 *   node update-system.mjs rollback   # Rollback last update
 *   node update-system.mjs dismiss    # Dismiss update check
 *
 * See DATA_CONTRACT.md for the full system/user layer definitions.
 */

import { execFile, execFileSync, execSync } from 'child_process';
import { copyFileSync, readFileSync, writeFileSync, existsSync, unlinkSync, rmSync, realpathSync } from 'fs';
import { join, dirname, resolve, posix as pathPosix } from 'path';
import { fileURLToPath } from 'url';

// NOTE: this file must stay *self-loading* — no static (top-level) relative
// imports. A pre-#1245 client's apply() self-reexec checks out ONLY
// update-system.mjs before re-execing the target updater, so a static top-level
// relative import here crashes that re-exec with ERR_MODULE_NOT_FOUND on the
// old→new jump, before the fuller checkout that would materialize the imported
// module ever runs (#1706). Local modules (e.g. the skill-entrypoints helper
// under scaffolder/) are instead pulled in lazily at their point of use, by
// which time the full update stage has already checked them out. The
// updater-migration and test-all suites enforce this invariant.

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const CANONICAL_REPO = 'https://github.com/santifer/career-ops.git';
const RAW_VERSION_URL = 'https://raw.githubusercontent.com/santifer/career-ops/main/VERSION';
const RELEASES_API = 'https://api.github.com/repos/santifer/career-ops/releases/latest';

// Matches a semver, with or without a leading `v` and an optional
// Release Please component prefix (e.g. `career-ops-v1.9.0` → `1.9.0`).
// Anchoring on `(?:^|-)` lets the releases-API fallback parse our tags,
// which Release Please always prefixes with the component name.
export const SEMVER_RE = /(?:^|-)v?(\d+\.\d+\.\d+)$/i;
// 120s: local git commands are normally instant, but a cloud-evicted working
// tree (iCloud "optimize storage", OneDrive dehydration) can stall a plain
// `git status` for a minute of pure I/O wait re-materializing files (#1393).
export const DEFAULT_GIT_TIMEOUT_MS = parsePositiveInt(process.env.CAREER_OPS_GIT_TIMEOUT_MS, 120000);
export const DEFAULT_GIT_FETCH_TIMEOUT_MS = parsePositiveInt(
  process.env.CAREER_OPS_GIT_FETCH_TIMEOUT_MS,
  Math.max(DEFAULT_GIT_TIMEOUT_MS, 300000),
);
export const NPM_INSTALL_TIMEOUT_MS = parsePositiveInt(process.env.CAREER_OPS_NPM_INSTALL_TIMEOUT_MS, 60000);
export const PLAYWRIGHT_INSTALL_TIMEOUT_MS = parsePositiveInt(process.env.CAREER_OPS_PLAYWRIGHT_INSTALL_TIMEOUT_MS, 120000);
export const DASHBOARD_REBUILD_TIMEOUT_MS = parsePositiveInt(process.env.CAREER_OPS_DASHBOARD_REBUILD_TIMEOUT_MS, 60000);
export const UPDATE_PATH_CHECKOUT_BUDGET_MS = parsePositiveInt(process.env.CAREER_OPS_UPDATE_PATH_CHECKOUT_BUDGET_MS, 5000);
export const REEXEC_BUFFER_TIMEOUT_MS = parsePositiveInt(process.env.CAREER_OPS_REEXEC_BUFFER_TIMEOUT_MS, 60000);

// System layer paths — ONLY these files get updated
const SYSTEM_PATHS = [
  '.gitattributes',
  'modes/README.md',
  'modes/_shared.md',
  'modes/_writing.md',
  'modes/_profile.template.md',
  'modes/_custom.template.md',
  'modes/_brief.template.md',
  'voice-dna.template.md',
  'modes/oferta.md',
  'modes/pdf.md',
  'modes/ats.md',
  'modes/text.md',
  'modes/pdf/',
  'modes/cover.md',
  'modes/email.md',
  'modes/add.md',
  'modes/expand.md',
  'modes/scan.md',
  'modes/discover.md',
  'modes/batch.md',
  'modes/apply.md',
  'modes/auto-pipeline.md',
  'modes/contacto.md',
  'modes/deep.md',
  'modes/ofertas.md',
  'modes/pipeline.md',
  'modes/triage.md',
  'modes/project.md',
  'modes/tracker.md',
  'modes/training.md',
  'modes/interview.md',
  'modes/interview-redflag.md',
  'modes/latex.md',
  'modes/latex-tex.md',
  'modes/followup.md',
  'modes/offer-prep.md',
  'modes/interview-prep.md',
  'modes/interview/',
  'interview-prep/sessions/.gitkeep',
  'interview-prep/sessions/README.md',
  'modes/patterns.md',
  'modes/calibrate.md',
  'modes/titles.md',
  'modes/upskill.md',
  'modes/intake.md',
  'documents/.gitkeep',
  'documents/README.md',
  'modes/update.md',
  'modes/agent-inbox.md',
  'modes/reply-watch.md',
  'modes/outcome.md',
  'modes/ar/',
  'modes/da/',
  'modes/de/',
  'modes/de/interview/',
  'modes/fr/',
  'modes/fr/interview/',
  'modes/hi/',
  'modes/es/',
  'modes/es/interview/',
  'modes/id/',
  'modes/id/interview/',
  'modes/it/',
  'modes/it/interview/',
  'modes/ja/',
  'modes/ko/',
  'modes/nl/',
  'modes/pl/',
  'modes/pt/',
  'modes/pt/interview/',
  'modes/ru/',
  'modes/ru/interview/',
  'modes/tr/',
  'modes/ua/',
  'modes/ua/interview/',
  'modes/heuristics/',
  'modes/regional/',
  'modes/zh/',
  'modes/zh/interview/',
  'modes/zh-TW/',
  'CLAUDE.md',
  'CODEX.md',
  'OPENCODE.md',
  'AGENTS.md',
  'GEMINI.md',
  'KIMI.md',
  'build-dashboard.mjs',
  'clean-markers.mjs',
  'generate-pdf.mjs',
  'hired-share.mjs',
  'hired-wall-build.mjs',
  'HIRED.md',
  'theme-style.mjs',
  'generate-latex.mjs',
  'extract-latex-content.mjs',
  'patch-latex-content.mjs',
  'lib/ascii-fold.mjs',
  'lib/cli-flags.mjs',
  'lib/gemini-node-floor.mjs',
  'lib/local-today.mjs',
  'lib/is-main-module.mjs',
  'lib/mjs-files.mjs',
  'lib/outcome-dir.mjs',
  'lib/outcome-types.mjs',
  'lib/latex-escape.mjs',
  'scan-hn.mjs',
  'scripts/check-syntax.mjs',
  'scripts/export-ats-text.mjs',
  'story-provenance-check.mjs',
  'lib/latex-content.mjs',
  'lib/context-budget.mjs',
  'lib/context-budget.test.mjs',
  'lib/golden-budget-analysis.mjs',
  'img-to-pdf.mjs',
  'archive-posting.mjs',
  'jd-capture.mjs',
  'application-answers.mjs',
  'generate-cover-letter.mjs',
  'merge-tracker.mjs',
  'url-key.mjs',
  'sync-pdf-flags.mjs',
  'tracker-links.mjs',
  'tracker.mjs',
  'find.mjs',
  'verify-pipeline.mjs',
  'reconcile-pipeline.mjs',
  'dedup-tracker.mjs',
  'add-entry.mjs',
  'role-matcher.mjs',
  'tracker-utils.mjs',
  'tracker-parse.mjs',
  'tracker-aliases.json',
  'set-status.mjs',
  'set-status-tests.mjs',
  'mark-pdf-ready.mjs',
  'normalize-statuses.mjs',
  'cv-sync-check.mjs',
  'verify-cv-facts.mjs',
  'verify-ats.mjs',
  'update-system.mjs',
  'path-resolver.mjs',

  'reserve-report-num.mjs',
  'scan.mjs',
  'pipeline-lock.mjs',
  'portal-health-lock.mjs',
  'classify-tier.mjs',
  'scan-ats-full.mjs',
  'scan-interamt.mjs',
  'company-funded.mjs',
  'match-star.mjs',
  'jd-skill-gap.mjs',
  'prepare-application.mjs',
  'application-artifacts.mjs',
  'batch-evaluate-gemini.mjs',
  'providers/',
  'seeds/',
  'tests/',
  'user-agent.mjs',
  'doctor.mjs',
  'jsonc-parse.mjs',
  'check-liveness.mjs',
  'liveness-core.mjs',
  'liveness-api.mjs',
  'liveness-browser.mjs',
  'browser-extract.mjs',
  'analyze-patterns.mjs',
  'calibrate.mjs',
  'upskill.mjs',
  'skill-extract.mjs',
  'intake.mjs',
  'stats.mjs',
  'detect-reposts.mjs',
  'rank-pipeline.mjs',
  'discover-ats.mjs',
  'tests/discover-ats.test.mjs',
  'check-table-freshness.mjs',
  'fingerprint-core.mjs',
  'process-quality.mjs',
  'tests/process-quality.test.mjs',
  'company-history.mjs',
  'tests/company-history.test.mjs',
  'rejection-latency.mjs',
  'salary-gap.mjs',
  'negotiation-roi.mjs',
  'funnel-velocity.mjs',
  'assessment-log.mjs',
  'contacts.mjs',
  'linkedin-join.mjs',
  'tests/contacts.test.mjs',
  'weekly-digest.mjs',
  'tracker-sync-check.mjs',
  'followup-cadence.mjs',
  'tests/followup-cadence.test.mjs',
  'invite-match.mjs',
  'tests/invite-match.test.mjs',
  'agent-inbox.mjs',
  'followup-seed.mjs',
  'followup-seed-tests.mjs',
  'profile-language.mjs',
  'title-keywords.mjs',
  'gemini-eval.mjs',
  'ollama-eval.mjs',
  'openai-eval.mjs',
  'openai-tailor.mjs',
  'eval-golden.mjs',
  'evals/',
  'openrouter-runner.mjs',
  'jd-similarity.mjs',
  'tests/jd-similarity.test.mjs',
  'test-all.mjs',
  'tests/detect-reposts.test.mjs',
  'tests/salary-filter.test.mjs',
  'tests/trust-validator.test.mjs',
  'tracker-columns-tests.mjs',
  'tracker-writer-lock-tests.mjs',
  'agent-inbox-tests.mjs',
  'validate-portals.mjs',
  'verify-portals.mjs',
  'fix-slugs.mjs',
  'updater-migration-tests.mjs',
  'validate-system-paths-coverage.mjs',
  'validate-untrusted-content-coverage.mjs',
  'reply-matcher.mjs',
  'tests/reply-matcher.test.mjs',
  'reply-watch.mjs',
  'paste-reply.mjs',
  'paste-reply-tests.mjs',
  'outcome.mjs',
  'tests/outcome.test.mjs',
  'batch/batch-prompt.md',
  'batch/batch-runner.sh',
  'batch/aggregate-tokens.mjs',
  'batch/README.md',
  'utils/token-tracker.mjs',
  'batch-tailor.mjs',
  'dashboard/',
  'templates/',
  'config/cv-facts.example.json',
  'fonts/',
  'examples/',
  'config/profile.example.yml',
  'config/local-paths.example.txt',
  '.env.example',
  '.editorconfig',
  '.agents/',
  '.claude/skills/',
  '.cursor/skills/',
  '.opencode/skills/',
  '.opencode/commands/',
  '.claude-plugin/',
  '.qwen/',
  '.antigravitycli/skills/',
  '.grok/skills/',
  '.kimi/skills/',
  'docs/',
  'writing-samples/README.md',
  'VERSION',
  'DATA_CONTRACT.md',
  'MANIFESTO.md',
  'manifesto.mjs',
  'SIGNATURES.md',
  'CONTRIBUTING.md',
  'MAINTAINERS.md',
  'ARCHITECTURE.md',
  'README.md',
  'README.ar.md',
  'README.cn.md',
  'README.da.md',
  'README.de.md',
  'README.es.md',
  'README.fr.md',
  'README.hi.md',
  'README.ja.md',
  'README.ko-KR.md',
  'README.pl.md',
  'README.pt-BR.md',
  'README.ru.md',
  'README.ta.md',
  'README.ua.md',
  'README.zh-TW.md',
  'README.tr.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTORS.md',
  '.all-contributorsrc',
  'GOVERNANCE.md',
  'LEGAL_DISCLAIMER.md',
  'SECURITY.md',
  'SUPPORT.md',
  'TRADEMARK.md',
  'LICENSE',
  'CITATION.cff',
  'funding.json',
  '.editorconfig',
  '.github/',
  'package.json',
  'build-cv-latex.mjs',
  'build-cv-html.mjs',
  'cv-sections-core.mjs',
  'cv-templates.mjs',
  'playwright.cv.config.mjs',
  'tests/cv-templates.test.mjs',
  'tests/cover-resolver.test.mjs',
  'tests/pipeline-lock.test.mjs',
  'tests/profile-photo.test.mjs',
  'templates/cv-template.zh-minimal.html',
  'tests/zh-minimal-template.test.mjs',
  'tests/cv-visual/',
  'scaffolder/',
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',
  'cops',
  'DOCKER.md',
  'plugins/',
  'plugins.mjs',
  'plugins-registry/',
  'plugin-install.mjs',
  'plugin-audit.mjs',
  'validate-plugin-registry.mjs',
  'config/plugins.example.yml',
  'opencode.example.json',
  'seed-fixture.mjs',
  'test-fixtures/',
  'upgrade-tests.mjs',
];

const BOOTSTRAP_PATHS = [
  '.agents/',
  '.cursor/skills/',
  '.opencode/skills/',
  '.antigravitycli/skills/',
  '.grok/skills/',
  '.kimi/skills/',
  'providers/',
  'liveness-browser.mjs',
  'tracker-links.mjs',
  'role-matcher.mjs',
  'tracker-utils.mjs',
  'tracker-parse.mjs',
  'tracker-aliases.json',
  'scaffolder/',
  'reserve-report-num.mjs',
  'updater-migration-tests.mjs',
  'validate-portals.mjs',
  'tracker-columns-tests.mjs',
  'plugins/',
  'plugins.mjs',
  'plugins-registry/',
  'plugin-install.mjs',
  'plugin-audit.mjs',
  'validate-plugin-registry.mjs',
  'config/plugins.example.yml',
  'agent-inbox.mjs',
  'agent-inbox-tests.mjs',
];

// User layer paths — NEVER touch these (safety check)
/**
 * Files and directories the updater must never touch — the USER layer of the
 * data contract (DATA_CONTRACT.md). Exported so other tooling can derive the
 * same boundary instead of re-listing it: a hardcoded second copy is how a
 * fourth user file eventually gets policed by something that has no business
 * having an opinion about it (#2480).
 */
export const USER_PATHS = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'modes/_custom.md',
  'modes/_brief.md',
  'voice-dna.md',
  'portals.yml',
  'article-digest.md',
  'interview-prep/',
  'documents/',
  'data/',
  'reports/',
  'output/',
  'jds/',
  'writing-samples/',
  'config/plugins.yml',
  'plugins.local/',
  'plugins.lock',
  'opencode.json',
  '.claude/settings.json',
  '.claude/hooks/',
];

// Local user layer — a fork's own files, declared OUTSIDE the system layer.
//
// USER_PATHS lives in this file, which `apply` overwrites and which git
// re-merges on every sync, so "this file is mine" was previously a statement
// you could only make inside the thing that keeps overwriting it (#2421). The
// declaration file is gitignored and read at runtime instead: one repo-relative
// path per line, `#` comments, trailing `/` for a directory prefix — the same
// shape as the arrays above. Absent file means no extra paths, which is the
// behaviour every existing install already has.
export const LOCAL_PATHS_FILE = 'config/local-paths.txt';

/**
 * Parse a declaration file's contents into a de-duplicated path list.
 * Pure and tolerant of CRLF: Windows forks are the population this exists
 * for, and a stray \r would make every entry miss its match.
 * @param {string} text - Raw file contents.
 * @returns {string[]} Declared paths, in file order, without duplicates.
 */
export function parseLocalPaths(text) {
  const seen = new Set();
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    seen.add(line);
  }
  return [...seen];
}

/**
 * Read + validate the local declaration file.
 *
 * Refuses rather than honours anything ambiguous: a path the system layer
 * already ships would silently stop updating, and a path that escapes the
 * checkout would widen the "never touch" set over files the updater does not
 * own. Both throw, naming the offending entry.
 *
 * @param {string} [root=ROOT] - Repo root to read from.
 * @returns {string[]} Extra user-layer paths. Empty when the file is absent.
 */
export function localUserPaths(root = ROOT) {
  const file = join(root, LOCAL_PATHS_FILE);
  if (!existsSync(file)) return [];

  const declared = parseLocalPaths(readFileSync(file, 'utf-8'));
  const reject = (path, why) => {
    throw new Error(`${LOCAL_PATHS_FILE}: refusing "${path}" — ${why}`);
  };

  for (const path of declared) {
    if (path === LOCAL_PATHS_FILE) {
      reject(path, 'the declaration file cannot list itself (it is gitignored, so nothing updates it)');
    }
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\')) {
      reject(path, 'paths must be repo-relative, not absolute');
    }
    if (path.split(/[\\/]/).includes('..')) {
      reject(path, 'paths must stay inside the repo');
    }
    // Canonical spelling, required BEFORE the collision check below.
    //
    // That check compares strings exactly (`path === sys`), and
    // userLayerViolations() later compares against git's changed-path format,
    // which is always canonical. A non-canonical spelling therefore matches
    // NEITHER: `./merge-tracker.mjs` sails past the collision check, and is
    // never recognised as the file it names when the safety check runs. The
    // declaration silently protects nothing while the updater overwrites the
    // file — the data loss this feature exists to prevent, reachable from a
    // plausible typo.
    //
    // Rejected rather than normalised, deliberately. Normalising would accept
    // several spellings for one path and leave this file disagreeing with what
    // git reports; refusing keeps one path to one spelling, and says so.
    if (path.includes('\\')) {
      reject(path, 'paths use forward slashes, matching how git reports them');
    }
    // A single trailing slash is the documented directory-prefix form, so it is
    // dropped before the segment check rather than read as an empty segment.
    const segments = (path.endsWith('/') ? path.slice(0, -1) : path).split('/');
    if (segments.includes('')) {
      reject(path, 'paths must not contain an empty segment (a repeated separator)');
    }
    if (segments.includes('.')) {
      reject(path, 'paths must be written plainly, with no "." segment (use "merge-tracker.mjs", not "./merge-tracker.mjs")');
    }
    const collision = SYSTEM_PATHS.find((sys) =>
      sys.endsWith('/') ? path.startsWith(sys) : path === sys,
    );
    if (collision) {
      reject(
        path,
        `the system layer ships it (SYSTEM_PATHS entry "${collision}"). `
        + 'Declaring it would stop updates to it with no other signal',
      );
    }
  }
  return declared;
}

/**
 * USER_PATHS plus whatever the local declaration file adds. This is what the
 * safety check compares against — the built-in list alone would report a
 * fork's own files as violations.
 * @param {string} [root=ROOT] - Repo root to read from.
 * @returns {string[]} Every path the updater must never touch.
 */
export function effectiveUserPaths(root = ROOT) {
  return [...USER_PATHS, ...localUserPaths(root)];
}

/**
 * Which of the files an update touched belong to the user layer.
 *
 * Pure so the rule can be pinned without driving apply(), which is ROOT-bound
 * and full of side effects.
 *
 * @param {string[]} changedFiles - Paths the update modified.
 * @param {string[]} updatePaths - Paths this update was allowed to write.
 *   An explicit entry here wins over a user-layer prefix match, e.g.
 *   writing-samples/README.md is a system-owned doc inside a user directory.
 * @param {string[]} userPaths - User-layer paths, normally effectiveUserPaths().
 *   A trailing `/` means directory prefix; anything else matches exactly. Bare
 *   `startsWith` over-matched neighbours that merely share a prefix —
 *   `cv.md` claimed `cv.md.bak`, and a declared `run-nightly.ps1` claimed
 *   `run-nightly.ps1.old` — reporting files the user never declared as
 *   violations. The declaration syntax has always said trailing `/` is what
 *   makes an entry a prefix; this makes the matcher agree with it.
 * @returns {string[]} Violating files, each listed once.
 */
export function userLayerViolations(changedFiles, updatePaths, userPaths) {
  const violations = [];
  for (const file of changedFiles) {
    if (updatePaths.includes(file)) continue;
    if (userPaths.some((userPath) => (userPath.endsWith('/') ? file.startsWith(userPath) : file === userPath))) {
      violations.push(file);
    }
  }
  return violations;
}

function parseVersionFile(raw) {
  // VERSION may carry a release-please marker, e.g. "1.6.0 # x-release-please-version".
  // Take the first whitespace-delimited token so the marker doesn't break semver parsing.
  return raw.trim().split(/\s+/)[0] || '';
}

function localVersion() {
  const vPath = join(ROOT, 'VERSION');
  return existsSync(vPath) ? parseVersionFile(readFileSync(vPath, 'utf-8')) : '0.0.0';
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

function updateBackupBranchName(version, date = new Date()) {
  const stamp = date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `backup-pre-update-${version}-${stamp}`;
}

function backupTimestamp(branchName) {
  const match = branchName.match(/-(\d{8}T\d{6}Z)$/);
  if (!match) return 0;
  const [date, time] = match[1].split('T');
  return Date.parse(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`,
  ) || 0;
}

function newestBackupBranch(branches) {
  const branchList = branches.split('\n').map(b => b.trim()).filter(Boolean);
  if (branchList.length === 0) return null;

  // Prefer timestamped backup branches created by current versions. Older
  // backups are still accepted below for rollback compatibility.
  const timestamped = branchList
    .map(branch => ({ branch, timestamp: backupTimestamp(branch) }))
    .filter(entry => entry.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp);

  return timestamped[0]?.branch || branchList[0];
}

export function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function gitTimeoutMs(args) {
  return args[0] === 'fetch' ? DEFAULT_GIT_FETCH_TIMEOUT_MS : DEFAULT_GIT_TIMEOUT_MS;
}

export function reexecTimeoutMs(updatePathCount = SYSTEM_PATHS.length + BOOTSTRAP_PATHS.length) {
  return Math.max(
    120000,
    DEFAULT_GIT_FETCH_TIMEOUT_MS +
      DEFAULT_GIT_TIMEOUT_MS * 3 +
      UPDATE_PATH_CHECKOUT_BUDGET_MS * Math.max(0, updatePathCount) +
      NPM_INSTALL_TIMEOUT_MS +
      PLAYWRIGHT_INSTALL_TIMEOUT_MS +
      DASHBOARD_REBUILD_TIMEOUT_MS +
      REEXEC_BUFFER_TIMEOUT_MS,
  );
}

function describeGitCommand(args) {
  return `git ${args.join(' ')}`;
}

function isTimeoutLikeError(err) {
  return err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM';
}

function timeoutSeconds(timeout) {
  return Math.round(timeout / 1000);
}

function gitTimeoutEnvVar(args) {
  return args[0] === 'fetch' ? 'CAREER_OPS_GIT_FETCH_TIMEOUT_MS' : 'CAREER_OPS_GIT_TIMEOUT_MS';
}

/**
 * gitIn without the trailing/leading trim.
 *
 * Needed for output where whitespace is significant: `--name-only -z` emits
 * NUL-delimited paths, and a path may legitimately begin or end with a space.
 * Trimming the whole buffer would rewrite such a path into a different one.
 * Everything else should keep using gitIn.
 */
export function gitRawIn(root, ...args) {
  const timeout = gitTimeoutMs(args);
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8', timeout });
  } catch (err) {
    if (isTimeoutLikeError(err)) {
      throw new Error(`${describeGitCommand(args)} timed out after ${timeoutSeconds(timeout)}s. If your network is slow, retry or set ${gitTimeoutEnvVar(args)} to a larger value.`);
    }
    throw err;
  }
}

export function gitIn(root, ...args) {
  return gitRawIn(root, ...args).trim();
}

function git(...args) {
  return gitIn(ROOT, ...args);
}

/**
 * git(), but with the child's stderr piped instead of inherited.
 *
 * execFileSync inherits stderr by default, so a command whose failure is
 * expected and handled still prints git's raw error to the console. Use this
 * where a non-zero exit is a normal outcome the caller reports itself.
 *
 * @param {...string} args - git arguments.
 * @returns {string} Trimmed stdout.
 */
function gitQuiet(...args) {
  const timeout = gitTimeoutMs(args);
  try {
    return execFileSync('git', args, {
      cwd: ROOT, encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (isTimeoutLikeError(err)) {
      throw new Error(`${describeGitCommand(args)} timed out after ${timeoutSeconds(timeout)}s. If your network is slow, retry or set ${gitTimeoutEnvVar(args)} to a larger value.`);
    }
    throw err;
  }
}

/**
 * The enclosing repository's toplevel when ROOT is not a git toplevel itself,
 * or null when ROOT is its own toplevel (or not inside any worktree at all).
 *
 * Every git call in this file runs with `cwd: ROOT` and assumes that resolves
 * to the career-ops checkout. An install with no `.git` of its own that sits
 * INSIDE another repository — a ZIP unpacked into an existing project — breaks
 * that silently: git walks up, finds the outer repo, and every rev-parse,
 * fetch, branch and checkout lands there, with pathspecs failing because at
 * that root the files are prefixed by the install's subpath (#3334). Callers
 * use this to refuse before the first side effect.
 *
 * A ROOT inside no worktree at all returns null: that layout has no foreign
 * repo to damage, and each command already has its own handling for git
 * being unavailable.
 *
 * @param {string} [root=ROOT] - Directory to test.
 * @returns {string|null} The foreign toplevel path, or null.
 */
export function gitToplevelMismatch(root = ROOT) {
  let toplevel;
  try {
    toplevel = gitIn(root, 'rev-parse', '--show-toplevel');
  } catch {
    return null;
  }
  if (!toplevel) return null;
  // Realpath both sides: git resolves symlinks and reports on-disk casing
  // (macOS /tmp -> /private/tmp; Windows 8.3 names), while `root` keeps
  // whatever spelling the process was launched with. Same policy as the CLI
  // guard at the bottom of this file. On a realpath failure fall back to
  // resolve(): a false MISMATCH refuses an update, a false match fetches into
  // a stranger's repo, so the fallback only ever errs toward refusing.
  const canonicalize = realpathSync.native ?? realpathSync;
  let same;
  try {
    same = canonicalize(toplevel) === canonicalize(root);
  } catch {
    same = resolve(toplevel) === resolve(root);
  }
  return same ? null : toplevel;
}

/**
 * Throw when git operations from ROOT would land in an enclosing repository.
 * First statement of apply() and rollback(); check() reports a status instead.
 */
function assertOwnGitToplevel() {
  const foreignToplevel = gitToplevelMismatch();
  if (foreignToplevel) {
    throw new Error(
      `career-ops at ${ROOT} is not a git checkout of its own, so git operations would land in the enclosing repository at ${foreignToplevel} — this happens when the install was unpacked from a ZIP or copied without its .git directory. Nothing was changed. To make updates work, clone career-ops fresh (git clone ${CANONICAL_REPO}) and move your user-layer files (cv.md, config/, data/, reports/ — see DATA_CONTRACT.md) into the new clone.`,
    );
  }
}

/**
 * Paths the target manifest ships that did not materialize on disk.
 *
 * apply() reports success without checking that the checkout loop actually
 * produced a coherent install, so a client whose local manifest predates the
 * target's silently ends up missing every path added since — and only finds
 * out when the next script crashes with ERR_MODULE_NOT_FOUND (#1998).
 *
 * @param {string[]} targetPaths - SYSTEM_PATHS read from the target updater.
 * @returns {string[]} Entries present in FETCH_HEAD but absent locally.
 */
function missingFromTargetManifest(targetPaths) {
  const missing = [];
  for (const path of targetPaths) {
    const spec = path.endsWith('/') ? path.slice(0, -1) : path;

    // Directory entries need a RECURSIVE check: a pre-existing directory
    // (`.gemini/commands/`, `docs/`) can still be missing files the target
    // added under it, and `existsSync` on the directory would wrongly call it
    // materialized — masking the very partial update this verification exists
    // to catch. Compare the target tree's files beneath the entry against disk.
    if (path.endsWith('/')) {
      let treeFiles = [];
      try {
        treeFiles = gitQuiet('ls-tree', '-r', '--name-only', 'FETCH_HEAD', '--', spec)
          .split('\n').map(s => s.trim()).filter(Boolean);
      } catch {
        continue; // FETCH_HEAD unreadable for this spec — treat as stale, not missing
      }
      // Empty tree ⇒ the target ships nothing here (stale manifest entry).
      if (treeFiles.some(f => !existsSync(join(ROOT, f)))) missing.push(path);
      continue;
    }

    if (existsSync(join(ROOT, spec))) continue;
    // Only count it as missing when the target actually ships it — a manifest
    // entry the target no longer carries is a stale entry, not a failed update.
    try {
      gitQuiet('cat-file', '-e', `FETCH_HEAD:${spec}`);
      missing.push(path);
    } catch { /* absent upstream too — nothing to materialize */ }
  }
  return missing;
}

// Parses the NUL-delimited output of `git status --porcelain -z`. `-z` is the
// only form that round-trips every path byte-for-byte, which is what the
// user-layer safety checks depend on — they compare the parsed `path` against
// real files on disk, and a mangled path is a blind spot (#3048, and the
// follow-up this replaces):
//   - never quoted: the newline form C-quotes any path with a space, a quote,
//     a control char, or (under git's default core.quotepath) a non-ASCII
//     byte, e.g. ` M "data/my notes.md"` / ` M "data/caf\303\251.md"`. `-z`
//     emits the raw path, so no dequoting is needed.
//   - renames/copies as two fields, not one line: the newline form writes
//     `R  old -> new` on a single line, so a naive slice yields the blob
//     `old -> new` as the "path". `-z` writes the destination and origin as
//     two separate NUL-delimited fields; both are surfaced as their own entry
//     below so the safety check sees every path the move touched.
//   - no CRLF: `-z` suppresses git's line-ending translation, so there is no
//     trailing CR to strip on Windows.
//
// gitRawIn (not gitIn) because a `-z` field may legitimately begin or end with
// a space, and trimming the buffer would rewrite it into a different path.
export function parsePorcelainStatus(status) {
  if (!status) return [];
  const fields = status.split('\0');
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const code = field.slice(0, 2);
    entries.push({ code, path: field.slice(3) });
    // R (rename) and C (copy) always sit in the first status column and are
    // followed by one extra field — the origin path. Emit it too.
    if (code[0] === 'R' || code[0] === 'C') {
      const origin = fields[++i];
      if (origin) entries.push({ code, path: origin });
    }
  }
  return entries;
}

export function gitStatusEntries(root = ROOT) {
  return parsePorcelainStatus(gitRawIn(root, 'status', '--porcelain', '-z'));
}

export function extractArrayFromSource(source, name) {
  source = source.replace(/(['"])(?:\\.|(?!\1)[\s\S])*\1|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) => (
    /^['"]/.test(token) ? token : token.replace(/[^\n]/g, ' ')
  ));
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) return [];
  return Array.from(match[1].matchAll(/['"]([^'"]+)['"]/g), (entry) => entry[1]);
}

function mergePathLists(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const path of list) {
      if (seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}

function normalizeRepoPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function pathMatchesManifest(file, entry) {
  const normalizedFile = normalizeRepoPath(file);
  const normalizedEntry = normalizeRepoPath(entry).replace(/\/$/, '');
  return normalizedFile === normalizedEntry || normalizedFile.startsWith(`${normalizedEntry}/`);
}

export function staleSystemFiles(localFiles, remoteFiles, systemPaths, userPaths = USER_PATHS) {
  const remote = new Set([...remoteFiles].map(normalizeRepoPath));
  if (remote.size === 0) return [];
  return [...localFiles]
    .map(normalizeRepoPath)
    .filter((file) => !remote.has(file))
    .filter((file) => systemPaths.some((entry) => pathMatchesManifest(file, entry)))
    .filter((file) => !userPaths.some((entry) => pathMatchesManifest(file, entry)));
}

// A stale-file prune candidate can still be load-bearing for a file this same
// run just decided to KEEP because the user modified it (see
// `locallyModifiedSystemFiles` + the `preservedPaths` handling in `apply()`) —
// e.g. a user's custom CV template referencing a font file upstream no longer
// ships. Deleting the referenced asset out from under a preserved file leaves
// the preserved file silently broken (missing font, broken image) even though
// the file itself survived. Scoped to preserved HTML/CSS files' on-disk
// content, since those are the only preserved file types known to reference
// other system files by relative path.
export function isReferencedByPreservedFile(candidatePath, preservedPaths, readFile = (path) => readFileSync(path, 'utf-8')) {
  const basename = normalizeRepoPath(candidatePath).split('/').pop();
  if (!basename) return false;
  return preservedPaths.some((preservedPath) => {
    if (!/\.(html|css)$/i.test(preservedPath)) return false;
    try {
      return readFile(join(ROOT, ...preservedPath.split('/'))).includes(basename);
    } catch {
      return false;
    }
  });
}

// Files the self-reexec stage must check out so the TARGET update-system.mjs
// loads without a missing-module crash. Today this is the entry plus its only
// local import; resolveReexecCheckout derives the real set from the fetched
// source, so this is only a defensive fallback if parsing ever misses one.
const REEXEC_FALLBACK_FILES = ['update-system.mjs', 'scaffolder/bin/skill-entrypoints.mjs'];

// Extracts static relative import/export specifiers ('./x.mjs', '../y.mjs')
// from ESM source. Bare ('node:fs') and package ('js-yaml') specifiers are
// ignored — only on-disk relative modules need to exist before re-exec.
export function relativeImportSpecifiers(source) {
  const specs = new Set();
  const fromRe = /\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const bareRe = /\bimport\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = fromRe.exec(source))) specs.add(match[1]);
  while ((match = bareRe.exec(source))) specs.add(match[1]);
  return [...specs].filter((spec) => spec.startsWith('.'));
}

// Resolves the relative-import closure of `entry` within a git ref and returns
// the repo-relative paths (forward-slash, Windows-safe) the re-exec stage must
// check out. Only files actually present in the ref are returned; the known
// fallback files are appended defensively. This generalizes the previously
// hardcoded checkout list so a future new top-level import can't reintroduce
// the self-reexec ERR_MODULE_NOT_FOUND crash (issue #1245).
function resolveReexecCheckout(ref, entry) {
  const visited = new Set();
  const present = new Set();
  const order = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    let source;
    try {
      source = git('show', `${ref}:${file}`);
    } catch {
      continue; // absent in this ref — leave it to the normal update stage
    }
    present.add(file);
    order.push(file);
    const dir = pathPosix.dirname(file);
    for (const spec of relativeImportSpecifiers(source)) {
      stack.push(pathPosix.join(dir, spec));
    }
  }
  for (const file of REEXEC_FALLBACK_FILES) {
    if (present.has(file)) continue;
    try {
      git('show', `${ref}:${file}`);
      order.push(file);
      present.add(file);
    } catch {
      // Not in the target tree (older version) — nothing to check out.
    }
  }
  return order;
}

function repoPath(root, path) {
  return join(root, ...path.split('/'));
}

export function prepareMaterializedSkillEntrypointsForStage(paths, root = ROOT) {
  const prepared = [];
  for (const path of paths) {
    const entry = gitIn(root, 'ls-files', '-s', '--', path);
    if (!entry) continue;

    const mode = entry.split(/\s+/, 1)[0];
    if (mode === '120000') {
      gitIn(root, 'rm', '--cached', '-f', '--', path);
    }
    prepared.push(path);
  }
  return prepared;
}

/**
 * Does the COMMITTED system tree differ between `upstreamRef` and HEAD?
 *
 * check() needs this to tell two apart-shaped situations that both look like
 * "HEAD ≠ upstream main":
 *
 *   1. apply() ran successfully at the current version. It checks out
 *      upstream content and commits it as a NEW local commit, so HEAD can
 *      never equal upstream main's SHA again — SHA inequality alone is the
 *      steady state of every healthy install, not drift.
 *   2. Upstream changed system files this install has not adopted. That is
 *      real drift worth surfacing (#2630).
 *
 * Only content settles it: a ref-to-ref diff scoped to the system paths.
 * Compared against the COMMITTED state (HEAD), deliberately not the working
 * tree — uncommitted local edits to system files are the preserved-edit case
 * apply() already handles with .bak + messaging (#2337), not an update
 * waiting to happen.
 *
 * `--ignore-cr-at-eol`: a file whose only difference is a CRLF/LF line ending
 * must not read as drift. Installs that last synced before `.gitattributes`
 * was introduced carry pre-renormalization blobs that differ from upstream by
 * line endings alone (#2817 — same rationale as locallyModifiedSystemFiles).
 *
 * Failure is conservative by design: an unreadable ref or a git error throws
 * inside the diff and reads as drift, which preserves the pre-fix behavior
 * whenever content cannot be verified.
 *
 * @param {string[]} systemPaths - Pathspecs scoping the diff (SYSTEM_PATHS).
 * @param {string} [upstreamRef='FETCH_HEAD'] - Ref holding upstream content.
 * @param {{git?: (...args: string[]) => string}} [ctx] - Test seam: override
 *   the git runner (defaults to the module-level git() against ROOT).
 * @returns {boolean} True when committed system content differs (or cannot
 *   be proven identical); false when the trees match.
 */
export function systemTreeDiffers(systemPaths, upstreamRef = 'FETCH_HEAD', ctx = {}) {
  const runGit = ctx.git || git;
  if (!systemPaths || systemPaths.length === 0) return false;
  try {
    // --quiet: exit 0 when identical; exit 1 when they differ, which
    // execFileSync surfaces as a throw — indistinguishable here from any
    // other failure, and every throw lands on the conservative answer.
    runGit('diff', '--quiet', '--ignore-cr-at-eol', upstreamRef, 'HEAD', '--', ...systemPaths);
    return false;
  } catch {
    return true;
  }
}

/**
 * System-layer files this install changed locally that the update is about to
 * overwrite (#2337).
 *
 * apply() checks out every SYSTEM_PATHS entry from the upstream ref — a raw
 * checkout, not a merge — so a local fix to a system file is discarded with no
 * diff, no warning, and no list. The system layer stays system-owned (this is
 * NOT a merge, by design); the point is telling people what they are about to
 * lose.
 *
 * A file is at risk only when BOTH hold:
 *
 *   1. it differs from the merge-base — the last commit this install shares
 *      with upstream, i.e. the baseline it was last synced to. Anything that
 *      differs from it was changed HERE, whether committed or still in the
 *      working tree (`git diff <ref> -- <path>` compares against the worktree);
 *   2. it differs from the upstream ref. A local fix upstream has since adopted
 *      independently is byte-identical there, so the checkout costs nothing and
 *      warning about it would be noise — the exact case the #2337 reporter
 *      isolated when one of their two fixes survived an update.
 *
 * @param {string[]} paths - manifest entries (files or `dir/` prefixes).
 * @param {string} upstreamRef - ref being checked out, normally FETCH_HEAD.
 * @param {{git?: Function}} [ctx] - injectable git runner, for tests.
 * @returns {string[]} repo-relative file paths, sorted.
 */
export function locallyModifiedSystemFiles(paths, upstreamRef = 'FETCH_HEAD', ctx = {}) {
  const runGit = ctx.git || git;
  if (!paths || paths.length === 0) return [];

  const diffNames = (ref) => {
    try {
      // `--ignore-cr-at-eol`: a file whose only difference is a CRLF/LF line
      // ending must not read as a local edit. Installs that last synced before
      // `.gitattributes` was introduced (80d104f9) have a merge-base predating
      // it, so every text file not renormalized in that commit differs from the
      // baseline by line endings alone — which otherwise flags ~150 untouched
      // files and silently no-ops the whole update (#2817). This ignores only
      // the carriage return at end of line, so a genuine trailing-whitespace or
      // content edit is still detected.
      //
      // `--numstat`, deliberately, NOT `--name-only`: `--name-only` can list a
      // path on the blob-OID comparison alone, before the textual diff runs, so
      // a CRLF/LF-only file survives `--ignore-cr-at-eol` and the guard leaks
      // right back. `--numstat` forces the textual diff, so the ignore rule is
      // actually applied and a CR-only file drops out of the output entirely.
      // The path is field 3 (a binary file renders as `-\t-\tpath`, still field
      // 3). Reads less obviously than `--name-only`; keep it as-is.
      return runGit('diff', '--ignore-cr-at-eol', '--numstat', ref, '--', ...paths)
        .split('\n').map((l) => l.trim()).filter(Boolean)
        .map((l) => l.split('\t')[2]).filter(Boolean);
    } catch {
      // An unreadable ref (shallow clone, unrelated histories) must never abort
      // the update — it degrades the warning, not the checkout.
      return [];
    }
  };

  // An updater commit is the installed system snapshot. On a later update,
  // using the original merge-base would mistake the previous update's files
  // for user edits. Keep the merge-base fallback for installations without a
  // recorded updater commit.
  let baseline = null;
  try {
    const updaterCommit = runGit(
      'log', '-1', '--format=%H', '--grep=^chore: auto-update system files', 'HEAD',
    ).trim();
    if (updaterCommit) {
      runGit('merge-base', '--is-ancestor', updaterCommit, 'HEAD');
      baseline = updaterCommit;
    }
  } catch {
    baseline = null;
  }
  if (!baseline) {
    try {
      baseline = runGit('merge-base', 'HEAD', upstreamRef) || null;
    } catch {
      baseline = null;
    }
  }

  const changedLocally = new Set(diffNames(baseline || 'HEAD'));
  const differsFromUpstream = new Set(diffNames(upstreamRef));
  const atRisk = [...changedLocally].filter((file) => differsFromUpstream.has(file));

  // `git diff` never lists untracked files, so a file created locally at a path
  // the upstream ref DOES ship escapes both sets above — and the checkout
  // overwrites it with no warning and no .bak, which is the very loss mode this
  // exists to prevent. Only untracked files upstream actually ships can be
  // clobbered, so the upstream existence check is the whole filter.
  let untracked = [];
  try {
    untracked = runGit('ls-files', '--others', '--exclude-standard', '--', ...paths)
      .split('\n').map((f) => f.trim()).filter(Boolean);
  } catch {
    // Same degradation contract as diffNames: a warning we cannot compute must
    // never abort the update.
  }
  for (const file of untracked) {
    try {
      runGit('cat-file', '-e', `${upstreamRef}:${file}`);
      atRisk.push(file);
    } catch {
      // Purely local file, absent upstream — the checkout cannot touch it.
    }
  }

  // A path that is not on disk cannot be overwritten, so it is not at risk.
  // `git diff --name-only` lists DELETIONS, so a system file the user removed
  // landed in both sets above and was then "preserved" — excluded from the
  // checkout, which is exactly what stops it being restored. The update printed
  // `Keeping your versions` about a file that does not exist, failed to write
  // its `.bak` with ENOENT, and exited 1 telling the user to run apply again;
  // re-running reproduces the same state, so the install stayed stuck. Filtering
  // here also gives the `.bak` failure branch back its single meaning: a backup
  // that genuinely could not be written (permissions, full disk).
  const root = ctx.root || ROOT;
  return [...new Set(atRisk)]
    .filter((file) => existsSync(join(root, ...file.split('/'))))
    .sort();
}

export function revertPaths(paths, protectedPaths = new Set(), ctx = {}) {
  const runGit = ctx.git || git;
  const root = ctx.root || ROOT;
  if (paths.length === 0) return;
  // Must restore from HEAD, not from the index (#915 bug 1). After
  // `git checkout FETCH_HEAD -- <path>` the index already holds the new
  // content, so `git checkout -- <path>` (index→worktree) is a no-op.
  // `git checkout HEAD -- <path>` resets both the index and the worktree
  // to the pre-update commit, which is the correct rollback target.
  for (const p of paths) {
    try {
      runGit('checkout', 'HEAD', '--', p);
    } catch (err) {
      const pathspec = p.endsWith('/') ? p.slice(0, -1) : p;
      // Only remove if the path genuinely doesn't exist in HEAD.
      // Other errors (permissions, corrupt refs) should re-throw.
      let existsInHead = true;
      try { runGit('cat-file', '-e', `HEAD:${pathspec}`); } catch { existsInHead = false; }
      if (existsInHead) throw err;
      // Path was newly introduced by the update — remove it so the
      // working tree is consistent with HEAD.
      try { runGit('rm', '-r', '-f', '--ignore-unmatch', '--', pathspec); } catch { /* ignore */ }
      try { rmSync(join(root, pathspec), { recursive: true, force: true }); } catch { /* already gone */ }
    }
    // A directory pathspec that exists in HEAD checks out cleanly above, so the
    // catch never runs — but `git checkout HEAD -- docs/` only restores files
    // HEAD already knows about. Files the update introduced *under* that
    // directory are not in HEAD, so they survive the rollback as staged
    // additions and the tree is left dirtier than before the update (#2015).
    removeAdditionsNotInHead(p, protectedPaths, ctx);
  }
}

/**
 * Delete files staged as additions relative to HEAD under a pathspec.
 *
 * Complements `git checkout HEAD -- <path>`, which restores tracked content but
 * never removes paths HEAD does not contain. Only additions are considered, so
 * a user file that merely changed is untouched.
 *
 * @param {string} pathspec - SYSTEM_PATHS entry (file or directory).
 * @param {Set<string>} protectedPaths - Paths already dirty/staged BEFORE the
 *   update ran; never deleted, so a rollback cannot destroy the user's own
 *   pre-existing staged work under a system pathspec (#2015).
 * @param {{git?: typeof git, root?: string}} [ctx] - Testability seam: the git
 *   runner (defaults to the module `git`, bound to ROOT) and the working-tree
 *   root used for filesystem deletes. Production always uses the defaults; only
 *   the behavioral rollback test overrides them to drive a throwaway repo.
 */
export function removeAdditionsNotInHead(pathspec, protectedPaths = new Set(), ctx = {}) {
  const runGit = ctx.git || git;
  const root = ctx.root || ROOT;
  const spec = pathspec.endsWith('/') ? pathspec.slice(0, -1) : pathspec;
  let added = '';
  try {
    // -z: NUL-delimited, unquoted output, so paths containing spaces or even
    // newlines survive intact — `split('\n').trim()` would mangle them.
    added = runGit('diff', '--cached', '-z', '--name-only', '--diff-filter=A', 'HEAD', '--', spec);
  } catch {
    // No HEAD yet, or an unreadable pathspec — nothing safe to clean up.
    return;
  }
  for (const file of added.split('\0').filter(Boolean)) {
    // Never touch something the user already had staged before the update —
    // only additions THIS update introduced (#2015 review: no data loss).
    if (protectedPaths.has(file)) continue;
    let removed = false;
    try {
      runGit('rm', '-f', '--ignore-unmatch', '--', file);
      removed = true;
    } catch {
      // Index removal failed (lock/permission). Leave both the index entry AND
      // the worktree file in place and keep rolling back the rest — deleting
      // the worktree copy now would strand a staged addition with no file.
      console.error(`Rollback: could not unstage ${file}; leaving it untouched.`);
    }
    if (removed) {
      try { rmSync(join(root, file), { force: true }); } catch { /* already gone */ }
    }
  }
}

function addPaths(paths) {
  if (paths.length === 0) return;
  git('add', '--', ...paths);
}

// Git's "exclude this from the pathspec" magic prefix. Preserved files are held
// out of the checkout, the staging and the scoped commit with it, so the one
// place that has to recognise such an entry again — the index-commit guard —
// reads the prefix from here rather than re-spelling it.
const EXCLUDE_PATHSPEC_PREFIX = ':(exclude)';

/**
 * Staged paths that are NOT covered by `owned`.
 *
 * Used to decide whether committing the whole index is equivalent to a
 * pathspec-scoped commit. Entries in `owned` may be directories (`providers/`,
 * `tests/`), which cover everything beneath them, or exact file paths.
 *
 * `preserved` is the update's preserved-file list (#2337): system files THIS
 * install modified locally, which the update deliberately leaves alone. They are
 * not the update's to commit, so a staged preserved path is reported as
 * unrelated even when an owned DIRECTORY contains it — `providers/acme.mjs` is
 * unrelated although `providers/` is owned.
 *
 * It has to be passed separately rather than inferred from `owned`, because the
 * caller expresses preservation as `:(exclude)<path>` git pathspecs and those
 * never match a staged path: the `providers/` entry would still claim the file,
 * the guard would wave the bare index commit through, and the content the user
 * asked to keep would be swept into it — #915 bug 2, reintroduced through the
 * guard that exists to prevent it.
 *
 * Deliberately reads `--cached` rather than `git status`: only what is STAGED
 * can end up in a commit, and an unstaged working-tree edit is irrelevant to
 * that question.
 *
 * Takes the git runner as a seam (defaulting to the ROOT-bound one) so it can be
 * driven against a throwaway repo, matching removeAdditionsNotInHead and
 * tests/updater-rollback-behavior.test.mjs.
 *
 * Takes a RAW git runner — one that does not trim — because a path may
 * legitimately begin or end with a space and trimming would rewrite it.
 *
 * @param {string[]} owned
 * @param {string[]} [preserved] exact paths the update leaves to the user
 * @param {(...args: string[]) => string} [run] raw git runner; defaults to ROOT
 * @returns {string[]} staged paths the update does not own (empty ⇒ safe to commit the index)
 */
export function stagedPathsOutside(owned, preserved = [], run = (...args) => gitRawIn(ROOT, ...args)) {
  // -z, and no trimming. Without it git quotes any path holding a space, quote
  // or newline, and trimming would additionally rewrite a legitimate name: a
  // staged ` scan.mjs` (leading space) becomes `scan.mjs`, matches an owned
  // entry, and is silently treated as the update's own file — sweeping a user's
  // work into the commit, which is the exact #915 bug 2 regression this guard
  // exists to prevent. NUL-delimited output is unambiguous and unquoted.
  const staged = run('diff', '--cached', '--name-only', '-z');
  if (!staged) return [];

  const files = new Set();
  const dirs = [];
  for (const entry of owned) {
    if (entry.endsWith('/')) dirs.push(entry);
    else files.add(entry);
  }
  // Preservation wins over ownership, hence the check BEFORE the owned lookups:
  // being inside an owned directory is exactly the case that would otherwise
  // claim a preserved file. Exact paths only — the preserved list comes from
  // `git diff --name-only` / `git ls-files`, which never emit directories.
  const preservedFiles = new Set(preserved);

  return staged.split('\0')
    .filter(path => path !== '')
    .filter(path => preservedFiles.has(path)
      || (!files.has(path) && !dirs.some(dir => path.startsWith(dir))));
}

function dashboardGoSourcesChanged() {
  try {
    const changed = git('diff', '--name-only', 'HEAD', '--', 'dashboard');
    return changed
      .split('\n')
      .some(path => path.startsWith('dashboard/') && path.endsWith('.go'));
  } catch {
    return false;
  }
}

function rebuildDashboardBinaryIfNeeded() {
  if (!dashboardGoSourcesChanged()) return;

  try {
    execFileSync('go', ['build', '-o', 'career-dashboard', '.'], {
      cwd: join(ROOT, 'dashboard'),
      timeout: DASHBOARD_REBUILD_TIMEOUT_MS,
      stdio: 'pipe',
    });
    console.log('dashboard binary rebuilt');
  } catch {
    console.log('dashboard binary rebuild skipped -- run: cd dashboard && go build -o career-dashboard . manually');
  }
}

// ── CHECK ───────────────────────────────────────────────────────

// curl helper used by check() — curl works inside the Claude Code sandbox
// where Node's built-in fetch() fails (ENOTFOUND) because the sandbox
// routes network traffic through an HTTP/HTTPS proxy that fetch() does
// not respect but curl handles transparently.  The --silent / --fail flags
// match the failure-handling already used throughout apply().
function curlGet(url, extraArgs = []) {
  return new Promise((resolve) => {
    execFile(
      'curl',
      ['--silent', '--fail', '--max-time', '10', ...extraArgs, url],
      { encoding: 'utf-8', timeout: 12000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

async function check() {
  // Respect dismiss flag
  if (existsSync(join(ROOT, '.update-dismissed'))) {
    console.log(JSON.stringify({ status: 'dismissed' }));
    return;
  }

  // Before any git call: on an install nested inside a foreign repository the
  // rev-parse below reads the OUTER repo's HEAD and the drift fetch writes the
  // OUTER repo's FETCH_HEAD, so check reports a phantom system-files-changed
  // forever on a byte-identical install (#3334). Report the layout as its own
  // status instead; agents ignore unknown statuses by contract (AGENTS.md),
  // and apply() refuses the same layout with the actionable message.
  const foreignToplevel = gitToplevelMismatch();
  if (foreignToplevel) {
    console.log(JSON.stringify({ status: 'not-a-git-toplevel', local: localVersion(), toplevel: foreignToplevel }));
    return;
  }

  const local = localVersion();
  let remote = '';
  let releaseVersion = '';
  let changelog = '';
  let localCommit = '';
  let remoteCommit = '';

  // Use curl instead of fetch() so the check works inside the Claude Code
  // sandbox (see curlGet() above for rationale).  Two sources are tried;
  // both failing is the only true-offline signal.
  const [rawVersion, releaseRaw] = await Promise.all([
    curlGet(RAW_VERSION_URL),
    curlGet(RELEASES_API, [
      '--header', 'Accept: application/vnd.github.v3+json',
      '--header', 'User-Agent: career-ops-update-checker',
    ]),
  ]);

  // VERSION is release metadata, not a complete description of the system
  // tree. Compare the installed commit with main as well, so same-version
  // manifest/file drift is visible (#2630). A failed commit lookup is
  // deliberately conservative: version checks still work offline/behind a
  // restricted git transport.
  try { localCommit = gitQuiet('rev-parse', 'HEAD'); } catch { /* no git checkout */ }
  const remoteRef = await curlGet('https://api.github.com/repos/santifer/career-ops/git/ref/heads/main', [
    '--header', 'Accept: application/vnd.github+json',
    '--header', 'User-Agent: career-ops-update-checker',
  ]);
  if (remoteRef !== null) {
    try { remoteCommit = String(JSON.parse(remoteRef)?.object?.sha || '').trim(); } catch { /* malformed API response */ }
  }

  if (rawVersion !== null) {
    try {
      const raw = parseVersionFile(rawVersion);
      const match = raw.match(SEMVER_RE);
      remote = match ? match[1] : '';
    } catch {
      // Unparseable body; treat as no VERSION source
    }
  }

  if (releaseRaw !== null) {
    try {
      const release = JSON.parse(releaseRaw);
      changelog = release.body || '';
      const rawTag = String(release.tag_name || '').trim();
      const match = rawTag.match(SEMVER_RE);
      releaseVersion = match ? match[1] : '';
    } catch {
      // Unparseable body; treat as no release source
    }
  }

  if (!remote && !releaseVersion) {
    // Both curl calls returned null → genuine network failure.
    // If one returned non-null but unparseable, remote/releaseVersion are
    // empty strings, which still reaches the offline branch — that's the
    // right conservative behaviour (no version = can't determine status).
    const bothNetworkFailed = rawVersion === null && releaseRaw === null;
    const status = bothNetworkFailed ? 'offline' : 'no-remote-version';
    console.log(JSON.stringify({ status, local }));
    return;
  }

  // Use the higher version between VERSION file and GitHub Release
  // (handles cases where VERSION file is not bumped after a release,
  // or the raw host is unreachable but the API is).
  if (!remote) {
    remote = releaseVersion;
  } else if (releaseVersion && compareVersions(releaseVersion, remote) > 0) {
    remote = releaseVersion;
  }

  // SHA inequality alone is NOT drift. apply() commits upstream content as a
  // NEW local commit on the install's own history, so after any successful
  // update HEAD never equals upstream main again — treating SHA mismatch as
  // drift made every post-apply check report system-files-changed forever.
  // Settle it on CONTENT instead: fetch upstream (exactly what apply() does)
  // and diff the committed system tree (#2630's same-version drift intent).
  // Computed after the offline early-return above, so a machine with no
  // network never pays for a doomed git fetch. Fetch/diff failure stays
  // conservative (drift reported), matching the failed-commit-lookup policy
  // at the top of this function.
  let systemTreeDrift = false;
  if (localCommit && remoteCommit && localCommit !== remoteCommit) {
    try {
      gitQuiet('fetch', '--quiet', CANONICAL_REPO, 'main');
      systemTreeDrift = systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD');
    } catch {
      systemTreeDrift = true;
    }
  }

  if (compareVersions(local, remote) >= 0 && !systemTreeDrift) {
    console.log(JSON.stringify({ status: 'up-to-date', local, remote, local_commit: localCommit || undefined, remote_commit: remoteCommit || undefined }));
    return;
  }

  console.log(JSON.stringify({
    status: 'update-available',
    local,
    remote,
    reason: systemTreeDrift ? 'system-files-changed' : 'version-changed',
    local_commit: localCommit || undefined,
    remote_commit: remoteCommit || undefined,
    changelog: changelog.slice(0, 500),
  }));
}

// ── .gitignore RECONCILE ────────────────────────────────────────

// The header the appended block is written under. Purely cosmetic: the
// reconciler keys off pattern presence, never off this marker, so a user who
// deletes or moves it loses nothing.
const GITIGNORE_BLOCK_HEADER = [
  '# Added by career-ops update-system.mjs.',
  '# System-owned ignore rules that were missing from this file. Your own rules',
  '# are never modified, reordered or removed: the updater only appends patterns',
  '# it cannot already find somewhere in this file. Reordering these lines, or',
  '# moving them elsewhere in the file, is safe and will not bring them back.',
  '# Deleting or commenting one out is not: they are system-owned, several of',
  '# them guard files holding personal data, and the next update re-adds any',
  '# that is no longer present as a live pattern.',
];

/**
 * Read a blob from a git ref verbatim, with no trimming.
 *
 * `gitQuiet()` calls `.trim()` on stdout, which is right for the SHAs and
 * pathspecs every other caller reads and wrong for file CONTENT: it strips a
 * significant backslash-escaped trailing space from the blob's final line, and
 * the final newline with it. For .gitignore that silently defeats the verbatim
 * guarantee reconcileGitignore() is built on, at the one line most likely to be
 * a freshly appended rule.
 *
 * @param {string} spec - A `<ref>:<path>` blob spec, e.g. `FETCH_HEAD:.gitignore`.
 * @returns {string} The blob's exact bytes as UTF-8, untrimmed.
 */
function gitShowRaw(spec) {
  const args = ['show', spec];
  const timeout = gitTimeoutMs(args);
  try {
    return execFileSync('git', args, {
      cwd: ROOT, encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (isTimeoutLikeError(err)) {
      throw new Error(`${describeGitCommand(args)} timed out after ${timeoutSeconds(timeout)}s. If your network is slow, retry or set ${gitTimeoutEnvVar(args)} to a larger value.`);
    }
    throw err;
  }
}

/**
 * Write .gitignore atomically: temp file on the same filesystem, then rename.
 *
 * writeFileSync opens with O_TRUNC, so a crash or I/O error partway through
 * leaves the file empty or half-written. For most files that is an annoyance.
 * For this one it un-ignores everything the truncated portion covered, turning
 * a failed update into exactly the exposure the file exists to prevent, and
 * doing it silently. Mirrors discover-ats.mjs and followup-seed.mjs.
 *
 * Lazy-imports `renameSyncWithRetry` (see the top-of-file self-loading note —
 * a static import of tracker-utils.mjs here would crash a pre-#1245 client's
 * old→new re-exec the same way a static scaffolder/ import would, #1706).
 *
 * @param {string} filePath - Absolute path to write.
 * @param {string} content - Full file content.
 * @returns {Promise<void>}
 */
async function writeGitignoreAtomic(filePath, content) {
  const { renameSyncWithRetry } = await import('./tracker-utils.mjs');
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmpPath, content);
    renameSyncWithRetry(tmpPath, filePath);
  } catch (err) {
    // The original is still intact: the rename either happened or it did not.
    try { rmSync(tmpPath, { force: true }); } catch { /* already gone */ }
    throw err;
  }
}

/**
 * Reconcile a local .gitignore against the upstream one by appending only the
 * system-owned patterns it is missing.
 *
 * .gitignore cannot join SYSTEM_PATHS: unlike every other system file it is
 * co-owned. Users add their own rules to it, and the raw `git checkout` the
 * update stage performs would delete those silently, which is a worse bug than
 * the one this fixes. So it gets the append-if-missing treatment
 * agent-inbox.mjs:ensureGitignored() already applies to its own single rule,
 * generalized to the whole upstream rule set.
 *
 * Deliberately append-only. An upstream rule that was REMOVED or REWRITTEN
 * (e.g. `*.bak` becoming `*.bak*`) leaves the superseded line in place, because
 * there is no way to tell a stale system rule from a user rule the same shape.
 * A redundant ignore rule is harmless; deleting a user's is not.
 *
 * Ordering caveat: missing patterns are appended at the end in upstream order,
 * which preserves each negation's position relative to the pattern it negates
 * *within the appended block*. A user-authored negation earlier in the file can
 * still be overridden by a newly appended pattern, since later lines win in
 * .gitignore. That is the correct precedence for a system rule, and it is the
 * only ordering that does not require rewriting lines we do not own.
 *
 * @param {string} localText - Current .gitignore content.
 * @param {string} upstreamText - Upstream .gitignore content (FETCH_HEAD).
 * @returns {{ text: string, added: string[] }} Reconciled content and the
 *   patterns appended. `added` is empty and `text` is byte-identical to
 *   `localText` when nothing was missing, which is what makes repeated runs
 *   idempotent and keeps a no-op update out of the commit.
 */
export function reconcileGitignore(localText, upstreamText) {
  // One set for both patterns and comments. A comment can never collide with a
  // pattern (only comments start with '#'), so membership answers both "does
  // this install already have this rule?" and "has this rationale block already
  // been copied by an earlier update?" with no second structure to keep in sync.
  const seen = new Set(localText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ''));

  const block = [];
  const added = [];
  let pendingComments = [];
  for (const raw of upstreamText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') { pendingComments = []; continue; }
    if (line.startsWith('#')) { pendingComments.push([raw, line]); continue; }
    if (seen.has(line)) { pendingComments = []; continue; }
    // Carry the rule's own rationale across with it. Several of these comments
    // are the only record of WHY a path is ignored (which ones hold PII, why a
    // glob has a trailing `*`), and an install that gets the pattern without
    // the reason is one edit away from removing it as noise.
    for (const [rawComment, comment] of pendingComments) {
      if (!seen.has(comment)) { block.push(rawComment); seen.add(comment); }
    }
    pendingComments = [];
    // Emitted verbatim, compared normalized. A pattern whose trailing space is
    // backslash-escaped (`secret\ `) is significant in .gitignore and would be
    // corrupted by writing back the trimmed form used for matching.
    block.push(raw);
    added.push(line);
    // Guard against an upstream file that lists the same pattern twice.
    seen.add(line);
  }

  if (added.length === 0) return { text: localText, added };

  // Match the local file's dominant line ending. A checkout on Windows under
  // `core.autocrlf=true` leaves CRLF on disk, and appending LF-only lines to it
  // makes `git diff` show the whole file as changed.
  const crlfCount = (localText.match(/\r\n/g) || []).length;
  const lfCount = (localText.match(/\n/g) || []).length - crlfCount;
  const eol = crlfCount > lfCount ? '\r\n' : '\n';
  const body = [...GITIGNORE_BLOCK_HEADER, ...block].join(eol);
  // localText is concatenated verbatim, never trimmed. A local rule whose
  // trailing space is backslash-escaped is significant, and stripping it would
  // MODIFY a user's line, which is the one thing this function promises not to
  // do. Only the separator varies: none for an empty file, one EOL when the
  // file already ends in a newline, two when it does not.
  const separator = localText === ''
    ? ''
    : (/\r?\n$/.test(localText) ? eol : `${eol}${eol}`);
  return { text: `${localText}${separator}${body}${eol}`, added };
}

// ── APPLY ───────────────────────────────────────────────────────

async function apply() {
  assertOwnGitToplevel();
  const local = localVersion();
  // --force overwrites system files this install edited locally (#2337). The
  // env var carries the flag across the self-reexec, which re-invokes the
  // TARGET updater as `update-system.mjs apply` with a fixed argv.
  const updateForce = process.argv.includes('--force') || process.env.CAREER_OPS_UPDATE_FORCE === '1';
  const initialStatusPaths = new Set(gitStatusEntries().map(entry => entry.path));
  const isReexec = process.env.CAREER_OPS_UPDATE_REEXEC === '1';

  // Check for lock
  const lockFile = join(ROOT, '.update-lock');
  if (existsSync(lockFile) && !isReexec) {
    console.error('Update already in progress (.update-lock exists). If stuck, delete it manually.');
    process.exit(1);
  }

  // Create lock
  if (!isReexec) {
    writeFileSync(lockFile, new Date().toISOString());
  }

  try {
    // 1. Backup: create branch + stash uncommitted work (#915 bug 3).
    // The branch only captures committed state; any uncommitted edits are
    // invisible to `git branch` and can be lost if the update aborts.
    // `git stash create` builds a stash object without touching the stash
    // stack, giving a recoverable ref for WIP even if the update fails.
    const backupBranch = process.env.CAREER_OPS_UPDATE_BACKUP_BRANCH || updateBackupBranchName(local);
    if (!isReexec) {
      try {
        const wip = git('stash', 'create');
        if (wip) {
          git('update-ref', `refs/backup-pre-update-wip/${local}`, wip);
          console.log(`WIP stash ref saved: refs/backup-pre-update-wip/${local} (recover with: git stash apply refs/backup-pre-update-wip/${local})`);
        }
      } catch {
        // Non-fatal: stash creation can fail in bare repos or empty trees.
      }
      git('branch', backupBranch);
      console.log(`Backup branch created: ${backupBranch}`);
    }

    // 2. Fetch from canonical repo
    console.log('Fetching latest from upstream...');
    git('fetch', CANONICAL_REPO, 'main');

    if (!isReexec) {
      const timeout = reexecTimeoutMs();
      try {
        // The re-exec runs the TARGET updater, so every local module it imports
        // at load time must exist first. Resolve the fetched update-system.mjs's
        // relative-import closure and check out exactly those files, so a future
        // new top-level import can't reintroduce the self-reexec crash (#1245).
        const reexecFiles = resolveReexecCheckout('FETCH_HEAD', 'update-system.mjs');
        git('checkout', 'FETCH_HEAD', '--', ...reexecFiles);
        execFileSync(process.execPath, ['update-system.mjs', 'apply'], {
          cwd: ROOT,
          stdio: 'inherit',
          timeout,
          env: {
            ...process.env,
            CAREER_OPS_UPDATE_REEXEC: '1',
            CAREER_OPS_UPDATE_BACKUP_BRANCH: backupBranch,
            ...(updateForce ? { CAREER_OPS_UPDATE_FORCE: '1' } : {}),
          },
        });
        return;
      } catch (err) {
        if (isTimeoutLikeError(err)) {
          console.error(`Updater self-reexec timed out after ${timeoutSeconds(timeout)}s.`);
          throw err;
        }
        console.error(`Updater self-reexec failed: ${err.message}`);
        throw err;
      }
    }

    // 3. Checkout system files only
    console.log('Updating system files...');
    const updated = [];
    let remoteSystemPaths = [];
    try {
      const remoteUpdaterSource = git('show', 'FETCH_HEAD:update-system.mjs');
      remoteSystemPaths = extractArrayFromSource(remoteUpdaterSource, 'SYSTEM_PATHS');
    } catch {
      // Older targets may not have update-system.mjs. Fall back to the
      // local manifest plus bootstrap paths below.
    }

    // 3a. Keep bootstrap paths as a fallback for very old targets, but the
    // target updater's SYSTEM_PATHS is now the source of truth for new files.
    const updatePaths = mergePathLists(SYSTEM_PATHS, remoteSystemPaths, BOOTSTRAP_PATHS);

    // 3b. Local edits to system files (#2337). The checkout is a raw overwrite,
    // so anything this install fixed locally and upstream has not adopted is
    // about to vanish silently. Default is to KEEP the local version and say
    // so; `--force` overwrites. Either way a .bak of the local content is
    // written first, so the fix is recoverable even from the forced path.
    const preservedPaths = [];
    const atRisk = locallyModifiedSystemFiles(updatePaths, 'FETCH_HEAD');
    if (atRisk.length > 0) {
      console.log('');
      console.log(`${atRisk.length} system file(s) differ from upstream because THIS install changed them:`);
      for (const file of atRisk) {
        const backup = `${join(ROOT, ...file.split('/'))}.bak`;
        try {
          copyFileSync(join(ROOT, ...file.split('/')), backup);
          console.log(`  ${file}  (local copy saved: ${file}.bak)`);
        } catch (err) {
          // A .bak we could not write is worth saying out loud, but it must not
          // abort the update — the file itself is still listed either way.
          console.log(`  ${file}  (could not write ${file}.bak: ${err.message})`);
        }
      }
      if (updateForce) {
        console.log('--force: overwriting them with the upstream version.');
      } else {
        preservedPaths.push(...atRisk);
        console.log('Keeping your versions. They will NOT receive upstream changes.');
        console.log('Re-run with `node update-system.mjs apply --force` to take the upstream version instead.');
      }
      console.log('');
    }
    // Excluding by pathspec keeps the index and the working tree in agreement:
    // checking out and restoring afterwards would leave the index holding the
    // upstream blob, so the scoped commit below would record the very content
    // the user asked to keep out.
    const preserveSpecs = preservedPaths.map((file) => `${EXCLUDE_PATHSPEC_PREFIX}${file}`);

    const preservedSet = new Set(preservedPaths);

    const skippedPaths = [];
    for (const path of updatePaths) {
      // `git checkout <ref> -- <path> :(exclude)<path>` errors with "did not
      // match any file(s)" when the exclusions cancel the whole pathspec — and
      // that error is indistinguishable from a genuine failure at the catch
      // below, so it would abort the entire update. Skip the entry instead when
      // nothing would be left to check out. Only entries that actually contain
      // a preserved file pay for the extra ls-tree, normally none.
      if (preservedSet.size > 0) {
        const preservedHere = preservedPaths.filter((f) => (path.endsWith('/') ? f.startsWith(path) : f === path));
        if (preservedHere.length > 0) {
          let upstreamFiles = [];
          try {
            upstreamFiles = gitQuiet('ls-tree', '-r', '--name-only', 'FETCH_HEAD', '--', path)
              .split('\n').map((f) => f.trim()).filter(Boolean);
          } catch {
            // Unreadable entry — fall through to the normal checkout, which
            // reports the real failure with its own diagnostics.
          }
          if (upstreamFiles.length > 0 && upstreamFiles.every((f) => preservedSet.has(f))) continue;
        }
      }
      try {
        // stderr is piped rather than inherited here. A path absent upstream is
        // an EXPECTED skip (a stale manifest entry such as `.gemini/commands/`),
        // but execFileSync inherits stderr by default, so git printed
        // `error: pathspec '...' did not match any file(s) known to git`
        // immediately before the success banner — which reads as a failed
        // update and sends people chasing the wrong root cause (#1998).
        gitQuiet('checkout', 'FETCH_HEAD', '--', path, ...preserveSpecs);
        updated.push(path);
      } catch (err) {
        // A path genuinely absent upstream is the expected skip. But the catch
        // also caught timeouts, permission errors, and repo corruption and
        // reported them as skips too — letting a partial update reach the
        // success banner (#1998). Confirm the path is actually absent from
        // FETCH_HEAD before treating the failure as benign; otherwise rethrow.
        const spec = path.endsWith('/') ? path.slice(0, -1) : path;
        let absentUpstream = false;
        try { gitQuiet('cat-file', '-e', `FETCH_HEAD:${spec}`); }
        catch { absentUpstream = true; }
        if (!absentUpstream) throw err;
        skippedPaths.push(path);
      }
    }
    if (skippedPaths.length > 0) {
      console.log(`Skipped ${skippedPaths.length} path(s) absent upstream: ${skippedPaths.join(', ')}`);
    }

    // All tracked system files need the same stale-file treatment. In
    // particular, root-level system files removed upstream (for example an
    // old plugins-registry.json) are not covered by a directory-only prune.
    // Never infer a deletion from an empty/failed tree lookup, and never touch
    // untracked files or paths explicitly classified as user data (#2532).
    try {
      let remoteFiles = new Set();
      try {
        remoteFiles = new Set(
          git('ls-tree', '-r', '--name-only', 'FETCH_HEAD')
            .split('\n').filter(Boolean).map((p) => p.replace(/\\/g, '/'))
        );
      } catch {
        // A failed tree lookup is not evidence that the target is empty.
      }
      if (remoteFiles.size > 0) {
        const localFiles = git('ls-files').split('\n').filter(Boolean);
        // A file just preserved above because THIS install modified it (e.g. a
        // custom cv-template.*.html no longer shipped upstream) must never also
        // be deleted here as "stale" — the two checks used to run independently,
        // so a preserved file with no upstream counterpart was backed up to
        // .bak by the block above and then unlinked by this one in the same run.
        const staleCandidates = staleSystemFiles(localFiles, remoteFiles, SYSTEM_PATHS, mergePathLists(USER_PATHS, preservedPaths));
        for (const f of staleCandidates) {
          if (isReferencedByPreservedFile(f, preservedPaths)) {
            console.log(`Kept stale asset still referenced by a preserved file: ${f}`);
            continue;
          }
          try {
            unlinkSync(join(ROOT, f));
            updated.push(f);
            console.log(`Pruned stale system file: ${f}`);
          } catch (err) {
            console.error(`Failed to prune stale system file ${f}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      console.error(`Stale system-file prune step failed: ${err.message}`);
    }

    // 3c. Reconcile .gitignore (#2756). Every other system file is checked out
    // above; this one cannot be, because it is the one system file users also
    // write to. A raw checkout would delete their rules silently — the same
    // failure shape as the bug being fixed. Append what is missing, touch
    // nothing else. The consequence of skipping it entirely for 43 releases was
    // that new ignore rules never reached an existing install, so a candidate's
    // CV or tracker could sit unignored in a fork after a reflexive `git add .`
    // — exactly what tests/user-layer-gitignored.test.mjs exists to prevent,
    // and what it could only prevent inside this repository.
    try {
      const gitignorePath = join(ROOT, '.gitignore');
      const upstreamGitignore = gitShowRaw('FETCH_HEAD:.gitignore');
      // Uncommitted local edits to .gitignore are the user's, and that is a
      // routine state rather than an exotic one: agent-inbox.mjs's own
      // ensureGitignored() appends a rule without committing it. Such a file
      // must stay OUT of `updated`, for the two reasons #2337 established for
      // system files. `updated` is the rollback pathspec, and revertPaths()
      // runs a bare `git checkout HEAD -- <path>` whose protectedPaths guard
      // covers only newly ADDED files, so a tracked .gitignore would be hard
      // reset and the user's uncommitted rules destroyed. `updated` is also the
      // commit pathspec, so their edit would be swept in under an "auto-update
      // system files" message. The reconciled rules are live on disk either
      // way, which is all that ignoring actually requires.
      const gitignoreWasDirty = initialStatusPaths.has('.gitignore');
      const trackGitignore = () => {
        if (!gitignoreWasDirty) {
          updated.push('.gitignore');
          return;
        }
        console.log('.gitignore had uncommitted local changes. The new rules are applied but left');
        console.log('  unstaged, so they land in your own commit rather than in this update.');
      };
      if (!existsSync(gitignorePath)) {
        // No local file at all (deleted by hand, or a checkout predating it).
        // Nothing is co-owned yet, so the upstream copy can be written whole.
        // Written exactly as upstream has it. The read is untrimmed, so the blob
        // already carries its own final newline; the guard is only for a blob that
        // somehow lacks one.
        const seed = upstreamGitignore.endsWith('\n') ? upstreamGitignore : `${upstreamGitignore}\n`;
        await writeGitignoreAtomic(gitignorePath, seed);
        trackGitignore();
        console.log('Restored .gitignore (it was missing).');
      } else {
        const { text, added } = reconcileGitignore(readFileSync(gitignorePath, 'utf-8'), upstreamGitignore);
        if (added.length > 0) {
          await writeGitignoreAtomic(gitignorePath, text);
          trackGitignore();
          console.log(`.gitignore: appended ${added.length} missing rule(s): ${added.join(', ')}`);
        }
      }
    } catch (err) {
      // Never abort an update over this, but never swallow it either: a silent
      // skip here is precisely how the original bug stayed invisible.
      console.error(`Could not reconcile .gitignore: ${err.message}`);
      console.error('Your own rules were left untouched. Compare manually with: git diff FETCH_HEAD -- .gitignore');
    }

    // Lazy import: keep update-system.mjs self-loading (see the top-of-file
    // note). scaffolder/ was just checked out by the update stage above, so the
    // module resolves here even on a pre-#1245 old→new re-exec.
    const { ensureSkillEntrypoints } = await import('./scaffolder/bin/skill-entrypoints.mjs');
    const materializedSkillEntrypoints = ensureSkillEntrypoints(ROOT);
    if (materializedSkillEntrypoints.length > 0) {
      for (const path of materializedSkillEntrypoints) {
        if (!updated.includes(path)) updated.push(path);
      }
      console.log(`Materialized ${materializedSkillEntrypoints.length} skill entrypoint(s) for filesystems without symlink support`);
    }

    // 4. Validate: check NO user files were touched.
    //
    // Track which user paths the update unexpectedly touched so we
    // can exclude them from the revert and log what was preserved.
    const violatedUserPaths = new Set();
    try {
      // effectiveUserPaths(), not USER_PATHS: a fork's own files are declared
      // in the gitignored local file (#2421) and are just as untouchable as
      // cv.md. Explicit SYSTEM_PATHS entries still override a prefix match
      // (e.g. writing-samples/README.md is system-owned doc inside a user dir).
      const changed = gitStatusEntries()
        .map((entry) => entry.path)
        .filter((file) => !initialStatusPaths.has(file));
      for (const file of userLayerViolations(changed, updatePaths, effectiveUserPaths())) {
        console.error(`SAFETY VIOLATION: User file was modified: ${file}`);
        violatedUserPaths.add(file);
      }
    } catch (err) {
      // Fail closed: if we can't validate the safety invariant we must
      // not silently proceed — that would let a real violation slip
      // through. Revert what we already applied and abort.
      console.error(`Aborting: could not validate user-layer safety (${err.message}).`);
      try {
        revertPaths(updated, initialStatusPaths);
      } catch (revertErr) {
        // If the revert itself fails (likely whatever broke `git
        // status` also broke `git checkout --`), don't lose the
        // original validation error — chain it via `cause`.
        throw new Error(
          `Validation failed (${err.message}) and revert also failed (${revertErr.message})`,
          { cause: err },
        );
      }
      throw err;
    }

    if (violatedUserPaths.size > 0) {
      console.error('Aborting: user files were touched. Rolling back system files...');
      // Revert ONLY the system-layer updates — never `git checkout` the
      // violated user paths back to HEAD. Doing so would overwrite the
      // user's working-tree content (accumulated STAR+R stories, local
      // edits) with whatever is committed upstream, causing data loss.
      // The user files were flagged as touched by the update, not by the
      // user; leaving them as-is is the safe choice — the user decides
      // what to do with them.
      const violation = new Error('Update aborted: user files were touched.');
      try {
        revertPaths([...updated], initialStatusPaths);
      } catch (revertErr) {
        // If the revert itself fails, don't lose the safety-violation
        // diagnostic — chain it via `cause` so the user sees both.
        throw new Error(
          `Safety violation (${violation.message}) and revert also failed (${revertErr.message})`,
          { cause: violation },
        );
      }
      console.error(`User file(s) left as-is (your content was NOT overwritten):`);
      for (const f of violatedUserPaths) console.error(`  ${f}`);
      // `throw` (not `process.exit`) so the outer `finally` runs and
      // .update-lock is removed. Exiting here would leak the lock and
      // permanently block subsequent updates until the user deletes
      // it manually.
      throw violation;
    }

    // 5. Install any new dependencies
    try {
      execSync('npm install --silent', { cwd: ROOT, timeout: NPM_INSTALL_TIMEOUT_MS });
    } catch {
      console.log('npm install skipped (may need manual run)');
    }

    // 5b. Ensure Playwright browser binary is up to date after npm install
    try {
      execSync('npx playwright install chromium', { cwd: ROOT, timeout: PLAYWRIGHT_INSTALL_TIMEOUT_MS, stdio: 'ignore' });
    } catch {
      console.log('playwright install skipped (run manually: npx playwright install chromium)');
    }

    // 6. Rebuild compiled dashboard if Go sources changed
    rebuildDashboardBinaryIfNeeded();

    // 7. Commit the update
    const remote = localVersion(); // Re-read after checkout updated VERSION
    // Files deliberately left untouched are excluded from the staging pathspec
    // too: this update did not change them, so an "auto-update system files"
    // commit must not sweep the user's local edit in under its message (#2337).
    const pathsToStage = [...updated, ...preserveSpecs];
    const dismissFile = join(ROOT, '.update-dismissed');
    if (existsSync(dismissFile)) {
      unlinkSync(dismissFile);
      pathsToStage.push('.update-dismissed');
    }

    // Which commit form was used, so the failure path can suggest the matching
    // recovery command. Declared outside the try because the catch reads it.
    let usedIndexCommit = false;

    try {
      prepareMaterializedSkillEntrypointsForStage(materializedSkillEntrypoints);
      addPaths(pathsToStage);
      // Scope the commit to only the staged update paths (#915 bug 2).
      // A bare `git commit` would sweep any unrelated pre-staged files into
      // the update commit. Passing the explicit pathspec list constrains the
      // commit to exactly the files this update touched.
      //
      // …but the pathspec form builds the commit from the WORKING TREE for those
      // paths rather than from the index. Where `core.fileMode` is false — the
      // default on Windows — the working tree cannot express the executable bit,
      // so a mode change that `git checkout FETCH_HEAD -- <path>` just staged is
      // dropped from the commit and left sitting in the index. The install is
      // dirty the instant a "clean" update finishes, and stays dirty, because
      // every later update re-stages the same mode and drops it again.
      //
      // Committing the index captures the mode. That is only equivalent to the
      // scoped commit when the index holds nothing beyond what this update
      // staged — which is precisely the #915 bug 2 hazard — so verify it rather
      // than assume it, and fall back to the scoped form when anything else is
      // staged. Content is committed identically either way; only the mode bits
      // ride on the index-based path.
      //
      // `pathsToStage` is a git PATHSPEC list, not a path list: the preserved
      // entries in it are `:(exclude)<path>`, which match no staged path at all.
      // Handing them to the guard as owned paths would leave a preserved file
      // claimed by its enclosing owned directory (`providers/` covering
      // `providers/acme.mjs`) — so strip the exclusions out and pass the
      // preserved list separately, where preservation outranks ownership.
      const ownedPaths = pathsToStage.filter((spec) => !spec.startsWith(EXCLUDE_PATHSPEC_PREFIX));
      const unrelated = stagedPathsOutside(
        [...ownedPaths, ...materializedSkillEntrypoints],
        preservedPaths,
      );
      usedIndexCommit = unrelated.length === 0;
      if (usedIndexCommit) {
        git('commit', '-m', `chore: auto-update system files to v${remote}`);
      } else {
        git('commit', '-m', `chore: auto-update system files to v${remote}`, '--', ...pathsToStage);
      }
    } catch (e) {
      let commitFailed = false;
      try {
        const entries = gitStatusEntries();
        const changedPaths = new Set(entries.map(entry => entry.path));
        const allTargetPaths = [...pathsToStage, ...materializedSkillEntrypoints];
        commitFailed = allTargetPaths.some(p => changedPaths.has(p));
      } catch (err) {
        commitFailed = true;
      }

      if (commitFailed) {
        const allTargetPaths = [...pathsToStage, ...materializedSkillEntrypoints];
        const pathspec = allTargetPaths.map(p => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
        // Print the command matching the path actually taken. Suggesting the
        // pathspec form after the index form was selected would tell the user to
        // run the very thing that drops the staged mode bits — a recovery step
        // that quietly reintroduces the bug it is recovering from.
        const recovery = usedIndexCommit
          ? `git commit -m "chore: auto-update system files to v${remote}"`
          : `git commit -m "chore: auto-update system files to v${remote}" -- ${pathspec}`;
        throw new Error(
          `Update commit failed (files may be staged but not committed).\n` +
          `    Error: ${e.message.split('\n')[0]}\n` +
          `    Please run manually to finish the update:\n` +
          `    ${recovery}`
        );
      }
      // Otherwise, genuinely nothing to commit (already up to date)
    }

    // Verify the update actually produced a coherent install before claiming
    // success. A client whose local manifest predates the target checks out
    // only the paths ITS OWN manifest lists, so everything added upstream since
    // is silently absent and the next script dies with ERR_MODULE_NOT_FOUND.
    // Re-running apply fixes it (the first pass did update update-system.mjs
    // itself, so the second pass uses the target manifest) — but only if the
    // user is told, instead of being shown "Update complete" (#1998).
    const unmaterialized = missingFromTargetManifest(remoteSystemPaths);
    if (unmaterialized.length > 0) {
      console.error(`\nUpdate incomplete: v${local} → v${remote}`);
      console.error(`${unmaterialized.length} path(s) from the target manifest were not checked out:`);
      for (const path of unmaterialized) console.error(`  ${path}`);
      console.error('\nThis happens when the installed updater predates the paths the target adds.');
      console.error('Run `node update-system.mjs apply` again — the updater itself is now current,');
      console.error('so the second pass uses the target manifest and picks up what this one missed.');
      process.exit(1);
    }

    console.log(`\nUpdate complete: v${local} → v${remote}`);
    console.log(`Updated ${updated.length} system paths.`);
    console.log(`Rollback available: node update-system.mjs rollback`);

    console.log('\n-- The CareerOps Manifesto ------------------------------');
    console.log('A new way of job searching is taking shape. You are');
    console.log('already practicing it. Read it, sign it if you want to help:');
    console.log('    npm run manifesto  ·  https://career-ops.org/manifesto?utm_source=updater');

  } finally {
    // Remove lock
    if (!isReexec && existsSync(lockFile)) unlinkSync(lockFile);
  }
}

// ── ROLLBACK ────────────────────────────────────────────────────

function rollback() {
  // Same precondition as apply(): a nested .git-less install would look its
  // backup branches up — and check files out — in the enclosing repo (#3334).
  assertOwnGitToplevel();
  // Find most recent backup branch
  try {
    const branches = git('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/backup-pre-update-*');
    const latest = newestBackupBranch(branches);

    if (!latest) {
      console.error('No backup branches found. Nothing to rollback.');
      process.exit(1);
    }

    console.log(`Rolling back to: ${latest}`);

    // Checkout system files from backup branch.
    //
    // Two failure modes for `git checkout` here:
    //   (a) the path didn't exist in the backup branch — the apply()
    //       that produced this backup was on an older version that
    //       didn't track this path yet. Rollback must DELETE the path
    //       so the working tree mirrors the backup state.
    //   (b) anything else — propagate so we don't silently leave the
    //       working tree in a partially-restored state.
    //
    // Limitation: `git checkout <ref> -- <dir>` restores blobs from
    // the backup tree but doesn't remove files that were added INSIDE
    // an already-tracked directory between backup and rollback. Rolling
    // back per-file via `git diff --name-status <backup>` would catch
    // that but is a larger change; tracked separately if it ever bites.
    const restored = [];
    const removed = [];
    for (const path of SYSTEM_PATHS) {
      try {
        git('checkout', latest, '--', path);
        restored.push(path);
      } catch (err) {
        const pathspec = path.endsWith('/') ? path.slice(0, -1) : path;
        let existedInBackup = true;
        try {
          git('cat-file', '-e', `${latest}:${pathspec}`);
        } catch {
          existedInBackup = false;
        }
        if (existedInBackup) {
          throw err;
        }
        // Path was introduced by a later apply() — remove it so the
        // tree truly matches the backup. `git rm` stages the deletion
        // for tracked files; `rmSync` cleans up the untracked-but-
        // on-disk case (e.g. an apply() that crashed between checkout
        // and commit, leaving the path untracked locally).
        git('rm', '-r', '-f', '--ignore-unmatch', '--', pathspec);
        try {
          rmSync(join(ROOT, pathspec), { recursive: true, force: true });
        } catch {
          // Already gone, or not present on disk — fine.
        }
        removed.push(pathspec);
      }
    }

    if (restored.length > 0) addPaths(restored);
    const rollbackPaths = [...restored, ...removed];
    try {
      // Scope the commit to the rollback paths (#915 bug 2). A bare
      // `git commit` would sweep unrelated staged files into the rollback.
      if (rollbackPaths.length > 0) {
        git('commit', '-m', `chore: rollback system files from ${latest}`, '--', ...rollbackPaths);
      }
    } catch {
      // Tolerate any commit failure here — the common case is the
      // "nothing to commit" no-op when the working tree already
      // matched the backup (e.g. user ran rollback twice). This
      // mirrors apply()'s broad-catch in the commit step; narrowing
      // to a specific git-error string is fragile and would diverge
      // from that pattern. Genuine setup problems (hooks, signing,
      // disk full) will resurface on the next normal git operation.
    }

    console.log(`Rollback complete. Restored ${restored.length} path(s) from ${latest}, removed ${removed.length} path(s) added after the backup.`);
    console.log('Your data (CV, profile, tracker, reports) was not affected.');
  } catch (err) {
    console.error('Rollback failed:', err.message);
    process.exit(1);
  }
}

// ── DISMISS ─────────────────────────────────────────────────────

function dismiss() {
  writeFileSync(join(ROOT, '.update-dismissed'), new Date().toISOString());
  console.log('Update check dismissed. Run "node update-system.mjs check" or say "check for updates" to re-enable.');
}

// ── MAIN ────────────────────────────────────────────────────────

// Only run the CLI when executed directly, so importing this module
// (e.g. from test-all.mjs to exercise SEMVER_RE) does not trigger a
// live update check.
//
// This is the ONE place that inlines lib/is-main-module.mjs instead of importing
// it (#3170). #1706 requires this file to be SELF-LOADING: a pre-#1245 client's
// apply() checks out only update-system.mjs and re-execs it, so any static
// relative import crashes the old→new jump with ERR_MODULE_NOT_FOUND. The
// semantics must still match the helper exactly — realpath BOTH sides, because
// `import.meta.url` is realpath-resolved by Node while argv[1] keeps whatever
// spelling the caller typed, and a mismatch makes the updater a silent no-op
// that exits 0. tests/main-guard-convention.test.mjs exempts this file BY NAME
// from its no-hand-rolled-guard source scan (the #1706 constraint is why), and
// pins the semantics behaviourally instead: it invokes this file through a
// symlink and requires the CLI tail to answer. Keep that in mind when editing —
// the scan will not catch a regression here; only that behaviour test will.
//
// `.native` matches lib/is-main-module.mjs's canonicalize(): it expands Windows
// 8.3 short names and reports on-disk casing, which the JS realpath leaves
// alone. Both sides go through the SAME function, which is the property that
// actually matters — a divergence here would make this copy answer differently
// from the helper on exactly the platforms the helper was hardened for.
const canonicalizePath = realpathSync.native ?? realpathSync;
const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
let isCli = Boolean(process.argv[1]) && entryPath === selfPath;
if (process.argv[1] && !isCli) {
  try { isCli = canonicalizePath(entryPath) === canonicalizePath(selfPath); } catch { isCli = false; }
}

if (isCli) {
  const cmd = process.argv[2] || 'check';

  try {
    switch (cmd) {
      case 'check': await check(); break;
      case 'apply': await apply(); break;
      case 'rollback': rollback(); break;
      case 'dismiss': dismiss(); break;
      default:
        console.log('Usage: node update-system.mjs [check|apply [--force]|rollback|dismiss]');
        process.exit(1);
    }
  } catch (err) {
    // Subcommands now `throw` on aborts so their outer `finally` blocks
    // run (e.g. apply() must release `.update-lock`). Print a clean
    // message here instead of letting Node spit out a stack trace.
    console.error(err.message || err);
    process.exit(1);
  }
}
