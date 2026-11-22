// tests/egress-proxy.test.mjs — the egress filter every Chromium launch for
// third-party pages goes through (lib/egress-proxy.mjs, lib/hardened-chromium.mjs).
//
// The route() guards never see a redirect hop: Playwright calls the handler
// "only for the first url if the response is a redirect". A public page that
// answered 302 to a private address was loaded through every one of them. The
// load-bearing check here is the last one: on Chromium itself, a public page
// that redirects into private space never reaches the private server, whether
// the hop names a literal address or a name that resolves to one.
//
// No test touches the network: names are answered by an injected resolver,
// and "public" sites are loopback servers a test seam vouches for.
import { pass, fail, toolUnavailable } from './helpers.mjs';
import http from 'node:http';
import net from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import {
  vetDestination,
  upstreamProxyFor,
  isPrivateUseName,
  startEgressProxy,
  egressLaunchOptions,
} from '../lib/egress-proxy.mjs';

console.log('\nlib/egress-proxy.mjs — the browser egress filter');

const check = (ok, label, detail = '') => (ok ? pass(label) : fail(`${label}${detail ? ` — ${detail}` : ''}`));

// A resolver that answers from a table and records what it was asked.
function tableResolver(table) {
  const asked = [];
  const resolve = async (host) => {
    asked.push(host);
    if (!(host in table)) {
      const err = new Error(`no answer for ${host}`);
      err.code = 'ENOTFOUND';
      throw err;
    }
    return table[host];
  };
  return { resolve, asked };
}

// ── verdicts ────────────────────────────────────────────────────────────────
{
  const { resolve, asked } = tableResolver({
    'jobs.example': ['93.184.215.14'],
    'rebind.example': ['10.0.0.7'],
    'mixed.example': ['93.184.215.14', '169.254.169.254'],
    'sink.example': ['0.0.0.0', '::'],
  });
  const refusedLiterals = ['127.0.0.1', '[::1]', '::ffff:7f00:1', '0.0.0.0', '169.254.169.254',
    '100.100.100.200', 'fd00::1', '224.0.0.1', '198.18.0.1'];
  for (const host of refusedLiterals) {
    const v = await vetDestination(host, { resolve });
    check(!v.ok, `literal ${host} is refused`, JSON.stringify(v));
  }
  const pub = await vetDestination('93.184.215.14', { resolve });
  check(pub.ok && pub.addresses[0] === '93.184.215.14', 'a public literal is allowed as itself');

  asked.length = 0;
  for (const host of ['localhost', 'LOCALHOST.', 'a.localhost', 'mybox.local', 'x.internal', 'nas.home.arpa']) {
    const v = await vetDestination(host, { resolve });
    check(!v.ok, `private-use name ${host} is refused`, JSON.stringify(v));
  }
  check(asked.length === 0, 'private-use names are refused before any lookup', `asked ${asked.join(', ')}`);
  check(isPrivateUseName('jobs.local') && !isPrivateUseName('localjobs.com'), 'isPrivateUseName matches the suffix, not a substring');

  const ok = await vetDestination('jobs.example', { resolve });
  check(ok.ok && ok.addresses.join() === '93.184.215.14', 'a name with only public answers is allowed with those addresses');
  const rebind = await vetDestination('rebind.example', { resolve });
  check(!rebind.ok && /10\.0\.0\.7/.test(rebind.reason), 'a name that resolves privately is refused');
  const mixed = await vetDestination('mixed.example', { resolve });
  check(!mixed.ok && !mixed.sinkhole, 'one private answer among public ones refuses the name (rebinding shape)');
  const sink = await vetDestination('sink.example', { resolve });
  check(!sink.ok && sink.sinkhole === true, "a DNS filter's 0.0.0.0/:: answer is refused and tagged as a sinkhole");
  const gone = await vetDestination('gone.example', { resolve });
  check(!gone.ok && gone.unresolved === true, 'a name that does not resolve is refused when the filter dials itself');
  const viaUpstream = await vetDestination('gone.example', { resolve, allowUnresolved: true });
  check(viaUpstream.ok && viaUpstream.addresses.length === 0, "a name that does not resolve is left to the user's proxy");
  const literalViaUpstream = await vetDestination('127.0.0.1', { resolve, allowUnresolved: true });
  check(!literalViaUpstream.ok, "a literal private address is refused even when the user's proxy would resolve");
}

