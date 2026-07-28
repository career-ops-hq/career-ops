// tests/providers/startupch.test.mjs — direct provider-contract tests (PR #825).
// startup.ch needs browser-like headers and a session cookie primed from the
// homepage, so fetch() makes TWO hops. Both must go through ctx.fetchResponse
// with redirect:'error' — a regression that drops either hop (or bypasses ctx
// for a bespoke fetch) would silently lose the SSRF guard, so the hops are
// asserted individually rather than "at least one". Also covers the anti-bot
// page failing closed.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — startupch');

try {
  const startupch = (await import(pathToFileURL(join(ROOT, 'providers/startupch.mjs')).href)).default;

  if (startupch.id === 'startupch') pass('startupch.id is "startupch"');
  else fail(`startupch.id is ${JSON.stringify(startupch.id)}`);

  if (startupch.detect({ name: 'S', careers_url: 'https://www.startup.ch/jobs' })?.url === 'https://www.startup.ch/jobs') {
    pass('startupch.detect() claims a startup.ch careers_url');
  } else {
    fail('startupch.detect() should claim startup.ch');
  }

  // SSRF: path-spoofed / off-host careers_url must not be detected as startup.ch.
  if (startupch.detect({ name: 'Spoof', careers_url: 'https://evil.example/startup.ch' }) === null
      && startupch.detect({ name: 'Other', careers_url: 'https://example.com/jobs' }) === null) {
    pass('startupch.detect() rejects path-spoofed / off-host URLs (SSRF)');
  } else {
    fail('startupch.detect() must only claim the startup.ch hostname');
  }

  // A minimal Response-like stub so the provider can read text + Set-Cookie.
  const makeRes = (html, setCookie = null) => ({
    headers: {
      getSetCookie: () => (setCookie ? [setCookie] : []),
      get: () => setCookie,
    },
    text: async () => html,
  });
  const sampleHtml = [
    '<div class="white-box startup-box">',
    '  <a href="index.cfm?page=137888&profil_id=42&JobID=999#job_999"></a>',
    '  <img src="x.png" alt="Acme AG" />',
    '  <h4 class="top10-title foo">Head of Operations</h4>',
    '  <img src="location.png" /><p class="d-inline-flex mb-1">Zurich</p>',
    '</div>',
  ].join('\n');

  // fetch() routes through ctx.fetchResponse with redirect:'error' on BOTH hops:
  // the homepage cookie-prime and the listings request.
  const startCalls = [];
  const startJobs = await startupch.fetch(
    { name: 'startup.ch', careers_url: 'https://www.startup.ch/jobs' },
    { fetchResponse: async (url, opts) => { startCalls.push({ url, opts }); return makeRes(sampleHtml, 'CFID=1'); } },
  );

  const primeCall = startCalls.find(c => c.url === 'https://www.startup.ch/');
  const listCall = startCalls.find(c => c.url === 'https://www.startup.ch/jobs');
  if (primeCall && listCall) {
    pass('startupch.fetch() makes both the cookie-prime and listings requests');
  } else {
    fail(`startupch.fetch() expected both hops, saw ${JSON.stringify(startCalls.map(c => c.url))}`);
  }
  if (primeCall?.opts?.redirect === 'error') pass('startupch cookie-prime request passes redirect:"error"');
  else fail(`startupch cookie-prime opts = ${JSON.stringify(primeCall?.opts)}`);
  if (listCall?.opts?.redirect === 'error') pass('startupch listings request passes redirect:"error"');
  else fail(`startupch listings opts = ${JSON.stringify(listCall?.opts)}`);

  // The primed cookie must actually reach the listings request.
  if (/CFID=1/.test(listCall?.opts?.headers?.cookie || '')) {
    pass('startupch.fetch() forwards the primed session cookie to the listings request');
  } else {
    fail(`startupch listings cookie header = ${JSON.stringify(listCall?.opts?.headers?.cookie)}`);
  }

  if (startJobs.length === 1 && startJobs[0].title === 'Head of Operations'
      && startJobs[0].url === 'https://www.startup.ch/index.cfm?page=137888&profil_id=42&JobID=999'
      && startJobs[0].company === 'Acme AG') {
    pass('startupch.fetch() parses a listing card into a job');
  } else {
    fail(`startupch.fetch() row = ${JSON.stringify(startJobs[0])}`);
  }

  // Anti-bot/error page fails closed (throws, not silent zero).
  let startThrew = false;
  try {
    await startupch.fetch(
      { name: 'startup.ch', careers_url: 'https://www.startup.ch/jobs' },
      { fetchResponse: async () => makeRes('<title>Error</title> unerwarteter Fehler') },
    );
  } catch (e) { startThrew = /error|anti-bot|rate-limit/i.test(e.message); }
  if (startThrew) pass('startupch.fetch() throws on the anti-bot/error page (fails closed)');
  else fail('startupch.fetch() should throw on the error page');

  // Genuinely empty board → empty array (no cards, no error markers).
  const startEmpty = await startupch.fetch(
    { name: 'startup.ch', careers_url: 'https://www.startup.ch/jobs' },
    { fetchResponse: async () => makeRes('<html><body>No openings right now</body></html>') },
  );
  if (Array.isArray(startEmpty) && startEmpty.length === 0) pass('startupch.fetch() returns [] for an empty board');
  else fail(`startupch.fetch() empty board = ${JSON.stringify(startEmpty)}`);
} catch (e) {
  fail(`startupch provider tests crashed: ${e.message}`);
}
