// tests/plugin-fetch-body-timeout.test.mjs — a plugin's ctx.fetch timeout covers the
// response BODY, not only the wait for headers.
//
// Before this, the timer was cleared as soon as headers arrived, so a host that sent
// headers and then dripped (or stalled) held the call open indefinitely: the hook's
// outer timeout reported failure while the socket stayed open. Loopback fixture only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildCtx } from '../plugins/_engine.mjs';

const manifest = { id: 'body-timeout-demo', allowedHosts: ['127.0.0.1'], requiredEnv: [], optionalEnv: [], allowsLocalhost: true };
let server;
let base;
let dripClosed;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/drip' || req.url === '/stall') {
      let closed;
      dripClosed = new Promise((r) => { closed = r; });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('start');
      // /drip keeps sending a byte now and then; /stall sends nothing more.
      const timer = req.url === '/drip' ? setInterval(() => res.write('x'), 50) : null;
      res.on('close', () => { if (timer) clearInterval(timer); closed(); });
      res.on('error', () => {});
    } else if (req.url === '/slow-but-ok') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('a');
      setTimeout(() => res.end('b'), 150);
    } else if (req.url === '/error-drip') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.write('oops ');
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

test('a body that keeps dripping after the headers is cut off at timeoutMs and its socket released', async () => {
  const started = Date.now();
  await assert.rejects(ctx().fetchText(`${base}/drip`, { timeoutMs: 300 }));
  assert.ok(Date.now() - started < 3000, 'gave up long before any outer timeout');
  await Promise.race([dripClosed, new Promise((_, rej) => setTimeout(() => rej(new Error('server never saw the connection close')), 3000))]);
});

test('a body that stalls after the headers is cut off at timeoutMs', async () => {
  const started = Date.now();
  await assert.rejects(ctx().fetchText(`${base}/stall`, { timeoutMs: 300 }));
  assert.ok(Date.now() - started < 3000);
});

test('the same limit applies when the plugin reads fetch().text() itself', async () => {
  const res = await ctx().fetch(`${base}/stall`, { timeoutMs: 300 });
  await assert.rejects(res.text());
});

test('a body that finishes inside the timeout is unaffected', async () => {
  assert.equal(await ctx().fetchText(`${base}/slow-but-ok`, { timeoutMs: 2000 }), 'ab');
});

test('an error response whose body stalls still reports the HTTP status', async () => {
  await assert.rejects(ctx().fetchText(`${base}/error-drip`, { timeoutMs: 300 }), (e) => e.status === 500);
});
