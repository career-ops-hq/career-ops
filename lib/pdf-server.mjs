// An idle painter exits on its own, so a crashed run does not leave Chromium up forever.

import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';

const MAX_FRAME = 32 * 1024 * 1024;
const IDLE_MS = 30 * 60 * 1000;
const OPT_KEYS = [
  'format', 'baseDir', 'reportNum', 'inputPath', 'workspaceRoot',
  'maxPages', 'strictPages', 'styleTokens', 'kind', 'country',
];

function unavailable(message) {
  const err = new Error(message);
  err.code = 'PDF_SERVER_UNAVAILABLE';
  return err;
}

// On Linux the temp dir is shared by every user. A socket at a guessable path
// there could be planted by someone else, and the client would send it the CV
// HTML. The socket goes in a directory this user owns and only this user can
// open; anything else means paint locally instead.
function privateSocketDir() {
  const dir = join(tmpdir(), `co-pdf-${process.getuid()}`);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw unavailable(`cannot create ${dir}: ${err.message}`);
  }
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) {
    throw unavailable(`${dir} is not a private directory owned by this user`);
  }
  return dir;
}

export function sharedPdfSocketPath(rootDir) {
  if (process.env.CAREER_OPS_PDF_SOCKET) return process.env.CAREER_OPS_PDF_SOCKET;
  const hash = createHash('sha256').update(String(rootDir)).digest('hex').slice(0, 16);
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    return `\\\\.\\pipe\\career-ops-pdf-${hash}`;
  }
  // Short names: a unix socket path is capped near 104 bytes, and the macOS
  // temp dir alone is about 50.
  return join(privateSocketDir(), `${hash}.sock`);
}

function isPipe(socketPath) {
  return /^\\\\[.?]\\pipe\\/i.test(socketPath);
}

// A Windows named pipe is not a file, so its pid file lives in the temp dir.
function pidFile(socketPath) {
  if (isPipe(socketPath)) {
    const hash = createHash('sha256').update(socketPath).digest('hex').slice(0, 16);
    return join(tmpdir(), `career-ops-pdf-${hash}.pid`);
  }
  return `${socketPath}.pid`;
}

function removeSocket(socketPath) {
  if (!isPipe(socketPath)) rmSync(socketPath, { force: true });
}

function pickOpts(opts = {}) {
  const out = {};
  for (const key of OPT_KEYS) {
    if (opts[key] !== undefined) out[key] = opts[key];
  }
  return out;
}

function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_FRAME) {
    const err = new Error('PDF render request is too large');
    err.code = 'PDF_SERVER_UNAVAILABLE';
    throw err;
  }
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

function readFrame(socket) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let settled = false;
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const length = buf.readUInt32BE(0);
      if (length > MAX_FRAME) return finish(new Error('PDF render response is too large'));
      if (buf.length < 4 + length) return;
      try {
        finish(null, JSON.parse(buf.subarray(4, 4 + length).toString('utf8')));
      } catch (err) {
        finish(err);
      }
    };
    const onError = (err) => finish(err);
    const onEnd = () => finish(new Error('PDF browser closed the connection'));
    function finish(err, value) {
      if (settled) return;
      settled = true;
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
      if (err) reject(err);
      else resolve(value);
    }
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('end', onEnd);
  });
}

function connect(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const fail = (err) => {
      socket.destroy();
      reject(err);
    };
    socket.once('connect', () => {
      socket.off('error', fail);
      resolve(socket);
    });
    socket.once('error', fail);
  });
}

async function socketIsLive(socketPath) {
  try {
    const socket = await connect(socketPath);
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

function listen(server, socketPath) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

function createLimiter(max) {
  let active = 0;
  const waiting = [];
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active += 1;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            const next = waiting.shift();
            if (next) next();
          });
      };
      if (active >= max) waiting.push(run);
      else run();
    });
  };
}

async function claimSocket(server, socketPath) {
  try {
    await listen(server, socketPath);
    return true;
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
  }
  if (await socketIsLive(socketPath)) return false;
  removeSocket(socketPath);
  try {
    await listen(server, socketPath);
    return true;
  } catch (err) {
    if (err.code === 'EADDRINUSE' && await socketIsLive(socketPath)) return false;
    throw err;
  }
}

/**
 * Listen for paint requests. Returns once the socket accepts connections.
 * `close` stops this listener. It does not stop a painter someone else owns.
 *
 * @param {{
 *   socketPath?: string,
 *   rootDir?: string,
 *   launchBrowser: (options: {headless: boolean}) => Promise<{close?: () => Promise<void>}>
 *   render: (browser: object, html: string, outputPath: string, opts: object) => Promise<{outputPath: string, pageCount: number, size: number}>
 *   idleMs?: number
 * }} options
 */
