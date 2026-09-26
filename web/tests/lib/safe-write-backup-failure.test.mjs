import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteWithBackup } from "../../src/lib/core/safe-write.ts";

function fixture(t, content = "ORIGINAL\n") {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "web-backup-failure-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "cv.md");
  if (content !== undefined) fs.writeFileSync(file, content);
  return { dir, file };
}

for (const code of ["EACCES", "ENOSPC", "ENOENT"]) {
  test(`backup write ${code} preserves the original and propagates`, (t) => {
    const { dir, file } = fixture(t);
    const originalWrite = fs.writeFileSync;
    const error = Object.assign(new Error(`backup ${code}`), { code });
    t.mock.method(fs, "writeFileSync", (target, ...args) => {
      if (String(target).startsWith(`${file}.bak-`)) throw error;
      return originalWrite(target, ...args);
    });
    assert.throws(() => atomicWriteWithBackup(file, "REPLACED"), (e) => e === error);
    assert.equal(fs.readFileSync(file, "utf8"), "ORIGINAL\n");
    assert.deepEqual(fs.readdirSync(dir), ["cv.md"]);
  });
}

test("an unreadable existing source is not treated as missing", (t) => {
  const { dir, file } = fixture(t);
  const originalRead = fs.readFileSync;
  const error = Object.assign(new Error("source EACCES"), { code: "EACCES" });
  t.mock.method(fs, "readFileSync", (target, ...args) => {
    if (target === file) throw error;
    return originalRead(target, ...args);
  });
  assert.throws(() => atomicWriteWithBackup(file, "REPLACED"), (e) => e === error);
  assert.equal(originalRead(file, "utf8"), "ORIGINAL\n");
  assert.deepEqual(fs.readdirSync(dir), ["cv.md"]);
});

test("a missing source is created without a backup", (t) => {
  const { dir, file } = fixture(t);
  fs.unlinkSync(file);
  assert.equal(atomicWriteWithBackup(file, "CREATED"), null);
  assert.equal(fs.readFileSync(file, "utf8"), "CREATED");
  assert.deepEqual(fs.readdirSync(dir), ["cv.md"]);
});

test("an empty source keeps the existing no-backup behavior", (t) => {
  const { file } = fixture(t, "");
  assert.equal(atomicWriteWithBackup(file, "CREATED"), null);
  assert.equal(fs.readFileSync(file, "utf8"), "CREATED");
});

test("successful replacement backs up the exact original bytes", (t) => {
  const original = Buffer.from("# Fixture\r\n\r\nOriginal \xfftext.\n", "latin1");
  const { file } = fixture(t, original);
  const backup = atomicWriteWithBackup(file, "REPLACED");
  assert.ok(backup);
  assert.deepEqual(fs.readFileSync(backup), original);
  assert.equal(fs.readFileSync(file, "utf8"), "REPLACED");
});
