import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseFollowupId } from "../../src/lib/followup-id.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../..");

test("parseFollowupId accepts positive safe integer numbers and canonical strings", () => {
  for (const [input, expected] of [
    [1, 1],
    [42, 42],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ["1", 1],
    [" 42 ", 42],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ]) {
    assert.equal(parseFollowupId(input), expected);
  }
});

test("parseFollowupId rejects coercible prefixes and non-positive or unsafe values", () => {
  for (const input of [
    undefined,
    null,
    "",
    "0",
    0,
    -1,
    "-1",
    1.5,
    "1.5",
    "1e2",
    "42junk",
    "01",
    Number.MAX_SAFE_INTEGER + 1,
    String(Number.MAX_SAFE_INTEGER + 1),
    [],
    {},
  ]) {
    assert.equal(parseFollowupId(input), null, `expected ${JSON.stringify(input)} to be rejected`);
  }
});

test("all follow-up mutation routes use strict ID parsing", () => {
  for (const [relative, expectedCalls] of [
    ["src/app/api/followups/log/route.ts", 2],
    ["src/app/api/followups/override/route.ts", 2],
  ]) {
    const source = fs.readFileSync(path.join(webRoot, relative), "utf8");
    assert.equal(source.includes("Number.parseInt(String(body."), false, relative);
    assert.equal((source.match(/parseFollowupId\(/g) ?? []).length, expectedCalls, relative);
  }
});
