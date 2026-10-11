// tests/connection-scope.test.mjs — per-board connection pools for the full
// sweep (providers/_connection-scope.mjs). Without them a sweep keeps one idle
// socket per per-tenant hostname for the rest of the run; these tests pin the
// behaviour that prevents that: each unit gets its own pool, and every socket
// in it is closed when the unit ends, whether it resolved or threw.
import http from 'node:http';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nconnection scope — per-board connection pools');

const mod = await import(pathToFileURL(join(ROOT, 'providers/_connection-scope.mjs')).href);
const { withConnectionScope, currentConnectionScope, _resetConnectionScopeForTests } = mod;

// An inherited CAREER_OPS_CONNECTION_SCOPE=0 would turn scoping off for every
// test below; run them with it on and put the caller's setting back at the end.
const originalScopeSetting = process.env.CAREER_OPS_CONNECTION_SCOPE;
delete process.env.CAREER_OPS_CONNECTION_SCOPE;

// A scope exists inside the unit and nowhere else.
{
  const outside = currentConnectionScope();
  let inside;
  await withConnectionScope(async () => { inside = currentConnectionScope(); });
  if (outside === undefined && inside?.agent && typeof inside.fetch === 'function') {
    pass('scope is visible inside withConnectionScope and absent outside it');
  } else {
    fail(`scope visibility: outside=${outside} inside=${JSON.stringify(Object.keys(inside || {}))}`);
  }
}

// Concurrent units never share a pool, and each pool survives an await.
{
  const seen = [];
  await Promise.all([1, 2].map(() => withConnectionScope(async () => {
    const before = currentConnectionScope().agent;
    await new Promise((r) => setTimeout(r, 10));
    seen.push([before, currentConnectionScope().agent]);
  })));
  const [[a1, a2], [b1, b2]] = seen;
  if (a1 === a2 && b1 === b2 && a1 !== b1) pass('concurrent units get separate pools that persist across awaits');
  else fail('concurrent units shared a pool or lost it across an await');
}

// The pool is destroyed when the unit resolves, and when it throws.
{
  let okAgent;
  let errAgent;
  await withConnectionScope(async () => { okAgent = currentConnectionScope().agent; });
  await withConnectionScope(async () => { errAgent = currentConnectionScope().agent; throw new Error('boom'); })
    .catch(() => {});
  if (okAgent?.destroyed === true && errAgent?.destroyed === true) pass('pool destroyed after both resolve and reject');
  else fail(`pool not destroyed: resolved=${okAgent?.destroyed} rejected=${errAgent?.destroyed}`);
}

// The unit's own result and error pass through unchanged.
{
  const value = await withConnectionScope(async () => 42);
  const error = await withConnectionScope(async () => { throw new Error('kept'); }).catch((e) => e);
  if (value === 42 && error?.message === 'kept') pass('result and error pass through');
  else fail(`passthrough: value=${value} error=${error?.message}`);
}

// Opt-out: CAREER_OPS_CONNECTION_SCOPE=0 runs the unit with the default pool.
{
  process.env.CAREER_OPS_CONNECTION_SCOPE = '0';
  let inside;
  await withConnectionScope(async () => { inside = currentConnectionScope(); });
  delete process.env.CAREER_OPS_CONNECTION_SCOPE;
  if (inside === undefined) pass('CAREER_OPS_CONNECTION_SCOPE=0 disables scoping');
  else fail('opt-out still created a scope');
}

// End to end: sockets a unit opens are closed when it ends. Five units, each
// talking to its own origin (a separate port, as a tenant would be its own
// hostname), against a server that counts open connections.
{
  _resetConnectionScopeForTests();
  const servers = [];
  let open = 0;
  let peak = 0;
  for (let i = 0; i < 5; i++) {
    const server = http.createServer((req, res) => res.end('ok'));
    server.keepAliveTimeout = 60_000; // the server would happily keep them
    server.on('connection', (socket) => {
      open++; peak = Math.max(peak, open);
      socket.on('close', () => { open--; });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
  }
  try {
    for (const server of servers) {
      await withConnectionScope(async () => {
        const { fetch: scopedFetch, agent } = currentConnectionScope();
        const res = await scopedFetch(`http://127.0.0.1:${server.address().port}/`, { dispatcher: agent });
        await res.text();
      });
    }
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    await Promise.all(servers.map((server) => new Promise((r) => server.close(r))));
  }
  if (open === 0 && peak >= 1) pass(`every socket closed when its unit ended (peak ${peak}, open after ${open})`);
  else fail(`sockets still open after their units ended: ${open} (peak ${peak})`);
}

// Only per-tenant-host sources are scoped; single-host directories share one pool.
{
  const { SOURCES } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
  const single = ['greenhouse', 'lever', 'ashby'].every((s) => SOURCES[s].singleHost === true);
  const multi = ['workday', 'icims', 'bamboohr'].every((s) => !SOURCES[s].singleHost);
  if (single && multi) pass('single-host sources unscoped; workday, icims and bamboohr scoped');
  else fail(`singleHost flags: ${JSON.stringify(Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.singleHost])))}`);
}

if (originalScopeSetting === undefined) delete process.env.CAREER_OPS_CONNECTION_SCOPE;
else process.env.CAREER_OPS_CONNECTION_SCOPE = originalScopeSetting;
