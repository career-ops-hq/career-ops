import assert from "node:assert/strict";
import { test } from "node:test";

// Mirror of pickSoleInstalled in src/lib/saved-cli.ts (TS; this suite is .mjs).
function pickSoleInstalled(clis) {
  const installed = (clis || []).filter((c) => c.installed);
  return installed.length === 1 ? installed[0].id : null;
}

test("sole installed CLI is the default", () => {
  assert.equal(
    pickSoleInstalled([
      { id: "claude", installed: false },
      { id: "grok", installed: true },
    ]),
    "grok",
  );
});

test("zero or two installed CLIs stay unset", () => {
  assert.equal(pickSoleInstalled([]), null);
  assert.equal(
    pickSoleInstalled([
      { id: "claude", installed: true },
      { id: "grok", installed: true },
    ]),
    null,
  );
});

// Mirror of resolveCliId's post-fetch race guard in src/lib/saved-cli.ts (TS;
// this suite is .mjs), with storage/fetch injected instead of the real
// localStorage/fetch globals so the race is deterministic to test.
function makeStore(initial) {
  let value = initial ?? null;
  return {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
}

async function resolveCliId(store, fetchClis) {
  const readSaved = () => {
    try {
      const raw = store.get();
      const id = raw ? JSON.parse(raw).cliId : "";
      return typeof id === "string" && id ? id : null;
    } catch {
      return null;
    }
  };
  const persist = (cliId) => {
    const raw = store.get();
    const prev = raw ? JSON.parse(raw) : {};
    store.set(JSON.stringify({ ...prev, mode: prev.mode || "cli", cliId }));
  };

  const saved = readSaved();
  if (saved) return saved;
  const d = await fetchClis();
  const sole = pickSoleInstalled(d.clis);
  if (!sole) return null;
  const savedMeanwhile = readSaved();
  if (savedMeanwhile) return savedMeanwhile;
  persist(sole);
  return sole;
}

test("a choice saved while the detection fetch is in flight wins, and is not clobbered", async () => {
  const store = makeStore(null);
  const result = await resolveCliId(store, async () => {
    // Simulate the user saving a different CLI via Config while /api/clis
    // is still in flight.
    store.set(JSON.stringify({ mode: "cli", cliId: "codex" }));
    return { clis: [{ id: "grok", installed: true }] };
  });
  assert.equal(result, "codex");
  assert.equal(JSON.parse(store.get()).cliId, "codex");
});

test("with no save in flight, the sole installed CLI is still detected and persisted", async () => {
  const store = makeStore(null);
  const result = await resolveCliId(store, async () => ({ clis: [{ id: "grok", installed: true }] }));
  assert.equal(result, "grok");
  assert.equal(JSON.parse(store.get()).cliId, "grok");
});
