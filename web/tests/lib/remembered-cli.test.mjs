// The web picks the agent CLI the user set up in (CAREER_OPS_CLI, written by
// `node remember-cli.mjs`) before falling back to the first installed one, so
// doctor, the scripts and the web agree on one CLI.
//
// Run:  node --experimental-strip-types --test tests/lib/remembered-cli.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickDefaultInstalled, pickUsableCli } from "../../src/lib/cli-pick.mjs";
import { readRememberedCli } from "../../src/lib/remembered-cli.mjs";

const { resolveCliId } = await import("../../src/lib/saved-cli.ts");

const TWO = [
  { id: "claude", installed: true },
  { id: "grok", installed: true },
  { id: "codex", installed: false },
];

function root(t, envFile) {
  const dir = mkdtempSync(join(tmpdir(), "co-remembered-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (envFile !== undefined) writeFileSync(join(dir, ".env"), envFile);
  return dir;
}

test("readRememberedCli reads CAREER_OPS_CLI from the shell, then the data root .env", (t) => {
  assert.equal(readRememberedCli(root(t, "CAREER_OPS_CLI=grok\n"), {}), "grok");
  assert.equal(readRememberedCli(root(t, 'export CAREER_OPS_CLI="codex"\n'), {}), "codex");
  assert.equal(readRememberedCli(root(t, "CAREER_OPS_CLI=grok\n"), { CAREER_OPS_CLI: "claude" }), "claude");
  assert.equal(readRememberedCli(root(t, "CAREER_OPS_CLI=grok # set at setup\n"), {}), "grok");
  assert.equal(readRememberedCli(root(t, "CAREER_OPS_CLI=codex#note\n"), {}), "codex");
  assert.equal(readRememberedCli(root(t, "CAREER_OPS_CLI='kimi' # quoted\r\n"), {}), "kimi");
  assert.equal(readRememberedCli(root(t, "OTHER=1\n"), {}), null);
  assert.equal(readRememberedCli(root(t), {}), null);
});

test("the Config default is the remembered CLI while it is installed", () => {
  assert.equal(pickDefaultInstalled(TWO, "grok"), "grok");
  assert.equal(pickDefaultInstalled(TWO, "codex"), "claude");
  assert.equal(pickDefaultInstalled(TWO, null), "claude");
});

test("a stale saved id falls back to the remembered CLI before giving up", () => {
  assert.deepEqual(pickUsableCli("gemini", TWO, "grok"), { id: "grok", substitutedFrom: "gemini" });
  assert.deepEqual(pickUsableCli("gemini", TWO, null), { id: null, substitutedFrom: null });
});

test("with nothing saved, resolveCliId picks and persists the remembered CLI", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ clis: TWO, remembered: "grok" }) });
  assert.equal(await resolveCliId(), "grok");
  assert.equal(JSON.parse(store.get("career-ops:config")).cliId, "grok");
});
