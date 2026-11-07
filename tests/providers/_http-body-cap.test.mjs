// tests/providers/_http-body-cap.test.mjs — fetchJson/fetchText must refuse
// an oversized response body instead of buffering it whole.
//
// fetchTextHead already caps at maxBytes and cancels the body; the full-fetch
// siblings had no cap at all, so one hostile or merely enormous board could
// pin the scanner's memory with a single response. The cap THROWS rather than
// truncating: a cut-off JSON document must never masquerade as the board's
// answer. Default is generous (DEFAULT_MAX_BODY_BYTES) because real board JSON
// is legitimately megabyte-sized; tests pass small maxBytes explicitly.
//
// The refusal also has to RELEASE the connection: a body nobody reads keeps
// its socket, and a provider sweep holds many of them at once. Both the
// over-cap header and the mid-stream cap cancel, and the server side proves
// it by reporting the response as aborted.
import { createServer } from 'node:http';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, withLocalServerAs } from '../helpers.mjs';

console.log('\nProvider — _http body cap');

const { fetchJson, fetchText, fetchResponse, fetchJsonWithRetry, DEFAULT_MAX_BODY_BYTES, MAX_ERROR_BODY_BYTES } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

const BIG = 2 * 1024 * 1024; // honest 2MiB body
const bigJson = JSON.stringify({ jobs: 'x'.repeat(BIG) });

// Server-side evidence that the client gave up on the body.
const aborted = { declared: false, chunked: false, error: false };
// How many times the over-cap body was requested — the retry evidence.
const hits = { sized1025: 0 };

/** Write a body slowly and never finish it, so a cancel is observable. */
async function streamForever(res, chunk, flag) {
  res.on('close', () => { if (!res.writableFinished) aborted[flag] = true; });
  try {
    for (let i = 0; i < 200; i++) {
      res.write(chunk);
      await new Promise((r) => setTimeout(r, 2));
    }
    res.end();
  } catch {
    /* the client cancelled — that is the point of this route */
  }
}

