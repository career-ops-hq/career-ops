// tests/egress-proxy-half-open.test.mjs — a CONNECT tunnel whose origin never
// sends its FIN back must not keep the process alive.
//
// splice() piped the two sockets and destroyed them only on 'close'. When the
// browser hung up, pipe() half-closed the origin side; an origin that never
// answered with its own FIN left both sockets open for good, and `scan --verify`
// printed its results and then never exited (13 hours, holding the caller's
// lock). The check runs in a child process, because "the process exits" is
// the behaviour under test.
//
// No test touches the network: the origin is a loopback server a vet seam
// vouches for.
import { pass, fail } from './helpers.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

console.log('\nlib/egress-proxy.mjs — a half-open tunnel does not hold the process open');

const proxyModule = fileURLToPath(new URL('../lib/egress-proxy.mjs', import.meta.url));

// The child: an origin that ignores the client's FIN, the proxy, and a client
// that opens a tunnel and hangs up. Nothing is unref'd by hand except the
// origin's listening socket, so only the tunnel can keep the loop alive.
const child = `
import net from 'node:net';
const { startEgressProxy } = await import(${JSON.stringify(proxyModule)});
const origin = net.createServer({ allowHalfOpen: true }, (s) => { s.on('data', () => {}); s.on('end', () => {}); });
await new Promise((r) => origin.listen(0, '127.0.0.1', r));
origin.unref();
const port = origin.address().port;
const proxy = await startEgressProxy({
  vet: async (host) => ({ ok: true, host, addresses: ['127.0.0.1'] }),
  env: {},
  warn: () => {},
});
const c = net.connect(proxy.port, '127.0.0.1', () => c.write('CONNECT public.test:' + port + ' HTTP/1.1\\r\\nHost: public.test:' + port + '\\r\\n\\r\\n'));
c.once('data', (d) => { console.log(String(d).split('\\r\\n')[0]); c.end(); });
`;

const LIMIT_MS = 20000;
const started = Date.now();
const proc = spawn(process.execPath, ['--input-type=module', '-e', child], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
proc.stdout.on('data', (d) => { out += d; });
proc.stderr.on('data', (d) => { out += d; });
const killer = setTimeout(() => proc.kill('SIGKILL'), LIMIT_MS);
const code = await new Promise((resolve) => proc.on('exit', (c, sig) => resolve(sig ? sig : c)));
clearTimeout(killer);
const elapsed = Date.now() - started;

if (!out.includes('200 Connection Established')) {
  fail(`the tunnel opened before the client hung up — child said: ${out.trim() || '(nothing)'}`);
} else if (code === 'SIGKILL') {
  fail(`the process exits after the browser hangs up on a tunnel whose origin never closes — still running after ${LIMIT_MS} ms`);
} else if (code !== 0) {
  fail(`the process exits after the browser hangs up on a tunnel whose origin never closes — exit ${code}: ${out.trim()}`);
} else {
  pass(`the process exits after the browser hangs up on a tunnel whose origin never closes (${elapsed} ms)`);
}
