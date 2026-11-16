// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { execFile } from 'child_process';
import { realpathSync } from 'fs';
import { join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const execFileAsync = promisify(execFile);

const LOCAL_PARSER_TIMEOUT_MS = 20_000;
const LOCAL_PARSER_MAX_BUFFER_BYTES = 2_000_000;

// `parser.command` / `parser.script` come from portals.yml, which on a shared or
// template config is not fully trusted. The command must be a known interpreter
// or a file inside this project or the data root's local/ folder (see
// dataLocalRoot) — never an arbitrary binary like `rm` or `curl`.
const PROJECT_ROOT = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))));
const ALLOWED_INTERPRETERS = new Set(['python3', 'python', 'node', 'deno', 'bun', 'sh', 'bash']);

// `{careers_url}` and `{company}` are interpolated into the parser's argv. Validate
// them so an interpolated value can never be read as a CLI flag (argument injection).
function safeCareersUrl(value) {
  if (!value) return '';
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`local-parser: careers_url is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`local-parser: careers_url must be http(s): ${value}`);
  }
  return url.href;
}

function safeCompany(value) {
  if (!value) return '';
  const name = String(value).trim();
  // execFile passes args verbatim (no shell), so the only injection risk is a
  // value that begins like a CLI flag.
  if (name.startsWith('-')) {
    throw new Error(`local-parser: company name cannot start with '-': ${value}`);
  }
  return name;
}

// Only validate a placeholder's value when the arg actually uses it — a fixed
// `parser.script` must not be rejected because some unrelated `{company}` value
// has punctuation it never sees.
function expandParserArg(value, entry) {
  let out = String(value);
  if (out.includes('{careers_url}')) out = out.replaceAll('{careers_url}', safeCareersUrl(entry.careers_url));
  if (out.includes('{company}')) out = out.replaceAll('{company}', safeCompany(entry.name));
  return out;
}

// Where the parser script sits in buildParserArgs()'s output, or -1: index 0
// for `parser.script`, else the first `parser.args` entry that looks like one.
function parserScriptIndex(entry) {
  const parser = entry.parser || {};
  if (parser.script) return 0;

  const args = Array.isArray(parser.args) ? parser.args : [];
  return args.findIndex(arg => {
    const value = String(arg);
    return !value.startsWith('-') && /\.(py|mjs|js|sh)$/.test(value);
  });
}

function buildParserArgs(entry) {
  const parser = entry.parser || {};
  const args = [];

  if (parser.script) args.push(parser.script);
  if (Array.isArray(parser.args)) args.push(...parser.args);

  return args.map(arg => expandParserArg(arg, entry));
}

function isInside(path, root) {
  return path !== root && path.startsWith(root + sep);
}

// The data root's local/ folder, when it is not the checkout's own. A Claude
// Code plugin install replaces the code root on every update, so a private
// parser there is lost; the user's files live in the data root instead
// (#7152). Only local/ is accepted, never the whole data root: a template
// portals.yml must not be able to point an interpreter at a saved JD, an HTML
// capture or a report. Read on every call rather than at load, so a data root
// that path-resolver refuses (UnsafeDataRootError) leaves out this folder
// instead of breaking the provider's import.
function dataLocalRoot() {
  let dataRoot;
  let localDir;
  try {
    dataRoot = realpathSync(getCareerOpsRoot());
    localDir = realpathSync(join(dataRoot, 'local'));
  } catch {
    return null;
  }
  if (dataRoot === PROJECT_ROOT) return null;
  // A local/ that is a symlink out of the data root (to /usr/bin, say) would
  // make its target the allowed folder. Refuse it.
  if (!isInside(localDir, dataRoot)) return null;
  return { dataRoot, localDir };
}

// Resolve a configured path and confirm it stays inside the project tree or
// the data root's local/ folder. A relative path resolves against the project
// root first, then against the data root. Returns the real path and the root
// the parser should run in.
function resolveAllowedPath(rawPath) {
  const raw = String(rawPath);
  let projectError;
  try {
    const resolved = realpathSync(resolve(PROJECT_ROOT, raw));
    if (resolved === PROJECT_ROOT || isInside(resolved, PROJECT_ROOT)) {
      return { path: resolved, cwd: PROJECT_ROOT };
    }
  } catch (err) {
    projectError = err;
  }

  const data = dataLocalRoot();
  if (data) {
    let resolved = null;
    try {
      resolved = realpathSync(resolve(data.dataRoot, raw));
    } catch {
      // Not under the data root either; reported below.
    }
    if (resolved && isInside(resolved, data.localDir)) {
      return { path: resolved, cwd: data.dataRoot };
    }
  }

  if (projectError) throw projectError;
  throw new Error(`local-parser: path is outside the project root and the data root's local/ folder: ${raw}`);
}

