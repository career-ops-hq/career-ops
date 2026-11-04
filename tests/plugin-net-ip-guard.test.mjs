// tests/plugin-net-ip-guard.test.mjs — the plugin egress guard refuses what the
// provider guard refuses. plugins/_net.mjs kept its own copy of the blocked
// ranges and fell behind providers/_ip-guard.mjs; it now delegates, and this
// pins the two to the same verdicts.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nPlugin egress — IP guard parity');

try {
  const net = await import(pathToFileURL(join(ROOT, 'plugins/_net.mjs')).href);
  const guard = await import(pathToFileURL(join(ROOT, 'providers/_ip-guard.mjs')).href);

  // These passed the plugin guard while the provider guard refused them.
  const missedBefore = ['198.18.0.1', '198.19.255.1', 'fe90::1', 'febf::1', 'ff02::1', '::127.0.0.1', '::7f00:1', '::a9fe:a9fe'];
  const stillOpen = missedBefore.filter((ip) => !net.isBlockedIp(ip));
  if (stillOpen.length === 0) pass('isBlockedIp refuses benchmarking, all of fe80::/10, multicast and IPv4-compatible forms');
  else fail(`isBlockedIp lets through ${stillOpen.join(', ')}`);

  const sample = [
    ...missedBefore,
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.0.0.1',
    '192.168.1.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
    '::ffff:7f00:1', '8.8.8.8', '1.1.1.1', '2606:4700::1111', '2001:4860:4860::8888',
  ];
  const disagree = sample.filter((ip) => net.isBlockedIp(ip) !== guard.isBlockedAddress(ip));
  if (disagree.length === 0) pass('isBlockedIp and isBlockedAddress agree on every sampled address');
  else fail(`isBlockedIp and isBlockedAddress disagree on ${disagree.join(', ')}`);

  if (!net.isBlockedIp('8.8.8.8') && !net.isBlockedIp('2606:4700::1111')) pass('public addresses stay reachable');
  else fail('isBlockedIp blocks a public address');

  if (net.isBlockedIp('example.com') && net.isBlockedIp('')) pass('a non-IP string fails closed');
  else fail('isBlockedIp accepts a non-IP string');

  let threw = false;
  try { await net.resolveAndValidate('::7f00:1'); } catch { threw = true; }
  if (threw) pass('resolveAndValidate refuses an IPv4-compatible loopback literal');
  else fail('resolveAndValidate accepted ::7f00:1');

  const local = await net.resolveAndValidate('127.0.0.1', { allowsLocalhost: true });
  if (Array.isArray(local) && local[0] === '127.0.0.1') pass('allowsLocalhost still lets a loopback literal through');
  else fail(`allowsLocalhost loopback returned ${JSON.stringify(local)}`);
} catch (err) {
  fail(`plugin IP guard tests crashed: ${err.message}`);
}
