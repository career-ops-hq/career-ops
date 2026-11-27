import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Agent, fetch as undiciFetch } from 'undici';
import { EventEmitter } from 'node:events';
import { withConnectionScope, withAbortScope, currentConnectionScope } from '../../providers/_connection-scope.mjs';
import { fetchJson, makeHttpCtx } from '../../providers/_http.mjs';
import { ROOT } from '../helpers.mjs';
import { describeSpawn } from '../helpers/describe-spawn.mjs';

function derLen(n) {
  if (n < 128) return Buffer.from([n]);
  const bytes = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), derLen(buf.length), buf]);
}

const seq = (...items) => derTag(0x30, items);
const set = (...items) => derTag(0x31, items);
const oid = (bytes) => derTag(0x06, Buffer.from(bytes));
const utf8 = (s) => derTag(0x0c, Buffer.from(s, 'utf8'));
const utc = (s) => derTag(0x17, Buffer.from(s, 'ascii'));
const derInt = (buf) => derTag(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const bitStr = (buf) => derTag(0x03, Buffer.concat([Buffer.from([0]), buf]));

function createTestCert(cn = 'localhost') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const algId = seq(oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]));
  const name = seq(set(seq(oid([0x55, 0x04, 0x03]), utf8(cn))));
  const validity = seq(utc('250101000000Z'), utc('350101000000Z'));
  const sanVal = seq(
    derTag(0x82, Buffer.from('localhost', 'ascii')),
    derTag(0x87, Buffer.from([127, 0, 0, 1])),
  );
  const exts = derTag(0xa3, [seq(seq(oid([0x55, 0x1d, 0x11]), derTag(0x04, [sanVal])))]);
  const tbs = seq(
    derTag(0xa0, [derInt(Buffer.from([2]))]),
    derInt(Buffer.from([1])),
    algId,
    name,
    validity,
    name,
    spki,
    exts,
  );
  const sig = crypto.sign('sha256', tbs, privateKey);
  const certDer = seq(tbs, algId, bitStr(sig));
  const b64 = certDer.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function createAlpnGateServer({ cert, key }) {
  const seen = [];
  const server = https.createServer({
    key,
    cert,
    ALPNCallback({ protocols, servername }) {
      seen.push({ protocols, servername });
      return protocols[0];
    },
  }, (req, res) => {
    const sockAlpn = req.socket.alpnProtocol;
    if (sockAlpn) {
      res.writeHead(429, { 'content-type': 'text/html', 'cf-mitigated': 'challenge' });
      res.end('<html>Security Check</html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ total: 1, alpn: sockAlpn ?? null }));
  });
  return { server, seen };
}

test('stock undici.Agent sends ALPN http/1.1 while withConnectionScope omits ALPN', async () => {
  const { cert, key } = createTestCert();
  const { server, seen } = createAlpnGateServer({ cert, key });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // Control: stock undici.Agent advertises ALPN ['http/1.1'] and gets 429.
    const stockAgent = new Agent({ connect: { ca: cert } });
    try {
      const blocked = await undiciFetch(`https://127.0.0.1:${port}/wday/cxs/acme/site/jobs`, {
        method: 'POST',
        body: '{}',
        dispatcher: stockAgent,
      });
      assert.equal(blocked.status, 429);
      assert.equal(seen.length, 1);
      assert.deepEqual(seen[0].protocols, ['http/1.1']);
    } finally {
      await stockAgent.destroy();
    }

    // Scoped agent must NOT trigger ALPNCallback at all, and honors top-level
    // agentOptions.tls / connectTimeout forwarding.
    seen.length = 0;
    await withConnectionScope(async () => {
      const { agent, fetch: scopedFetch } = currentConnectionScope();
      const ok = await scopedFetch(`https://localhost:${port}/wday/cxs/acme/site/jobs`, {
        method: 'POST',
        body: '{}',
        dispatcher: agent,
      });
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.total, 1);
      assert.equal(body.alpn, false);
    }, { agentOptions: { tls: { ca: cert }, connectTimeout: 5_000 } });
    assert.equal(seen.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('withConnectionScope forwards top-level connectTimeout and fetchJson keeps IP guard inside scope', async () => {
  const prevTrustProxy = process.env.CAREER_OPS_TRUST_PROXY_EGRESS;
  process.env.CAREER_OPS_TRUST_PROXY_EGRESS = '0';
  const blackholeSockets = new Set();
  const blackhole = net.createServer((sock) => {
    blackholeSockets.add(sock);
    sock.on('close', () => blackholeSockets.delete(sock));
    sock.pause();
  });
  await new Promise((r) => blackhole.listen(0, '127.0.0.1', r));
  try {
    await withConnectionScope(async () => {
      const { agent, fetch: scopedFetch } = currentConnectionScope();
      await assert.rejects(
        scopedFetch(`https://127.0.0.1:${blackhole.address().port}/`, { dispatcher: agent }),
        (err) => (err?.cause?.code ?? err?.code) === 'UND_ERR_CONNECT_TIMEOUT',
      );
      // SSRF guard in _http.mjs still blocks private addresses inside withConnectionScope.
      await assert.rejects(
        fetchJson(`https://localhost:${blackhole.address().port}/`),
        (err) => (err?.cause?.code ?? err?.code) === 'ECAREEROPS_BLOCKED_ADDRESS',
      );
    }, { agentOptions: { connectTimeout: 80 } });
  } finally {
    if (prevTrustProxy === undefined) delete process.env.CAREER_OPS_TRUST_PROXY_EGRESS;
    else process.env.CAREER_OPS_TRUST_PROXY_EGRESS = prevTrustProxy;
    for (const sock of blackholeSockets) sock.destroy();
    await new Promise((r) => blackhole.close(r));
  }
});

test('createDirectConnect strips ALPNProtocols, omits IP SNI, handles http and timeouts', async () => {
  const { createDirectConnect } = await import('../../providers/_tls-connect.mjs');
  const { cert, key } = createTestCert();
  const { server, seen } = createAlpnGateServer({ cert, key });
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"plain":true}');
  });

  await Promise.all([
    new Promise((r) => server.listen(0, '127.0.0.1', r)),
    new Promise((r) => httpServer.listen(0, '127.0.0.1', r)),
  ]);

  // Passing ALPNProtocols / alpnProtocols in options must still never transmit ALPN.
  const connect = createDirectConnect({ ca: cert, ALPNProtocols: ['http/1.1'], alpnProtocols: ['http/1.1'] });
  const agent = new Agent({ connect });

  try {
    // IP literal must omit SNI (no ERR_TLS_CERT_ALTNAME_INVALID or invalid SNI) and no ALPN.
    const httpsRes = await undiciFetch(`https://127.0.0.1:${server.address().port}/`, { dispatcher: agent });
    assert.equal(httpsRes.status, 200);
    assert.equal(seen.length, 0);

    // Bracketed IPv6 explicit servername must also omit SNI, and multiple errors
    // must settle callback once without crashing.
    let cbCount = 0;
    const fakeUpgradeErrSock = new EventEmitter();
    await new Promise((resolve) => {
      connect({ hostname: '::1', host: '[::1]', servername: '[::1]', protocol: 'http:', httpSocket: fakeUpgradeErrSock }, (err) => {
        cbCount++;
        assert.match(err?.message ?? '', /TLS upgrade/);
        resolve();
      });
    });
    assert.equal(cbCount, 1);

    // Plain http:// still works via net.connect.
    const httpRes = await undiciFetch(`http://127.0.0.1:${httpServer.address().port}/`, { dispatcher: agent });
    assert.equal(httpRes.status, 200);
    assert.deepEqual(await httpRes.json(), { plain: true });

    // Unbracketed IPv6 literals (e.g. '::1') must NOT be stripped to ':' as TLS servername.
    const { default: tlsMod } = await import('node:tls');
    const origTlsConnect = tlsMod.connect;
    let capturedTlsOpts = null;
    tlsMod.connect = (opts) => {
      capturedTlsOpts = opts;
      const sock = new EventEmitter();
      sock.setKeepAlive = () => sock;
      sock.setNoDelay = () => sock;
      sock.destroy = () => sock;
      queueMicrotask(() => sock.emit('error', new Error('stop')));
      return sock;
    };
    try {
      await new Promise((resolve) => {
        connect({ hostname: '::1', host: '::1', servername: '::1', protocol: 'https:', port: 443 }, () => resolve());
      });
      assert.equal('servername' in (capturedTlsOpts ?? {}), false, 'unbracketed ::1 must omit TLS servername');
    } finally {
      tlsMod.connect = origTlsConnect;
    }

    // agentOptions.connect.socketPath must map to Node's IPC `path` option (not TCP).
    const sockDir = mkdtempSync(join(tmpdir(), 'co-alpn-sock-'));
    const sockPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\co-alpn-sock-${process.pid}-${Date.now()}`
      : join(sockDir, 'provider.sock');
    const ipcServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ipc":true}');
    });
    await new Promise((r) => ipcServer.listen(sockPath, r));
    try {
      await withConnectionScope(async () => {
        const { agent: ipcAgent, fetch: scopedFetch } = currentConnectionScope();
        const ipcRes = await scopedFetch('http://localhost/', { dispatcher: ipcAgent });
        assert.equal(ipcRes.status, 200);
        assert.deepEqual(await ipcRes.json(), { ipc: true });
      }, { agentOptions: { connect: { socketPath: sockPath } } });
    } finally {
      await new Promise((r) => ipcServer.close(r));
      rmSync(sockDir, { recursive: true, force: true });
    }
  } finally {
    await agent.destroy();
    await Promise.all([
      new Promise((r) => server.close(r)),
      new Promise((r) => httpServer.close(r)),
    ]);
  }

  // Connect timeout destroys a stalled handshake and rejects once.
  const blackholeSockets = new Set();
  const blackhole = net.createServer((sock) => {
    blackholeSockets.add(sock);
    sock.on('close', () => blackholeSockets.delete(sock));
    sock.pause();
  });
  await new Promise((r) => blackhole.listen(0, '127.0.0.1', r));
  const fastTimeoutAgent = new Agent({ connect: createDirectConnect({ timeout: 80 }) });
  try {
    await assert.rejects(
      undiciFetch(`https://127.0.0.1:${blackhole.address().port}/`, { dispatcher: fastTimeoutAgent }),
      (err) => (err?.cause?.code ?? err?.code) === 'UND_ERR_CONNECT_TIMEOUT',
    );
  } finally {
    await fastTimeoutAgent.destroy();
    for (const sock of blackholeSockets) sock.destroy();
    await new Promise((r) => blackhole.close(r));
  }
});

