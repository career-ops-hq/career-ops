import { test } from "node:test";
import assert from "node:assert/strict";
import { readFillResult } from "../../src/lib/apply/fill-stream.mjs";

const encoder = new TextEncoder();
const step = { t: "step", turn: 1, action: "fill", detail: "Filled the name field" };
const record = (event) => `${JSON.stringify(event)}\n`;

function responseFor(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  }));
}

function read(response, onStep = () => {}, isCurrent = () => true) {
  return readFillResult(response, onStep, isCurrent);
}

test("EOF after a progress step releases filling without claiming success", async () => {
  const steps = [];
  const response = responseFor([record(step)]);
  const result = await read(response, (event) => steps.push(event));
  assert.deepEqual(steps, [step]);
  assert.equal(result.status, "ready");
  assert.match(result.error, /stopped before confirming/);
  assert.match(result.error, /Check the real form before trying again/);
  assert.equal(response.body.locked, false);
});

test("an empty response releases filling with an actionable interruption", async () => {
  const result = await read(responseFor([]));
  assert.equal(result.status, "ready");
  assert.match(result.error, /stopped before confirming/);
});

test("a complete terminal result without a trailing newline finishes the fill", async () => {
  const result = await read(responseFor([record(step), '{"t":"done","filled":true}']));
  assert.deepEqual(result, { status: "done", filled: true });
});

test("an unsuccessful but completed agent attempt preserves its filled=false result", async () => {
  assert.deepEqual(await read(responseFor([record({ t: "done", filled: false })])), { status: "done", filled: false });
});

test("split records and split Unicode bytes preserve steps and completion", async () => {
  const event = { ...step, detail: "Filled José's name" };
  const bytes = encoder.encode(record(event) + record({ t: "done", filled: true }));
  const steps = [];
  const result = await read(responseFor(Array.from(bytes, (byte) => Uint8Array.of(byte))), (value) => steps.push(value));
  assert.deepEqual(steps, [event]);
  assert.deepEqual(result, { status: "done", filled: true });
});

test("a terminal error without a trailing newline restores the editor with its message", async () => {
  const result = await read(responseFor(['{"t":"error","message":"The page closed."}']));
  assert.deepEqual(result, { status: "ready", error: "The page closed." });
});

test("a terminal error with no usable message gives recovery guidance", async () => {
  const result = await read(responseFor([record({ t: "error", message: {} })]));
  assert.equal(result.status, "ready");
  assert.match(result.error, /Check the real form before trying again/);
});

test("HTTP errors keep the API's explanation instead of waiting for NDJSON", async () => {
  const result = await read(Response.json({ error: "Apply session expired" }, { status: 404 }));
  assert.deepEqual(result, { status: "ready", error: "Apply session expired" });
});

test("non-JSON HTTP errors include their status and never count as done", async () => {
  const result = await read(new Response("Bad gateway", { status: 502 }));
  assert.equal(result.status, "ready");
  assert.match(result.error, /HTTP 502/);
});

test("a missing response body releases filling", async () => {
  const result = await read(new Response(null));
  assert.equal(result.status, "ready");
  assert.match(result.error, /No response stream/);
});

test("malformed and unknown records never impersonate successful completion", async () => {
  for (const text of ['{"t":"done"}', '{"t":"done","filled":"true"}', '{"t":"done",', "null\n", "{}\n", '{"t":"heartbeat"}\n']) {
    const result = await read(responseFor([text]));
    assert.equal(result.status, "ready", text);
    assert.match(result.error, /stopped before confirming|unreadable fill result/, text);
  }
});

test("blank and unknown valid progress records do not discard a later valid result", async () => {
  const result = await read(responseFor(["\r\nnull\n{}\n", record({ t: "done", filled: true })]));
  assert.deepEqual(result, { status: "done", filled: true });
});

test("a malformed error record cannot be silently dropped before a later done", async () => {
  const result = await read(responseFor(['{"t":"error","message":"Page closed"\n', record({ t: "done", filled: true })]));
  assert.equal(result.status, "ready");
  assert.match(result.error, /unreadable fill result/);
});

test("a malformed terminal result cannot be replaced by a later done", async () => {
  const result = await read(responseFor([record({ t: "done" }), record({ t: "done", filled: true })]));
  assert.equal(result.status, "ready");
  assert.match(result.error, /unreadable fill result/);
});

test("terminal completion does not wait for the transport to close", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(record({ t: "done", filled: true })));
    },
    cancel() { cancelled = true; },
  }));
  assert.deepEqual(await read(response), { status: "done", filled: true });
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test("a terminal error cannot be overwritten by a later done record", async () => {
  const result = await read(responseFor([record({ t: "error", message: "Page closed" }) + record({ t: "done", filled: true })]));
  assert.deepEqual(result, { status: "ready", error: "Page closed" });
});

test("a response for an abandoned session produces no updates", async () => {
  const steps = [];
  const result = await read(responseFor([record(step), record({ t: "done", filled: true })]), (value) => steps.push(value), () => false);
  assert.equal(result, null);
  assert.deepEqual(steps, []);
});

test("leaving while a read is pending discards its result and releases the reader", async () => {
  let controller;
  let current = true;
  const response = new Response(new ReadableStream({ start(value) { controller = value; } }));
  const steps = [];
  const pending = read(response, (value) => steps.push(value), () => current);
  current = false;
  controller.enqueue(encoder.encode(record(step) + record({ t: "done", filled: true })));
  assert.equal(await pending, null);
  assert.deepEqual(steps, []);
  assert.equal(response.body.locked, false);
});

test("transport errors reach the provider's recovery path and release the reader", async () => {
  const response = new Response(new ReadableStream({
    start(controller) { controller.error(new Error("Connection dropped")); },
  }));
  await assert.rejects(read(response), /Connection dropped/);
  assert.equal(response.body.locked, false);
});

test("an explicit retry can complete after an interrupted attempt", async () => {
  const first = await read(responseFor([record(step)]));
  const retry = await read(responseFor([record({ t: "done", filled: true })]));
  assert.equal(first.status, "ready");
  assert.deepEqual(retry, { status: "done", filled: true });
});
