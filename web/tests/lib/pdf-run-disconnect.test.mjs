// A client that leaves while the CV HTML is built must not get a saved PDF.
import assert from "node:assert/strict";
import { test } from "node:test";
import { saveBuiltCv } from "../../src/lib/pdf-run-save.mjs";

test("a disconnect during CV build does not save or render the PDF", async () => {
  let closed = false;
  const calls = [];
  await saveBuiltCv({
    build: async () => {
      closed = true;
      calls.push("build");
      return { ok: true, html: "<p>cv</p>", warnings: [], ats: false };
    },
    isClosed: () => closed,
    onError: () => calls.push("error"),
    onWarnings: () => calls.push("warnings"),
    save: () => {
      calls.push("save");
      return true;
    },
    render: async () => {
      calls.push("render");
    },
  });
  assert.deepEqual(calls, ["build"]);
});

test("a finished CV build saves and then renders", async () => {
  const calls = [];
  await saveBuiltCv({
    build: async () => {
      calls.push("build");
      return { ok: true, html: "<p>cv</p>", warnings: ["tight margin"], ats: true };
    },
    isClosed: () => false,
    onError: () => calls.push("error"),
    onWarnings: () => calls.push("warnings"),
    save: () => {
      calls.push("save");
      return true;
    },
    render: async () => {
      calls.push("render");
    },
  });
  assert.deepEqual(calls, ["build", "warnings", "save", "render"]);
});

test("a failed CV build does not save or render", async () => {
  const calls = [];
  await saveBuiltCv({
    build: async () => ({ ok: false, error: "no blocks" }),
    isClosed: () => false,
    onError: (message) => calls.push(message),
    onWarnings: () => calls.push("warnings"),
    save: () => {
      calls.push("save");
      return true;
    },
    render: async () => {
      calls.push("render");
    },
  });
  assert.deepEqual(calls, ["no blocks"]);
});