test('unscoped native fetchJson uses no-ALPN tls.connect while preserving globalThis.fetch stubs', async () => {
  // 1. In-process stub after _http.mjs import must still be honored even if
  // the host environment has trusted proxy egress variables configured.
  const realFetch = globalThis.fetch;
  const prevTrustProxy = process.env.CAREER_OPS_TRUST_PROXY_EGRESS;
  process.env.CAREER_OPS_TRUST_PROXY_EGRESS = '0';
  globalThis.fetch = async () => new Response('{"stubbed":"after"}', { status: 200 });
  try {
    assert.deepEqual(await fetchJson('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/site/jobs'), { stubbed: 'after' });
  } finally {
    globalThis.fetch = realFetch;
    if (prevTrustProxy === undefined) delete process.env.CAREER_OPS_TRUST_PROXY_EGRESS;
    else process.env.CAREER_OPS_TRUST_PROXY_EGRESS = prevTrustProxy;
  }

  // 2. Preload --import stub before _http.mjs import must still be honored.
  const dir = mkdtempSync(join(tmpdir(), 'co-alpn-preload-'));
  try {
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, 'globalThis.fetch = async () => new Response(\'{"stubbed":"preload"}\', { status: 200 });\n');
    const httpUrl = pathToFileURL(join(ROOT, 'providers/_http.mjs')).href;
    const preResult = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(preload).href, '--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        const { fetchJson } = await import(${JSON.stringify(httpUrl)});
        assert.deepEqual(await fetchJson('https://acme.wd3.myworkdayjobs.com/jobs'), { stubbed: 'preload' });
      `],
      {
        encoding: 'utf8',
        timeout: 15_000,
        env: { ...process.env, CAREER_OPS_TRUST_PROXY_EGRESS: '0' },
      },
    );
    assert.equal(preResult.status, 0, describeSpawn(preResult));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 3. Unstubbed native fetchJson (direct, inside withAbortScope, and under
  // CAREER_OPS_CONNECTION_SCOPE=0 with signal) routes through tls.connect WITHOUT ALPNProtocols.
  const httpUrl = pathToFileURL(join(ROOT, 'providers/_http.mjs')).href;
  const scopeUrl = pathToFileURL(join(ROOT, 'providers/_connection-scope.mjs')).href;
  const nativeScript = `
    import assert from 'node:assert/strict';
    import dns from 'node:dns';
    import tls from 'node:tls';
    import { EventEmitter } from 'node:events';

    dns.lookup = (_host, optsOrCb, maybeCb) => {
      const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
      const opts = typeof optsOrCb === 'object' && optsOrCb ? optsOrCb : {};
      if (opts.all) cb(null, [{ address: '93.184.216.34', family: 4 }]);
      else cb(null, '93.184.216.34', 4);
    };

    const recorded = [];
    tls.connect = (opts) => {
      recorded.push(opts);
      const sock = new EventEmitter();
      sock.setKeepAlive = () => sock;
      sock.setNoDelay = () => sock;
      sock.destroy = () => sock;
      queueMicrotask(() => sock.emit('error', Object.assign(new Error('probe stop'), { code: 'ECONNREFUSED' })));
      return sock;
    };

    const { makeHttpCtx } = await import(${JSON.stringify(httpUrl)});
    const { withAbortScope, withConnectionScope } = await import(${JSON.stringify(scopeUrl)});

    await assert.rejects(
      makeHttpCtx().fetchJson('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/site/jobs', { method: 'POST', body: '{}' }),
      /fetch failed|probe stop/i,
    );
    await assert.rejects(
      withAbortScope(new AbortController().signal, () =>
        makeHttpCtx().fetchJson('https://abort.wd3.myworkdayjobs.com/wday/cxs/acme/site/jobs', { method: 'POST', body: '{}' })),
      /fetch failed|probe stop/i,
    );
    process.env.CAREER_OPS_CONNECTION_SCOPE = '0';
    await assert.rejects(
      withConnectionScope(
        () => makeHttpCtx().fetchJson('https://noscope.wd3.myworkdayjobs.com/wday/cxs/acme/site/jobs', { method: 'POST', body: '{}' }),
        { signal: new AbortController().signal },
      ),
      /fetch failed|probe stop/i,
    );

    assert.equal(recorded.length, 3, 'expected all 3 native paths to connect via tls.connect');
    for (const call of recorded) {
      assert.equal('ALPNProtocols' in call, false, 'ALPNProtocols must be omitted on TLS connect');
    }
    assert.deepEqual(
      recorded.map((c) => c.servername),
      ['acme.wd3.myworkdayjobs.com', 'abort.wd3.myworkdayjobs.com', 'noscope.wd3.myworkdayjobs.com'],
    );
  `;
  const nativeResult = spawnSync(process.execPath, ['--input-type=module', '-e', nativeScript], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, CAREER_OPS_TRUST_PROXY_EGRESS: '0' },
  });
  assert.equal(nativeResult.status, 0, describeSpawn(nativeResult));
});
