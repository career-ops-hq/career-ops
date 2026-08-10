import assert from "node:assert/strict";
import test from "node:test";

import { patchClientConfig, readConfiguredCli } from "../../src/lib/client-config.mjs";

test("reads a configured CLI and rejects malformed or empty values", () => {
  assert.equal(readConfiguredCli('{"cliId":"kimi"}'), "kimi");
  assert.equal(readConfiguredCli('{"cliId":""}'), null);
  assert.equal(readConfiguredCli('{"cliId":42}'), null);
  assert.equal(readConfiguredCli("not-json"), null);
});

test("patching a CLI preserves unrelated browser preferences", () => {
  const next = JSON.parse(patchClientConfig('{"logos":false,"provider":"google"}', { mode: "cli", cliId: "kimi" }));

  assert.deepEqual(next, { logos: false, provider: "google", mode: "cli", cliId: "kimi" });
});
