import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { revealCvRequest } from "../../src/lib/cv-reveal.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-reveal-"));
  const output = path.join(root, "output");
  fs.mkdirSync(output);
  const file = path.join(output, "cv-acme.pdf");
  fs.writeFileSync(file, "%PDF-1.4");
  return {
    root,
    file,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function recorder() {
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, ...args]);
    return {
      on(event, fn) {
        if (event === "spawn") fn();
        return this;
      },
      unref() {},
    };
  };
  return { calls, spawn };
}

function request(platform, file, root, spawn, extra = {}) {
  return revealCvRequest({
    searchParams: new URLSearchParams({ n: "4", ...extra }),
    platform,
    spawn,
    root,
    locate: async (selectors) => {
      assert.deepEqual(selectors, { n: "4", company: "", application: "", kind: "cv" });
      return { file };
    },
  });
}

test("darwin reveal selects the resolved file in Finder", async () => {
  const { root, file, cleanup } = fixture();
  try {
    const { calls, spawn } = recorder();
    const result = await request("darwin", file, root, spawn);
    assert.equal(result.status, 204);
    assert.deepEqual(calls, [["open", "-R", file]]);
  } finally {
    cleanup();
  }
});

test("win32 reveal selects the resolved file in Explorer", async () => {
  const { root, file, cleanup } = fixture();
  try {
    const { calls, spawn } = recorder();
    const result = await request("win32", file, root, spawn);
    assert.equal(result.status, 204);
    assert.deepEqual(calls, [["explorer", `/select,${file}`]]);
  } finally {
    cleanup();
  }
});

test("linux reveal opens the parent directory of the resolved file", async () => {
  const { root, file, cleanup } = fixture();
  try {
    const { calls, spawn } = recorder();
    const result = await request("linux", file, root, spawn);
    assert.equal(result.status, 204);
    assert.deepEqual(calls, [["xdg-open", path.dirname(file)]]);
  } finally {
    cleanup();
  }
});

test("an unsupported platform returns 501 and the relative path without spawning", async () => {
  const { root, file, cleanup } = fixture();
  try {
    const { calls, spawn } = recorder();
    const result = await request("freebsd", file, root, spawn);
    assert.equal(result.status, 501);
    assert.equal(result.body, path.relative(root, file));
    assert.deepEqual(calls, []);
  } finally {
    cleanup();
  }
});

test("a path outside the resolved file is never spawned", async () => {
  const { root, file, cleanup } = fixture();
  const outside = path.join(os.tmpdir(), `cv-northwind-${process.pid}.pdf`);
  fs.writeFileSync(outside, "%PDF-1.4");
  try {
    const { calls, spawn } = recorder();
    const result = await revealCvRequest({
      searchParams: new URLSearchParams({ n: "4", file: outside, path: outside }),
      platform: "darwin",
      spawn,
      root,
      locate: async (selectors) => {
        assert.deepEqual(selectors, { n: "4", company: "", application: "", kind: "cv" });
        assert.equal(Object.hasOwn(selectors, "file"), false);
        assert.equal(Object.hasOwn(selectors, "path"), false);
        return { file };
      },
    });
    assert.equal(result.status, 204);
    assert.deepEqual(calls, [["open", "-R", file]]);
    assert.equal(JSON.stringify(calls).includes(outside), false);

    calls.length = 0;
    const refused = await revealCvRequest({
      searchParams: new URLSearchParams({ file: outside }),
      platform: "darwin",
      spawn,
      root,
      locate: async (selectors) => {
        assert.equal(selectors.n, "");
        return { file: outside };
      },
    });
    assert.equal(refused.status, 404);
    assert.equal(refused.body, "tailored CV is unavailable");
    assert.deepEqual(calls, []);
  } finally {
    fs.rmSync(outside, { force: true });
    cleanup();
  }
});

test("a spawn error event is a short error", async () => {
  const { root, file, cleanup } = fixture();
  try {
    const calls = [];
    const result = await request("darwin", file, root, (command, args) => {
      calls.push([command, ...args]);
      return {
        on(event, fn) {
          if (event === "error") fn(new Error("ENOENT cv-northwind.pdf"));
          return this;
        },
        unref() {},
      };
    });
    assert.equal(result.status, 500);
    assert.equal(result.body, "Could not reveal the file.");
    assert.deepEqual(calls, [["open", "-R", file]]);
  } finally {
    cleanup();
  }
});

test("a spawn failure is a short error and does not echo the thrown text", async () => {
  const { root, file, cleanup } = fixture();
  try {
    const result = await request("darwin", file, root, () => {
      throw new Error("spawn failed for cv-northwind.pdf");
    });
    assert.equal(result.status, 500);
    assert.equal(result.body, "Could not reveal the file.");
  } finally {
    cleanup();
  }
});

test("the reveal route asks locateTailoredPdf and does not read a client path", () => {
  const src = fs.readFileSync(new URL("../../src/app/api/cv-reveal/route.ts", import.meta.url), "utf8");
  assert.match(src, /locateTailoredPdf/);
  assert.match(src, /revealCvRequest/);
  assert.doesNotMatch(src, /searchParams\.get\("file"\)/);
  assert.doesNotMatch(src, /searchParams\.get\("path"\)/);
});