const server = createServer(async (req, res) => {
  if (req.url === '/big') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bigJson) });
    streamForever(res, 'x'.repeat(64 * 1024), 'declared');
    return;
  }
  if (req.url === '/big-chunked') {
    // No content-length: the cap must hold mid-stream, not only on the header.
    res.writeHead(200, { 'content-type': 'application/json' });
    streamForever(res, 'y'.repeat(64 * 1024), 'chunked');
    return;
  }
  if (req.url === '/sized-1024') {
    // Fixed lengths, never a length taken from the request: a repeat count
    // derived from the request is an allocation an attacker controls.
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1024' });
    res.end('x'.repeat(1024));
    return;
  }
  if (req.url === '/sized-1025') {
    hits.sized1025 += 1;
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1025' });
    res.end('x'.repeat(1025));
    return;
  }
  if (req.url === '/bom') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('\uFEFF{"ok":true}');
    return;
  }
  if (req.url === '/error-big') {
    // A failing endpoint with a huge error page: the body is diagnostic, so
    // it is capped instead of being buffered whole.
    res.writeHead(500, { 'content-type': 'text/html' });
    streamForever(res, 'z'.repeat(64 * 1024), 'error');
    return;
  }
  if (req.url === '/error-small') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('nope');
    return;
  }
  if (req.url === '/error-marker') {
    // The marker sits in the last bytes that still fit under the cap, and it
    // arrives in a piece that crosses the ceiling: the chunk that straddles
    // the cap has to keep the part that fits, or the marker is lost.
    //
    // Two writes, not many small ones: every timer wait costs up to the
    // platform's timer resolution (on some Windows machines about 15ms), and
    // enough of them push the read past fetchText's default timeout, which
    // reports the body as empty. If the two writes arrive as one chunk, that chunk still
    // crosses the cap with the marker in it.
    res.writeHead(500, { 'content-type': 'text/html' });
    const body = 'x'.repeat(MAX_ERROR_BODY_BYTES - 3) + 'END' + 'z'.repeat(600);
    const split = MAX_ERROR_BODY_BYTES - 300;
    res.write(body.slice(0, split));
    await new Promise((r) => setTimeout(r, 20));
    res.write(body.slice(split));
    res.end();
    return;
  }
  if (req.url === '/big-headers') {
    res.writeHead(200, { 'content-type': 'application/json', 'x-board': 'acme', 'content-length': String(BIG) });
    streamForever(res, 'w'.repeat(64 * 1024), 'declared');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://caps.example.test';
const viaLocal = (fn) => withLocalServerAs(base, `http://127.0.0.1:${server.address().port}`, fn);
try {

  const isTooLarge = (err) => err?.code === 'response_too_large';

  /** Wait for a server-side fact, so a slow 'close' event is not a false negative. */
  async function waitFor(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return predicate();
  }

  // 1. Under the cap, unchanged behaviour.
  try {
    const text = await viaLocal(() => fetchText(`${base}/ok`, { maxBytes: 1024 }));
    text === '{"ok":true}' ? pass('fetchText under the cap is unchanged') : fail(`fetchText under the cap returned ${text}`);
  } catch (err) {
    fail(`fetchText under the cap threw: ${err?.message}`);
  }

  // 2. fetchJson under the cap still parses through the capped reader.
  try {
    const json = await viaLocal(() => fetchJson(`${base}/ok`, { maxBytes: 1024 }));
    json?.ok === true ? pass('fetchJson under the cap still parses') : fail('fetchJson under the cap returned unexpected JSON');
  } catch (err) {
    fail(`fetchJson under the cap threw: ${err?.message}`);
  }

  // 3. Declared content-length over the cap: refused before the body is read.
  try {
    await viaLocal(() => fetchText(`${base}/big`, { maxBytes: 64 * 1024 }));
    fail('fetchText resolved on a body declaring more than maxBytes');
  } catch (err) {
    isTooLarge(err) ? pass('fetchText refuses an over-cap content-length') : fail(`fetchText failed another way: ${err?.message}`);
  }

  // 4. Same for fetchJson.
  try {
    await viaLocal(() => fetchJson(`${base}/big`, { maxBytes: 64 * 1024 }));
    fail('fetchJson resolved on a body declaring more than maxBytes');
  } catch (err) {
    isTooLarge(err) ? pass('fetchJson refuses an over-cap content-length') : fail(`fetchJson failed another way: ${err?.message}`);
  }

  // 5. Chunked, no content-length: the mid-stream cap must cancel and throw.
  try {
    await viaLocal(() => fetchText(`${base}/big-chunked`, { maxBytes: 16 * 1024 }));
    fail('fetchText resolved on a chunked body exceeding maxBytes');
  } catch (err) {
    isTooLarge(err) ? pass('fetchText refuses a chunked body past maxBytes') : fail(`fetchText failed another way: ${err?.message}`);
  }

  // 6. A refused body releases its connection — otherwise a sweep accumulates
  // sockets that nobody reads.
  await waitFor(() => aborted.declared);
  aborted.declared
    ? pass('the refused declared-length body is cancelled, not left open')
    : fail('the over-cap body was refused but its connection stayed open');
  await waitFor(() => aborted.chunked);
  aborted.chunked
    ? pass('the chunked body is cancelled mid-stream')
    : fail('the chunked body was refused but its connection stayed open');

  // 7. The exact limit is allowed: a body of exactly maxBytes is not over it.
  try {
    const text = await viaLocal(() => fetchText(`${base}/sized-1024`, { maxBytes: 1024 }));
    text.length === 1024 ? pass('a body of exactly maxBytes is accepted') : fail(`expected 1024 bytes, got ${text.length}`);
  } catch (err) {
    fail(`a body of exactly maxBytes was refused: ${err?.message}`);
  }

  // 8. One byte over the limit is refused.
  try {
    await viaLocal(() => fetchText(`${base}/sized-1025`, { maxBytes: 1024 }));
    fail('a body one byte over maxBytes was accepted');
  } catch (err) {
    isTooLarge(err) ? pass('a body one byte over maxBytes is refused') : fail(`fetchText failed another way: ${err?.message}`);
  }

  // 9. A BOM-prefixed JSON body still parses: res.json() used to strip it.
  try {
    const json = await viaLocal(() => fetchJson(`${base}/bom`, { maxBytes: 1024 }));
    json?.ok === true ? pass('a BOM-prefixed JSON body still parses') : fail('a BOM-prefixed JSON body did not parse');
  } catch (err) {
    fail(`a BOM-prefixed JSON body threw: ${err?.message}`);
  }

  // 10. A nonsense maxBytes is refused instead of silently disabling the cap.
  for (const bad of [0, -1, Number.NaN, 'lots', 0.5, 0.9]) {
    const label = Number.isNaN(bad) ? 'NaN' : JSON.stringify(bad);
    try {
      await viaLocal(() => fetchText(`${base}/ok`, { maxBytes: bad }));
      fail(`maxBytes ${label} was accepted`);
    } catch (err) {
      err instanceof TypeError
        ? pass(`maxBytes ${label} is refused`)
        : fail(`maxBytes ${label} failed another way: ${err?.message}`);
    }
  }

  // 11. The default exists and is generous but finite.
  typeof DEFAULT_MAX_BODY_BYTES === 'number' && DEFAULT_MAX_BODY_BYTES > BIG
    ? pass(`default cap is ${DEFAULT_MAX_BODY_BYTES} bytes`)
    : fail(`DEFAULT_MAX_BODY_BYTES is ${DEFAULT_MAX_BODY_BYTES}`);

  // 12. A failing response's body is capped too: the abort timer limits how
  // long the read takes, not how many bytes it buffers.
  try {
    await viaLocal(() => fetchText(`${base}/error-big`, { maxBytes: 64 * 1024 }));
    fail('a 500 with a large body resolved instead of throwing');
  } catch (err) {
    const bounded = typeof err?.body === 'string' && err.body.length <= MAX_ERROR_BODY_BYTES;
    if (err?.status === 500 && bounded && err.code !== 'response_too_large') {
      pass('a non-2xx body is capped, and the HTTP error still wins');
    } else {
      fail(`unexpected non-2xx handling: status=${err?.status} body=${err?.body?.length} code=${err?.code}`);
    }
  }
  await waitFor(() => aborted.error);
  aborted.error
    ? pass('the capped error body releases its connection')
    : fail('the capped error body left its connection open');

  // 13. A small error body is attached unchanged — the cap must not alter the
  // diagnostic a caller reads.
  try {
    await viaLocal(() => fetchText(`${base}/error-small`));
    fail('a 404 resolved instead of throwing');
  } catch (err) {
    err?.status === 404 && err.body === 'nope'
      ? pass('a small error body is attached unchanged')
      : fail(`a small error body was altered: status=${err?.status} body=${JSON.stringify(err?.body)}`);
  }

  // 14. fetchResponse is capped too: it rebuilds a Response, and the read
  // behind that rebuild was the last unbounded one in the transport.
  try {
    await viaLocal(() => fetchResponse(`${base}/big`, { maxBytes: 64 * 1024 }));
    fail('fetchResponse resolved on a body over maxBytes');
  } catch (err) {
    isTooLarge(err) ? pass('fetchResponse refuses an over-cap body') : fail(`fetchResponse failed another way: ${err?.message}`);
  }
  try {
    const res = await viaLocal(() => fetchResponse(`${base}/ok`, { maxBytes: 1024 }));
    const text = await res.text();
    text === '{"ok":true}'
      ? pass('fetchResponse under the cap still returns the body')
      : fail(`fetchResponse returned ${text}`);
  } catch (err) {
    fail(`fetchResponse under the cap threw: ${err?.message}`);
  }

  // 15. An over-cap body is not retried. The same response would be refused
  // again, so retrying only downloads the oversize body a second and third time.
  hits.sized1025 = 0;
  try {
    const ctx = { fetchJson: (u, o) => fetchJson(u, o), sleep: async () => {} };
    await viaLocal(() => fetchJsonWithRetry(ctx, `${base}/sized-1025`, { maxBytes: 1024 }));
    fail('the retry wrapper resolved on an over-cap body');
  } catch (err) {
    isTooLarge(err)
      ? pass('an over-cap body surfaces as response_too_large')
      : fail(`the retry wrapper failed another way: ${err?.message}`);
  }
  hits.sized1025 === 1
    ? pass('an over-cap body is fetched once, not three times')
    : fail(`an over-cap body was fetched ${hits.sized1025} times`);

  // 16. A diagnostic marker that sits in the last bytes under the cap survives
  // the truncation: dropping the whole crossing chunk would throw it away.
  try {
    await viaLocal(() => fetchText(`${base}/error-marker`));
    fail('the marker route resolved instead of throwing');
  } catch (err) {
    const body = typeof err?.body === 'string' ? err.body : '';
    body.length === MAX_ERROR_BODY_BYTES && body.endsWith('END')
      ? pass('a marker at the cap edge survives the truncation')
      : fail(`the marker was lost: body is ${body.length} bytes and ends with ${JSON.stringify(body.slice(-10))}`);
  }

  // 17. An over-cap response still carries its headers: fetchResponse exists
  // for the headers (Set-Cookie, Location), so the size error must not take
  // them away with it.
  try {
    await viaLocal(() => fetchResponse(`${base}/big-headers`, { maxBytes: 64 * 1024 }));
    fail('fetchResponse resolved on an over-cap body');
  } catch (err) {
    err?.code === 'response_too_large' && err?.headers?.get?.('x-board') === 'acme'
      ? pass('an over-cap response still carries its headers')
      : fail(`the headers were lost on the size error: ${err?.headers?.get?.('x-board')}`);
  }

  } finally {
    // The listening server keeps the event loop busy, so an unexpected throw
    // above must not leave it open for the rest of the run.
    server.closeAllConnections?.();
    server.close();
  }