// ── the user's own proxy ────────────────────────────────────────────────────
{
  const env = { https_proxy: 'http://proxy.corp:3128', HTTP_PROXY: 'http://proxy.corp:8080', NO_PROXY: '.internal.corp,example.org:8443' };
  check(upstreamProxyFor('https:', 'jobs.example', 443, env)?.port === '3128', 'https_proxy carries CONNECT tunnels');
  check(upstreamProxyFor('http:', 'jobs.example', 80, env)?.port === '8080', 'HTTP_PROXY carries plain requests');
  check(upstreamProxyFor('https:', 'a.internal.corp', 443, env) === null, 'NO_PROXY suffix goes direct');
  check(upstreamProxyFor('https:', 'example.org', 8443, env) === null && upstreamProxyFor('https:', 'example.org', 443, env) !== null,
    'NO_PROXY host:port matches that port only');
  check(upstreamProxyFor('https:', 'jobs.example', 443, { ALL_PROXY: 'socks5://127.0.0.1:1080' }) === null,
    'a socks proxy is not used to carry the tunnel');
  check(upstreamProxyFor('https:', 'jobs.example', 443, {}) === null, 'no proxy configured → direct');
  let threw = null;
  try { upstreamProxyFor('https:', 'jobs.example', 443, { HTTPS_PROXY: 'http://user:pw@proxy.corp:3128' }); } catch (err) { threw = err; }
  check(threw && /must use HTTPS/.test(threw.message), 'a proxy URL with credentials over plain http is refused');
  check(upstreamProxyFor('https:', 'jobs.example', 443, { HTTPS_PROXY: 'http://user:pw@127.0.0.1:3128' })?.port === '3128'
    && upstreamProxyFor('https:', 'jobs.example', 443, { HTTPS_PROXY: 'https://user:pw@proxy.corp:3129' })?.port === '3129',
  'credentials are fine over https, or to a loopback proxy');
}

// ── launch options ──────────────────────────────────────────────────────────
{
  const seam = { proxy: { server: 'http://127.0.0.1:9' } };
  const opts = await egressLaunchOptions({ headless: true }, seam);
  check(opts.headless === true && opts.proxy?.server === 'http://127.0.0.1:9' && opts.proxy?.bypass === '<-loopback>',
    'egressLaunchOptions adds the filter as proxy, with loopback forced through it');
  const own = await egressLaunchOptions({ proxy: { server: 'http://mine:1' } }, seam);
  check(own.proxy.server === 'http://mine:1', 'a caller that set its own proxy keeps it');
}

