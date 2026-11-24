#!/usr/bin/env node

/**
 * capture-jd.mjs — capture a job posting into the pipeline without evaluating it.
 *
 * A capture session used to mean `auto-pipeline`: evaluate, report, PDF, tracker,
 * 26 minutes. When the user only wants to close the tab, that is the wrong shape.
 * This script does the one thing that is actually urgent — record the posting —
 * and leaves the evaluation as a separate, deliberate decision.
 *
 * What it writes:
 *
 *   jds/{YYYY-MM-DD}_{company}_{role}_{sha256(url)[0:16]}.md   when JD text is given
 *   data/pipeline.md                                           one Pending row
 *
 * The URL identity in the filename is the same one `archive-posting.mjs` writes,
 * so `findCaptureForUrl()` resolves a capture from the URL alone — no report
 * number, no date, no re-scraped company or role.
 *
 * Usage:
 *   echo "<jd text>" | node capture-jd.mjs --url <url> [--company X] [--role Y]
 *   node capture-jd.mjs --url <url> --text-file jd.txt --commit
 *   node capture-jd.mjs --url <url> --title "<page title>" --json
 *   node capture-jd.mjs --help
 *
 * Flags:
 *   --url <url>          Required. The posting URL (http/https only).
 *   --text-file <path>   JD text from a file. Use `-` to read stdin.
 *   --company <name>     Overrides the company derived from --title/URL host.
 *   --role <name>        Overrides the role derived from --title.
 *   --title <text>       Page title, used to derive company and role.
 *   --commit             Stage ONLY this capture and data/pipeline.md and commit.
 *   --push               With --commit, also push. Never implied: a push sends
 *                        the JD and the inbox to the remote, so it is opt-in.
 *   --json               Machine-readable result on stdout.
 *
 * Without JD text the capture file is skipped and only the pipeline row is
 * written — the "just the URL" path. Rows are deduplicated by URL, so capturing
 * the same posting twice changes nothing and commits nothing.
 *
 * Capture text is untrusted external content: it is stored verbatim as data and
 * is never interpreted as instructions.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { sectionKind } from './lib/pipeline-sections.mjs';
import { captureIdentity, captureSlug, findCaptureForUrl, isSupportedCaptureExtension, validateCaptureUrl } from './jd-capture.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { renameSyncWithRetry } from './lib/rename-retry.mjs';
import { postingUrlRelation } from './url-key.mjs';

const PIPELINE_SKELETON = '# Pipeline\n\n## Pending\n\n## Processed\n';

/**
 * Atomic, symlink-aware file write.
 *
 * Local copy of the pattern scan.mjs:141 uses rather than an import: scan.mjs
 * pulls in the provider registry and the YAML loader, and a capture must not
 * need those to append one markdown line. Same steps, same guarantees — a
 * reader sees either the old file or the new one, never a truncated mix.
 * Pipeline writes intentionally follow existing symlinks; JD outputs opt out.
 */
export function atomicWrite(filePath, text, { followSymlinks = true } = {}) {
  const fileStat = lstatSync(filePath, { throwIfNoEntry: false });
  if (!followSymlinks && fileStat?.isSymbolicLink()) {
    throw new Error('Refusing atomic write to a symlink capture output');
  }
  const targetPath = followSymlinks && fileStat?.isSymbolicLink() ? realpathSync(filePath) : filePath;
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  let fd = null;
  try {
    const existingMode = existsSync(targetPath) ? statSync(targetPath).mode & 0o7777 : null;
    fd = openSync(tempPath, 'wx', 0o600);
    if (existingMode !== null) fchmodSync(fd, existingMode);
    writeFileSync(fd, text, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSyncWithRetry(tempPath, targetPath);
  } catch (err) {
    if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } }
    try { unlinkSync(tempPath); } catch { /* never created, or already renamed */ }
    throw err;
  }
}

/** Today in YYYY-MM-DD, local time (a capture belongs to the day it was made). */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Collapse a capture field onto one line so it cannot break the pipeline table. */
function oneLine(text, max = 120) {
  return String(text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\|/g, '/')
    .trim()
    .slice(0, max);
}

const GENERIC_HOST_LABELS = new Set(['boards', 'jobs', 'job-boards', 'careers', 'career', 'apply', 'recruiting', 'hire', 'talent', 'www']);

/**
 * Multi-tenant ATS hosts serve one company per first path segment
 * (`boards.greenhouse.io/acme/jobs/123`). On these, the host says nothing about
 * the employer — the tenant slug does.
 */
