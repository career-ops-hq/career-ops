// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { execFile } from 'child_process';
import { realpathSync } from 'fs';
import { resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const LOCAL_PARSER_TIMEOUT_MS = 20_000;
const LOCAL_PARSER_MAX_BUFFER_BYTES = 2_000_000;

// `parser.command` / `parser.script` come from portals.yml, which on a shared or
// template config is not fully trusted. The command must be a known interpreter
// or a file inside this project — never an arbitrary binary like `rm` or `curl`.
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

function getParserScriptPath(entry) {
  const parser = entry.parser || {};
  if (parser.script) return expandParserArg(parser.script, entry);

  const args = Array.isArray(parser.args) ? parser.args : [];
  const scriptArg = args.find(arg => {
    const value = String(arg);
    return !value.startsWith('-') && /\.(py|mjs|js|sh)$/.test(value);
  });

  return scriptArg ? expandParserArg(scriptArg, entry) : null;
}

function buildParserArgs(entry) {
  const parser = entry.parser || {};
  const args = [];

  if (parser.script) args.push(parser.script);
  if (Array.isArray(parser.args)) args.push(...parser.args);

  return args.map(arg => expandParserArg(arg, entry));
}

// Resolve a configured path and confirm it stays inside the project tree.
function resolveInsideRoot(rawPath) {
  const resolved = realpathSync(resolve(PROJECT_ROOT, String(rawPath)));
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(PROJECT_ROOT + sep)) {
    throw new Error(`local-parser: path escapes the project root: ${rawPath}`);
  }
  return resolved;
}

// The command is either a whitelisted interpreter (resolved via PATH) or a script
// that lives inside the repo. Anything else is rejected.
function resolveCommand(command) {
  const value = String(command || '');
  if (!value) throw new Error('local-parser: parser.command is required');
  if (!value.includes('/') && ALLOWED_INTERPRETERS.has(value)) return value;
  return resolveInsideRoot(value);
}

// Validate the whole invocation and return what to spawn. Throws on anything unsafe.
function resolveInvocation(entry) {
  const rawCommand = String(entry.parser?.command || '');
  const command = resolveCommand(rawCommand);
  const args = buildParserArgs(entry);
  const scriptPath = getParserScriptPath(entry);

  const usesInterpreter = !rawCommand.includes('/') && ALLOWED_INTERPRETERS.has(rawCommand);
  if (usesInterpreter) {
    // A whitelisted interpreter must run an in-repo script as its FIRST argument.
    // Anything before the script is an interpreter option (node --eval / --require,
    // python -c, …) that could execute arbitrary code, so require the script to lead.
    if (!scriptPath) throw new Error('local-parser: interpreter command requires an in-repo parser script');
    resolveInsideRoot(scriptPath);
    if (args[0] !== scriptPath) {
      throw new Error('local-parser: the parser script must be the interpreter\'s first argument');
    }
  } else if (scriptPath) {
    // command is an in-repo file; keep any detected script path inside the repo too.
    resolveInsideRoot(scriptPath);
  }

  return { command, args };
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

function normalizeParserJob(job, entry) {
  if (!job || typeof job !== 'object') return null;

  const title = String(job.title || job.name || '').trim();
  const url = normalizeJobUrl(
    job.url || job.jobUrl || job.job_url || job.applyUrl || job.apply_url,
    entry.careers_url,
  );
  if (!title || !url) return null;

  return {
    title,
    url,
    company: String(job.company || entry.name || '').trim(),
    location: normalizeLocation(job.location || job.locations),
  };
}

async function runLocalParser(entry) {
  const parser = entry.parser || {};
  const { command, args } = resolveInvocation(entry);
  const timeout = Number(parser.timeout_ms || LOCAL_PARSER_TIMEOUT_MS);
  const maxBuffer = Number(parser.max_buffer_bytes || LOCAL_PARSER_MAX_BUFFER_BYTES);

  // cwd is pinned to the project root so a relative script arg resolves to the
  // same file resolveInvocation() validated, regardless of the caller's cwd.
  const { stdout } = await execFileAsync(command, args, {
    cwd: PROJECT_ROOT,
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

    // An invocation we can't safely resolve (unknown command, out-of-repo or
    // missing script, inline-code flags) is not runnable — skip it.
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
