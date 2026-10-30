// A Config write must reach panels mounted in the SAME tab. The browser's
// "storage" event only fires in other tabs, so the assistant kept showing
// "no CLI configured" after Config auto-picked a CLI, until a reload.
//
// Run:  node --experimental-strip-types --test tests/lib/saved-cli-notify.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

const { persistCliId, notifyConfigChange, CONFIG_CHANGE_EVENT, CONFIG_KEY } = await import("../../src/lib/saved-cli.ts");

function stubWindow() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const target = new EventTarget();
  globalThis.window = target;
  return { store, target };
}

test("persistCliId announces the change to this tab, after the current render", async () => {
  const { store, target } = stubWindow();
  let seen = null;
  target.addEventListener(CONFIG_CHANGE_EVENT, () => {
    seen = JSON.parse(store.get(CONFIG_KEY)).cliId;
  });
  persistCliId("opencode");
  assert.equal(seen, null, "dispatching synchronously would setState mid-render");
  await Promise.resolve();
  assert.equal(seen, "opencode", "listeners must read the new value, not the old one");
});

test("notifyConfigChange is a no-op without a window", () => {
  delete globalThis.window;
  assert.doesNotThrow(() => notifyConfigChange());
});
