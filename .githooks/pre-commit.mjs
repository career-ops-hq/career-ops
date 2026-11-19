#!/usr/bin/env node
/**
 * .githooks/pre-commit.mjs — the opt-in pre-commit checks (#6535).
 *
 * Opt in with `npm run hooks:install`, which sets `core.hooksPath` to
 * `.githooks` for this clone. Nothing installs it for you: job seekers run
 * `npm install` too, and a hook is a contributor tool. `.githooks/pre-commit`
 * is the shell entry git runs; this file holds the checks so the lint covers
 * them and the tests can import them.
 *
 * The hook adds to CI and does not replace it. `git commit --no-verify` skips
 * it, and CAREER_OPS_HOOK_SKIP=lint,coverage skips the named checks. The
 * checks, cheapest first:
 *
 *   paths       Staged user-layer files (the no-user-data.yml list), a CV or
 *               resume at the repo root, and .env files.
 *   secrets     Common credential formats on added lines of the staged diff.
 *   whitespace  `git diff --cached --check`, except Markdown, where trailing
 *               spaces are a hard line break.
 *   gofmt       `gofmt -l` over each staged dashboard .go file.
 *   coverage    validate-system-paths-coverage.mjs.
 *   lint        `npm run lint`, when a .mjs file is staged.
 *
 * paths, secrets, whitespace and gofmt read the index, so they grade exactly
 * what the commit will hold. coverage reads the index too: `git ls-files` for
 * the file list and `--index` for the policy files. lint reads the working
 * tree, so an unstaged edit to a staged .mjs file is what it checks.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { validateFlags } from '../lib/cli-flags.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const USAGE = `Usage: node .githooks/pre-commit.mjs

The opt-in pre-commit checks. git runs them on every commit once you enable
them with \`npm run hooks:install\`; you can also run them by hand on whatever
is staged.

Checks: paths, secrets, whitespace, gofmt, coverage, lint.
CAREER_OPS_HOOK_SKIP=lint,coverage skips the named checks.
git commit --no-verify skips all of them.`;

// Mirrors USER_PATHS, EXACT_SCAFFOLD and isScaffold in
// .github/workflows/no-user-data.yml. The workflow is what blocks a PR; this is
// the same rule applied before the commit exists.
// tests/githooks-pre-commit.test.mjs fails when the two drift.
export const USER_PATHS = [
  /^cv\.md$/,
  /^config\/profile\.yml$/,
  /^config\/plugins\.yml$/,
  /^modes\/_profile\.md$/,
  /^modes\/_custom\.md$/,
  /^modes\/_brief\.md$/,
  /^portals\.yml$/,
  /^article-digest\.md$/,
  /^opencode\.json$/,
  /^plugins\.lock$/,
  /^plugins\.local\//,
  /^\.career-ops-web\//,
  /^documents\//,
  /^interview-prep\//,
  /^data\//,
  /^reports\//,
  /^output\//,
  /^jds\//,
  /^writing-samples\//,
  /^batch\//,
];

export const EXACT_SCAFFOLD = {
  'batch/': new Set([
    'batch/README.md',
    'batch/aggregate-tokens.mjs',
    'batch/batch-prompt.md',
    'batch/batch-prompt-match.md',
    'batch/batch-runner.sh',
    'batch/company-scope.mjs',
    'batch/jd-rescue.mjs',
    'batch/logs/.gitkeep',
    'batch/tracker-additions/.gitkeep',
  ]),
  'documents/': new Set([
    'documents/.gitkeep',
    'documents/README.md',
  ]),
};

/**
 * Tracked scaffolding that may live under a user-layer directory.
 *
 * @param {string} f - Repo-relative path.
 * @returns {boolean}
 */
export function isScaffold(f) {
  const dir = Object.keys(EXACT_SCAFFOLD).find((d) => f.startsWith(d));
  return dir
    ? EXACT_SCAFFOLD[dir].has(f)
    : /(^|\/)\.gitkeep$/.test(f) || /(^|\/)README\.md$/.test(f);
}

// A CV saved or exported at the repo root. .gitignore already ignores root
// PDF and DOCX files; this also catches `git add -f` and the formats a CV is
// written in under a name that says what it is (my-cv.md, resume.txt).
const ROOT_DOCUMENT = /\.(pdf|docx?|odt|rtf|pages)$/i;
const ROOT_CV_NAME = /(^|[^a-z])(cv|resume|résumé)([^a-z]|$)/i;
const ROOT_CV_EXT = /\.(md|markdown|txt|tex|html?|json|ya?ml)$/i;

// .env holds API keys. The example and sample files are the ones meant to be
// committed; .envrc is direnv config, not a key store.
const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template)$/;

