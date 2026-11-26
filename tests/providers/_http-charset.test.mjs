// tests/providers/_http-charset.test.mjs — fetchText decodes a page served in
// a legacy single-byte encoding when the provider names it (opts.charset).
//
// Without it the body is decoded as UTF-8, and every byte above 0x7F in an
// ISO-8859-1 page becomes U+FFFD: "Técnico" reads "T�cnico", with no way back.
// net-empregos.com serves its pages that way.
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT, withLocalServerAs } from '../helpers.mjs';

console.log('\nProvider — _http charset');

const { fetchText } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);
const { withHttpCache } = await import(pathToFileURL(join(ROOT, 'providers/_http-cache.mjs')).href);

// "Técnico – Ação" in windows-1252: é = E9, en dash = 96, ç = E7, ã = E3.
const LATIN = Buffer.from([0x54, 0xe9, 0x63, 0x6e, 0x69, 0x63, 0x6f, 0x20, 0x96, 0x20, 0x41, 0xe7, 0xe3, 0x6f]);
const EXPECTED = 'Técnico – Ação';

let hits = 0;
const server = createServer((req, res) => {
  hits++;
  if (req.url === '/latin' || req.url === '/cached') {
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': LATIN.length });
    res.end(LATIN);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://charset.example.test';
const via = (fn) => withLocalServerAs(base, `http://127.0.0.1:${server.address().port}`, fn);

try {
  const decoded = await via(() => fetchText(`${base}/latin`, { charset: 'windows-1252' }));
  if (decoded === EXPECTED) pass('fetchText decodes a windows-1252 body when opts.charset names it');
  else fail(`fetchText charset: got ${JSON.stringify(decoded)}`);

  const iso = await via(() => fetchText(`${base}/latin`, { charset: 'iso-8859-1' }));
  if (iso === EXPECTED) pass('fetchText treats the iso-8859-1 label as windows-1252, as browsers do');
  else fail(`fetchText iso-8859-1: got ${JSON.stringify(iso)}`);

  const plain = await via(() => fetchText(`${base}/latin`));
  if (plain.includes('�') && !plain.includes('é')) pass('fetchText without charset still decodes as UTF-8');
  else fail(`fetchText default decode changed: ${JSON.stringify(plain)}`);

  const before = hits;
  try {
    await via(() => fetchText(`${base}/latin`, { charset: 'not-an-encoding' }));
    fail('fetchText should refuse an unknown charset label');
  } catch (err) {
    if (err instanceof RangeError && hits === before) pass('fetchText refuses an unknown charset label before any request');
    else fail(`fetchText unknown charset: ${err?.name} ${err?.message}, requests ${hits - before}`);
  }

  // The cache keys a body by its charset too: the same URL read as UTF-8 and
  // then as windows-1252 must not hand back the first decode.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-charset-'));
  const [utf8, latin] = await via(() => withHttpCache({ dir, ttlMs: 60_000, write: true }, async () => [
    await fetchText(`${base}/cached`),
    await fetchText(`${base}/cached`, { charset: 'windows-1252' }),
  ]));
  if (utf8.includes('�') && latin === EXPECTED) pass('the HTTP cache keeps a windows-1252 read apart from a UTF-8 read of the same URL');
  else fail(`cache mixed charsets: ${JSON.stringify([utf8, latin])}`);
} finally {
  await new Promise((r) => server.close(r));
}
