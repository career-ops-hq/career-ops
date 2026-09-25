// Guards atomicWrite() in src/lib/core/safe-write.ts — "THE one place every
// user-layer write goes through", per its own header.
//
// It writes a temp file next to the destination and renames it into place. The
// temp file therefore holds a byte-for-byte copy of what is about to become
// cv.md / config/profile.yml / portals.yml / data/follow-ups.md. That is fine
// while the rename succeeds and the file lives for microseconds.
//
// A rename that THROWS is where it stops being fine, and it does throw: Windows
// refuses a rename whose destination is open by anyone else at that instant and
// answers EPERM/EACCES/EBUSY (the class #3006 fixed and #3046 catalogued across
// five more files), and ENOSPC and a read-only mount reach the same place. With
// no catch, the copy of the user's CV survives — one per failure, forever,
// since nothing else ever removes it.
//
// The core's writeFileAtomic (tracker-utils.mjs) has always had that catch. This
// pins the same two properties here:
//
//   1. the rename is inside a try whose catch removes the temp file, and
//   2. the error is rethrown, so a failed write is never reported as success.
//
// safe-write.ts is TypeScript and cannot be imported by node --test, so this
// reads the source and asserts the shape — the approach core-writer-await.test.mjs
// already uses for pipeline.ts. The extractor self-checks, so a rename of the
// function fails loudly rather than silently matching nothing.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/safe-write-temp-cleanup.test.mjs
// From the repo root:                   node --test web/tests/lib/safe-write-temp-cleanup.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib", "core", "safe-write.ts");
const src = readFileSync(SRC, "utf8");

/** The body of `export function atomicWrite(...)`, brace-matched. */
function atomicWriteBody() {
  const start = src.indexOf("export function atomicWrite");
  assert.notEqual(start, -1, "atomicWrite is gone or renamed — this guard is matching nothing");
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("unbalanced braces in atomicWrite");
}

test("extractor still finds atomicWrite and its rename (guards against a rename)", () => {
  const body = atomicWriteBody();
  assert.match(body, /renameSync\s*\(/, "atomicWrite no longer renames — re-read this guard before deleting it");
  assert.match(body, /writeFileSync\s*\(/, "atomicWrite no longer writes a temp file");
});

test("the rename is inside a try that removes the temp file", () => {
  const body = atomicWriteBody();
  const tryAt = body.indexOf("try");
  const renameAt = body.search(/renameSync\s*\(/);
  assert.notEqual(tryAt, -1, "atomicWrite has no try/catch: a failed rename leaks a copy of the user's file");
  assert.ok(tryAt < renameAt, "the rename happens outside the try, so its failure is not caught");

  const catchAt = body.indexOf("catch", renameAt);
  assert.notEqual(catchAt, -1, "no catch after the rename");
  const handler = body.slice(catchAt);
  assert.match(handler, /rmSync\s*\([^)]*\bforce\s*:\s*true/s,
    "the catch does not rmSync the temp file with force:true — the copy survives");
});

test("a failed write is rethrown, never swallowed", () => {
  // Cleaning up and returning normally would be worse than the leak: the route
  // answers 200 and the user believes their edit was saved.
  const body = atomicWriteBody();
  const catchAt = body.indexOf("catch", body.search(/renameSync\s*\(/));
  const binding = /catch\s*\(\s*([A-Za-z_$][\w$]*)/.exec(body.slice(catchAt))?.[1];
  assert.ok(binding, "the write catch does not bind the error, so it cannot rethrow it");
  assert.match(
    body.slice(catchAt),
    new RegExp(`\\bthrow\\s+${binding}\\b`),
    "the catch does not rethrow the original error — a lost write reads as a successful save",
  );
});

test("a cleanup failure cannot replace the error the caller needs", () => {
  // `force: true` suppresses ENOENT and nothing else — not EPERM/EBUSY, which is
  // the same contention that got us into this branch and can hold the temp file
  // too. An unguarded rmSync would then surface a second-order complaint about a
  // file the caller never asked about, in place of "rename failed: EPERM". The
  // leaked copy is there either way; the diagnosis is what is worth protecting.
  const body = atomicWriteBody();
  const rmAt = body.search(/rmSync\s*\(/);
  assert.notEqual(rmAt, -1, "no rmSync to guard");
  // The rm must sit inside a try of its own, opened after the outer catch.
  const catchAt = body.indexOf("catch", body.search(/renameSync\s*\(/));
  const innerTry = body.indexOf("try", catchAt);
  assert.ok(innerTry !== -1 && innerTry < rmAt, "rmSync is not inside its own try — it can mask the write error");
  assert.notEqual(body.indexOf("catch", rmAt), -1, "the cleanup try has no catch");
});

test("the temp file is named in the shape .gitignore actually covers", () => {
  // Both intermediate shapes safe-write.ts produces have to stay unstageable,
  // which is what tests/user-layer-gitignored.test.mjs probes. The name is
  // asserted here so the two files cannot drift apart silently: a new shape
  // introduced here without a matching rule there is a PII leak into `git add .`.
  const body = atomicWriteBody();
  assert.match(body, /\.tmp/, "the temp file no longer ends in .tmp — update .gitignore's `*.tmp*` rule and its probes");
});
