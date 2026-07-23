// tests/providers/http-timeout.test.mjs — the abort timeout must cover the
// BODY read, not just the header phase. A server that sends headers and then
// stalls the body used to hang fetchJson forever, which could silently freeze
// a full-directory sweep partway through with no error output.
import { createServer } from 'node:http';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — _http timeout');

const { fetchJson, fetchText } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

const sockets = new Set();
const server = createServer((req, res) => {
  if (req.url === '/stall') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"jobs": [');   // headers + partial body, then silence forever
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// 1. Stalled body must abort within the timeout window, not hang.
{
  const t0 = Date.now();
  try {
    await fetchJson(`${base}/stall`, { timeoutMs: 300 });
    fail('fetchJson resolved on a stalled body');
  } catch {
    const elapsed = Date.now() - t0;
    if (elapsed < 5_000) pass(`fetchJson aborted stalled body read in ${elapsed}ms`);
    else fail(`fetchJson took ${elapsed}ms to abort a stalled body (timeout not covering body read)`);
  }
}

// 2. Same for fetchText.
{
  const t0 = Date.now();
  try {
    await fetchText(`${base}/stall`, { timeoutMs: 300 });
    fail('fetchText resolved on a stalled body');
  } catch {
    const elapsed = Date.now() - t0;
    if (elapsed < 5_000) pass(`fetchText aborted stalled body read in ${elapsed}ms`);
    else fail(`fetchText took ${elapsed}ms to abort a stalled body`);
  }
}

// 3. Happy path still works after the refactor.
{
  const ok = await fetchJson(`${base}/ok`, { timeoutMs: 2_000 });
  if (ok && ok.ok === true) pass('fetchJson still parses a completed body');
  else fail(`fetchJson happy path broken: ${JSON.stringify(ok)}`);
}

for (const s of sockets) s.destroy();
server.close();
