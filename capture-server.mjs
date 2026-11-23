#!/usr/bin/env node

/**
 * capture-server.mjs — localhost receiver for the career-ops capture extension.
 *
 * The Chrome extension cannot write files, so it POSTs here; this process owns
 * the write. Everything it does goes through `capture-jd.mjs`, so the CLI and the
 * extension can never disagree about what a capture is.
 *
 * Security posture:
 *   - binds 127.0.0.1 by default; a wildcard host is refused unless
 *     CAREER_OPS_CAPTURE_ALLOW_NETWORK=1 is set, because a capture endpoint on
 *     the LAN is a write primitive for anyone on the network.
 *   - requires a bearer token from `data/.capture-token`, generated on first run.
 *     A token is not paranoia: a page in any tab can `fetch()` a localhost POST
 *     with a simple content type, and CORS preflight does not stop that. The
 *     header requirement plus an origin check does.
 *   - caps the request body, and accepts only http/https URLs.
 *
 * Usage:
 *   node capture-server.mjs [--port 7788] [--host 127.0.0.1] [--no-eval]
 *
 * Routes:
 *   GET  /health    → { ok, version }
 *   POST /capture   → { url, title?, text?, evaluate?, commit?, push? }  + X-Capture-Token
 *
 * A capture is committed unless `commit: false`; it is pushed only when the
 * request sets `push: true`.
 *
 * `evaluate: true` captures first, then starts ONE detached evaluation session
 * and returns immediately. The evaluation is logged to `data/capture-evals.log`;
 * the HTTP response never waits for it. Disable with --no-eval or
 * CAREER_OPS_CAPTURE_EVAL=off — a click that silently starts a paid 25-minute
 * run is not something this server should do by default.
 */

import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { isIPv4 } from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { captureJd } from './capture-jd.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const VERSION = '1.0.0';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const ALLOWED_ORIGIN = /^chrome-extension:\/\/[a-z0-9]+$/i;

function parseArgs(argv) {
  const flags = { port: 7788, host: '127.0.0.1', eval: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') flags.port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) flags.port = Number(arg.slice(7));
    else if (arg === '--host') flags.host = String(argv[++i]);
    else if (arg.startsWith('--host=')) flags.host = arg.slice(7);
    else if (arg === '--no-eval') flags.eval = false;
    else if (arg === '--help' || arg === '-h') flags.help = true;
  }
  return flags;
}

/**
 * Read the capture token, creating it on first run.
 *
 * The token lives in the data root rather than in this script, so it survives a
 * checkout update and is never committed with the code.
 */
export function ensureToken(dataRoot) {
  const file = path.join(dataRoot, 'data', '.capture-token');
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf-8').trim();
    if (existing) return existing;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const token = randomBytes(24).toString('hex');
  writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}

/** Constant-time-ish comparison; the token is not a password, but no free tells. */
function tokenMatches(expected, given) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(given ?? ''));
  if (a.length !== b.length) return false;
  return a.length > 0 && Buffer.compare(a, b) === 0;
}

