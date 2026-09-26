import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchText } from '../../providers/_http.mjs';

async function listening(server) {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function withProxyEnv(values, run) {
  const keys = ['CAREER_OPS_TRUST_PROXY_EGRESS', 'http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, values);
    return await run();
  } finally {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
}

for (const emptyLowercase of [false, true]) {
test(`opted-in provider request uses a scoped proxy (empty lowercase: ${emptyLowercase})`, {
  // Windows aliases HTTP_PROXY and http_proxy, so assigning the empty lowercase
  // value also clears the uppercase URL. This two-variable state only exists
  // on platforms with case-sensitive environment variable names.
  skip: emptyLowercase && process.platform === 'win32',
}, async () => {
  const destinations = [];
  const proxy = http.createServer();
  proxy.on('connect', (req, socket) => {
    destinations.push(req.url);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nPROXIED!'));
  });
  const proxyUrl = await listening(proxy);
  try {
    await withProxyEnv({ CAREER_OPS_TRUST_PROXY_EGRESS: '1', HTTP_PROXY: proxyUrl.replace('127.0.0.1', 'localhost'), NO_PROXY: 'localhost,127.0.0.1', ...(emptyLowercase ? { http_proxy: '', no_proxy: '' } : {}) }, async () => {
      assert.equal(await fetchText('http://unresolvable.invalid/job', { redirect: 'error' }), 'PROXIED!');
      assert.deepEqual(destinations, ['unresolvable.invalid:80']);
      // NO_PROXY goes direct and still meets the private-address guard.
      await assert.rejects(fetchText('http://localhost:8080/'), (err) =>
        (err.cause ?? err).code === 'ECAREEROPS_BLOCKED_ADDRESS');
      await assert.rejects(fetchText('http://127.0.0.1:8080/'), (err) =>
        (err.cause ?? err).code === 'ECAREEROPS_BLOCKED_ADDRESS');
      assert.equal(destinations.length, 1);
    });
  } finally { proxy.close(); }
});

}

test('unrelated fetch is never assigned the provider proxy', async () => {
  const server = http.createServer((_req, res) => res.end('LOCAL'));
  const url = await listening(server);
  try {
    await withProxyEnv({ CAREER_OPS_TRUST_PROXY_EGRESS: '1', HTTP_PROXY: url, NO_PROXY: '' }, async () => {
      assert.equal(await (await fetch(url)).text(), 'LOCAL');
    });
  } finally { server.close(); }
});

test('proxy environment alone does not silently bypass the address guard', async () => {
  await withProxyEnv({ HTTP_PROXY: 'http://127.0.0.1:3128' }, async () => {
    await assert.rejects(fetchText('http://localhost:8080/job', { timeoutMs: 2000 }),
      (err) => (err.cause ?? err).code === 'ECAREEROPS_BLOCKED_ADDRESS');
  });
});

test('private IPv6 literals are blocked before a trusted proxy can receive them', async () => {
  await withProxyEnv({ CAREER_OPS_TRUST_PROXY_EGRESS: '1', HTTP_PROXY: 'http://127.0.0.1:3128' }, async () => {
    await assert.rejects(fetchText('http://[::1]:8080/'),
      (err) => err.code === 'ECAREEROPS_BLOCKED_ADDRESS');
  });
});

test('HTTPS_PROXY receives HTTPS provider destinations without local DNS', async () => {
  const destinations = [];
  const proxy = http.createServer();
  proxy.on('connect', (req, socket) => {
    destinations.push(req.url);
    socket.destroy(); // reaching CONNECT is enough; there is no remote TLS server
  });
  const proxyUrl = await listening(proxy);
  try {
    await withProxyEnv({ CAREER_OPS_TRUST_PROXY_EGRESS: '1', HTTPS_PROXY: proxyUrl }, async () => {
      await assert.rejects(fetchText('https://unresolvable.invalid/job', { timeoutMs: 1000 }));
      assert.ok(destinations.includes('unresolvable.invalid:443'));
    });
  } finally { proxy.close(); }
});

test('direct requests work without undici; opting in explains how to install it', async () => {
  const { spawnSync } = await import('node:child_process');
  const loader = 'data:text/javascript,' + encodeURIComponent(
    'export async function resolve(s, c, next) { if (s === "undici") throw new Error("undici unavailable"); return next(s, c); }',
  );
  const moduleUrl = new URL('../../providers/_http.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    const { fetchText } = await import(${JSON.stringify(moduleUrl)});
    globalThis.fetch = async () => new Response('DIRECT');
    delete process.env.CAREER_OPS_TRUST_PROXY_EGRESS;
    process.env.HTTP_PROXY = 'http://localhost:3128';
    assert.equal(await fetchText('http://public.example/'), 'DIRECT');
    process.env.CAREER_OPS_TRUST_PROXY_EGRESS = '1';
    await assert.rejects(fetchText('http://public.example/'), /run npm install/);
  `;
  const result = spawnSync(process.execPath, ['--experimental-loader', loader, '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('credential-bearing HTTP proxies are rejected without exposing their credentials', async () => {
  for (const proxyVariable of ['HTTP_PROXY', 'HTTPS_PROXY']) {
    await withProxyEnv({ CAREER_OPS_TRUST_PROXY_EGRESS: '1', [proxyVariable]: 'http://user:secret@proxy.example:3128' }, async () => {
      await assert.rejects(fetchText('https://public.example/'), (error) => {
        assert.match(error.message, /credentials must use HTTPS/);
        assert.ok(!error.message.includes('secret'));
        assert.ok(!error.message.includes('user:'));
        return true;
      });
    });
  }
});

test('credential-bearing HTTPS proxies remain available to provider requests', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.ok(options.dispatcher);
      return new Response('TLS PROXY CONFIGURED');
    };
    await withProxyEnv({ CAREER_OPS_TRUST_PROXY_EGRESS: '1', HTTPS_PROXY: 'https://user:secret@proxy.example:3128' }, async () => {
      assert.equal(await fetchText('https://public.example/'), 'TLS PROXY CONFIGURED');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
