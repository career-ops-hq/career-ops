#!/usr/bin/env node
// Self-serve API key request for the H-1B sponsor check.
// Usage: node plugins/h1b-sponsor/token.mjs request
//
// Prints a new token to stdout and stops there. It never writes .env, never
// writes any other file, and never prints the token anywhere but that one
// block: where a durable credential gets stored is the user's call.
//
// Minting is metered per address, so a 429 here is that budget working rather
// than an outage.

import { isMainModule } from '../../lib/is-main-module.mjs';
import { apiBase, fetchWithTimeout, readBoundedText } from './lib/api.mjs';

const USER_AGENT = 'career-ops-plugin-h1b-sponsor/1.0';
const TIMEOUT_MS = 10_000;
const USAGE = 'Usage: node plugins/h1b-sponsor/token.mjs request';
// A real token is h1b_ followed by hex. Anything else must not reach the
// H1B_API_TOKEN= line: a value carrying shell metacharacters would run when the
// user sources their .env.
const TOKEN_RE = /^h1b_[0-9a-f]+$/;
// Server-controlled text printed to the terminal gets the same control-char
// strip check.mjs applies: C0, DEL, and C1, then whitespace collapse.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
function displayClean(s) {
  // Whitespace collapse first: newlines are control chars too, and stripping
  // them before the collapse would glue words together instead of separating
  // them. What survives (ESC, BEL, DEL, C1) is not whitespace and is stripped.
  return String(s || '').replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').trim();
}

// "about 12 hours" is something a person can act on; the raw 43200 reads like
// an error code.
function humanSpan(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const span = (n, unit) => `about ${n} ${unit}${n === 1 ? '' : 's'}`;
  if (s < 60) return span(Math.max(1, s), 'second');
  if (s < 3600) return span(Math.round(s / 60), 'minute');
  if (s < 86_400) return span(Math.round(s / 3600), 'hour');
  return span(Math.round(s / 86_400), 'day');
}

// A mint reply is a small JSON object; anything bigger is not a key service
// answering. readBoundedText counts bytes as they stream in and cancels once
// the total would pass this, so the cap bounds the read itself and peak memory,
// not just what gets parsed.
const MAX_BODY_BYTES = 64 * 1024;

// The mint POST goes through the read path's egress guard (redirect handled
// manually, off-host or scheme-downgraded targets rejected) so a hijacked
// redirect cannot hand back an attacker-issued token. maxRedirects is 0: the
// key service never redirects this endpoint, and following one would re-issue
// the POST, which could spend the mint budget more than once. The body is read
// inside the same abort-timer window (via consume) so a server that sends
// headers and then stalls the body cannot hang the CLI. Such a stall is
// reported against the status that already arrived rather than as a timeout
// (see consume below). The read is size-capped. What comes back is a plain
// envelope, never a live Response: { status, retryAfterSeconds, body |
// bodyError }.
function guardedMintFetch() {
  return fetchWithTimeout(`${apiBase()}/keys/request`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
    timeoutMs: TIMEOUT_MS,
    maxRedirects: 0,
  }, async res => {
    const rawRetry = res.headers.get('retry-after');
    const retrySecs = Number(rawRetry);
    const envelope = {
      status: res.status,
      retryAfterSeconds: (rawRetry !== null && Number.isFinite(retrySecs)) ? retrySecs : null,
    };
    let read;
    try {
      read = await readBoundedText(res, MAX_BODY_BYTES);
    } catch {
      // Headers are already in hand: consume only runs once fetch has resolved,
      // so the status is known and true even when the body never arrives. Keep
      // it rather than reporting a bare timeout, which reads as "nothing
      // happened". That matters most on a 201, where it would invite a retry
      // that spends another of the day's two mints, but it is equally wrong on
      // a 429 (the wait is already known from the headers) or a 500. A real
      // timeout before any headers still surfaces as one, because consume never
      // runs for it.
      envelope.bodyError = 'unreadable';
      return envelope;
    }
    if (read.oversized) {
      envelope.bodyError = 'oversized';
      return envelope;
    }
    try {
      envelope.body = JSON.parse(read.text);
    } catch {
      envelope.bodyError = 'notjson';
    }
    return envelope;
  });
}

/**
 * Request one key. Returns a plain result so the outcome is testable without a
 * live mint: `{ ok: true, token, note }` on success, else
 * `{ ok: false, exitCode, message }`. `fetchImpl` is injectable for tests and
 * must resolve to the envelope shape guardedMintFetch produces.
 */
export async function mintToken({ fetchImpl = guardedMintFetch } = {}) {
  let env;
  try {
    env = await fetchImpl();
  } catch (err) {
    const reason = (err && err.name === 'AbortError')
      ? `no response within ${TIMEOUT_MS / 1000}s`
      : displayClean((err && err.message) ? err.message : err);
    return { ok: false, exitCode: 1, message: `could not reach the key service (${reason})` };
  }

  if (env.status === 429) {
    const span = (env.retryAfterSeconds !== null) ? humanSpan(env.retryAfterSeconds) : null;
    return {
      ok: false,
      exitCode: 1,
      message: `rate limited: this address has used its recent mint budget (2 available, then one more every 12 hours). Try again in ${span || 'a while'}.`,
    };
  }

  if (env.status !== 201) {
    return { ok: false, exitCode: 1, message: `could not issue a key (HTTP ${env.status})` };
  }

  // A 201 means the server may already have spent this address's budget, so a
  // failure to read the token past that point is worth saying out loud.
  const spentNote = ' A key may have been issued and the mint budget spent; wait for the cool-off before retrying.';

  if (env.bodyError || !env.body) {
    return { ok: false, exitCode: 1, message: `could not issue a key (the response was not readable JSON).${spentNote}` };
  }

  const body = env.body;
  const token = (typeof body.token === 'string') ? body.token.trim() : '';
  if (!token) {
    return { ok: false, exitCode: 1, message: `could not issue a key (the response carried no token).${spentNote}` };
  }
  if (!TOKEN_RE.test(token)) {
    return { ok: false, exitCode: 1, message: `could not issue a key (the response token was malformed).${spentNote}` };
  }

  // Server-controlled text; collapse whitespace so it stays one line and cannot
  // smuggle extra instructions into output the agent may relay.
  const note = (typeof body.note === 'string') ? displayClean(body.note) : '';

  return { ok: true, token, note };
}

function render(result) {
  // The only place the token is ever printed. Nothing else logs the response
  // body, and nothing writes it to disk.
  const lines = [
    result.token,
    '',
    'Set this in your shell before running the plugin (add it to your .env only',
    'if your workflow loads that, for example direnv or node --env-file):',
    `H1B_API_TOKEN=${result.token}`,
  ];
  if (result.note) lines.push('', result.note);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== 'request') {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const result = await mintToken();
  if (!result.ok) {
    // Errors go to stderr and set an exit code rather than calling
    // process.exit, so the stream is flushed before the process ends.
    process.stderr.write(`${result.message}\n`);
    process.exitCode = result.exitCode;
    return;
  }
  render(result);
}

// Run the CLI only when invoked as a script. mintToken is imported by the test
// suite; an unguarded main() would run on import with the importer's argv,
// print usage, and set the IMPORTER's exit code to 2 (test-all.mjs imports
// test files in-process, so that turned the whole suite red).
if (isMainModule(import.meta.url)) {
  main().catch(err => {
    const message = displayClean((err && err.message) ? err.message : err);
    process.stderr.write(`could not issue a key (${message})\n`);
    process.exitCode = 1;
  });
}
