// providers/_connection-scope.mjs — give one unit of work (one board in a
// sweep) its own connection pool, and release every socket in it when the
// unit ends.
//
// Why: Node's fetch keeps one keep-alive socket open per origin it has talked
// to, and in practice those sockets stay ESTABLISHED for the rest of the
// process. Shortening keepAliveTimeout does not release them, and neither does
// a `connection: close` request header; only closing the pool does. That is
// harmless for a provider that serves a whole directory from one hostname
// (greenhouse, lever, ashby), and ruinous for one that gives every tenant its
// own hostname (workday, icims, bamboohr): a full sweep visits tens of
// thousands of distinct origins and so holds tens of thousands of idle sockets.
//
// Measured on macOS, Node 26, 2,000 BambooHR boards in one fresh process:
// established sockets grew in a straight line, ~1 per board, to 1,927 at the
// end. In the full nightly order (greenhouse, lever, ashby, workday, icims,
// bamboohr) the later stages then fail wholesale: on two consecutive nights
// Workday successes collapsed after its first 3,500-5,000 tenants, iCIMS lost
// 60-86% of its boards and BambooHR 99.9%, while the same BambooHR boards
// answered normally when fetched on their own.
//
// The scope uses undici's OWN fetch together with its Agent. Mixing the npm
// package's Agent with Node's built-in fetch is not safe across versions: an
// undici 6 Agent handed to Node 26's fetch fails every request with
// "invalid onError method", because the dispatcher handler interface changed.
// A matched pair works on every Node version this project supports.
//
// undici is optional at runtime, exactly as for trusted proxy egress in
// _http.mjs: if it cannot be imported, withConnectionScope() just runs the
// work with the default pool. CAREER_OPS_CONNECTION_SCOPE=0 opts out.

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** @type {null | false | { Agent: any, fetch: typeof fetch }} */
let undiciModule = null; // null = not tried yet, false = unavailable

async function loadUndici() {
  if (undiciModule === null) {
    try {
      const mod = await import('undici');
      undiciModule = (typeof mod.Agent === 'function' && typeof mod.fetch === 'function')
        ? { Agent: mod.Agent, fetch: mod.fetch }
        : false;
    } catch {
      undiciModule = false;
    }
  }
  return undiciModule;
}

/**
 * The pool and fetch for the unit of work currently running, if any.
 * @returns {{ agent: any, fetch: typeof fetch } | undefined}
 */
export function currentConnectionScope() {
  return storage.getStore();
}

/**
 * Run `fn` with a private connection pool, then destroy the pool.
 *
 * `destroy` (not `close`) is deliberate: when a caller's watchdog has already
 * given up on `fn`, its requests may still be in flight, and close() would
 * wait for them. Destroying aborts them and frees their sockets now.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ agentOptions?: object }} [options]
 * @returns {Promise<T>}
 */
export async function withConnectionScope(fn, { agentOptions } = {}) {
  if (process.env.CAREER_OPS_CONNECTION_SCOPE === '0') return fn();
  const undici = await loadUndici();
  if (!undici) return fn();
  const agent = new undici.Agent(agentOptions);
  try {
    return await storage.run({ agent, fetch: undici.fetch }, fn);
  } finally {
    await agent.destroy().catch(() => {});
  }
}

/** Test hook: forget the cached import result. */
export function _resetConnectionScopeForTests() {
  undiciModule = null;
}
