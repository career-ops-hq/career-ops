// Run:  node --test tests/lib/safe-path.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveInside, realInside } from "../../src/lib/safe-path.mjs";

const base = path.resolve("/tmp/output");

test("resolveInside allows files inside the base", () => {
  assert.equal(resolveInside(base, "acme/role/evaluation.md"), path.join(base, "acme", "role", "evaluation.md"));
});

test("resolveInside rejects traversal and the base itself", () => {
  assert.equal(resolveInside(base, "../secret.md"), null);
  assert.equal(resolveInside(base, "acme/../../secret.md"), null);
  assert.equal(resolveInside(base, ".."), null);
  assert.equal(resolveInside(base, ""), null);
  assert.equal(resolveInside(base, "../output-evil/x.md"), null); // sibling sharing the prefix
});

test("realInside serves real files and refuses a symlink that leaves the folder", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-path-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, "output");
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, "ok.md"), "ok");
  fs.writeFileSync(path.join(dir, "secret.md"), "secret");
  assert.equal(realInside(out, "ok.md"), fs.realpathSync(path.join(out, "ok.md")));
  assert.equal(realInside(out, "missing.md"), null);
  try {
    fs.symlinkSync(path.join(dir, "secret.md"), path.join(out, "link.md"));
  } catch {
    t.skip("symlinks not permitted here"); // e.g. Windows without developer mode
    return;
  }
  assert.equal(realInside(out, "link.md"), null);
});
