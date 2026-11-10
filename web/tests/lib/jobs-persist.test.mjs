// Worker jobs are stored for reloads, but a streaming job replaced the list on
// every chunk and the provider stored all of it each time. createJobsPersister
// writes at most once per delay while a job runs, at once when none does.
//
// Run: npm test -- tests/lib/jobs-persist.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJobsPersister } from "../../src/lib/jobs-persist.mjs";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function harness(delayMs = 1000) {
  const writes = [];
  const timers = new Map();
  let nextId = 1;
  const persister = createJobsPersister({
    write: (jobs) => writes.push(jobs),
    isActive: (jobs) => jobs.some((j) => j.status === "running"),
    delayMs,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const fire = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  return { persister, writes, timers, fire };
}

const running = (text) => [{ id: "a", status: "running", text }];

test("a streaming job is written once per delay, with the latest list", () => {
  const { persister, writes, timers, fire } = harness();
  for (let i = 0; i < 500; i++) persister.save(running(`chunk ${i}`));
  assert.equal(writes.length, 0, "nothing is written per chunk");
  assert.equal(timers.size, 1, "one pending timer, not one per chunk");
  assert.equal([...timers.values()][0].ms, 1000);
  fire();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].text, "chunk 499", "the write carries the newest state");
  persister.save(running("chunk 500"));
  fire();
  assert.equal(writes.length, 2);
});

test("a list with nothing running is written at once and cancels the pending write", () => {
  const { persister, writes, timers } = harness();
  persister.save(running("partial"));
  persister.save([{ id: "a", status: "done", text: "final" }]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].status, "done");
  assert.equal(timers.size, 0, "the stale timed write is cancelled");
});

test("flush writes a pending list now, and is a no-op otherwise", () => {
  const { persister, writes, timers } = harness();
  persister.flush();
  assert.equal(writes.length, 0);
  persister.save(running("mid-stream"));
  persister.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].text, "mid-stream");
  assert.equal(timers.size, 0);
  persister.flush();
  assert.equal(writes.length, 1, "nothing pending, nothing written");
});

test("the jobs provider stores through the persister and flushes on pagehide", () => {
  const src = readFileSync(join(webRoot, "src/components/jobs/job-store.tsx"), "utf8");
  assert.match(src, /createJobsPersister(<[^>]*>)?\(/);
  assert.match(src, /addEventListener\("pagehide"/);
  // One direct write is left: the persister's own write callback.
  assert.equal(src.match(/localStorage\.setItem\(/g)?.length, 1);
});
