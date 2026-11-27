import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG_KEY, CONFIG_EVENT, writeConfig, subscribeConfig } from "../../src/lib/config-events.mjs";

function fixture() {
  const values = new Map();
  return { target: new EventTarget(), storage: { setItem: (key, value) => values.set(key, value) }, values };
}
function storageEvent(key) {
  return Object.assign(new Event("storage"), { key });
}

test("a same-tab write notifies after the saved config is available", () => {
  const { target, storage, values } = fixture();
  const observed = [];
  subscribeConfig(target, () => observed.push(JSON.parse(values.get(CONFIG_KEY))));
  writeConfig(storage, target, { cliId: "codex", logos: false });
  assert.deepEqual(observed, [{ cliId: "codex", logos: false }]);
});

test("cross-tab config storage events notify", () => {
  const { target } = fixture(); let calls = 0;
  subscribeConfig(target, () => calls++);
  target.dispatchEvent(storageEvent(CONFIG_KEY));
  assert.equal(calls, 1);
});

test("unrelated storage keys do not notify", () => {
  const { target } = fixture(); let calls = 0;
  subscribeConfig(target, () => calls++);
  target.dispatchEvent(storageEvent("career-ops:chat"));
  assert.equal(calls, 0);
});

test("a cross-tab whole-storage clear notifies", () => {
  const { target } = fixture(); let calls = 0;
  subscribeConfig(target, () => calls++);
  target.dispatchEvent(storageEvent(null));
  assert.equal(calls, 1);
});

test("unsubscribe removes both notification channels", () => {
  const { target, storage } = fixture(); let calls = 0;
  const unsubscribe = subscribeConfig(target, () => calls++);
  unsubscribe();
  writeConfig(storage, target, { cliId: "codex" });
  target.dispatchEvent(storageEvent(CONFIG_KEY));
  target.dispatchEvent(new Event(CONFIG_EVENT));
  assert.equal(calls, 0);
});

test("failed storage writes do not announce an unsaved config", () => {
  const { target } = fixture(); let calls = 0;
  subscribeConfig(target, () => calls++);
  assert.throws(() => writeConfig({ setItem() { throw new Error("quota"); } }, target, {}), /quota/);
  assert.equal(calls, 0);
});

test("unsubscribing one consumer leaves other consumers active", () => {
  const { target, storage } = fixture(); const calls = [0, 0];
  const unsubscribe = subscribeConfig(target, () => calls[0]++);
  subscribeConfig(target, () => calls[1]++);
  unsubscribe();
  writeConfig(storage, target, { cliId: "codex" });
  assert.deepEqual(calls, [0, 1]);
});