export async function startPdfServer({ socketPath, rootDir, launchBrowser, render, idleMs = IDLE_MS }) {
  const path = socketPath || sharedPdfSocketPath(rootDir || process.cwd());
  // A client may finish writing its request before it reads the reply. The
  // default closes this side when theirs does, and the reply is then a write
  // on a socket that already ended.
  const server = net.createServer({ allowHalfOpen: true });
  const owned = await claimSocket(server, path);
  if (!owned) {
    return {
      socketPath: path,
      alreadyRunning: true,
      close: async () => {},
      closed: Promise.resolve(),
    };
  }

  let browserPromise = null;
  let lastUse = Date.now();
  let stopped = false;
  let closeResolve = () => {};
  const closed = new Promise((resolve) => { closeResolve = resolve; });
  const limit = createLimiter(4);

  function browser() {
    if (!browserPromise) {
      const pending = Promise.resolve()
        .then(() => launchBrowser({ headless: true }))
        .then((painted) => {
          painted.once?.('disconnected', () => {
            if (browserPromise === pending) browserPromise = null;
          });
          return painted;
        })
        .catch((err) => {
          browserPromise = null;
          throw err;
        });
      browserPromise = pending;
    }
    return browserPromise;
  }

  server.on('connection', (socket) => {
    socket.on('error', () => {});
    lastUse = Date.now();
    limit(async () => {
      let payload;
      try {
        payload = await readFrame(socket);
      } catch {
        socket.destroy();
        return;
      }
      try {
        const painted = await browser();
        const result = await render(painted, payload.html, payload.outputPath, payload.opts || {});
        lastUse = Date.now();
        reply(socket, {
          ok: true,
          outputPath: result.outputPath,
          pageCount: result.pageCount,
          size: result.size,
        });
      } catch (err) {
        reply(socket, { ok: false, error: err?.message || String(err) });
      }
    }).catch(() => {
      if (!socket.destroyed) socket.destroy();
    });
  });

  await writeFile(pidFile(path), String(process.pid));

  const timer = setInterval(() => {
    if (Date.now() - lastUse >= idleMs) close();
  }, 30_000);
  timer.unref();

  async function close() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    await new Promise((resolve) => server.close(() => resolve()));
    if (browserPromise) {
      const painted = await browserPromise.catch(() => null);
      if (painted && typeof painted.close === 'function') await painted.close().catch(() => {});
    }
    // A successor may have bound the path while this listener drained. Leave
    // its socket and pid file alone.
    let ownsPid = false;
    try {
      ownsPid = readFileSync(pidFile(path), 'utf8').trim() === String(process.pid);
    } catch {}
    if (ownsPid && !(await socketIsLive(path))) {
      removeSocket(path);
      rmSync(pidFile(path), { force: true });
    }
    closeResolve();
  }

  return { socketPath: path, alreadyRunning: false, close, closed };
}

export async function ensureSharedPdfServer(generatePdfPath) {
  const socketPath = sharedPdfSocketPath(dirname(generatePdfPath));
  if (await socketIsLive(socketPath)) return socketPath;
  const child = spawn(process.execPath, [generatePdfPath, '--pdf-server'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CAREER_OPS_PDF_SHARED: '1',
      CAREER_OPS_PDF_SERVER_PROCESS: '1',
      CAREER_OPS_PDF_SOCKET: socketPath,
    },
  });
  child.unref();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await socketIsLive(socketPath)) return socketPath;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const err = new Error('shared PDF browser did not start');
  err.code = 'PDF_SERVER_UNAVAILABLE';
  throw err;
}

function reply(socket, value) {
  if (!socket.writable || socket.destroyed) {
    socket.destroy();
    return;
  }
  try {
    socket.end(frame(value));
  } catch {
    socket.destroy();
  }
}

// A painter that is gone, or that drops the connection before it answers,
// is unavailable and the caller paints locally. An { ok: false } answer is a
// real render error and is not retried.
export async function requestPdfRender(socketPath, { html, outputPath, opts }) {
  let socket;
  try {
    socket = await connect(socketPath);
  } catch (err) {
    throw unavailable(`cannot reach the shared PDF browser: ${err.message}`);
  }
  socket.on('error', () => {});
  try {
    socket.write(frame({ html, outputPath, opts: pickOpts(opts) }));
    let response;
    try {
      response = await readFrame(socket);
    } catch (err) {
      throw unavailable(`the shared PDF browser dropped the request: ${err.message}`);
    }
    if (!response?.ok) {
      const err = new Error(response?.error || 'PDF render failed');
      throw err;
    }
    return { outputPath: response.outputPath, pageCount: response.pageCount, size: response.size };
  } finally {
    socket.destroy();
  }
}

export async function renderViaSharedPdfServer(html, outputPath, opts, generatePdfPath) {
  const socketPath = await ensureSharedPdfServer(generatePdfPath);
  return requestPdfRender(socketPath, { html, outputPath, opts });
}

export async function stopSharedPdfServer(rootDir) {
  let socketPath;
  let pid = 0;
  try {
    socketPath = sharedPdfSocketPath(rootDir || process.cwd());
    pid = Number(readFileSync(pidFile(socketPath), 'utf8'));
  } catch {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0) return;
  try { process.kill(pid, 'SIGTERM'); } catch {}
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      removeSocket(socketPath);
      rmSync(pidFile(socketPath), { force: true });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try { process.kill(pid, 'SIGKILL'); } catch {}
  removeSocket(socketPath);
  rmSync(pidFile(socketPath), { force: true });
}