// The command is either a whitelisted interpreter (resolved via PATH) or a
// script in an allowed folder. Anything else is rejected.
function isInterpreter(command) {
  return !command.includes('/') && ALLOWED_INTERPRETERS.has(command);
}

// Validate the whole invocation and return what to spawn. Throws on anything
// unsafe. Each validated path goes into argv as an absolute path, so the
// parser runs the file that was checked whatever the cwd.
function resolveInvocation(entry) {
  const rawCommand = String(entry.parser?.command || '');
  if (!rawCommand) throw new Error('local-parser: parser.command is required');
  const args = buildParserArgs(entry);
  const scriptIndex = parserScriptIndex(entry);

  let command = rawCommand;
  let cwd = PROJECT_ROOT;
  if (isInterpreter(rawCommand)) {
    // A whitelisted interpreter must run an allowed script as its FIRST argument.
    // Anything before the script is an interpreter option (node --eval / --require,
    // python -c, …) that could execute arbitrary code, so require the script to lead.
    if (scriptIndex < 0) throw new Error('local-parser: interpreter command requires a parser script');
    if (scriptIndex !== 0) {
      throw new Error('local-parser: the parser script must be the interpreter\'s first argument');
    }
    const script = resolveAllowedPath(args[0]);
    args[0] = script.path;
    cwd = script.cwd;
  } else {
    const resolvedCommand = resolveAllowedPath(rawCommand);
    command = resolvedCommand.path;
    cwd = resolvedCommand.cwd;
    // The command is an allowed file; keep any detected script path allowed too.
    if (scriptIndex >= 0) args[scriptIndex] = resolveAllowedPath(args[scriptIndex]).path;
  }

  return { command, args, cwd };
}

function normalizeJobUrl(rawUrl, baseUrl) {
  if (!rawUrl) return '';
  try {
    return new URL(String(rawUrl).trim(), baseUrl || undefined).href;
  } catch {
    return '';
  }
}

function normalizeLocation(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(normalizeLocation).filter(Boolean).join(', ');
  if (typeof value === 'object') return value.name || value.text || '';
  return String(value).trim();
}

// The ECMA-262 Date range: ±100,000,000 days from the epoch, in ms. A raw
// number outside this range is finite but produces an Invalid Date, which
// throws RangeError downstream (scan.mjs's postedAtIsoDate calls toISOString()).
const MAX_VALID_EPOCH_MS = 8_640_000_000_000_000;

// NaN-safe coercion for an optional parser-supplied posting date. Accepts an
// epoch-milliseconds number or a Date.parse-able string; an unparseable
// string, a non-finite or out-of-range number, a non-string/non-number
// value, or an absent field yields undefined, so the row is kept without a
// date rather than carrying a wrong one. The `typeof value !== 'string'`
// guard is load-bearing, not redundant with the truthiness check below it: a
// truthy object (e.g. one JSON.parse produces from `{"toString":null}`)
// reaching Date.parse() throws TypeError (ToPrimitive can't call a
// non-callable toString and Object.prototype.valueOf isn't primitive), which
// is not caught anywhere between here and the parser's fetch() call.
// A result at or before the Unix epoch is rejected, not preserved: no real
// job posting predates 1970, so `0` (or negative) is a sentinel/placeholder
// from the source, not a date, regardless of which alias or format it came
// in as.
function toEpochMs(value) {
  let ms;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    ms = value;
  } else if (typeof value === 'string' && value) {
    ms = Date.parse(value);
    if (Number.isNaN(ms)) return undefined;
  } else {
    return undefined;
  }
  return ms > 0 && ms <= MAX_VALID_EPOCH_MS ? ms : undefined;
}

