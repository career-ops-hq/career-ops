import { test } from "node:test";
import assert from "node:assert/strict";
import { readJobStream } from "../../src/lib/job-stream.mjs";

const encoder = new TextEncoder();
const record = (event) => `${JSON.stringify(event)}\n`;

function response(chunks, { error, stayOpen = false } = {}) {
  let cancelled = 0;
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      } else if (error) controller.error(error);
      else if (!stayOpen) controller.close();
    },
    cancel() { cancelled++; },
  });
  return { stream, cancelled: () => cancelled };
}

async function read(chunks, options) {
  const fixture = response(chunks, options);
  const progress = [];
  const result = await readJobStream(fixture.stream, (event) => progress.push(event));
  assert.equal(fixture.stream.locked, false, "the reader must always release its lock");
  return { result, progress, cancelled: fixture.cancelled() };
}

test("a verdict followed by EOF is an interrupted run, never a confirmed score", async () => {
  const { result, progress } = await read([record({ type: "text", text: "VERDICT: 4.8/5 — Fixture fit" })]);
  assert.equal(progress[0].text, "VERDICT: 4.8/5 — Fixture fit");
  assert.equal(result.status, "error");
  assert.match(result.message, /before the server confirmed completion/);
});

test("an empty successful HTTP response does not mean the worker completed", async () => {
  const { result } = await read([]);
  assert.equal(result.status, "error");
});

test("keepalives and future events cannot confirm completion", async () => {
  const { result, progress } = await read([record({ type: "keepalive" }), record({ type: "future-event" })]);
  assert.equal(result.status, "error");
  assert.deepEqual(progress, []);
});

test("confirmed completion forwards progress and preserves the reported usage", async () => {
  const events = [
    { type: "status", label: "Rendering PDF…" },
    { type: "tool", name: "Read" },
    { type: "text", text: "CV rendered." },
  ];
  const { result, progress } = await read([
    ...events.map(record),
    record({ type: "done", tokens: 1234, costUsd: 0.12 }),
  ]);
  assert.deepEqual(progress, events);
  assert.deepEqual(result, { status: "done", tokens: 1234, costUsd: 0.12 });
});

test("the final done record is accepted without a trailing newline", async () => {
  const { result } = await read([JSON.stringify({ type: "done", tokens: 0, costUsd: 0 })]);
  assert.deepEqual(result, { status: "done", tokens: 0, costUsd: 0 });
});

test("the final error record is preserved without a trailing newline", async () => {
  const { result } = await read([JSON.stringify({ type: "error", msg: "This evaluation didn't save a report." })]);
  assert.deepEqual(result, { status: "error", message: "This evaluation didn't save a report." });
});

test("fragmented UTF-8 and JSON records retain every character", async () => {
  const event = { type: "text", text: "José — 東京 résumé" };
  const bytes = encoder.encode(record(event) + JSON.stringify({ type: "done", tokens: 42 }));
  const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
  const { result, progress } = await read(chunks);
  assert.deepEqual(progress, [event]);
  assert.deepEqual(result, { status: "done", tokens: 42 });
});

test("CRLF records and blank lines are supported", async () => {
  const { result } = await read(['\r\n  \r\n{"type":"keepalive"}\r\n{"type":"done"}\r\n']);
  assert.deepEqual(result, { status: "done" });
});

test("a terminal error cannot be replaced by a later done record", async () => {
  const { result } = await read([record({ type: "error", msg: "Worker failed" }) + record({ type: "done" })]);
  assert.deepEqual(result, { status: "error", message: "Worker failed" });
});

test("malformed JSON cannot be skipped on the way to a successful completion", async () => {
  const { result } = await read(['{"type":"error",\n' + record({ type: "done" })]);
  assert.equal(result.status, "error");
  assert.match(result.message, /Invalid response/);
});

test("a connection failure before confirmation stays a connection error", async () => {
  const { result } = await read([record({ type: "text", text: "Almost done" })], { error: new TypeError("network failed") });
  assert.deepEqual(result, { status: "error", message: "Connection error" });
});

test("an aborted reader reports interruption rather than completion", async () => {
  const { result } = await read([], { error: new DOMException("The operation was aborted", "AbortError") });
  assert.deepEqual(result, { status: "error", message: "Interrupted. Check the pipeline before retrying." });
});

test("a terminal error releases a response whose producer has not closed", async () => {
  const { result, cancelled } = await read([record({ type: "error", msg: "Worker failed" })], { stayOpen: true });
  assert.equal(result.status, "error");
  assert.equal(cancelled, 1);
});

test("confirmed success does not wait on or fail with the transport after done", async () => {
  const { result, cancelled } = await read([record({ type: "done", tokens: 42 })], { stayOpen: true });
  assert.deepEqual(result, { status: "done", tokens: 42 });
  assert.equal(cancelled, 1);
});
