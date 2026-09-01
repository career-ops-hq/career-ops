/**
 * Persist inbox Skip/undo by flipping the `data/pipeline.md` checkbox for one
 * posting URL. localStorage is only a cache; this is the file write.
 *
 * The URL is a matcher, never a filesystem path. Only the checkbox on matching
 * Pending rows changes — company/role and every other line stay byte-identical.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const MAX_URL_LEN = 2048;
const CHECKBOX_LINE = /^(\s*-\s*)\[([ xX])\](.*)$/;
const PENDING_HEADING = /^##\s+(Pending|Pendientes)\s*$/i;

/**
 * Accept only a real http(s) posting URL. Anything else (relative paths,
 * file:/javascript:/data:, newlines) is refused so a Skip cannot be turned
 * into a write outside pipeline.md.
 *
 * @param {unknown} raw
 * @returns {string | null} trimmed URL, or null when it is not a posting URL
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
 * Job URL on a pipeline checkbox line — the first `|` cell, same rule as
 * readInbox. The whole cell must be an http(s) posting URL; a substring
 * elsewhere on the line is not a match.
 *
 * @param {string} rest text after `- [ ]` / `- [x]`
 * @returns {string | null}
 */
export function jobUrlFromRest(rest) {
  return postingUrl(rest.split("|")[0]);
}

function pendingRange(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (PENDING_HEADING.test(t)) {
      start = i + 1;
      continue;
    }
    if (start !== -1 && t.startsWith("## ")) {
      return { start, end: i };
    }
  }
  if (start !== -1) return { start, end: lines.length };
  return null; // no Pending heading → every line is a candidate
}

function inRange(i, range) {
  return !range || (i >= range.start && i < range.end);
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

  const range = pendingRange(lines);
  const want = done ? "x" : " ";
  let matched = 0;
  let changed = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!inRange(i, range)) continue;
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

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Read-modify-write `pipeline.md` under the core pipeline lock when available.
 *
 * @param {string} pipelinePath absolute path to data/pipeline.md
 * @param {string} url
 * @param {boolean} done
 * @param {{ lockModule?: string, timeoutMs?: number }} [options]
 */
export async function setInboxSkip(pipelinePath, url, done, options = {}) {
  const parsed = postingUrl(url);
  if (!parsed) return { ok: false, error: "invalid-url" };

  const run = () => {
    let md;
    try {
      md = fs.readFileSync(pipelinePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return { ok: false, error: "not-found" };
      throw err;
    }
    const result = applyInboxSkip(md, parsed, done);
    if (!result.ok) return result;
    if (result.changed > 0) atomicWrite(pipelinePath, result.text);
    return result;
  };

  const lockModule = options.lockModule;
  if (!lockModule) return run();

  const mod = await import(/* webpackIgnore: true */ pathToFileURL(lockModule).href);
  if (typeof mod.withPipelineLock !== "function") {
    throw new Error("pipeline-lock.mjs has no withPipelineLock");
  }
  try {
    return await mod.withPipelineLock(pipelinePath, run, {
      timeoutMs: options.timeoutMs ?? (Number(process.env.CAREER_OPS_WEB_LOCK_TIMEOUT_MS) || 5_000),
      retryMs: 50,
    });
  } catch (err) {
    if (err && err.name === "LockTimeoutError") return { ok: false, error: "busy" };
    throw err;
  }
}
