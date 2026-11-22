// Run:  node --experimental-strip-types --test tests/lib/json-body-limit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readJsonObject } from "../../src/lib/json-body.ts";

const post = (body) => new Request("http://127.0.0.1/api/x", { method: "POST", body });

test("readJsonObject with maxBytes still parses a body within the limit", async () => {
  assert.deepEqual(await readJsonObject(post('{"a":1}'), { maxBytes: 100 }), { a: 1 });
});

test("readJsonObject with maxBytes refuses a body over the limit", async () => {
  assert.equal(await readJsonObject(post(JSON.stringify({ a: "x".repeat(200) })), { maxBytes: 100 }), null);
});

test("readJsonObject with maxBytes counts bytes as they stream in, not only a declared length", async () => {
  // One valid JSON object (about 140 bytes) split across two chunks, so a rejection can only
  // come from the byte count, never from a parse error.
  const whole = new TextEncoder().encode(JSON.stringify({ a: "x".repeat(130) }));
  const half = Math.floor(whole.length / 2);
  const streamed = () =>
    new Request("http://127.0.0.1/api/x", {
      method: "POST",
      duplex: "half",
      body: new ReadableStream({
        start(c) {
          c.enqueue(whole.slice(0, half));
          c.enqueue(whole.slice(half));
          c.close();
        },
      }),
    });
  assert.deepEqual(await readJsonObject(streamed(), { maxBytes: 1000 }), { a: "x".repeat(130) });
  assert.equal(await readJsonObject(streamed(), { maxBytes: 100 }), null);
});

test("readJsonObject without maxBytes behaves as before", async () => {
  assert.deepEqual(await readJsonObject(post(JSON.stringify({ a: "x".repeat(500) }))), { a: "x".repeat(500) });
  assert.equal(await readJsonObject(post("[1]")), null);
});
