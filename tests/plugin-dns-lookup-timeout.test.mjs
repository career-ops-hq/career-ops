// tests/plugin-dns-lookup-timeout.test.mjs — the plugin egress guard stops waiting
// on a DNS lookup that never answers, instead of holding the plugin call.
//
// The resolver is injected (`lookup`), so nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAndValidate, DEFAULT_DNS_TIMEOUT_MS } from '../plugins/_net.mjs';

const never = () => new Promise(() => {});

test('a lookup that never answers is abandoned after timeoutMs', async () => {
  const started = Date.now();
  await assert.rejects(
    resolveAndValidate('hang.example.com', { timeoutMs: 60, lookup: never }),
    /cannot resolve hang\.example\.com — DNS lookup timed out after 60ms/,
  );
  assert.ok(Date.now() - started < 2000, 'returned long before any outer timeout');
});

test('a lookup that answers in time still resolves', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  assert.deepEqual(await resolveAndValidate('ok.example.com', { timeoutMs: 500, lookup }), ['93.184.216.34']);
});

test('a lookup that fails keeps its own error', async () => {
  const lookup = async () => { throw new Error('getaddrinfo ENOTFOUND nope.example.com'); };
  await assert.rejects(resolveAndValidate('nope.example.com', { timeoutMs: 500, lookup }), /cannot resolve nope\.example\.com — getaddrinfo ENOTFOUND/);
});

test('a slow lookup that fails after the timeout does not leak an unhandled rejection', async () => {
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on('unhandledRejection', onUnhandled);
  const lookup = () => new Promise((_, rej) => setTimeout(() => rej(new Error('late failure')), 80));
  await assert.rejects(resolveAndValidate('slow.example.com', { timeoutMs: 20, lookup }), /timed out/);
  await new Promise((r) => setTimeout(r, 150));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(seen, []);
});

test('a blocked address is still refused when the lookup is fast', async () => {
  const lookup = async () => [{ address: '169.254.169.254', family: 4 }];
  await assert.rejects(resolveAndValidate('meta.example.com', { timeoutMs: 500, lookup }), /blocked address/);
});

test('a bad timeoutMs is ignored and the default limit applies', async () => {
  assert.equal(DEFAULT_DNS_TIMEOUT_MS, 5000);
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  for (const bad of [NaN, -1, 0, '5', Infinity, null]) {
    assert.deepEqual(await resolveAndValidate('ok.example.com', { timeoutMs: bad, lookup }), ['93.184.216.34'], `timeoutMs ${String(bad)}`);
  }
});

test('IP literals and loopback opt-in skip the lookup entirely', async () => {
  const boom = () => { throw new Error('lookup must not run'); };
  assert.deepEqual(await resolveAndValidate('93.184.216.34', { lookup: boom }), ['93.184.216.34']);
  assert.deepEqual(await resolveAndValidate('localhost', { allowsLocalhost: true, lookup: boom }), ['127.0.0.1']);
});

test('a timeoutMs above the timer limit is ignored instead of firing after 1 ms', async () => {
  // setTimeout would run a delay over 2^31-1 ms after ~1 ms, failing a lookup that has plenty of time.
  const lookup = () => new Promise((r) => setTimeout(() => r([{ address: '93.184.216.34', family: 4 }]), 50));
  assert.deepEqual(await resolveAndValidate('ok.example.com', { timeoutMs: 2_147_483_648, lookup }), ['93.184.216.34']);
});
