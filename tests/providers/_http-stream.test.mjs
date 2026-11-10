// tests/providers/_http-stream.test.mjs — fetchTextStream hands a body to its
// callback piece by piece, through the same transport rules as fetchText:
// redirects refused, non-2xx thrown, compression decoded, the decoded size
// capped, the whole transfer bounded by timeoutMs, and the body cancelled when
// the caller stops early.
import { createServer } from 'node:http';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, withLocalServerAs } from '../helpers.mjs';

console.log('\nProvider — _http fetchTextStream');

const { fetchTextStream } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

const check = (ok, label, detail) => (ok ? pass(label) : fail(detail ? `${label} — ${detail}` : label));

const PIECE = 'é'.repeat(4096); // two bytes per char, so a chunk boundary can split one
const DOC = Array.from({ length: 64 }, (_, i) => `<job>${i}${PIECE}</job>`).join('');
const aborted = { endless: false };

async function writeSlowly(res, text, pieces = 16) {
  const step = Math.ceil(text.length / pieces);
  for (let i = 0; i < text.length; i += step) {
    res.write(text.slice(i, i + step));
    await new Promise((r) => setTimeout(r, 2));
  }
  res.end();
}

const server = createServer(async (req, res) => {
  if (req.url === '/doc') {
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
    writeSlowly(res, DOC);
    return;
  }
  if (req.url === '/gzip') {
    res.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'gzip' });
    res.end(gzipSync(Buffer.from(DOC)));
    return;
  }
  if (req.url === '/br') {
    res.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'br' });
    res.end(brotliCompressSync(Buffer.from(DOC)));
    return;
  }
  if (req.url === '/endless') {
    res.on('close', () => { if (!res.writableFinished) aborted.endless = true; });
    res.writeHead(200, { 'content-type': 'application/xml' });
    try {
      for (let i = 0; i < 2000 && !res.destroyed; i++) {
        res.write('<job>x</job>'.repeat(512));
        await new Promise((r) => setTimeout(r, 2));
      }
      res.end();
    } catch { /* the client cancelled */ }
    return;
  }
  if (req.url === '/stall') {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.write('<job>first</job>');
    return; // never ends
  }
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/doc' });
    res.end();
    return;
  }
  if (req.url === '/limited') {
    res.writeHead(429, { 'retry-after': '86400', 'content-type': 'application/json' });
    res.end('{"error":"rate_limit"}');
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://stream.example.test';
const viaLocal = (fn) => withLocalServerAs(base, `http://127.0.0.1:${server.address().port}`, fn);

try {
  await viaLocal(async () => {
    {
      const pieces = [];
      const result = await fetchTextStream(`${base}/doc`, { maxBytes: 10 * 1024 * 1024 }, (t) => { pieces.push(t); });
      check(pieces.length > 1, 'the body reaches the callback in several pieces', `${pieces.length} piece(s)`);
      check(pieces.join('') === DOC, 'the pieces join to the exact body, multi-byte characters split across chunks included');
      check(result.complete === true && result.bytes === Buffer.byteLength(DOC), 'a body read to its end reports complete and its decoded size');
    }
    for (const route of ['gzip', 'br']) {
      const pieces = [];
      const result = await fetchTextStream(`${base}/${route}`, { maxBytes: 10 * 1024 * 1024 }, (t) => { pieces.push(t); });
      check(pieces.join('') === DOC && result.bytes === Buffer.byteLength(DOC), `a ${route} body is decoded, and maxBytes counts the decoded size`);
    }
    {
      let calls = 0;
      const result = await fetchTextStream(`${base}/endless`, { maxBytes: 100 * 1024 * 1024 }, () => { calls++; return calls < 3 ? undefined : false; });
      await new Promise((r) => setTimeout(r, 50));
      check(result.complete === false && calls === 3, 'onText returning false stops the read');
      check(aborted.endless, 'stopping early cancels the body, so the server sees the connection close');
    }
    {
      let err = null;
      try { await fetchTextStream(`${base}/doc`, { maxBytes: 64 * 1024 }, () => {}); } catch (e) { err = e; }
      check(err?.code === 'response_too_large', 'a decoded body over maxBytes throws response_too_large', err?.message);
    }
    {
      let err = null;
      let called = false;
      try { await fetchTextStream(`${base}/redirect`, {}, () => { called = true; }); } catch (e) { err = e; }
      check(err && !called, 'a redirect is refused (redirect: error) and the callback never runs');
    }
    {
      let err = null;
      let called = false;
      try { await fetchTextStream(`${base}/limited`, {}, () => { called = true; }); } catch (e) { err = e; }
      check(err?.status === 429 && err.retryAfter === '86400' && !called, 'a non-2xx throws the usual HttpError with Retry-After, and the callback never runs');
    }
    {
      let err = null;
      const pieces = [];
      const started = Date.now();
      try { await fetchTextStream(`${base}/stall`, { timeoutMs: 300 }, (t) => { pieces.push(t); }); } catch (e) { err = e; }
      check(err && err.timedOut === true && Date.now() - started < 5000, 'timeoutMs bounds the whole transfer: a stalled body fails as timed out', err?.message);
    }
    {
      let err = null;
      try { await fetchTextStream(`${base}/doc`, {}); } catch (e) { err = e; }
      check(err instanceof TypeError, 'a missing callback is a TypeError before any request');
    }
  });
} finally {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
}