// Tries each alias in order and keeps the first one that parses, so a garbage
// value in an earlier-checked field (e.g. postedAt) doesn't hide a good date
// in a later one (e.g. posted_at) — unlike a `??` chain, which stops at the
// first non-nullish value regardless of whether it actually parses.
function firstPostedAt(...candidates) {
  for (const candidate of candidates) {
    const parsed = toEpochMs(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function normalizeParserJob(job, entry) {
  if (!job || typeof job !== 'object') return null;

  const title = String(job.title || job.name || '').trim();
  const url = normalizeJobUrl(
    job.url || job.jobUrl || job.job_url || job.applyUrl || job.apply_url,
    entry.careers_url,
  );
  if (!title || !url) return null;

  // Carry through any other key the parser emitted, so a jobs-json-v1 parser
  // can publish an occupation code, a department or a req id for the scan to
  // read — the prerequisite for #3438's declared-field whitelists. The
  // normalized keys are destructured out,
  // along with the aliases they are built from, so rest cannot overwrite
  // them; a parser that emits only those keys gets the same object as before.
  // Every posting-date alias is taken out too: postedAt is set below only when
  // it parses, and a raw unparseable date must not ride along in rest.
  const {
    title: _title, name: _name,
    url: _url, jobUrl: _jobUrl, job_url: _jobUrlSnake,
    applyUrl: _applyUrl, apply_url: _applyUrlSnake,
    company: _company, location: _location, locations: _locations,
    postedAt: _postedAt, posted_at: _postedAtSnake,
    publishedAt: _publishedAt, published_at: _publishedAtSnake,
    published_date: _publishedDate, datePosted: _datePosted, date_posted: _datePostedSnake,
    ...rest
  } = job;

  const out = {
    ...rest,
    title,
    url,
    company: String(job.company || entry.name || '').trim(),
    location: normalizeLocation(job.location || job.locations),
  };

  const postedAt = firstPostedAt(
    job.postedAt, job.posted_at, job.publishedAt, job.published_at,
    job.published_date, job.datePosted, job.date_posted,
  );
  if (postedAt !== undefined) out.postedAt = postedAt;

  return out;
}

async function runLocalParser(entry) {
  const parser = entry.parser || {};
  const { command, args, cwd } = resolveInvocation(entry);
  const timeout = Number(parser.timeout_ms || LOCAL_PARSER_TIMEOUT_MS);
  const maxBuffer = Number(parser.max_buffer_bytes || LOCAL_PARSER_MAX_BUFFER_BYTES);

  // cwd is the root the parser came from: the project root for an in-repo
  // parser, the data root for one in its local/ folder, so a parser's relative
  // reads and writes (data/parser-output/…) land beside it.
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    timeout,
    maxBuffer,
    windowsHide: true,
  });

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error('local parser returned invalid JSON');
  }

  const rawJobs = Array.isArray(payload) ? payload : payload.jobs || payload.results;
  if (!Array.isArray(rawJobs)) {
    throw new Error('local parser JSON must be an array or contain jobs[]/results[]');
  }

  return rawJobs
    .map(job => normalizeParserJob(job, entry))
    .filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'local-parser',

  detect(entry) {
    if (!entry.parser?.command) return null;

    // An invocation we can't safely resolve (unknown command, a missing script
    // or one outside the allowed folders, inline-code flags) is not runnable —
    // skip it.
    try {
      resolveInvocation(entry);
    } catch {
      return null;
    }

    return { url: entry.careers_url || 'local-parser' };
  },

  async fetch(entry) {
    return runLocalParser(entry);
  },
};
