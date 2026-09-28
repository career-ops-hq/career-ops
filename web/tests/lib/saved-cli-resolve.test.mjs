// Executes the REAL resolveCliId() from saved-cli.ts. The module is client-safe
// (localStorage + fetch, no node imports) and uses only strippable type syntax,
// so node --test imports the .ts directly, the way explore-ai-dedup.test.mjs does.
//
// Covers #4012: a saved cliId that is no longer installed was returned
// unchecked, so every run 404'd ("CLI '<id>' not found") with nothing on screen
// connecting the failure to a stale setting.
//
// Run:  node --experimental-strip-types --test tests/lib/saved-cli-resolve.test.mjs
//       (or `npm test`, which passes the flag; it is unflagged from Node 22.18)

import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveCliId } = await import("../../src/lib/saved-cli.ts");

const CONFIG_KEY = "career-ops:config";

// Install fake localStorage + fetch and return the backing store so a test can
// assert what got persisted.
function stubEnv({ saved, clis, fetchThrows, httpError, errorBody = { error: "boom" } } = {}) {
  const store = new Map();
  if (saved !== undefined) {
    store.set(CONFIG_KEY, JSON.stringify({ mode: "cli", cliId: saved }));
  }
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/clis");
    if (fetchThrows) throw new Error("network down");
    if (httpError) return { ok: false, status: 500, json: async () => errorBody };
    return { ok: true, status: 200, json: async () => ({ clis }) };
  };
  return store;
}

const savedCliId = (store) => JSON.parse(store.get(CONFIG_KEY) || "{}").cliId;

test("a saved id that is still installed is returned", async () => {
  const store = stubEnv({
    saved: "claude",
    clis: [
      { id: "claude", installed: true },
      { id: "opencode", installed: false },
    ],
  });
  assert.equal(await resolveCliId(), "claude");
  assert.equal(savedCliId(store), "claude");
});

test("a saved id that is no longer installed falls through to the sole installed CLI and persists it", async () => {
  const store = stubEnv({
    saved: "opencode",
    clis: [
      { id: "claude", installed: true },
      { id: "opencode", installed: false },
    ],
  });
  assert.equal(await resolveCliId(), "claude");
  assert.equal(savedCliId(store), "claude", "the stale pick should be replaced");
});

test("a saved id that is no longer installed, with no sole pick, resolves to null", async () => {
  stubEnv({
    saved: "opencode",
    clis: [
      { id: "claude", installed: true },
      { id: "codex", installed: true },
      { id: "opencode", installed: false },
    ],
  });
  // null is what routes the caller to the existing "open Config" message
  // instead of a 404 on every run.
  assert.equal(await resolveCliId(), null);
});

test("no saved id still picks the sole installed CLI", async () => {
  const store = stubEnv({
    clis: [
      { id: "claude", installed: false },
      { id: "opencode", installed: true },
    ],
  });
  assert.equal(await resolveCliId(), "opencode");
  assert.equal(savedCliId(store), "opencode");
});

test("an unreachable /api/clis trusts the saved id rather than stranding a working setup", async () => {
  stubEnv({ saved: "claude", fetchThrows: true });
  assert.equal(await resolveCliId(), "claude");
});

test("a non-2xx /api/clis response trusts the saved id, not a null 'no CLI' verdict", async () => {
  stubEnv({ saved: "claude", httpError: true });
  assert.equal(await resolveCliId(), "claude");
});

test("a malformed /api/clis entry (null in the array) trusts the saved id instead of throwing", async () => {
  stubEnv({ saved: "claude", clis: [{ id: "claude", installed: true }, null] });
  assert.equal(await resolveCliId(), "claude");
});

test("a malformed /api/clis entry (no id) is not picked as the sole install", async () => {
  const store = stubEnv({ clis: [{ installed: true }] });
  assert.equal(await resolveCliId(), null);
  assert.equal(savedCliId(store), undefined, "a malformed entry must not be persisted as the picked CLI");
});

test("a non-2xx /api/clis response is not parsed even when its body looks like a CLI list", async () => {
  // Without the r.ok guard this body resolves: 'claude' is absent, 'opencode'
  // is the sole install, so the saved choice would be overwritten from an
  // error response. The plain error body above can't catch that — it fails the
  // Array.isArray check with or without the guard.
  const store = stubEnv({
    saved: "claude",
    httpError: true,
    errorBody: { clis: [{ id: "opencode", installed: true }] },
  });
  assert.equal(await resolveCliId(), "claude");
  assert.equal(savedCliId(store), "claude", "an error response must not rewrite the saved id");
});

// --- onStale: a replaced saved id is reported, not dropped silently ---

test("onStale reports the stale id and the CLI that replaced it", async () => {
  stubEnv({
    saved: "opencode",
    clis: [
      { id: "claude", installed: true },
      { id: "opencode", installed: false },
    ],
  });
  const calls = [];
  assert.equal(await resolveCliId((...a) => calls.push(a)), "claude");
  assert.deepEqual(calls, [["opencode", "claude"]]);
});

test("onStale reports a stale id with no replacement as null", async () => {
  stubEnv({
    saved: "opencode",
    clis: [
      { id: "claude", installed: true },
      { id: "codex", installed: true },
    ],
  });
  const calls = [];
  assert.equal(await resolveCliId((...a) => calls.push(a)), null);
  assert.deepEqual(calls, [["opencode", null]]);
});

test("onStale stays quiet when nothing was replaced", async () => {
  const calls = [];
  const onStale = (...a) => calls.push(a);

  stubEnv({ saved: "claude", clis: [{ id: "claude", installed: true }] });
  await resolveCliId(onStale);
  stubEnv({ clis: [{ id: "claude", installed: true }] }); // nothing saved to go stale
  await resolveCliId(onStale);
  stubEnv({ saved: "claude", fetchThrows: true }); // couldn't check, kept
  await resolveCliId(onStale);

  assert.deepEqual(calls, []);
});

test("the /api/clis fetch is bounded, and a timeout falls back to the saved id", async () => {
  // Every job start awaits this fetch; unbounded, a stalled request would leave
  // the job at "Starting…". Waiting out the real timeout would add seconds to
  // the suite, so assert the signal is passed and reject the way it would.
  stubEnv({ saved: "claude" });
  let init;
  globalThis.fetch = async (_url, i) => {
    init = i;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  assert.equal(await resolveCliId(), "claude");
  assert.ok(init?.signal instanceof AbortSignal, "fetch('/api/clis') must carry an AbortSignal");
});
