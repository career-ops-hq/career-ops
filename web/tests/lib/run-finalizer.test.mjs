import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import { createRunFinalizer } from "../../src/lib/run-finalizer.mjs";

function fixture() {
  const child = new EventEmitter();
  let releases = 0;
  const finish = createRunFinalizer(child, () => { releases++; });
  return { child, finish, releases: () => releases };
}

test("canceling keeps the write guard until the worker closes", () => {
  const run = fixture();
  run.finish();
  assert.equal(run.releases(), 0);

  run.child.emit("exit", null, "SIGTERM");
  assert.equal(run.releases(), 0, "exit may precede the closing of inherited stdio");

  run.child.emit("close", null, "SIGTERM");
  assert.equal(run.releases(), 1);
});

test("worker close keeps the guard during PDF rendering and marking", () => {
  const run = fixture();
  run.child.emit("close", 0);
  assert.equal(run.releases(), 0);

  run.finish();
  assert.equal(run.releases(), 1);
});

test("error handling cannot release a worker that has not closed", () => {
  const run = fixture();
  run.child.on("error", run.finish);
  run.child.emit("error", new Error("worker failed"));
  assert.equal(run.releases(), 0);

  run.child.emit("close", -2);
  assert.equal(run.releases(), 1);
});

test("late close and repeated completion signals release only once", () => {
  const run = fixture();
  run.finish();
  run.finish();
  run.child.emit("close", null);
  run.finish();
  run.child.emit("close", null);
  assert.equal(run.releases(), 1);
  assert.equal(run.child.listenerCount("close"), 0);
});

test("independent runs keep independent write guards", () => {
  const first = fixture();
  const second = fixture();
  first.finish();
  second.finish();
  first.child.emit("close", 0);
  assert.equal(first.releases(), 1);
  assert.equal(second.releases(), 0);
  second.child.emit("close", 0);
  assert.equal(second.releases(), 1);
});

test("a real worker remains guarded while it finishes after cancellation", { timeout: 10_000 }, async (t) => {
  // IPC keeps the child alive without launching an AI CLI or touching user data.
  // It also lets this exercise the same lifetime on Windows and POSIX.
  const child = spawn(process.execPath, ["-e", `
    process.on("message", message => {
      if (message === "finish") process.exit(0);
    });
    process.send("ready");
  `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let guarded = true;
  const finish = createRunFinalizer(child, () => { guarded = false; });
  await once(child, "message");

  finish();
  assert.equal(child.exitCode, null);
  assert.equal(guarded, true);

  const closed = once(child, "close");
  child.send("finish");
  await closed;
  assert.equal(child.exitCode, 0);
  assert.equal(guarded, false);
});