// ── wiring: every third-party launch site uses the hardened chromium ───────
{
  const sites = ['archive-posting.mjs', 'batch-evaluate-gemini.mjs', 'browser-extract.mjs', 'check-liveness.mjs',
    'openrouter-runner.mjs', 'scan-ats-full.mjs', 'scan-dayforce.mjs', 'scan-interamt.mjs', 'scan-topdev.mjs', 'scan.mjs',
    'upskill.mjs'];
  // `import('playwright').Page` in a JSDoc type is not a runtime import.
  const bare = /from\s+['"]playwright['"]|import\(\s*['"]playwright['"]\s*\)(?!\.)/;
  const hardened = /['"]\.\/lib\/hardened-chromium\.mjs['"]/;
  const offenders = sites.filter((f) => {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    return bare.test(src) || !hardened.test(src);
  });
  check(offenders.length === 0, 'every launch site for third-party pages imports chromium from lib/hardened-chromium.mjs',
    `still on bare playwright: ${offenders.join(', ')}`);

  // A launch site added later must join the list above (scan-topdev.mjs came
  // in on bare playwright after the list was written). A file that launches a
  // browser it imported from playwright itself is a launch site; one handed its
  // chromium (liveness-browser's headed provider) inherits its caller's. Only
  // these launch a browser that loads no third-party page: the PDF renderers
  // open local files, and doctor (with its remote-page browser check) only
  // checks that the browser starts.
  const localOnly = new Set(['doctor.mjs', 'generate-pdf.mjs', 'img-to-pdf.mjs', 'lib/remote-page-browser-check.mjs', 'test-all.mjs']);
  const launchCall = /\b(?:chromium|firefox|webkit)\.(?:launch|launchPersistentContext)\(/;
  const unlisted = [];
  for (const dir of ['', 'lib/', 'batch/']) {
    for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
      const f = `${dir}${name}`;
      if (!/\.(?:mjs|js)$/.test(name) || sites.includes(f) || localOnly.has(f)) continue;
      const code = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
        .split('\n').filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join('\n');
      if (launchCall.test(code) && bare.test(code)) unlisted.push(f);
    }
  }
  check(unlisted.length === 0, 'no browser launch on bare playwright outside the local-only renderers',
    `add to the list and import lib/hardened-chromium.mjs: ${unlisted.join(', ')}`);

  // The dashboard's apply session uses playwright-core from web/, so it puts the
  // same filter on its two launches (system Chrome, then the bundled fallback).
  const session = readFileSync(new URL('../web/src/lib/apply/session.ts', import.meta.url), 'utf8');
  const launches = session.match(/chromium\.launch\([^)]*\)/g) ?? [];
  check(launches.length === 2 && launches.every((l) => l.startsWith('chromium.launch(await withEgressFilter('))
    && /rootScriptFile\("lib\/egress-proxy"\)/.test(session),
  'the apply session launches both of its browsers through the egress filter', JSON.stringify(launches));
}

// ── the proxy itself, without a browser ─────────────────────────────────────
function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function connectThrough(proxyPort, target, { headers = '' } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(proxyPort, '127.0.0.1', () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${headers}\r\n`);
    });
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.removeAllListeners('data');
      resolve({ status: Number(buf.slice(9, 12)), socket, rest: buf.slice(end + 4) });
    });
    socket.on('error', () => resolve({ status: 0, socket, rest: '' }));
    socket.on('close', () => resolve({ status: 0, socket, rest: '' }));
  });
}

function echoOnce(socket, text) {
  return new Promise((resolve) => {
    let got = '';
    socket.on('data', (chunk) => {
      got += chunk.toString();
      if (got.includes('\n')) { socket.end(); resolve(got.trim()); }
    });
    socket.on('close', () => resolve(got.trim()));
    socket.write(`${text}\n`);
  });
}

function plainGet(proxyPort, url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { host: u.host }, agent: false });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (err) => resolve({ status: 0, error: err.code || err.message }));
    req.end();
  });
}

{
  const echo = net.createServer((s) => s.on('data', (d) => s.write(`echo:${d}`)));
  const echoPort = await listen(echo);
  let originHits = 0;
  const origin = http.createServer((req, res) => {
    originHits++;
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/internal' }); res.end(); return; }
    res.end(`origin saw host=${req.headers.host}`);
  });
  const originPort = await listen(origin);

  const { resolve } = tableResolver({ 'private.test': ['10.0.0.1'] });
  const warnings = [];
  // public.test stands in for a public site: the seam vouches for it and pins
  // it to the loopback test servers. Everything else gets the real verdict.
  const vet = async (host, allowUnresolved) => (host === 'public.test'
    ? { ok: true, host, addresses: ['127.0.0.1'] }
    : vetDestination(host, { resolve, allowUnresolved }));
  const proxy = await startEgressProxy({ vet, env: {}, warn: (m) => warnings.push(m) });
  try {
    const ok = await connectThrough(proxy.port, `public.test:${echoPort}`);
    const echoed = ok.status === 200 ? await echoOnce(ok.socket, 'ping') : '';
    check(ok.status === 200 && echoed === 'echo:ping', 'CONNECT to an allowed host opens a working tunnel', `status ${ok.status}, got ${echoed}`);

    const literal = await connectThrough(proxy.port, `127.0.0.1:${echoPort}`);
    check(literal.status === 403, 'CONNECT to a literal private address is refused with 403', `status ${literal.status}`);
    literal.socket.destroy();
    const named = await connectThrough(proxy.port, `private.test:${echoPort}`);
    check(named.status === 403, 'CONNECT to a name that resolves privately is refused with 403', `status ${named.status}`);
    named.socket.destroy();
    const v6 = await connectThrough(proxy.port, `[::1]:${echoPort}`);
    check(v6.status === 403, 'CONNECT to [::1] is refused', `status ${v6.status}`);
    v6.socket.destroy();

    const plain = await plainGet(proxy.port, `http://public.test:${originPort}/job`);
    check(plain.status === 200 && plain.body === `origin saw host=public.test:${originPort}`,
      'a plain http request to an allowed host is forwarded with its Host header', JSON.stringify(plain));
    const hop = await plainGet(proxy.port, `http://public.test:${originPort}/redirect`);
    check(hop.status === 302 && hop.headers.location === 'http://127.0.0.1:1/internal',
      'a redirect is handed back to the browser, not followed by the proxy', JSON.stringify(hop));
    const before = originHits;
    const refusedPlain = await plainGet(proxy.port, `http://127.0.0.1:${originPort}/job`);
    check(refusedPlain.status === 0 && originHits === before,
      'a plain http request to a private address gets no response and never reaches the server', JSON.stringify(refusedPlain));

    check(proxy.refusals.length >= 4 && proxy.refusals.some((r) => r.host === 'private.test'), 'refusals are recorded');
    const privateWarnings = warnings.filter((w) => w.includes('private.test'));
    const repeat = await connectThrough(proxy.port, `private.test:${echoPort}`);
    repeat.socket.destroy();
    check(privateWarnings.length === 1 && warnings.filter((w) => w.includes('private.test')).length === 1,
      'a refused host is reported once, not once per connection', JSON.stringify(warnings));
  } finally {
    await proxy.close();
  }

  // The user's own proxy: the tunnel goes through it, with its credentials,
  // and a literal private address is still refused before it is asked.
  const upstreamSeen = [];
  const upstream = http.createServer();
  upstream.on('connect', (req, clientSocket, head) => {
    upstreamSeen.push({ target: req.url, auth: req.headers['proxy-authorization'] });
    const [, port] = req.url.split(':');
    const out = net.connect(Number(port), '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) out.write(head);
      out.pipe(clientSocket);
      clientSocket.pipe(out);
    });
    out.on('error', () => clientSocket.destroy());
  });
  const upstreamPort = await listen(upstream);
  const chained = await startEgressProxy({
    resolve: tableResolver({}).resolve,
    env: { https_proxy: `http://user:pa%40ss@127.0.0.1:${upstreamPort}` },
    warn: () => {},
  });
  try {
    const t = await connectThrough(chained.port, `jobs.corp-only:${echoPort}`);
    const echoed = t.status === 200 ? await echoOnce(t.socket, 'via') : '';
    const seen = upstreamSeen[0];
    check(t.status === 200 && echoed === 'echo:via' && seen?.target === `jobs.corp-only:${echoPort}`
      && seen?.auth === `Basic ${Buffer.from('user:pa@ss').toString('base64')}`,
      "a name only the user's proxy can resolve is tunnelled through it, with its credentials", JSON.stringify({ status: t.status, echoed, seen }));
    const count = upstreamSeen.length;
    const lit = await connectThrough(chained.port, `169.254.169.254:${echoPort}`);
    lit.socket.destroy();
    check(lit.status === 403 && upstreamSeen.length === count,
      "a literal private address is refused before the user's proxy is asked");
  } finally {
    await chained.close();
    upstream.close();
  }

  // ── on Chromium itself ────────────────────────────────────────────────────
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    toolUnavailable('browser', 'egress filter checks on Chromium skipped: Playwright is not installed');
  }
  let browser;
  if (chromium) {
    let hitB = 0;
    const b = http.createServer((_, res) => { hitB++; res.end('<p>INTERNAL-B</p>'); });
    const bPort = await listen(b);
    const a = http.createServer((req, res) => {
      const location = req.url === '/via-name' ? `http://private.test:${bPort}/` : `http://127.0.0.1:${bPort}/`;
      res.writeHead(302, { location });
      res.end();
    });
    const aPort = await listen(a);
    const filter = await startEgressProxy({ vet, env: {}, warn: () => {} });
    try {
      try {
        browser = await chromium.launch(await egressLaunchOptions({ headless: true }, { proxy: filter }));
      } catch (e) {
        toolUnavailable('browser', `egress filter checks on Chromium skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
      }
      if (browser) {
        for (const [label, path] of [['a literal private address', '/'], ['a name that resolves privately', '/via-name']]) {
          hitB = 0;
          const context = await browser.newContext();
          const seen = [];
          // The route() guard of the scanners, kept as it is: it sees only the first hop.
          await context.route('**/*', (route) => { seen.push(route.request().url()); return route.continue(); });
          const page = await context.newPage();
          await page.goto(`http://public.test:${aPort}${path}`).catch(() => {});
          check(hitB === 0, `Chromium: a public page that redirects to ${label} never reaches it`, `private server hit ${hitB}x`);
          check(seen.length === 1, `Chromium: route() still saw only the first hop (${label}), which is why the filter is needed`,
            `route saw ${JSON.stringify(seen)}`);
          await context.close();
        }
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
      await filter.close();
      a.close();
      b.close();
    }
  }

  echo.close();
  origin.close();
}
