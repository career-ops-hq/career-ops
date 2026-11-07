// A board fetched twice in one scan, or again a few minutes later, should not
// hit the network a second time. After the fresh window, a GET rechecks with
// If-None-Match and keeps the saved body when the server answers 304.
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail, pass, ROOT, withLocalServerAs } from '../helpers.mjs';

const { fetchJson, fetchText } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);
const { withHttpCache } = await import(pathToFileURL(join(ROOT, 'providers/_http-cache.mjs')).href);

const hits = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const bodyIn = Buffer.concat(chunks).toString('utf8');
    hits.push({ url: req.url, method: req.method, body: bodyIn, inm: req.headers['if-none-match'] || '' });
    if (req.url === '/missing') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('nope');
      return;
    }
    if (req.url === '/wide') {
      res.writeHead(200, { 'content-type': 'text/plain', etag: '"v1"' });
      res.end('x'.repeat(50));
      return;
    }
    if (req.headers['if-none-match'] === '"v1"') {
      res.writeHead(304, { etag: '"v1"' });
      res.end();
      return;
    }
    const payload = req.url === '/changed'
      ? '{"title":"Platform Engineer","n":2}'
      : '{"title":"Platform Engineer","n":1}';
    res.writeHead(200, { 'content-type': 'application/json', etag: '"v1"' });
    res.end(payload);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://boards.example.test';
const local = `http://127.0.0.1:${server.address().port}`;
const via = (fn) => withLocalServerAs(origin, local, fn);
const dir = mkdtempSync(join(tmpdir(), 'co-http-cache-'));
let now = 10_000;

function cache(fn) {
  return withHttpCache({ dir, ttlMs: 1_000, now: () => now, write: true }, fn);
}

const board = `${origin}/v1/boards/northwind/jobs`;

{
  const before = hits.length;
  const [a, b] = await via(() => cache(() => Promise.all([
    fetchJson(board),
    fetchJson(board),
  ])));
  const got = hits.length - before;
  if (got === 1 && a.n === 1 && b.n === 1) pass('two overlapping reads of one board make one request');
  else fail(`overlapping reads made ${got} requests (a=${JSON.stringify(a)} b=${JSON.stringify(b)})`);
}

{
  const before = hits.length;
  const again = await via(() => cache(() => fetchJson(board)));
  const got = hits.length - before;
  if (got === 0 && again.n === 1) pass('a second read inside the fresh window makes no request');
  else fail(`fresh reread made ${got} requests and returned ${JSON.stringify(again)}`);
}

{
  now += 5_000;
  const before = hits.length;
  const again = await via(() => cache(() => fetchJson(board)));
  const got = hits.slice(before);
  if (got.length === 1 && got[0].inm === '"v1"' && again.n === 1) pass('a stale board is rechecked with If-None-Match and a 304 keeps the saved JSON');
  else fail(`stale recheck was ${JSON.stringify(got)} and returned ${JSON.stringify(again)}`);
}

{
  const before = hits.length;
  const text = await via(() => cache(() => fetchText(`${origin}/postings/northwind`, {
    method: 'POST',
    body: '{"offset":0}',
    headers: { 'content-type': 'application/json' },
  })));
  const other = await via(() => cache(() => fetchText(`${origin}/postings/northwind`, {
    method: 'POST',
    body: '{"offset":20}',
    headers: { 'content-type': 'application/json' },
  })));
  const got = hits.slice(before);
  if (got.length === 2 && text.includes('"n":1') && other.includes('"n":1')) pass('two POST bodies are two requests');
  else fail(`POST bodies made ${got.length} requests`);
}

{
  const before = hits.length;
  let firstThrew = false;
  let secondThrew = false;
  try {
    await via(() => cache(() => fetchJson(`${origin}/missing`)));
  } catch {
    firstThrew = true;
  }
  try {
    await via(() => cache(() => fetchJson(`${origin}/missing`)));
  } catch {
    secondThrew = true;
  }
  const missingHits = hits.slice(before).filter((hit) => hit.url === '/missing').length;
  if (firstThrew && secondThrew && missingHits === 2) pass('a failed board is not saved, so the next read tries again');
  else fail(`error was saved or not retried (first=${firstThrew}, second=${secondThrew}, hits=${missingHits})`);
}

{
  const url = `${origin}/postings/keyed`;
  const read = (apiKey) => via(() => cache(() => fetchText(url, {
    method: 'POST',
    body: '{"offset":0}',
    headers: { 'content-type': 'application/json', 'x-algolia-api-key': apiKey },
  })));
  const before = hits.length;
  await read('key-a');
  await read('key-b');
  await read('key-a');
  const got = hits.slice(before).filter((hit) => hit.url === '/postings/keyed');
  if (got.length === 2) pass('two API keys for one URL are two saved responses');
  else fail(`API keys shared a cache entry (${got.length} requests)`);
}

{
  const url = `${origin}/wide`;
  const full = await via(() => cache(() => fetchText(url)));
  let tooBig = false;
  try {
    await via(() => cache(() => fetchText(url, { maxBytes: 10 })));
  } catch (err) {
    tooBig = err?.code === 'response_too_large';
  }
  const wideHits = hits.filter((hit) => hit.url === '/wide').length;
  if (full.length === 50 && tooBig && wideHits === 2) pass('a smaller maxBytes does not reuse a larger saved body');
  else fail(`maxBytes shared a body (len=${full.length}, tooBig=${tooBig}, hits=${wideHits})`);
}

{
  const url = `${origin}/clock`;
  await via(() => cache(() => fetchJson(url)));
  now -= 5_000;
  const before = hits.length;
  const again = await via(() => cache(() => fetchJson(url)));
  now += 5_000;
  const got = hits.slice(before).filter((hit) => hit.url === '/clock');
  if (got.length === 1 && got[0].inm === '"v1"' && again.n === 1) pass('a saved time in the future is rechecked');
  else fail(`future storedAt was ${JSON.stringify(got)} and returned ${JSON.stringify(again)}`);
}

{
  const readonly = `${origin}/readonly`;
  const notSaved = `${origin}/not-saved`;
  await via(() => cache(() => fetchJson(readonly)));
  const before = hits.length;
  const reused = await via(() => withHttpCache({
    dir, ttlMs: 1_000, now: () => now, write: false,
  }, () => fetchJson(readonly)));
  await via(() => withHttpCache({
    dir, ttlMs: 1_000, now: () => now, write: false,
  }, () => fetchJson(notSaved)));
  await via(() => cache(() => fetchJson(notSaved)));
  const got = hits.slice(before);
  const readonlyHits = got.filter((hit) => hit.url === '/readonly').length;
  const notSavedHits = got.filter((hit) => hit.url === '/not-saved').length;
  if (reused.n === 1 && readonlyHits === 0 && notSavedHits === 2) {
    pass('a dry run reuses a saved response and does not keep a new one');
  } else {
    fail(`dry run was ${JSON.stringify({ reused, readonlyHits, notSavedHits })}`);
  }
}

server.close();
