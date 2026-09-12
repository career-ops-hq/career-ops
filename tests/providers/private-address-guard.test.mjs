// tests/providers/private-address-guard.test.mjs — a provider must not connect
// to a host that resolves to a non-public address (#3096).
//
// Every provider's host guard pins the HOSTNAME to a public registrable
// domain; nothing checked where that name RESOLVES. `redirect: 'error'` blocks
// redirect hops, not a direct malicious A record.
//
// OFFLINE: the end-to-end cases use `localhost` against a local server, which
// is a real name resolving to a real loopback address — no DNS stubbing, and
// no network. Stubbing dns.lookup here would be worse than useless: a stub
// that answers directly never reaches the patched lookup, so the guard would
// appear to fail while working correctly (which is exactly what happened to me
// while writing this).
//
// Run:  node --test tests/providers/private-address-guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dnsModule from 'node:dns';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const spec = (rel) => pathToFileURL(join(ROOT, rel)).href;

const { isBlockedAddress, blockedAddressError, providerFetchContext } = await import(spec('providers/_ip-guard.mjs'));
const { fetchText } = await import(spec('providers/_http.mjs'));
const { RESOLVER_FAILURE_CODES } = await import(spec('providers/_dns-cache.mjs'));

/** Start a loopback server; returns its port and a close(). */
async function localServer(body = 'SECRET-LOCAL-DATA') {
  const srv = http.createServer((_q, s) => s.end(body)).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { port: srv.address().port, close: () => srv.close() };
}

const codeOf = (err) => (err?.cause ?? err)?.code;

// ── classification ─────────────────────────────────────────────────────────

test('blocks loopback, private, link-local and reserved ranges', () => {
  for (const address of [
    '127.0.0.1', '127.1.2.3', '0.0.0.0',
    '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254',      // cloud instance metadata — the usual SSRF target
    '100.64.0.1',           // CGNAT
    '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12::3', 'fe80::1', 'fe80::1%eth0', 'ff02::1',
    '::ffff:127.0.0.1',     // IPv4-mapped loopback
    '::ffff:169.254.169.254',
  ]) {
    assert.equal(isBlockedAddress(address), true, `${address} should be blocked`);
  }
});

test('allows ordinary public addresses, including the range boundaries', () => {
  for (const address of [
    '8.8.8.8', '1.1.1.1', '13.107.42.14',
    '172.15.255.255', '172.32.0.1',   // either side of 172.16.0.0/12
    '100.63.255.255',                  // just below 100.64.0.0/10
    '192.169.0.1',                     // just above 192.168.0.0/16
    '2606:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8',
  ]) {
    assert.equal(isBlockedAddress(address), false, `${address} should be allowed`);
  }
});

test('unparseable input is blocked, not guessed', () => {
  // A permissive parse is a bypass: the string is attacker-influenced.
  for (const address of ['', '   ', 'garbage', '1.2.3', '1.2.3.4.5', '01.2.3.4', '999.1.1.1', null, undefined]) {
    assert.equal(isBlockedAddress(address), true, `${JSON.stringify(address)} should be blocked`);
  }
});

// ── the guard, end to end ──────────────────────────────────────────────────

test('a provider fetch to a name resolving to loopback is refused', async () => {
  const srv = await localServer();
  try {
    await assert.rejects(
      () => fetchText(`http://localhost:${srv.port}/`, { timeoutMs: 4000 }),
      (err) => codeOf(err) === 'ECAREEROPS_BLOCKED_ADDRESS',
      'localhost resolved to loopback and was connected to anyway',
    );
  } finally { srv.close(); }
});

test('a NON-provider fetch to loopback still works', async () => {
  // The scoping guarantee. dns.lookup is patched process-wide, so an
  // unscoped check would break every local-server test in the repo — and
  // would most likely be "fixed" by an env opt-out that disables the guard
  // exactly where it is most likely to regress.
  const srv = await localServer();
  try {
    const res = await fetch(`http://localhost:${srv.port}/`);
    assert.equal(await res.text(), 'SECRET-LOCAL-DATA');
  } finally { srv.close(); }
});

test('a cached lookup is guarded too, not just a fresh one', async () => {
  // The hole this closes: resolve the name OUTSIDE a provider fetch so it is
  // memoized unvalidated, then fetch it as a provider. Guarding only the
  // resolver path would serve the private address straight from cache.
  const srv = await localServer();
  try {
    await new Promise((resolve, reject) =>
      dnsModule.lookup('localhost', (err, addr) => (err ? reject(err) : resolve(addr))));
    await assert.rejects(
      () => fetchText(`http://localhost:${srv.port}/`, { timeoutMs: 4000 }),
      (err) => codeOf(err) === 'ECAREEROPS_BLOCKED_ADDRESS',
      'a pre-warmed cache entry bypassed the guard',
    );
  } finally { srv.close(); }
});

// ── the error must not be mistaken for a sick resolver ─────────────────────

test('the block code is not a resolver-failure code', () => {
  // RESOLVER_FAILURE_CODES drives negative caching and the resolver-outage
  // signal (#2229). This is a verdict about ONE hostname, not resolver health;
  // counting it as the latter would negative-cache a refusal and could trip an
  // outage path over a config the user should be told about instead.
  const err = blockedAddressError('evil.example', '127.0.0.1');
  assert.equal(err.code, 'ECAREEROPS_BLOCKED_ADDRESS');
  assert.equal(RESOLVER_FAILURE_CODES.has(err.code), false);
  assert.match(err.message, /evil\.example/);
  assert.match(err.message, /127\.0\.0\.1/);
});

test('the context is entered only for provider requests', async () => {
  const { inProviderFetch } = await import(spec('providers/_ip-guard.mjs'));
  assert.equal(inProviderFetch(), false);
  providerFetchContext.run({ url: 'x' }, () => assert.equal(inProviderFetch(), true));
  assert.equal(inProviderFetch(), false);
});
