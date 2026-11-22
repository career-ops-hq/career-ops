import { test } from "node:test";
import assert from "node:assert/strict";
import { readFillResult, screenForFill } from "../../src/lib/apply/fill-stream.mjs";

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

function read(response, onStep = () => {}, isCurrent = () => true, signal) {
  return readFillResult(response, onStep, isCurrent, signal);
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

test("filled false leaves the success screen and returns to the editor", () => {
  const outcome = screenForFill({ status: "done", filled: false });
  assert.equal(outcome.status, "ready");
  assert.equal(outcome.error, "AI did its best but couldn't finish. Check the real form before trying again.");
});

test("filled true stays on the success screen", () => {
  const outcome = screenForFill({ status: "done", filled: true });
  assert.equal(outcome.status, "done");
  assert.equal(outcome.issue, "AI filled the form for you — review every answer on the real form, then submit it yourself.");
});

test("a held handoff keeps its gaps and stays on the editor", async () => {
  const gaps = [{
    level: "warn",
    code: "screening-empty",
    field: "Visa sponsorship",
    message: "Required sponsorship question is still empty (Visa sponsorship). Fill it on this page before the employer form opens.",
  }];
  const result = await read(responseFor([record({ t: "done", filled: false, gaps })]));
  assert.deepEqual(result, { status: "done", filled: false, gaps });
  const outcome = screenForFill(result);
  assert.deepEqual(outcome, { status: "ready", gaps });
  assert.equal(outcome.error, undefined);
  assert.doesNotMatch(JSON.stringify(outcome), /couldn't finish/);
});

test("gaps keep the editor up even when the stream says the fill finished", () => {
  const gaps = [{
    level: "warn",
    code: "resume-missing",
    field: "Resume",
    message: "No tailored CV was resolved for Resume, so nothing will be attached. The employer form stays on this page until a file is attached.",
  }];
  const outcome = screenForFill({ status: "done", filled: true, gaps });
  assert.equal(outcome.status, "ready");
  assert.deepEqual(outcome.gaps, gaps);
  assert.equal(outcome.error, undefined);
});

test("a completed handoff keeps a résumé warning on the success screen", () => {
  const gaps = [{
    level: "warn",
    code: "cv-resolve",
    message: "Could not resolve the résumé.",
  }];
  const outcome = screenForFill({ status: "done", filled: true, gaps });
  assert.equal(outcome.status, "done");
  assert.equal(outcome.issue, "AI filled the form for you — review every answer on the real form, then submit it yourself.");
  assert.deepEqual(outcome.gaps, gaps);
});

test("a blocking gap still holds the editor when a résumé warning is also present", () => {
  const gaps = [
    { level: "warn", code: "cv-resolve", message: "Could not resolve the résumé." },
    {
      level: "warn",
      code: "screening-empty",
      field: "Visa sponsorship",
      message: "Required sponsorship question is still empty (Visa sponsorship). Fill it on this page before the employer form opens.",
    },
  ];
  const outcome = screenForFill({ status: "done", filled: true, gaps });
  assert.equal(outcome.status, "ready");
  assert.deepEqual(outcome.gaps, gaps);
  assert.equal(outcome.error, undefined);
});

test("an empty gaps list does not change a completed fill", async () => {
  assert.deepEqual(await read(responseFor([record({ t: "done", filled: true, gaps: [] })])), { status: "done", filled: true });
});

test("a stream failure keeps its own error on the editor", () => {
  assert.deepEqual(screenForFill({ status: "ready", error: "Page closed" }), { status: "ready", error: "Page closed" });
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

test("aborting a never-closing stream settles and cancels the reader without another chunk", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }));
  const controller = new AbortController();
  const pending = read(response, () => {}, () => true, controller.signal);
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test("an explicit retry can complete after an interrupted attempt", async () => {
  const first = await read(responseFor([record(step)]));
  const retry = await read(responseFor([record({ t: "done", filled: true })]));
  assert.equal(first.status, "ready");
  assert.deepEqual(retry, { status: "done", filled: true });
});
