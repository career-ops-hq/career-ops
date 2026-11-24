// POST /api/followups/log must answer 400, not 500, when `date` or `channel`
// arrives as a non-string JSON value: both are trimmed before validation, so a
// number or object there used to throw a TypeError out of the handler.
//
// Run:  node --experimental-strip-types --test tests/lib/followups-log-route.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";

const { POST } = await import("../../src/app/api/followups/log/route.ts");

const post = (body) =>
  POST(new Request("http://127.0.0.1/api/followups/log", { method: "POST", body: JSON.stringify(body) }));

for (const field of ["date", "channel"]) {
  for (const value of [20261124, true, {}, ["Email"]]) {
    test(`a non-string ${field} (${JSON.stringify(value)}) answers 400`, async () => {
      const res = await post({ appNum: 1, company: "Acme", [field]: value });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, `${field} must be a string`);
    });
  }
}
