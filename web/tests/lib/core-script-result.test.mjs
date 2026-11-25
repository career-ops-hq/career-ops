import assert from "node:assert/strict";
import test from "node:test";
import { coreScriptHttp } from "../../src/lib/core-script-result.mjs";

const fallback = "could not finish";

test("coreScriptHttp maps CLI exits onto HTTP statuses", () => {
  assert.deepEqual(coreScriptHttp({ code: 0, parsed: { changed: true }, fallback }), { status: 200, body: { changed: true } });
  assert.equal(coreScriptHttp({ code: 0, parsed: null, fallback }).status, 200);
  assert.deepEqual(
    coreScriptHttp({ code: 1, parsed: { error: "not Applied", code: "NOT_APPLIED" }, fallback }),
    { status: 400, body: { error: "not Applied", code: "NOT_APPLIED" } },
  );
  assert.equal(coreScriptHttp({ code: 1, parsed: null, fallback }).status, 500);
  assert.equal(coreScriptHttp({ code: 2, parsed: { error: "missing", code: "NOT_FOUND" }, fallback }).status, 404);
  assert.equal(coreScriptHttp({ code: 3, parsed: { error: "two rows" }, fallback }).status, 409);
  assert.equal(coreScriptHttp({ code: 4, parsed: { error: "locked" }, fallback }).status, 503);
  assert.equal(coreScriptHttp({ code: 9, parsed: null, fallback }).body.error, fallback);
});