function corsHeaders(req) {
  const origin = String(req.headers.origin || '');
  const allow = ALLOWED_ORIGIN.test(origin) ? origin : '';
  return {
    ...(allow ? { 'Access-Control-Allow-Origin': allow, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Capture-Token',
    'Access-Control-Max-Age': '600',
  };
}

function send(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Characters cmd.exe treats specially even inside a double-quoted argument that
 * a `shell: true` spawn builds by joining argv with spaces. Control characters
 * and whitespace are already refused by validateCaptureUrl; they are checked
 * again here so this function stays safe on its own.
 */
const CMD_UNSAFE = /["&|<>^%\p{Cc}\s]/u;

/**
 * Start one detached evaluation session for a just-captured posting.
 *
 * Deliberately fire-and-forget: the response returns as soon as the process is
 * spawned, and every byte it writes lands in the log. A capture that could not
 * start its evaluation is still a successful capture.
 *
 * The prompt is a single line: on Windows the spawn goes through cmd.exe
 * (`shell: true`), which cuts a command line at the first newline, so a
 * multi-line prompt never delivered the URL. There the prompt is also wrapped in
 * double quotes, and a URL containing a cmd.exe metacharacter is refused rather
 * than escaped.
 *
 * `platform` and `spawnFn` are injectable for tests.
 *
 * @returns {{started: boolean, command?: string, log?: string, reason?: string}}
 */
export function startEvaluation({ url, dataRoot, cli, platform = process.platform, spawnFn = spawn }) {
  const logPath = path.join(dataRoot, 'data', 'capture-evals.log');
  const useShell = platform === 'win32';
  if (useShell && CMD_UNSAFE.test(String(url))) {
    return { started: false, reason: 'url contains characters unsafe for cmd.exe (& | < > ^ % or ")', log: logPath };
  }
  mkdirSync(path.dirname(logPath), { recursive: true });

  const prompt = `career-ops auto-pipeline ${url} - load the career-ops skill first`;
  const promptArg = useShell ? `"${prompt}"` : prompt;

  const bin = cli || process.env.CAREER_OPS_CLI || 'opencode';
  const args = bin === 'opencode' ? ['run', promptArg] : ['-p', promptArg];

  try {
    const fd = openSync(logPath, 'a');
    const child = spawnFn(bin, args, {
      cwd: dataRoot,
      detached: true,
      stdio: ['ignore', fd, fd],
      shell: useShell,
      env: { ...process.env, CAREER_OPS_CLI: '' },
    });
    // A missing CLI surfaces as an asynchronous 'error' event; without a
    // listener Node rethrows it and takes the capture server down. The capture
    // is already saved, so record the failure and keep serving.
    child.on('error', (err) => {
      const line = `[capture] evaluation failed to start: ${err?.message || err}`;
      console.error(line);
      try { appendFileSync(logPath, `${line}
`); } catch { /* log unavailable */ }
    });
    child.unref();
    closeSync(fd);
    return { started: true, command: `${bin} ${args[0]}`, log: logPath };
  } catch (err) {
    return { started: false, reason: err?.message || 'spawn failed', log: logPath };
  }
}

async function handleCapture(req, res, ctx) {
  if (!tokenMatches(ctx.token, req.headers['x-capture-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''))) {
    return send(res, 401, { ok: false, error: 'missing or invalid capture token' }, corsHeaders(req));
  }

  let body;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch (err) {
    return send(res, err.status || 400, { ok: false, error: err.status === 413 ? 'body too large' : 'invalid JSON' }, corsHeaders(req));
  }

  const result = await captureJd({
    url: body.url,
    text: typeof body.text === 'string' ? body.text : '',
    title: typeof body.title === 'string' ? body.title : '',
    company: typeof body.company === 'string' ? body.company : '',
    role: typeof body.role === 'string' ? body.role : '',
    dataRoot: ctx.dataRoot,
    commit: body.commit !== false,
    // Pushing sends the JD and the inbox to the remote: only on an explicit request.
    push: body.push === true,
  });

  if (!result.ok) return send(res, 400, result, corsHeaders(req));

  const wantsEval = body.evaluate === true && ctx.evalEnabled && !result.duplicate;
  const evaluation = wantsEval ? startEvaluation({ url: result.url, dataRoot: ctx.dataRoot }) : null;

  console.log(
    `[capture] ${result.company || '?'} — ${result.role || '?'} · ` +
    `${result.duplicate ? 'duplicate' : 'new'}${result.capture ? ' · text' : ' · url only'}` +
    `${result.committed ? ` · ${result.sha}` : ''}${evaluation ? (evaluation.started ? ' · eval started' : ' · eval failed') : ''}`,
  );

  return send(res, 200, { ...result, evaluation }, corsHeaders(req));
}

/**
 * Whether a bind host is loopback: the whole value, never a prefix, so
 * `localhost.example` or `127.example` is not mistaken for it.
 */
export function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  return isIPv4(h) && h.startsWith('127.');
}

export function createServer({ dataRoot, token, evalEnabled = true }) {
  return http.createServer((req, res) => {
    const cors = corsHeaders(req);
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      return send(res, 400, { ok: false, error: 'invalid request target' }, cors);
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, version: VERSION }, cors);
    }
    if (req.method === 'POST' && url.pathname === '/capture') {
      handleCapture(req, res, { dataRoot, token, evalEnabled }).catch((err) => {
        send(res, 500, { ok: false, error: err?.message || 'internal error' }, cors);
      });
      return undefined;
    }
    return send(res, 404, { ok: false, error: 'not found' }, cors);
  });
}

function main(argv) {
  const flags = parseArgs(argv);

  if (flags.help) {
    console.log(`capture-server — localhost receiver for the career-ops capture extension

Usage: node capture-server.mjs [options]

  --port <n>     Port to listen on (default: 7788)
  --host <addr>  Interface to bind (default: 127.0.0.1)
  --no-eval      Ignore evaluate:true; captures never start an evaluation
  --help

Environment:
  CAREER_OPS_CAPTURE_EVAL=off        Same as --no-eval
  CAREER_OPS_CAPTURE_ALLOW_NETWORK=1 Allow binding a non-loopback host
  CAREER_OPS_CLI=<name>              CLI used for the detached evaluation

The token is read from data/.capture-token and created on first run. Paste it
into the extension's options page.`);
    return 0;
  }

  if (process.env.CAREER_OPS_CAPTURE_ALLOW_NETWORK !== '1' && !isLoopbackHost(flags.host)) {
    console.error(`capture-server: refusing to bind ${flags.host}. A capture endpoint is a write primitive;`);
    console.error('bind 127.0.0.1, or set CAREER_OPS_CAPTURE_ALLOW_NETWORK=1 if you really mean it.');
    return 2;
  }

  const dataRoot = getCareerOpsRoot();
  const token = ensureToken(dataRoot);
  const evalEnabled = flags.eval && String(process.env.CAREER_OPS_CAPTURE_EVAL || '').toLowerCase() !== 'off';

  const server = createServer({ dataRoot, token, evalEnabled });
  server.listen(flags.port, flags.host, () => {
    console.log('');
    console.log('  career-ops capture server');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  listening   http://${flags.host}:${flags.port}`);
    console.log(`  data root   ${dataRoot}`);
    console.log(`  evaluation  ${evalEnabled ? 'enabled (one detached session per capture)' : 'disabled'}`);
    console.log(`  token       ${token}`);
    console.log('');
    console.log('  Paste the token into the extension options page');
    console.log('  (chrome-extension://<id>/options.html).');
    console.log('');
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return null;
}

if (isMainModule(import.meta.url)) {
  const code = main(process.argv.slice(2));
  if (code !== null) process.exit(code);
}
