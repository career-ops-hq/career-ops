import assert from "node:assert/strict";
import { test } from "node:test";
import { createInboxSkipActions, queueInboxSkip } from "../../src/lib/inbox-skip-client.mjs";

const url = "https://example.com/fixture-alpha";
const ok = (done) => Response.json({ ok: true, done, matched: 1, changed: 1 });

test("a Skip failure is suppressed after Undo is requested, even while Undo is pending", async () => {
  let rejectSkip;
  let resolveUndo;
  let undoFinished = false;
  const skip = new Promise((_, reject) => { rejectSkip = reject; });
  const undo = new Promise((resolve) => { resolveUndo = resolve; });
  const failures = [];
  const actions = createInboxSkipActions((done) => done ? skip : undo, (error) => failures.push(error));
  const skipped = actions.skip();
  const restored = actions.undo().then(() => { undoFinished = true; });
  rejectSkip(new Error("Skip failed"));
  await skipped; // the rejection handler has completed; Undo is still unresolved
  assert.equal(undoFinished, false);
  assert.deepEqual(failures, []);
  resolveUndo();
  await restored;
  assert.equal(undoFinished, true);
  assert.deepEqual(failures, []);
});

test("Skip failures still surface when Undo was not requested for that action", async () => {
  const failure = new Error("Skip failed");
  const failures = [];
  const actions = createInboxSkipActions(async () => { throw failure; }, (error) => failures.push(error));
  await actions.skip();
  assert.deepEqual(failures, [failure]);
});

test("Skip and Undo use the existing endpoint and are serialized per URL", async () => {
  const chains = new Map();
  const writes = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const request = async (endpoint, options) => {
    assert.equal(endpoint, "/api/inbox/skip");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    const body = JSON.parse(options.body);
    assert.equal(body.url, url);
    writes.push(body.done);
    if (body.done) await gate;
    return ok(body.done);
  };
  const skip = queueInboxSkip(chains, url, true, request);
  const undo = queueInboxSkip(chains, url, false, request);
  await Promise.resolve();
  assert.deepEqual(writes, [true]);
  release();
  await Promise.all([skip, undo]);
  assert.deepEqual(writes, [true, false]);
  await Promise.resolve();
  assert.equal(chains.size, 0);
});

test("a failed Undo rejects visibly without preventing a retry", async () => {
  const chains = new Map();
  const failure = queueInboxSkip(chains, url, false, async () => Response.json({ error: "Pipeline busy" }, { status: 409 }));
  const retry = queueInboxSkip(chains, url, false, async () => ok(false));
  await assert.rejects(failure, /Pipeline busy/);
  await retry;
});

test("a failed Skip does not prevent an already queued Undo", async () => {
  const chains = new Map();
  const skip = queueInboxSkip(chains, url, true, async () => { throw new Error("offline"); });
  const undo = queueInboxSkip(chains, url, false, async () => ok(false));
  await assert.rejects(skip, /offline/);
  await undo;
});

test("a slow posting does not block an independent posting", async () => {
  const chains = new Map();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = queueInboxSkip(chains, url, true, async () => { await gate; return ok(true); });
  await queueInboxSkip(chains, "https://example.com/fixture-beta", true, async () => ok(true));
  release();
  await first;
});

test("HTTP and network failures remain errors", async () => {
  await assert.rejects(queueInboxSkip(new Map(), url, false, async () => new Response("unavailable", { status: 503 })), /Could not save/);
  await assert.rejects(queueInboxSkip(new Map(), url, false, async () => { throw new Error("offline"); }), /offline/);
});

for (const body of [null, {}, { ok: false }, { ok: true }, { ok: true, done: true }]) {
  test(`Undo requires confirmed success: ${JSON.stringify(body)}`, async () => {
    await assert.rejects(queueInboxSkip(new Map(), url, false, async () => Response.json(body)), /Could not confirm/);
  });
}