/**
 * Why a staged path must not be committed, or null when it may.
 *
 * @param {string} f - Repo-relative path with forward slashes.
 * @returns {string|null}
 */
export function blockedPathReason(f) {
  if (USER_PATHS.some((re) => re.test(f)) && !isScaffold(f)) {
    return 'user-layer file (DATA_CONTRACT.md)';
  }
  if (!f.includes('/')) {
    if (ROOT_DOCUMENT.test(f)) return 'document at the repo root (an exported CV?)';
    if (ROOT_CV_NAME.test(f) && ROOT_CV_EXT.test(f)) return 'CV or resume at the repo root';
  }
  if (ENV_FILE.test(f) && !ENV_TEMPLATE.test(f)) return 'environment file (API keys)';
  return null;
}

// Each entry is a token format with a fixed prefix, so a match is rarely
// anything but the real thing. Generic "password = ..." rules are left out:
// this repo is full of docs and tests that talk about keys.
export const SECRET_PATTERNS = [
  { name: 'private key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'AWS access key ID', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[oprsu]_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenRouter API key', re: /\bsk-or-v1-[a-f0-9]{64}\b/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/ },
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe live key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}/ },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
];

// The detect-secrets convention, for the line that has to hold a fake key.
export const SECRET_ALLOW_MARKER = 'pragma: allowlist secret';

/**
 * Unquote a path from a diff header. git C-quotes a path holding a quote, a
 * backslash or a control character; non-ASCII stays raw under
 * core.quotePath=false, which the caller sets.
 *
 * @param {string} raw
 * @returns {string}
 */
function unquotePath(raw) {
  if (!raw.startsWith('"')) return raw;
  return raw
    .slice(1, -1)
    .replace(/\\([\\"abfnrtv]|[0-7]{3})/g, (_, c) => {
      if (/^[0-7]{3}$/.test(c)) return String.fromCharCode(parseInt(c, 8));
      return { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }[c] ?? c;
    });
}

/**
 * Credential-shaped strings on the added lines of a unified diff.
 *
 * Reports the file, line and kind of each hit and never the value, so the
 * hook's output does not leak what it found into a terminal log.
 *
 * @param {string} diff - `git diff --cached -U0` output.
 * @returns {{file: string, line: number, name: string}[]}
 */
export function findSecrets(diff) {
  const hits = [];
  let file = null;
  let inHunk = false;
  let line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('diff --git ')) {
      file = null;
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      if (text.startsWith('+++ ')) {
        const target = text.slice(4);
        file = target === '/dev/null' ? null : unquotePath(target).replace(/^b\//, '');
      } else if (text.startsWith('@@')) {
        inHunk = true;
      } else {
        continue;
      }
    }
    if (text.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      line = m ? Number(m[1]) : 0;
      continue;
    }
    if (text.startsWith('+')) {
      if (file && !text.includes(SECRET_ALLOW_MARKER)) {
        for (const { name, re } of SECRET_PATTERNS) {
          if (re.test(text)) {
            hits.push({ file, line, name });
            break;
          }
        }
      }
      line++;
    } else if (text.startsWith(' ')) {
      line++;
    }
  }
  return hits;
}

/** @returns {string} The working tree's top level. */
function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
}

/**
 * Run git and return stdout. The environment is inherited on purpose: during
 * `git commit -a` or `git commit <path>`, GIT_INDEX_FILE names the temporary
 * index that holds what is being committed.
 */
function git(root, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Staged paths, added or changed (deletions cannot leak anything). */
function stagedPaths(root) {
  return git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean);
}

/** @returns {{ok: boolean, detail?: string, skipped?: string}} */
function checkPaths(root, staged) {
  const bad = staged
    .map((f) => [f, blockedPathReason(f)])
    .filter(([, reason]) => reason);
  if (!bad.length) return { ok: true };
  return {
    ok: false,
    detail:
      bad.map(([f, reason]) => `${f}  (${reason})`).join('\n') +
      '\nUnstage with `git restore --staged <path>`. Sample data belongs under examples/.',
  };
}

