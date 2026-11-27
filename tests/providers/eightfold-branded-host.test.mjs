// tests/providers/eightfold-branded-host.test.mjs — the opt-in `eightfold_host`
// field: a tenant that serves /api/apply/v2/jobs from its own careers domain
// instead of <tenant>.eightfold.ai. Auto-discovered by test-all.mjs.
// Run alone with: node test-all.mjs --only eightfold
//
// Every host here is invented (careers.acme.com / acme.com). Nothing in
// this file touches the network: the guard case stubs the global fetch.

import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — eightfold (eightfold_host branded API host)');

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };

const BRANDED = 'careers.acme.com';
const ENTRY = {
  name: 'Acme',
  careers_url: `https://${BRANDED}/careers?domain=acme.com`,
  eightfold_host: BRANDED,
};

function mockCtx(pages) {
  const calls = [];
  return {
    calls,
    ctx: {
      transport: 'http',
      fetchText: async () => '',
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        const start = Number(new URL(url).searchParams.get('start') || '0');
        return pages[start] ?? { positions: [], count: 0 };
      },
    },
  };
}

/** fetch() must throw before any request; returns [message, requested]. */
async function refusedBeforeFetch(ef, entry) {
  let touched = false;
  try {
    await ef.fetch(entry, { transport: 'http', sleep: async () => {}, fetchText: async () => '', fetchJson: async () => { touched = true; return {}; } });
    return [null, touched];
  } catch (e) {
    return [e.message, touched];
  }
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/eightfold.mjs')).href);
  const ef = mod.default;
  const { resolveTenant, brandedHost } = mod;

  // ── allowed branded host ────────────────────────────────────────────
  const hit = ef.detect(ENTRY);
  if (hostOf(hit?.url) === BRANDED
      && new URL(hit.url).pathname === '/api/apply/v2/jobs'
      && new URL(hit.url).searchParams.get('domain') === 'acme.com') {
    pass('eightfold.detect() builds the API URL on the host named by eightfold_host');
  } else {
    fail(`detect(eightfold_host) returned ${JSON.stringify(hit)}`);
  }

  const rows = (n, offset) => Array.from({ length: n }, (_, i) => ({ id: offset + i, name: `Role ${offset + i}`, location: 'Remote' }));
  const { calls, ctx } = mockCtx({
    0: { count: 13, positions: rows(10, 0) },
    10: { count: 13, positions: rows(3, 10) },
  });
  const jobs = await ef.fetch(ENTRY, ctx);
  if (jobs.length === 13 && calls.length === 2
      && calls.every((c) => hostOf(c.url) === BRANDED && c.opts?.redirect === 'error')) {
    pass('eightfold.fetch() pages the branded host with redirect:"error" (2 pages → 13 jobs)');
  } else {
    fail(`branded fetch: ${jobs.length} jobs, hosts=${calls.map((c) => hostOf(c.url)).join(',')}, redirect=${calls.map((c) => c.opts?.redirect).join(',')}`);
  }
  // No canonicalPositionUrl in the fixture, so the fallback posting URL is
  // built on the same host the API answered from.
  if (hostOf(jobs[0]?.url) === BRANDED && new URL(jobs[0].url).searchParams.get('pid') === '0') {
    pass('eightfold fallback posting URL uses the branded host');
  } else {
    fail(`fallback url = ${jobs[0]?.url}`);
  }

  const mixedCase = resolveTenant({ ...ENTRY, eightfold_host: '  Careers.ACME.com ' });
  if (mixedCase?.host === BRANDED) pass('eightfold_host is matched case-insensitively and trimmed');
  else fail(`mixed-case eightfold_host resolved to ${JSON.stringify(mixedCase)}`);

  // api: still takes precedence, and may itself be the branded host.
  const viaApi = ef.detect({ name: 'Acme', api: `https://${BRANDED}/api/apply/v2/jobs`, careers_url: 'https://www.acme.com/careers', eightfold_host: BRANDED });
  if (hostOf(viaApi?.url) === BRANDED) pass('eightfold_host also applies to api:');
  else fail(`api: on the branded host returned ${JSON.stringify(viaApi)}`);

  // The field adds one host; it does not take the tenant pattern away.
  const tenantStill = ef.detect({ name: 'Acme', careers_url: 'https://acme.eightfold.ai/careers', eightfold_host: BRANDED });
  if (hostOf(tenantStill?.url) === 'acme.eightfold.ai') pass('a *.eightfold.ai URL still resolves when eightfold_host is set');
  else fail(`tenant URL with eightfold_host returned ${JSON.stringify(tenantStill)}`);

  // ── unlisted branded host: still rejected ───────────────────────────
  const unlisted = [
    // no eightfold_host at all — the pre-existing behaviour
    { name: 'B', careers_url: ENTRY.careers_url },
    // a different host was named
    { name: 'B', careers_url: ENTRY.careers_url, eightfold_host: 'careers.other.com' },
    // exact match only: a parent domain does not cover its subdomains
    { name: 'B', careers_url: ENTRY.careers_url, eightfold_host: 'acme.net' },
    // lookalike suffix and userinfo tricks
    { name: 'B', careers_url: `https://${BRANDED}.evil.example/careers`, eightfold_host: BRANDED },
    { name: 'B', careers_url: `https://${BRANDED}@evil.example/careers`, eightfold_host: BRANDED },
    { name: 'B', careers_url: `https://evil.example/${BRANDED}/careers`, eightfold_host: BRANDED },
  ];
  const leaks = unlisted.filter((e) => ef.detect(e) !== null || resolveTenant(e) !== null);
  if (leaks.length === 0) pass(`eightfold rejects all ${unlisted.length} branded hosts the entry did not name exactly`);
  else fail(`eightfold accepted: ${leaks.map((e) => `${e.careers_url} [${e.eightfold_host}]`).join(' | ')}`);

  {
    const [msg, touched] = await refusedBeforeFetch(ef, unlisted[1]);
    msg && /cannot derive API URL/.test(msg) && /careers_url or api must be an https:\/\/ URL on that host/.test(msg) && !touched
      ? pass('eightfold.fetch() refuses an unlisted branded host before any request, naming the mismatch')
      : fail(`unlisted host: message=${msg} fetchJson called=${touched}`);
  }

  // ── malformed eightfold_host: never widens the allowlist ────────────
  const malformed = [
    '*.acme.net', '*', `https://${BRANDED}`, `${BRANDED}:8443`, `${BRANDED}/careers`,
    `${BRANDED}.`, 'localhost', 'user@acme.net', 'acme net', '', '   ', 42, null, [BRANDED], { host: BRANDED },
  ];
  const widened = malformed.filter((v) => brandedHost({ eightfold_host: v }) !== null);
  if (widened.length === 0) pass(`brandedHost() rejects all ${malformed.length} malformed eightfold_host values (wildcard, scheme, port, path, …)`);
  else fail(`brandedHost() accepted: ${JSON.stringify(widened)}`);

  // ── private-IP branded host ─────────────────────────────────────────
  // A literal address can never be named: the field takes a DNS name only.
  const literals = ['169.254.169.254', '10.0.0.1', '127.0.0.1', '192.168.1.10', '[::1]', '::1', '[fd00::1]'];
  const literalLeaks = literals.filter((ip) => {
    const e = { name: 'B', careers_url: `https://${ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip}/careers`, eightfold_host: ip };
    return brandedHost(e) !== null || ef.detect(e) !== null;
  });
  if (literalLeaks.length === 0) pass(`eightfold_host refuses all ${literals.length} IP literals (metadata, RFC1918, loopback)`);
  else fail(`IP literal accepted as eightfold_host: ${literalLeaks.join(', ')}`);

  {
    const [msg, touched] = await refusedBeforeFetch(ef, { name: 'Meta', careers_url: 'https://169.254.169.254/careers', eightfold_host: '169.254.169.254' });
    msg && /must be one bare hostname/.test(msg) && !touched
      ? pass('eightfold.fetch() refuses a metadata-address eightfold_host before any request')
      : fail(`metadata eightfold_host: message=${msg} fetchJson called=${touched}`);
  }

  // A NAME that resolves privately is the shared guard's job: the request has
  // to run inside providerFetchContext with the branded host as its target, so
  // the patched dns.lookup validates the address it resolves to (#3096). Only
  // the network layer is stubbed; the real ctx from _http.mjs is used.
  {
    const { makeHttpCtx } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);
    const { providerFetchContext } = await import(pathToFileURL(join(ROOT, 'providers/_ip-guard.mjs')).href);
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push({ host: hostOf(String(url)), guarded: providerFetchContext.getStore()?.targetHost ?? null });
      return new Response(JSON.stringify({ count: 0, positions: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      await ef.fetch(ENTRY, makeHttpCtx());
    } finally {
      globalThis.fetch = realFetch;
    }
    seen.length === 1 && seen[0].host === BRANDED && seen[0].guarded === BRANDED
      ? pass('the branded-host request runs inside providerFetchContext (resolved address is validated)')
      : fail(`branded request guard context: ${JSON.stringify(seen)}`);
  }

  // ── http rejected ───────────────────────────────────────────────────
  const plain = { name: 'B', careers_url: `http://${BRANDED}/careers?domain=acme.com`, eightfold_host: BRANDED };
  if (ef.detect(plain) === null && resolveTenant(plain) === null) pass('eightfold rejects an http:// URL on the branded host');
  else fail(`http branded URL accepted: ${JSON.stringify(ef.detect(plain))}`);
  {
    const [msg, touched] = await refusedBeforeFetch(ef, plain);
    msg && /cannot derive API URL/.test(msg) && !touched
      ? pass('eightfold.fetch() refuses an http:// branded URL before any request')
      : fail(`http branded fetch: message=${msg} fetchJson called=${touched}`);
  }
} catch (e) {
  fail(`eightfold branded-host tests crashed: ${e.message}`);
}
