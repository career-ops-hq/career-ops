import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const fixture = { calls: [], run: null, read: null };
globalThis.__jobNotesRouteFixture = fixture;
const stubs = {
  "@/lib/core-cli": `export const runSetStatus = args => globalThis.__jobNotesRouteFixture.run(args);`,
  "@/lib/career-ops": `export const findApplication = n => globalThis.__jobNotesRouteFixture.read(n); export const careerOpsRoot = () => ${JSON.stringify(fileURLToPath(new URL("../../../", import.meta.url)))};`,
};
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify(stubs)};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST } = await import("../../src/app/api/notes/route.ts");

const outcome = (data, code = 0) => ({ code, stdout: JSON.stringify(data), stderr: "", spawnFailed: false, timedOut: false });
beforeEach(() => {
  fixture.calls = [];
  fixture.run = async args => { fixture.calls.push(args); return outcome({ note: "New note", removedNote: "Old note" }); };
  fixture.read = () => ({ notes: "Current notes" });
});
async function post(action) {
  return POST(new Request("http://fixture.invalid/api/notes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n: "7", status: "Evaluated", ...action }),
  }));
}

for (const action of [
  { note: "bad\0note" },
  { note: "New note", replaceNote: "bad\0previous", noteIndex: 0, expectedNotes: "Old note" },
  { removeNote: "bad\0note", expectedNotes: "Old note" },
  { removeNote: "Old note", expectedNotes: "bad\0snapshot" },
]) {
  test(`NUL is rejected before invoking the CLI: ${JSON.stringify(action)}`, async () => {
    const response = await post(action);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
    assert.equal(fixture.calls.length, 0);
  });
}

for (const asynchronous of [false, true]) {
  test(`a ${asynchronous ? "rejected" : "synchronously thrown"} writer failure returns safe JSON`, async t => {
    fixture.run = asynchronous
      ? async () => { throw new Error("private fixture path and internal details"); }
      : () => { throw new Error("private fixture path and internal details"); };
    const errors = [];
    t.mock.method(console, "error", (...args) => errors.push(args));
    const response = await post({ note: "New note" });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Could not update the note. Please try again." });
    assert.equal(errors.length, 1);
    assert.ok(errors[0][1] instanceof Error);
  });
}

test("a tracker read failure after saving returns a clear JSON response", async t => {
  fixture.read = () => { throw new Error("private tracker details"); };
  t.mock.method(console, "error", () => {});
  const response = await post({ note: "New note" });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /saved.*reload.*Refresh/i);
});

for (const [code, cliCode, httpStatus] of [[1, "usage", 400], [2, "not-found", 404], [3, "notes-changed", 409], [4, "lock-timeout", 503]]) {
  test(`writer exit ${code} preserves its structured ${httpStatus} error`, async () => {
    fixture.run = async () => outcome({ code: cliCode, error: "Fictional writer error" }, code);
    const response = await post({ removeNote: "Old note", expectedNotes: "Old note" });
    assert.equal(response.status, httpStatus);
    assert.deepEqual(await response.json(), { error: "Fictional writer error" });
  });
}

test("an unexpected CLI failure returns a generic error without leaking stderr", async () => {
  fixture.run = async () => ({ ...outcome({}, -1), stderr: "private process details", spawnFailed: true });
  const response = await post({ note: "New note" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Could not update the note. Please try again." });
});

test("successful note changes still return the canonical tracker notes", async () => {
  const response = await post({ removeNote: "Old note", expectedNotes: "Old note; Current notes" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, notes: "Current notes" });
  assert.ok(fixture.calls[0].includes("--remove-note=Old note"));
  assert.ok(fixture.calls[0].includes("--expect-notes=Old note; Current notes"));
});

test("an edit passes its displayed position and reviewed snapshot to the locked writer", async () => {
  const response = await post({ note: "New note", replaceNote: "same", noteIndex: 1, expectedNotes: "same; same" });
  assert.equal(response.status, 200);
  assert.ok(fixture.calls[0].includes("--replace-note=same"));
  assert.ok(fixture.calls[0].includes("--note-index=1"));
  assert.ok(fixture.calls[0].includes("--expect-notes=same; same"));
});
for (const action of [
  { note: "New note", replaceNote: "Old note" },
  { note: "New note", replaceNote: "Old note", noteIndex: 0 },
  { note: "New note", replaceNote: "Old note", expectedNotes: "Old note" },
  ...[-1, 1.5, "0", 9007199254740992].map(noteIndex => ({ note: "New note", replaceNote: "Old note", noteIndex, expectedNotes: "Old note" })),
  { note: "New note", replaceNote: "Old note", noteIndex: 0, expectedNotes: "bad\0snapshot" },
  { note: "New note", noteIndex: 0 },
  { removeNote: "Old note", expectedNotes: "Old note", noteIndex: 0 },
]) {
  test(`invalid indexed edit is rejected before invoking the CLI: ${JSON.stringify(action)}`, async () => {
    const response = await post(action);
    assert.equal(response.status, 400);
    assert.equal(fixture.calls.length, 0);
  });
}
