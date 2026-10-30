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
// Run (from web/, as `npm test` does):  node --test tests/lib/core-writer-await.test.mjs
// From the repo root:                   node --test web/tests/lib/core-writer-await.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib", "core", "pipeline.ts");
const src = readFileSync(SRC, "utf8");

// The async writers scan.mjs exports and this snippet drives.
const WRITERS = ["appendToPipeline", "appendToScanHistory"];

// A call is the name followed by `(`, ANYWHERE on the line — not just at the
// start of a statement. Anchoring to the statement start would let every
// non-statement form through unnoticed, and the test would report zero matches
// as a pass:
//   const p = appendToScanHistory(...)   // promise captured, never awaited
//   void appendToScanHistory(...)
//   offers.length && appendToScanHistory(...)
// The import line names the writers without calling them, so it is skipped
// explicitly rather than relying on the `(` to exclude it.
const callRe = (name) => new RegExp(`\\b${name}\\s*\\(`, "g");

/** @returns {{line: number, text: string, awaited: boolean}[]} every call to `name`. */
function callsTo(name) {
  const found = [];
  src.split("\n").forEach((text, i) => {
    if (/^\s*import\b/.test(text)) return;
    for (const m of text.matchAll(callRe(name))) {
      // Awaited only if `await` is the token immediately before the call.
      const before = text.slice(0, m.index);
      found.push({ line: i + 1, text: text.trim(), awaited: /\bawait\s*$/.test(before) });
    }
  });
  return found;
}

test("extractor still finds every core writer call (guards against a rename)", () => {
  for (const name of WRITERS) {
    assert.ok(
      callsTo(name).length > 0,
      `found no call to ${name}() in ${SRC} — it was renamed or the snippet was restructured, ` +
        `so this test is no longer guarding anything. Update WRITERS.`,
    );
  }
});

test("every core writer call is awaited before the success response", () => {
  for (const name of WRITERS) {
    for (const call of callsTo(name)) {
      assert.ok(
        call.awaited,
        `${SRC}:${call.line} calls ${name}() without await:\n    ${call.text}\n` +
          `It is async and takes the shared pipeline lock, so the child can write its success ` +
          `response and exit before the append lands, and a rejection bypasses the surrounding ` +
          `try/catch.`,
      );
    }
  }
});

test("extractor flags non-statement call forms, not just bare statements", () => {
  // Guard the guard: an anchored pattern would score all four of these as
  // "no calls found" and pass. Exercises the same predicate the sweep uses.
  const awaited = (text) => {
    const m = [...text.matchAll(callRe("appendToScanHistory"))][0];
    assert.ok(m, `pattern did not match a call in: ${text}`);
    return /\bawait\s*$/.test(text.slice(0, m.index));
  };
  assert.equal(awaited('    await appendToScanHistory(offers, date, "added");'), true);
  assert.equal(awaited('    appendToScanHistory(offers, date, "added");'), false);
  assert.equal(awaited('    const p = appendToScanHistory(offers, date, "added");'), false);
  assert.equal(awaited('    void appendToScanHistory(offers, date, "added");'), false);
  assert.equal(awaited('    offers.length && appendToScanHistory(offers, date, "added");'), false);
});

test("the handler that runs the writers is async", () => {
  assert.match(
    src,
    /process\.stdin\.on\(\s*["']end["']\s*,\s*async\b/,
    `${SRC}: the stdin "end" handler must be async — a non-async handler cannot await the writers.`,
  );
});
