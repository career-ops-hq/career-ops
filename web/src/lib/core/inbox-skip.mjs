/**
 * inbox-skip.mjs — the Inbox Skip/undo write to data/pipeline.md (#5269).
 *
 * Skip flips `- [ ]` to `- [x]` on the Pending rows whose posting URL is one
 * URL, and undo flips it back. Only the checkbox character changes: company,
 * role and every other line stay byte-identical. The URL is a matcher, never a
 * filesystem path.
 *
 * This is the one writer of that change. The root inbox-skip.mjs runs it for
 * the dashboard's Inbox `x` and `u` keys, and the web inbox's Skip runs it
 * too. Turbopack cannot import this file from web/, so
 * web/src/lib/core/inbox-skip.mjs is a byte copy. Edit this file, then copy
 * it. The lock is passed in: the core's withPipelineLock, which the web loads
 * from the checkout at request time, so both callers write under one lock.
 */
import {
  closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
// ./pipeline-sections.mjs is lib/pipeline-sections.mjs in the core and
// web/src/lib/core/pipeline-sections.mjs in the web copy: two files, kept
// equal by web/tests/lib/pipeline-sections-parity.test.mjs.
import { sectionKind } from "./pipeline-sections.mjs";

const MAX_URL_LEN = 2048;
const CHECKBOX_LINE = /^(\s*-\s*)\[([ xX])\](.*)$/;

/**
 * The posting URL, trimmed, when it is a plain http(s) URL with a host and no
 * credentials; null otherwise. Same rule as postingUrl in
 * web/src/lib/posting-url.mjs.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function postingUrl(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL_LEN) return null;
  if (/[\0\r\n]/.test(s)) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  if (u.username || u.password) return null;
  return s;
}

/**
 * Job URL on a pipeline checkbox line: the first `|` cell, same rule as the
 * web inbox's reader. The whole cell must be an http(s) posting URL; a
 * substring elsewhere on the line is not a match.
 *
 * @param {string} rest text after `- [ ]` / `- [x]`
 * @returns {string | null}
 */
export function jobUrlFromRest(rest) {
  return postingUrl(rest.split("|")[0]);
}

// Any level-two heading ends a section, `##` then a space or a tab, as
// sync-batch-input.mjs reads it.
const SECTION_HEADING = /^##\s/;

/**
 * Which lines a skip or undo may change: the first Pending section, up to
 * the next `##` heading. A file with no Pending heading is a plain checklist,
 * so every line is a candidate except those under a Processed heading.
 *
 * @param {string[]} lines
 * @returns {boolean[]}
 */
function candidateLines(lines) {
  const heads = lines.map((line) => line.trim());
  const pending = heads.findIndex((t) => sectionKind(t) === "pending");
  const ok = new Array(lines.length).fill(false);
  if (pending !== -1) {
    for (let i = pending + 1; i < lines.length && !SECTION_HEADING.test(heads[i]); i++) ok[i] = true;
    return ok;
  }
  let underProcessed = false;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADING.test(heads[i])) underProcessed = sectionKind(heads[i]) === "processed";
    else ok[i] = !underProcessed;
  }
  return ok;
}

/**
 * Flip `- [ ]` ↔ `- [x]` on Pending rows whose job URL equals `url`.
 *
 * @param {string} text pipeline.md contents
 * @param {string} url posting URL already accepted by postingUrl()
 * @param {boolean} done true = Skip (`[x]`), false = undo (`[ ]`)
 * @returns {{ ok: true, text: string, matched: number, changed: number } | { ok: false, error: string }}
 */
export function applyInboxSkip(text, url, done) {
  const parsed = postingUrl(url);
  if (!parsed) return { ok: false, error: "invalid-url" };

  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const endedWithNl = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (endedWithNl && lines[lines.length - 1] === "") lines.pop();

  const candidate = candidateLines(lines);
  const want = done ? "x" : " ";
  let matched = 0;
  let changed = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!candidate[i]) continue;
    const m = lines[i].match(CHECKBOX_LINE);
    if (!m) continue;
    const rest = m[3];
    const jobUrl = jobUrlFromRest(rest);
    if (jobUrl !== parsed) continue;
    matched += 1;
    const currentlyDone = m[2].toLowerCase() === "x";
    if (currentlyDone === done) continue;
    lines[i] = `${m[1]}[${want}]${rest}`;
    changed += 1;
  }

  if (matched === 0) return { ok: false, error: "unmatched" };
  return {
    ok: true,
    text: lines.join(nl) + (endedWithNl ? nl : ""),
    matched,
    changed,
  };
}

function isIgnorableDirectoryFsyncError(err) {
  return ["EINVAL", "ENOTSUP", "ENOSYS"].includes(err?.code)
    || (process.platform === "win32" && ["EACCES", "EPERM"].includes(err?.code));
}

// Replace the file the way scan.mjs atomicWriteFile writes pipeline.md: a
// symlink is followed, so the link stays a link and its target is what
// changes; the temp file sits beside that target, keeps its mode, and is
// fsynced before the rename, then the directory is fsynced.
function atomicWrite(file, content) {
  const fileStat = lstatSync(file, { throwIfNoEntry: false });
  const target = fileStat?.isSymbolicLink() ? realpathSync(file) : file;
  const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  let fd = null;
  let dirFd = null;
  try {
    const mode = existsSync(target) ? statSync(target).mode & 0o7777 : null;
    fd = openSync(tmp, "wx", 0o600);
    if (mode !== null) fchmodSync(fd, mode);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, target);
    try {
      dirFd = openSync(dirname(target), "r");
      fsyncSync(dirFd);
    } catch (err) {
      if (!isIgnorableDirectoryFsyncError(err)) throw err;
    } finally {
      if (dirFd !== null) closeSync(dirFd);
      dirFd = null;
    }
  } catch (err) {
    if (fd !== null) closeSync(fd);
    if (dirFd !== null) closeSync(dirFd);
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Read pipeline.md, flip the matching Pending rows and write it back, all
 * inside `withLock`. The file is written only when a checkbox changed.
 *
 * @param {string} pipelinePath absolute path to pipeline.md
 * @param {string} url posting URL
 * @param {boolean} done true = Skip (`[x]`), false = undo (`[ ]`)
 * @param {(path: string, fn: () => unknown, options: object) => Promise<unknown>} withLock
 *   the core's withPipelineLock (pipeline-lock.mjs)
 * @param {{ timeoutMs?: number, retryMs?: number, maxWaitMs?: number }} [lockOptions]
 * @returns {Promise<{ ok: true, text: string, matched: number, changed: number }
 *   | { ok: false, error: "invalid-url" | "unmatched" | "not-found" | "busy" }>}
 */
export async function setInboxSkip(pipelinePath, url, done, withLock, lockOptions = {}) {
  const parsed = postingUrl(url);
  if (!parsed) return { ok: false, error: "invalid-url" };

  const run = () => {
    let md;
    try {
      md = readFileSync(pipelinePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return { ok: false, error: "not-found" };
      throw err;
    }
    const result = applyInboxSkip(md, parsed, done);
    if (!result.ok) return result;
    if (result.changed > 0) atomicWrite(pipelinePath, result.text);
    return result;
  };

  try {
    return await withLock(pipelinePath, run, lockOptions);
  } catch (err) {
    if (err && err.name === "LockTimeoutError") return { ok: false, error: "busy" };
    throw err;
  }
}