const ATS_TENANT_HOSTS = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.ashbyhq.com',
  'jobs.smartrecruiters.com',
  'careers.smartrecruiters.com',
  'apply.workable.com',
  'jobs.workable.com',
]);

function prettifySlug(slug) {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Best-effort employer name from a posting URL.
 *
 * Wrong answers here are cheap — the pipeline row is a label, not a fact, and
 * `--company` overrides it — but reading `Boards` off `boards.greenhouse.io`
 * makes the inbox unreadable, so the two shapes that actually occur are handled:
 * a multi-tenant ATS (tenant from the path) and a plain host (label before the
 * TLD, with a generic `jobs.`/`careers.` prefix dropped).
 */
function companyFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./i, '');
  if (ATS_TENANT_HOSTS.has(host)) {
    const tenant = parsed.pathname.split('/').filter(Boolean)[0] || '';
    // Skip locale segments (`en_US`, `de-de`) and opaque ids; neither is a company.
    if (tenant && !/^[a-z]{2}([-_][a-z]{2})?$/i.test(tenant) && !/^[0-9a-f-]{16,}$/i.test(tenant)) {
      try {
        return prettifySlug(decodeURIComponent(tenant));
      } catch {
        return ''; // An undecodable tenant does not identify an employer.
      }
    }
  }

  const labels = host.split('.');
  if (labels.length > 2 && GENERIC_HOST_LABELS.has(labels[0])) labels.shift();
  const base = labels.length > 1 ? labels[0] : labels[0];
  return base ? prettifySlug(base) : '';
}

/**
 * Derive company and role when the caller did not supply them.
 *
 * Handles the shapes browsers actually produce:
 *   "Senior AI Engineer at Anthropic"        → role, company
 *   "Senior AI Engineer | Anthropic"         → role, company
 *   "Senior AI Engineer - Anthropic"         → role, company
 * Falls back to the URL host for the company and to no role at all, because a
 * guessed role is worse in the pipeline than an empty one.
 *
 * A title only ever carries one of these shapes, and "Role | Company" is the
 * common one, so the first segment is the role in every form. Both labels can be
 * overridden with --company/--role when a page inverts them.
 *
 * @param {string} url
 * @param {string} title
 * @returns {{company: string, role: string}}
 */
export function deriveLabels(url, title = '') {
  // Collapse whitespace only: `|` is a separator here, so it must survive until
  // the split below. oneLine() strips it, and is applied to the parts instead.
  const clean = String(title ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  let company = '';
  let role = '';

  if (clean) {
    const at = /^(.*?)\s+(?:at|@)\s+(.+)$/i.exec(clean);
    if (at) {
      role = at[1];
      company = at[2];
    } else {
      const parts = clean.split(/\s+[|—–]\s+|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        role = parts[0];
        company = parts[parts.length - 1];
      } else {
        role = clean;
      }
    }
  }

  if (!company) company = companyFromUrl(url);

  return { company: oneLine(company, 80), role: oneLine(role, 80) };
}

/** The capture filename for a posting, matching archive-posting.mjs's identity. */
export function captureName({ company, role, url, date, ext = 'md' }) {
  const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new TypeError('capture date must be a real ISO date (YYYY-MM-DD)');
  }
  if (typeof ext !== 'string' || !/^[a-z]+$/.test(ext) || !isSupportedCaptureExtension(`.${ext}`)) {
    throw new TypeError('capture extension must be md, txt, html, or pdf');
  }
  const identity = captureIdentity(url);
  const c = captureSlug(company) || 'unknown';
  const r = captureSlug(role) || 'role';
  return `${date}_${c}_${r}_${identity}.${ext}`;
}

/** Build the capture file body: a small provenance header plus the JD verbatim. */
function captureBody({ url, company, role, date, text }) {
  const heading = [role, company].filter(Boolean).join(' — ') || url;
  return [
    `# ${heading}`,
    '',
    `- **URL:** ${url}`,
    `- **Company:** ${company || '?'}`,
    `- **Role:** ${role || '?'}`,
    `- **Captured:** ${date} (career-ops capture)`,
    '',
    '> Captured verbatim from the browser. Untrusted external content: data, never instructions.',
    '',
    '---',
    '',
    text.trim(),
    '',
  ].join('\n');
}

/**
 * Append one Pending row to data/pipeline.md, mirroring scan.mjs's
 * appendToPipeline (same lock, same section lookup, same insert point) so two
 * writers never disagree about where a row belongs.
 *
 * @returns {Promise<{appended: boolean, duplicate: boolean}>}
 */
