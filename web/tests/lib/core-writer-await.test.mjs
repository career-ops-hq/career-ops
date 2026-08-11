// Guards the child-process snippet in src/lib/core/pipeline.ts that calls the
// core's canonical writers (appendToPipeline, appendToScanHistory from scan.mjs).
//
// Both writers are async and both take the shared pipeline lock. The snippet
// runs them from a `process.stdin.on("end", ...)` handler and then writes the
// success response — so an unawaited call lets the child report `added: N` and
// exit while the lock is still being acquired, and the append never lands. The
// synchronous try/catch does not see the rejection either, so a failed write is
// reported as a success. Nothing downstream retries.
//
// pipeline.ts is TypeScript and the snippet is a template string, so it cannot
// be imported and exercised here — this reads the source and asserts the shape
// instead. Same approach as tests/states-alias-coverage.test.mjs: the extractor
// self-checks, so an edit that renames the writers fails loudly rather than
// silently matching nothing.
//
// Run:  node --test tests/lib/core-writer-await.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib", "core", "pipeline.ts");
const src = readFileSync(SRC, "utf8");

// The async writers scan.mjs exports and this snippet drives.
const WRITERS = ["appendToPipeline", "appendToScanHistory"];

// A call to one of them at the start of a statement: optional `await `, then the
// name, then `(`. Anchored to the line so the import line never matches.
const callRe = (name) => new RegExp(`^\\s*(await\\s+)?${name}\\s*\\(`, "gm");

test("extractor still finds every core writer call (guards against a rename)", () => {
  for (const name of WRITERS) {
    const calls = [...src.matchAll(callRe(name))];
    assert.ok(
      calls.length > 0,
      `found no call to ${name}() in ${SRC} — it was renamed or the snippet was restructured, ` +
        `so this test is no longer guarding anything. Update WRITERS.`,
    );
  }
});

test("every core writer call is awaited before the success response", () => {
  for (const name of WRITERS) {
    for (const m of src.matchAll(callRe(name))) {
      const line = src.slice(0, m.index).split("\n").length;
      assert.ok(
        m[1],
        `${SRC}:${line} calls ${name}() without await. It is async and takes the shared ` +
          `pipeline lock, so the child can write its success response and exit before the ` +
          `append lands, and a rejection bypasses the surrounding try/catch.`,
      );
    }
  }
});

test("the handler that runs the writers is async", () => {
  assert.match(
    src,
    /process\.stdin\.on\(\s*["']end["']\s*,\s*async\b/,
    `${SRC}: the stdin "end" handler must be async — a non-async handler cannot await the writers.`,
  );
});
