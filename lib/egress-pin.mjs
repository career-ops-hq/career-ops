#!/usr/bin/env node
// lib/egress-pin.mjs — may a shell fetch this URL, and which address must it use?
//
//   node lib/egress-pin.mjs <url>
//
// Exit 0: allowed. stdout is the value for `curl --resolve` (host:port:addr,…)
//         when the host is a name, or empty when it is a public IP literal.
// Exit 1: refused: the host is, or resolves to, a non-public address, names
//         this machine, or does not resolve. The reason goes to stderr.
// Exit 2: not an http(s) URL.
//
// batch/batch-runner.sh calls this on every hop of its JD prefetch. Its old
// inline check read the literal host only, so a name that resolved to a
// private address was fetched. Checking the name here and then letting curl
// resolve it again would leave a window (DNS rebinding); pinning curl to the
// addresses checked here closes it.
//
// The verdict is lib/egress-proxy.mjs vetDestination, the rule the browser's
// egress filter applies, on providers/_ip-guard.mjs isBlockedAddress.

import net from 'node:net';
import { vetDestination } from './egress-proxy.mjs';
import { isMainModule } from './is-main-module.mjs';

/**
 * @param {string} rawUrl
 * @returns {Promise<{ exit: 0, pin: string } | { exit: 1 | 2, reason: string }>}
 */
export async function egressPin(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { exit: 2, reason: 'invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { exit: 2, reason: `unsupported protocol ${url.protocol}` };
  }
  const verdict = await vetDestination(url.hostname);
  if (!verdict.ok) return { exit: 1, reason: verdict.reason };
  if (net.isIP(verdict.host)) return { exit: 0, pin: '' };
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  // IPv4 first: curl tries the list in order, and an IPv6 answer on a host
  // without IPv6 egress would only cost a timeout before the next one.
  const ordered = [...verdict.addresses].sort((a, b) => net.isIP(a) - net.isIP(b));
  const addresses = ordered.map((a) => (net.isIP(a) === 6 ? `[${a}]` : a)).join(',');
  return { exit: 0, pin: `${verdict.host}:${port}:${addresses}` };
}

const USAGE = `Usage: node lib/egress-pin.mjs <url>

May a shell fetch <url>, and which addresses must it use?
  Exit 0  allowed: prints the value for curl --resolve (host:port:addr,...) when
          the host is a name, or nothing when it is a public IP literal
  Exit 1  refused: a private, loopback or metadata address, a local or
          private-use name, or a name that does not resolve
  Exit 2  not an http(s) URL

Options:
  --help, -h   show this help
`;

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const result = await egressPin(args[0] ?? '');
  if (result.exit === 0) process.stdout.write(result.pin);
  else process.stderr.write(`${result.reason}\n`);
  process.exitCode = result.exit;
}
