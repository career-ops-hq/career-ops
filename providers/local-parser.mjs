// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const LOCAL_PARSER_TIMEOUT_MS = 20_000;
const LOCAL_PARSER_MAX_BUFFER_BYTES = 2_000_000;

function expandParserArg(value, entry) {
  return String(value)
    .replaceAll('{careers_url}', entry.careers_url || '')
    .replaceAll('{company}', entry.name || '');
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
  const args = buildParserArgs(entry);
  const timeout = Number(parser.timeout_ms || LOCAL_PARSER_TIMEOUT_MS);
  const maxBuffer = Number(parser.max_buffer_bytes || LOCAL_PARSER_MAX_BUFFER_BYTES);

  const { stdout } = await execFileAsync(parser.command, args, {
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

    const scriptPath = getParserScriptPath(entry);
    if (scriptPath && !existsSync(scriptPath)) return null;

    return { url: entry.careers_url || 'local-parser' };
  },

  async fetch(entry) {
    return runLocalParser(entry);
  },
};
