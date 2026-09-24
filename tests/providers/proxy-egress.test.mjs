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

test('opted-in provider request uses a scoped proxy without local target DNS', async () => {
  const destinations = [];
  const proxy = http.createServer();
  proxy.on('connect', (req, socket) => {
    destinations.push(req.url);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nPROXIED!'));
  });
  const proxyUrl = await listening(proxy);
  try {
    await withProxyEnv({ CAREER_OPS_TRUST_PROXY_EGRESS: '1', HTTP_PROXY: proxyUrl.replace('127.0.0.1', 'localhost'), NO_PROXY: 'localhost,127.0.0.1' }, async () => {
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
