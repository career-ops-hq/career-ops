// tests/private-host-guards.test.mjs — every guard that judges a URL by its
// host refuses the bracketed IPv6 and other private spellings.
//
// openrouter-runner.mjs assertSafeRemoteUrl() compared URL.hostname with '::1',
// but the hostname keeps its brackets ('[::1]'), so the comparison never
// matched, and nothing checked IPv4-mapped, unique-local, link-local or
// unspecified IPv6, or 0.0.0.0. upskill.mjs --url-text checked DNS answers only:
// '[::1]' resolves to nothing, so it passed, and its plain-fetch fallback then
// read the loopback service. company-funded.mjs and sync-batch-input.mjs kept
// their own lists. All four now judge an IP literal with
// providers/_ip-guard.mjs isBlockedAddress, brackets stripped.
import { pass, fail } from './helpers.mjs';
import { isIP } from 'node:net';
import { setHostResolver } from '../liveness-browser.mjs';
import { assertSafeRemoteUrl } from '../openrouter-runner.mjs';
import { validateUrlSecurity as upskillGuard } from '../upskill.mjs';
import { isPrivateOrInternalHostname } from '../company-funded.mjs';
import { isSafePublicHttpUrl } from '../sync-batch-input.mjs';

console.log('\nprivate-host guards — bracketed IPv6 and the rest of private space');

const PRIVATE = [
  // The six URLs of the report, in its order.
  'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::]/', 'http://0.0.0.0/',
  // The same ranges, other members and spellings.
  'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[fc00::1]/', 'http://[febf::1]/',
  'http://[0:0:0:0:0:0:0:1]/', 'http://[::7f00:1]/', 'http://0.1.2.3/', 'http://100.64.0.1/', 'http://100.127.255.254/',
  'http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:8080/', 'http://2130706433/',
];
const PUBLIC = ['https://jobs.example/job', 'http://8.8.8.8/', 'http://100.128.0.1/', 'http://[2606:4700::1111]/'];

async function throws(fn) {
  try { await fn(); return null; } catch (err) { return err; }
}

// A literal answers with itself, as dns.lookup does; no test touches the network.
const restore = setHostResolver(async (host) => (isIP(host) ? [host] : { 'jobs.example': ['93.184.215.14'] }[host] ?? []));
try {
  const guards = [
    ['openrouter-runner assertSafeRemoteUrl', async (url) => Boolean(await throws(() => assertSafeRemoteUrl(url)))],
    ['upskill --url-text guard', async (url) => Boolean(await throws(() => upskillGuard(url)))],
    ['company-funded host check', async (url) => isPrivateOrInternalHostname(new URL(url).hostname)],
    ['sync-batch-input isSafePublicHttpUrl', async (url) => !isSafePublicHttpUrl(url)],
  ];
  for (const [name, refuses] of guards) {
    const missed = [];
    for (const url of PRIVATE) if (!(await refuses(url))) missed.push(url);
    if (missed.length === 0) pass(`${name} refuses all ${PRIVATE.length} private spellings`);
    else fail(`${name} let through ${missed.join(' ')}`);
    const blocked = [];
    for (const url of PUBLIC) if (await refuses(url)) blocked.push(url);
    if (blocked.length === 0) pass(`${name} lets public hosts through`);
    else fail(`${name} refused public ${blocked.join(' ')}`);
  }
} finally {
  restore();
}
