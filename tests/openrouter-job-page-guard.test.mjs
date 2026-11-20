// tests/openrouter-job-page-guard.test.mjs — the job-page fetch in
// openrouter-runner.mjs refuses private destinations (GHSA-wwfx).
//
// Its guard used to keep its own literal-only list: `[::1]` passed (URL.hostname
// keeps the brackets, so a '::1' comparison never matched), and so did 0.0.0.0,
// IPv4-mapped IPv6, fd00::/8, 100.64.0.0/10 and any name that resolved
// privately. The plain-fetch fallback also followed redirects on its own. It
// now asks the liveness guard (isBlockedAddress underneath), and follows each
// redirect by hand after checking it.
import { pass, fail } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import { setHostResolver } from '../liveness-browser.mjs';
import { assertSafeRemoteUrl } from '../openrouter-runner.mjs';

console.log('\nopenrouter-runner.mjs — job-page fetch guard');

const restore = setHostResolver(async (host) => ({
  'jobs.example': ['93.184.215.14'],
  'rebind.example': ['10.0.0.7'],
  'cgnat.example': ['100.100.100.200'],
}[host] ?? []));
try {
  const refused = [
    'http://[::1]/job', 'http://0.0.0.0/job', 'http://[::ffff:7f00:1]/job', 'http://[fd00::1]/job',
    'http://100.64.0.1/job', 'http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:8080/job',
    'http://localhost/job', 'http://intranet.local/job', 'https://rebind.example/job', 'https://cgnat.example/job',
    'ftp://jobs.example/job',
  ];
  for (const url of refused) {
    let error = null;
    try { await assertSafeRemoteUrl(url); } catch (err) { error = err; }
    if (error && /Refusing/.test(error.message)) pass(`refuses ${url}`);
    else fail(`must refuse ${url}, got ${error ? error.message : 'no error'}`);
  }
  for (const url of ['https://jobs.example/job', 'https://gone.example/job']) {
    let error = null;
    try { await assertSafeRemoteUrl(url); } catch (err) { error = err; }
    if (!error) pass(`lets ${url} through (a host with no address fails when fetched, not here)`);
    else fail(`must allow ${url}, got ${error.message}`);
  }
} finally {
  restore();
}

// The plain-fetch fallback goes through providers/_http.mjs (whose lookup-time
// guard checks the address it dials) and checks every redirect hop before it
// is requested. The Playwright path launches the hardened chromium, whose
// egress filter sees the browser's redirect hops.
const src = readFileSync(new URL('../openrouter-runner.mjs', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('async function fetchJobPage('), src.indexOf('// portals.yml parser'));
if (/await assertSafeRemoteUrl\(url\)/.test(body)
  && /fetchResponse\(finalUrl, \{[\s\S]*?redirect: 'manual'/.test(body)
  && /finalUrl = new URL\(location, finalUrl\)\.href;\s*await assertSafeRemoteUrl\(finalUrl\);/.test(body)
  && !/\bawait fetch\(/.test(body)
  && /import\('\.\/lib\/hardened-chromium\.mjs'\)/.test(body)) {
  pass('fetchJobPage checks the URL, every fallback redirect hop, and launches the hardened chromium');
} else {
  fail('fetchJobPage lost a guard: initial check, per-hop check with redirect: manual, or the hardened chromium');
}
if (/await assertSafeRemoteUrl\(c\.api\);\s*(?:\/\/[^\n]*\n\s*)*const r = await fetch\(c\.api, \{ redirect: 'error' \}\)/.test(src)) {
  pass('the Greenhouse scan awaits the guard and refuses redirects');
} else {
  fail('the Greenhouse scan must await assertSafeRemoteUrl and fetch with redirect: error');
}
