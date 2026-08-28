import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const store = fs.readFileSync(new URL("../../src/components/jobs/job-store.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../../src/app/api/run/route.ts", import.meta.url), "utf8");

test("worker jobs begin at Starting and transition to Error on stream errors", () => {
  assert.match(store, /status: "running"[\s\S]*label: "Starting…"/);
  assert.match(store, /ev\.type === "error"[\s\S]*finish\("error"/);
  assert.match(store, /!res\.ok[\s\S]*finish\("error"/);
});

test("run route forwards spawn errors and closes the stream", () => {
  assert.match(route, /child\.on\("error",[\s\S]{0,500}send\(\{ type: "error", msg \}\);[\s\S]{0,40}close\(\);/);
  assert.match(route, /spawnErrorCode = e\.code/);
  assert.match(route, /codexNoOutputMessage\(\{ code: null,[\s\S]*manualJob:/);
});
