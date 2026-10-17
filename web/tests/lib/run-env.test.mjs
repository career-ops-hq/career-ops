// Guards which run-route kinds skip the auto-loaded CLAUDE.md/AGENTS.md.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/run-env.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runEnvFor } from "../../src/lib/run-env.mjs";
import { KNOWN_KINDS } from "../../src/lib/worker-capabilities.mjs";

test("evaluate runs skip the auto-loaded project instructions", () => {
  const env = runEnvFor("evaluate", { PATH: "/bin" });
  assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
  assert.equal(env.PATH, "/bin");
});

test("every other kind keeps them, and gets the base env unchanged", () => {
  const base = { PATH: "/bin" };
  for (const kind of KNOWN_KINDS.filter((k) => k !== "evaluate")) {
    assert.equal(runEnvFor(kind, base), base, `${kind} must keep CLAUDE.md/AGENTS.md`);
  }
});

test("the base env is not mutated", () => {
  const base = { PATH: "/bin" };
  runEnvFor("evaluate", base);
  assert.deepEqual(base, { PATH: "/bin" });
});

test("the run route spawns with runEnvFor, not process.env directly", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "app", "api", "run", "route.ts"), "utf8");
  assert.match(src, /env:\s*runEnvFor\(kind,\s*process\.env\)/);
});