function checkSecrets(root) {
  // --no-textconv as well as --no-ext-diff: a local textconv driver could
  // rewrite the added lines before findSecrets reads them.
  const diff = git(root, ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--diff-filter=ACMR']);
  const hits = findSecrets(diff);
  if (!hits.length) return { ok: true };
  return {
    ok: false,
    detail:
      hits.map((h) => `${h.file}:${h.line}  ${h.name}`).join('\n') +
      `\nRemove the value, or end the line with "${SECRET_ALLOW_MARKER}" if it is a fake.`,
  };
}

/**
 * The `file:line: problem` headers of `git diff --check` output, without the
 * source line git prints under each one. That line can hold a credential with
 * a trailing space, and the hook never prints what it scanned.
 *
 * @param {string} output - `git diff --check` stdout.
 * @returns {string}
 */
export function whitespaceSummary(output) {
  return output
    .split('\n')
    .filter((l) => l && !/^[+\- ]/.test(l))
    .join('\n');
}

function checkWhitespace(root) {
  const r = spawnSync(
    'git',
    ['diff', '--cached', '--check', '--no-color', '--no-ext-diff', '--no-textconv', '--', '.', ':(exclude)*.md'],
    { cwd: root, encoding: 'utf-8' },
  );
  if (r.status === 0) return { ok: true };
  return { ok: false, detail: [whitespaceSummary(r.stdout), r.stderr.trim()].filter(Boolean).join('\n') };
}

function checkGofmt(root, staged) {
  const goFiles = staged.filter((f) => f.startsWith('dashboard/') && f.endsWith('.go'));
  if (!goFiles.length) return { ok: true, skipped: 'no dashboard .go file staged' };
  const probe = spawnSync('gofmt', ['-h'], { encoding: 'utf-8' });
  if (probe.error) return { ok: true, skipped: 'gofmt not on PATH' };
  const unformatted = goFiles.filter((f) => {
    const blob = execFileSync('git', ['show', `:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const r = spawnSync('gofmt', ['-l'], { input: blob, encoding: 'utf-8' });
    return r.status !== 0 || r.stdout.trim() !== '';
  });
  if (!unformatted.length) return { ok: true };
  return {
    ok: false,
    detail: unformatted.join('\n') + '\nRun `gofmt -w` on them and stage the result.',
  };
}

function runNode(root, script, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf-8' });
  if (r.status === 0) return { ok: true };
  return { ok: false, detail: (r.stdout + r.stderr).trim() || `${script} exited ${r.status}` };
}

function checkCoverage(root) {
  // --index: grade the staged SYSTEM_PATHS and USER_PATHS, not the working tree's.
  return runNode(root, 'validate-system-paths-coverage.mjs', ['--index']);
}

function checkLint(root, staged) {
  if (!staged.some((f) => f.endsWith('.mjs'))) return { ok: true, skipped: 'no .mjs file staged' };
  return runNode(root, join('scripts', 'check-syntax.mjs'));
}

export const CHECKS = [
  ['paths', checkPaths],
  ['secrets', checkSecrets],
  ['whitespace', checkWhitespace],
  ['gofmt', checkGofmt],
  ['coverage', checkCoverage],
  ['lint', checkLint],
];

/**
 * Parse CAREER_OPS_HOOK_SKIP.
 *
 * @param {string|undefined} value - Comma- or space-separated check names.
 * @returns {{skip: Set<string>, unknown: string[]}}
 */
export function parseSkip(value) {
  const names = (value || '').split(/[\s,]+/).filter(Boolean);
  const known = new Set(CHECKS.map(([name]) => name));
  return {
    skip: new Set(names.filter((n) => known.has(n))),
    unknown: names.filter((n) => !known.has(n)),
  };
}

function main() {
  // git passes pre-commit no arguments; this answers --help when you run it by
  // hand, and rejects anything else with exit 2 instead of running the checks.
  validateFlags(process.argv.slice(2), ['--help', '-h'], USAGE, { usageExitCode: 2 });
  const root = repoRoot();
  const staged = stagedPaths(root);
  const { skip, unknown } = parseSkip(process.env.CAREER_OPS_HOOK_SKIP);
  if (unknown.length) {
    console.error(`pre-commit: ignoring unknown CAREER_OPS_HOOK_SKIP name(s): ${unknown.join(', ')}`);
  }

  let failed = 0;
  for (const [name, check] of CHECKS) {
    if (skip.has(name)) {
      console.error(`- ${name}: skipped (CAREER_OPS_HOOK_SKIP)`);
      continue;
    }
    let result;
    try {
      result = check(root, staged);
    } catch (err) {
      result = { ok: false, detail: String(err.stderr || err.message).trim() };
    }
    if (result.ok) {
      if (result.skipped) console.error(`- ${name}: skipped (${result.skipped})`);
      continue;
    }
    failed++;
    console.error(`✗ ${name}`);
    console.error(result.detail.replace(/^/gm, '    '));
  }

  if (failed) {
    console.error(
      `\npre-commit: ${failed} check(s) failed. Fix them, or skip one with ` +
        'CAREER_OPS_HOOK_SKIP=<name> (all of them with --no-verify). CI runs these checks either way.',
    );
    process.exit(1);
  }
}

if (isMainModule(import.meta.url)) main();
