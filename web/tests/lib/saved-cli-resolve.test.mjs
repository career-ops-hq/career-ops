// Executes the REAL resolveCliId() from saved-cli.ts. The module is client-safe
// (localStorage + fetch, no node imports) and uses only strippable type syntax,
// so node --test imports the .ts directly, the way explore-ai-dedup.test.mjs does.
//
// Covers #4012: a saved cliId that is no longer installed was returned
// unchecked, so every run 404'd ("CLI '<id>' not found") with nothing on screen
// connecting the failure to a stale setting.
//
// Run:  node --test tests/lib/saved-cli-resolve.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveCliId } = await import("../../src/lib/saved-cli.ts");

const CONFIG_KEY = "career-ops:config";

// Install fake localStorage + fetch and return the backing store so a test can
// assert what got persisted.
function stubEnv({ saved, clis, fetchThrows, httpError } = {}) {
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
    if (httpError) return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
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
