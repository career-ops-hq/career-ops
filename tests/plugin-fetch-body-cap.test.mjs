// tests/plugin-fetch-body-cap.test.mjs — a plugin's ctx.fetch / fetchText /
// fetchJson refuse a response body over the cap, like the scanner's fetchers do
// (providers/_http.mjs DEFAULT_MAX_BODY_BYTES).
//
// Before this, the plugin fetcher returned the raw Response, so one endless or
// huge body from an allowed host was buffered whole: a 300 MB stream grew the
// process by ~900 MB. The fixture is a loopback server (the manifest opts in with
// allowsLocalhost), so nothing here touches the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { buildCtx } from '../plugins/_engine.mjs';

const manifest = { id: 'cap-demo', allowedHosts: ['127.0.0.1'], requiredEnv: [], optionalEnv: [], allowsLocalhost: true };
const MB = 1024 * 1024;

let server;
let base;
let streamedBytes = 0; // how much of the endless stream the server managed to write
let streamClosed;      // resolves when the endless stream's socket closes

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/small') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url === '/declared-big') {
      // content-length alone is enough to refuse: no body byte is read.
      res.writeHead(200, { 'content-length': String(50 * MB) });
      res.write(Buffer.alloc(1024, 97));
      res.on('error', () => {});
    } else if (req.url === '/endless') {
      // No content-length: only the running count can stop this one.
      streamedBytes = 0;
      let closed;
      streamClosed = new Promise((r) => { closed = r; });
      res.writeHead(200, { 'content-type': 'text/plain' });
      const chunk = Buffer.alloc(MB, 97);
      const timer = setInterval(() => { streamedBytes += chunk.length; res.write(chunk); }, 1);
      res.on('close', () => { clearInterval(timer); closed(); });
      res.on('error', () => {});
    } else if (req.url === '/gzip') {
      // What most real APIs send: the fetch layer decodes it, the cap must not break that.
      const payload = gzipSync(JSON.stringify({ items: Array.from({ length: 2000 }, (_, i) => `row-${i}`) }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(payload.length) });
      res.end(payload);
    } else if (req.url === '/gzip-bomb') {
      // 3 MB of 'a' compresses to ~3 KB on the wire: content-length passes a 1 MB
      // cap, so only the decompressed TransformStream byte counter can stop it.
      const payload = gzipSync(Buffer.alloc(3 * MB, 97));
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-length': String(payload.length) });
      res.end(payload);
    } else if (req.url === '/head-big') {
      // A HEAD reply may advertise the size of the GET body without sending any.
      res.writeHead(200, { 'content-length': String(50 * MB) });
      res.end();
    } else if (req.url === '/mid') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(Buffer.alloc(3 * MB, 98));
    } else if (req.url === '/error-big') {
      res.writeHead(500, { 'content-length': String(20 * MB) });
      res.write('internal error ');
      res.on('error', () => {});
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.closeAllConnections?.(); server.close(); });

const ctx = () => buildCtx(manifest, { settings: {}, dataRoot: process.cwd() });

test('a normal response still reads through fetchJson, fetchText and fetch().json()', async () => {
  const c = ctx();
  assert.deepEqual(await c.fetchJson(`${base}/small`), { ok: true });
  assert.equal(await c.fetchText(`${base}/small`), '{"ok":true}');
  const res = await c.fetch(`${base}/small`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('a gzip-compressed response still decodes through the capped body', async () => {
  const c = ctx();
  assert.equal((await c.fetchJson(`${base}/gzip`)).items.length, 2000);
  assert.equal((await (await c.fetch(`${base}/gzip`)).json()).items[1999], 'row-1999');
});

test('a gzip response whose wire content-length is under the cap is still refused when its decompressed body exceeds maxBytes', async () => {
  const c = ctx();
  await assert.rejects(
    c.fetchText(`${base}/gzip-bomb`, { maxBytes: 1 * MB }),
    (e) => e.code === 'response_too_large' && !/content-length/.test(e.message),
  );
});

test('a declared content-length over the cap is refused before the body is read', async () => {
  await assert.rejects(ctx().fetchText(`${base}/declared-big`), (e) => e.code === 'response_too_large' && /content-length 52428800/.test(e.message));
});

test('a stream with no content-length is cut off at the cap and its socket released', async () => {
  const c = ctx();
  await assert.rejects(c.fetchText(`${base}/endless`, { timeoutMs: 20_000 }), (e) => e.code === 'response_too_large');
  await Promise.race([streamClosed, new Promise((_, rej) => setTimeout(() => rej(new Error('server never saw the connection close')), 5000))]);
  // The default cap is 10 MB; the server may have a little more in flight, but nowhere near an unbounded read.
  assert.ok(streamedBytes < 64 * MB, `server wrote ${streamedBytes} bytes before the connection closed`);
});

test('the same cap applies when the plugin reads the body through fetch().text()', async () => {
  const res = await ctx().fetch(`${base}/endless`, { timeoutMs: 20_000 });
  await assert.rejects(res.text(), (e) => e.code === 'response_too_large');
});

test('opts.maxBytes sets the ceiling for one call, up or down', async () => {
  const c = ctx();
  assert.equal((await c.fetchText(`${base}/mid`)).length, 3 * MB); // under the 10 MB default
  await assert.rejects(c.fetchText(`${base}/mid`, { maxBytes: 1 * MB }), (e) => e.code === 'response_too_large');
  assert.equal((await c.fetchText(`${base}/mid`, { maxBytes: 4 * MB })).length, 3 * MB);
});

test('a bad maxBytes falls back to the default instead of disabling the cap', async () => {
  const c = ctx();
  for (const bad of [NaN, -1, 0, '5', Infinity, null]) {
    await assert.rejects(c.fetchText(`${base}/declared-big`, { maxBytes: bad }), (e) => e.code === 'response_too_large', `maxBytes ${String(bad)}`);
  }
});

test('an oversized error body keeps the HTTP status and loses only the snippet', async () => {
  await assert.rejects(ctx().fetchText(`${base}/error-big`), (e) => e.status === 500 && /^HTTP 500$/.test(e.message));
});

test('a HEAD response advertising a large content-length is not refused (it has no body)', async () => {
  const res = await ctx().fetch(`${base}/head-big`, { method: 'HEAD' });
  assert.equal(res.status, 200);
});

test('the capped response keeps the original url', async () => {
  const res = await ctx().fetch(`${base}/small`);
  assert.equal(res.url, `${base}/small`);
  assert.equal(res.redirected, false);
});
