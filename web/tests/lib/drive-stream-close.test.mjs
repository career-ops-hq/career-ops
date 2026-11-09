// Guards the ReadableStream in src/app/api/apply/drive/route.ts (issue #3966).
//
// The stream's `start(controller)` wraps the whole drive in try/catch/finally
// and closes the controller in the `finally`. Two success paths inside the
// `try` also closed it and then returned -- and a `return` runs the `finally`,
// so those paths closed twice. The second close throws
// `TypeError: Invalid state: Controller is already closed` (ERR_INVALID_STATE)
// out of an async `start`, which Next.js surfaces as `failed to pipe response`
// and a 500 after the body has already been streamed.
//
// It was the two SUCCESS paths that were wrong -- the error path returned
// through the `finally` alone and was fine -- which is why it only showed up
// once the agent actually reached and filled a form.
//
// route.ts is TypeScript inside a Next.js route and its `start` closure cannot
// be imported and exercised here, so this reads the source and asserts the
// shape instead. Same approach, and the same self-checking discipline, as
// tests/lib/core-writer-await.test.mjs: every anchor this test relies on is
// asserted to exist first, so a rename or a refactor fails loudly instead of
// matching nothing and passing.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/drive-stream-close.test.mjs
// From the repo root:                   node --test web/tests/lib/drive-stream-close.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "app",
  "api",
  "apply",
  "drive",
  "route.ts",
);
const src = readFileSync(SRC, "utf8");

/**
 * The `try { ... } finally { ... }` inside `start`, split into its two halves.
 *
 * Located by the `finally` that closes the controller rather than by brace
 * counting: the body is full of nested braces and object literals, and a
 * counter that drifts would silently redefine what "inside the try" means.
 */
function tryAndFinally() {
  const finallyRe = /\n(\s*)\} finally \{\n([\s\S]*?)\n\1\}\n/;
  const m = src.match(finallyRe);
  assert.ok(m, "could not find the `} finally {` block in route.ts — did the stream stop using try/finally?");
  return { beforeFinally: src.slice(0, m.index), finallyBody: m[2] };
}

const closeRe = /\bcontroller\s*\.\s*close\s*\(/g;
const count = (s) => (s.match(closeRe) ?? []).length;

test("self-check: the anchors this test reads still exist", () => {
  assert.match(src, /new ReadableStream/, "route.ts no longer builds a ReadableStream");
  assert.match(src, /async start\(controller\)/, "route.ts no longer has an `async start(controller)`");
  assert.ok(count(src) > 0, "route.ts never closes the controller — the test would pass vacuously");
});

test("the controller is closed only in the finally, never on a path that returns through it", () => {
  const { beforeFinally, finallyBody } = tryAndFinally();

  assert.equal(
    count(finallyBody),
    1,
    "the finally must close the controller exactly once — it is the single exit for every path",
  );

  // Every `return` in the try runs the finally on its way out, so any close
  // before it is the first of two. This is the assertion that actually fails
  // on the #3966 bug.
  assert.equal(
    count(beforeFinally),
    0,
    `controller.close() is called ${count(beforeFinally)} time(s) before the finally; ` +
      "each one double-closes, because the `return` that follows runs the finally too. " +
      "Let the finally do it.",
  );
});

test("the success paths still return, so the finally is what closes them", () => {
  const { beforeFinally } = tryAndFinally();
  // Guards the other way a fix could go wrong: dropping the `return`s along
  // with the closes would fall through into the "didn't reach a form" branch
  // and emit an error after a `done`.
  const returns = (beforeFinally.match(/\n\s+return;\n/g) ?? []).length;
  assert.ok(
    returns >= 2,
    `expected the two success paths to still return early, found ${returns} bare \`return;\` in the try`,
  );
});