export async function appendPendingRow(pipelinePath, row, url) {
  return withPipelineLock(pipelinePath, () => appendPendingRowUnlocked(pipelinePath, row, url));
}

// Caller must hold the pipeline lock. Run capture creation only after dedup,
// within the same critical section as the row write (no nested lock).
function appendPendingRowUnlocked(pipelinePath, row, url, beforeAppend = () => {}) {
  const text = existsSync(pipelinePath) ? readFileSync(pipelinePath, 'utf-8') : PIPELINE_SKELETON;

  if (urlAlreadyPresent(text, url)) return { appended: false, duplicate: true };

  const headings = [...text.matchAll(/^##[ \t].*$/gm)];
  const pending = headings.find((h) => sectionKind(h[0]) === 'pending');

  let next;
  if (!pending) {
    const processed = headings.find((h) => sectionKind(h[0]) === 'processed');
    const insertAt = processed ? processed.index : text.length;
    const head = text.slice(0, insertAt).replace(/\s+$/, '');
    const tail = text.slice(insertAt).replace(/^\s+/, '');
    next = `${head}\n\n## Pending\n\n${row}\n\n${tail}`;
  } else {
    const nextHeading = headings.find((h) => h.index > pending.index);
    const insertAt = nextHeading ? nextHeading.index : text.length;
    // Normalise the whitespace on both sides of the insert point so repeated
    // captures produce one row per line, and exactly one blank line under the
    // `## Pending` heading, matching the format modes/pipeline.md documents.
    const head = text.slice(0, insertAt).replace(/\s+$/, '');
    const tail = text.slice(insertAt).replace(/^\s+/, '');
    const lastLine = head.split('\n').pop() || '';
    const gap = /^##/.test(lastLine) ? '\n\n' : '\n';
    next = `${head}${gap}${row}\n\n${tail}`;
    if (!text.slice(insertAt)) next = `${head}${gap}${row}\n`;
  }

  beforeAppend();
  atomicWrite(pipelinePath, next);
  return { appended: true, duplicate: false };
}

/** Drop trailing slashes from the path only; the query and fragment are kept verbatim. */
function trimPathSlash(value) {
  const [, base, rest] = /^([^?#]*)(.*)$/s.exec(String(value).trim());
  return base.replace(/\/+$/, '') + rest;
}

/** A URL split at its first `#`: the page, and the fragment verbatim ('' when none). */
function splitFragment(value) {
  const s = String(value).trim();
  const hash = s.indexOf('#');
  return hash < 0 ? [s, ''] : [s.slice(0, hash), s.slice(hash)];
}

/**
 * Do two pipeline URLs name the same posting? The page is compared the way the
 * scanner's dedup compares it (url-key.mjs): a tracking parameter (`gh_src`,
 * `utm_*`), the host's case or a trailing slash on the path does not make a
 * second posting, and two known, different languages stay two. The fragment
 * is compared verbatim, as before.
 */
function samePosting(a, b) {
  const [pageA, fragmentA] = splitFragment(a);
  const [pageB, fragmentB] = splitFragment(b);
  if (fragmentA !== fragmentB) return false;
  if (trimPathSlash(pageA) === trimPathSlash(pageB)) return true;
  return postingUrlRelation(pageA, pageB) === 'same';
}

/** Is this URL already a row (Pending or Processed) in the pipeline text? */
export function urlAlreadyPresent(text, url) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s*\[[ xX!]\]/.test(line))
    .some((line) => {
      const cells = line.replace(/^\s*-\s*\[[ xX!]\]\s*/, '').split('|');
      // Completed evaluations prefix the URL with a report number; expired
      // rows wrap the URL and labels in strikethrough (modes/pipeline.md).
      const index = /^#\d+$/.test(cells[0].trim()) ? 1 : 0;
      const cell = (cells[index] || '').trim().replace(/^~~/, '').replace(/~~$/, '');
      return samePosting(cell, url);
    });
}

/**
 * Whether two paths name the same directory. Git reports the real path, so a
 * symlinked data root (macOS /var -> /private/var) or a Windows 8.3 short name
 * (RUNNER~1) must be resolved before comparing. Case is ignored on win32 only.
 */
function sameDirectory(a, b) {
  const real = (p) => {
    try { return realpathSync.native(p); } catch { return path.resolve(p); }
  };
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  return norm(real(a)) === norm(real(b));
}

/**
 * Stage only this capture's files, commit them, and push only when asked.
 *
 * `git commit -- <paths>` commits those paths' working-tree content and ignores
 * everything else in the index, which is what keeps the user's other pending
 * data changes (`data/applications.md`, `data/status-log.tsv`, …) out of a
 * capture commit. Never `git add -A`: the data root is dirty by design.
 *
 * The data root must BE the repository root, not merely sit inside one. Without
 * that check a data root nested under an unrelated repository — a temp folder
 * under a home-directory repo, say — would have its capture committed into that
 * other repo's history. Both sides are compared by real path (see sameDirectory).
 *
 * @returns {{committed: boolean, pushed: boolean, sha?: string, reason?: string}}
 */
export function commitCapture({ dataRoot, files, message, push = false }) {
  const git = (args) => spawnSync('git', args, { cwd: dataRoot, encoding: 'utf-8' });

  const top = git(['rev-parse', '--show-toplevel']);
  if (top.status !== 0) {
    return { committed: false, pushed: false, reason: 'not-a-git-repo' };
  }
  if (!sameDirectory(String(top.stdout).trim(), dataRoot)) {
    return { committed: false, pushed: false, reason: 'data-root-not-repo-root' };
  }

  const add = git(['add', '--', ...files]);
  if (add.status !== 0) return { committed: false, pushed: false, reason: 'add-failed' };

  const changes = git(['status', '--porcelain', '--', ...files]);
  if (!String(changes.stdout).trim()) return { committed: false, pushed: false, reason: 'nothing-to-commit' };

  const commit = git(['commit', '-m', message, '--', ...files]);
  if (commit.status !== 0) {
    return { committed: false, pushed: false, reason: `commit-failed: ${oneLine(commit.stderr || commit.stdout, 200)}` };
  }

  const sha = git(['rev-parse', '--short', 'HEAD']);
  const result = { committed: true, pushed: false, sha: String(sha.stdout).trim() };

  if (!push) return { ...result, reason: 'push-skipped' };
  const p = git(['push']);
  if (p.status !== 0) return { ...result, reason: `push-failed: ${oneLine(p.stderr || p.stdout, 200)}` };
  return { ...result, pushed: true };
}

/**
 * The whole capture in one call. Shared by the CLI and the local server.
 *
 * @param {object} input
 * @param {string} input.url                 Posting URL (http/https).
 * @param {string} [input.text]              JD text; empty means "URL only".
 * @param {string} [input.title]             Page title, for label derivation.
 * @param {string} [input.company]
 * @param {string} [input.role]
 * @param {string} [input.dataRoot]          Defaults to getCareerOpsRoot().
 * @param {string} [input.date]              Defaults to today().
 * @param {boolean} [input.commit=false]
 * @param {boolean} [input.push=false]
 * @returns {Promise<object>}
 */
export async function captureJd(input = {}) {
  let url;
  try {
    url = validateCaptureUrl(input.url);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  // Resolved once: commitCapture runs git with cwd: dataRoot and passes paths
  // joined from it, so a relative root would be applied twice.
  const dataRoot = path.resolve(input.dataRoot || getCareerOpsRoot());
  const date = input.date || today();
  const text = String(input.text ?? '');

  const derived = deriveLabels(url, input.title || '');
  const company = oneLine(input.company, 80) || derived.company;
  const role = oneLine(input.role, 80) || derived.role;
  let name;
  try {
    if (text.trim()) name = captureName({ company, role, url, date });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const jdsDir = path.join(dataRoot, 'jds');
  const pipelinePath = path.join(dataRoot, 'data', 'pipeline.md');

  const files = [];
  let capturePath = null;

  const row = `- [ ] ${url} | ${company} | ${role}${text.trim() ? '' : ' | note: url only'}`;
  const appended = await withPipelineLock(pipelinePath, () =>
    appendPendingRowUnlocked(pipelinePath, row, url, () => {
      if (!text.trim()) return;
      mkdirSync(jdsDir, { recursive: true });
      capturePath = path.join(jdsDir, name);
      atomicWrite(capturePath, captureBody({ url, company, role, date, text }), { followSymlinks: false });
      files.push(capturePath);
    }));
  if (appended.appended) files.unshift(pipelinePath);

  const result = {
    ok: true,
    url,
    company,
    role,
    date,
    capture: capturePath,
    hasText: Boolean(text.trim()),
    pipeline: pipelinePath,
    appended: appended.appended,
    duplicate: appended.duplicate,
    committed: false,
    pushed: false,
  };

  if (input.commit && appended.appended && files.length > 0) {
    const message = `chore(capture): ${company || 'unknown'} — ${role || 'posting'}`;
    const git = commitCapture({ dataRoot, files, message, push: input.push === true });
    Object.assign(result, { committed: git.committed, pushed: git.pushed, sha: git.sha, gitReason: git.reason });
  }

  return result;
}

function parseArgs(argv) {
  const out = { flags: {}, positional: [] };
  const takesValue = new Set(['--url', '--text-file', '--company', '--role', '--title', '--find']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { out.flags.help = true; continue; }
    if (takesValue.has(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      out.flags[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      out.flags[name] = inline === undefined ? true : inline;
      continue;
    }
    out.positional.push(arg);
  }
  return out;
}

const HELP = `capture-jd — record a job posting in the pipeline, without evaluating it

Usage:
  echo "<jd text>" | node capture-jd.mjs --url <url> [--company X] [--role Y]
  node capture-jd.mjs --url <url> --text-file jd.txt --commit
  node capture-jd.mjs --url <url> --title "<page title>" --json

Flags:
  --url <url>        Required. Posting URL (http/https only).
  --text-file <path> JD text from a file; '-' reads stdin.
  --company <name>   Override the derived company.
  --role <name>      Override the derived role.
  --title <text>     Page title, used to derive company and role.
  --commit           Stage only this capture and data/pipeline.md and commit.
  --push             With --commit, also push (never implied).
  --find <url>       Print the capture already stored for this URL, if any.
  --json             Machine-readable result on stdout.

Without JD text only the pipeline row is written. Captures are deduplicated by
URL, so capturing the same posting twice changes nothing and commits nothing.`;

function readStdin() {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`capture-jd: ${err.message}`);
    return 2;
  }

  const { flags } = parsed;
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  // Lookup mode: print the capture already stored for a URL, if any. Used by
  // auto-pipeline Step 0 to reuse a JD the user captured instead of fetching it.
  // Exit 0 with empty output is "no capture", so a caller needs no error handling.
  if (flags.find) {
    const root = getCareerOpsRoot();
    const found = findCaptureForUrl(path.join(root, 'jds'), String(flags.find));
    if (found) console.log(flags.json ? JSON.stringify(found) : found.path);
    return 0;
  }

  if (!flags.url) {
    console.error('capture-jd: --url is required. See --help.');
    return 2;
  }
  let url;
  try {
    url = validateCaptureUrl(flags.url);
  } catch (error) {
    console.error(`capture-jd: ${error.message}`);
    return 2;
  }

  let text = '';
  if (flags['text-file'] && flags['text-file'] !== '-') {
    try {
      text = readFileSync(String(flags['text-file']), 'utf-8');
    } catch (err) {
      console.error(`capture-jd: cannot read --text-file ${flags['text-file']}: ${err.message}`);
      return 2;
    }
  } else if (flags['text-file'] === '-' || !process.stdin.isTTY) {
    text = readStdin();
  }

  const result = await captureJd({
    url,
    text,
    title: typeof flags.title === 'string' ? flags.title : '',
    company: typeof flags.company === 'string' ? flags.company : '',
    role: typeof flags.role === 'string' ? flags.role : '',
    commit: Boolean(flags.commit),
    push: flags.push === true,
  });

  if (!result.ok) {
    console.error(`capture-jd: ${result.error}`);
    return 2;
  }

  // A push the user asked for that did not happen is a failure, even though the
  // capture and the local commit are saved. A local-only commit is not.
  const pushFailed = result.committed && flags.push === true && !result.pushed;
  const reportPushFailure = () => {
    console.error(`capture-jd: ${result.gitReason || 'push-failed'}`);
    console.error(`capture-jd: the capture and local commit ${result.sha} are saved; push them yourself.`);
  };

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    if (pushFailed) { reportPushFailure(); return 1; }
    return 0;
  }

  if (result.duplicate) {
    console.log(`already in the pipeline: ${result.url}`);
    return 0;
  }

  console.log(`captured  ${result.company || '?'} — ${result.role || '?'}`);
  if (result.capture) console.log(`  jd      ${result.capture}`);
  console.log(`  row     ${result.pipeline}`);
  if (result.committed) console.log(`  commit  ${result.sha}${result.pushed ? ' (pushed)' : ''}`);
  else if (result.gitReason) console.log(`  commit  skipped: ${result.gitReason}`);
  if (pushFailed) { reportPushFailure(); return 1; }
  return 0;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`capture-jd: ${err && err.stack ? err.stack : err}`);
      process.exit(1);
    },
  );
}
