// The PDF path in src/app/api/run/route.ts deletes its scratch dir in a
// finally, then close()s the stream. close() also drops the tracker-write
// guard. fs.rmSync({ force: true }) still throws on EPERM and EBUSY, so an
// unguarded delete skips close() and the next PDF run waits on a guard that
// never comes back.
//
// The handler's start() closure is not importable, so this reads the source
// and asserts the shape. Same discipline as drive-stream-close.test.mjs:
// every anchor is asserted to exist first.

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
  "run",
  "route.ts",
);
const src = readFileSync(SRC, "utf8");

function blockBody(openBraceAt) {
  let depth = 0;
  for (let i = openBraceAt; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openBraceAt + 1, i);
    }
  }
  return "";
}

function pdfScratchFinally() {
  const rmAt = src.indexOf("fs.rmSync(scratchDir");
  assert.ok(rmAt > 0, "route.ts no longer deletes scratchDir");
  const finallyAt = src.lastIndexOf("} finally {", rmAt);
  assert.ok(finallyAt > 0, "scratch delete is not inside a finally");
  const body = blockBody(src.indexOf("{", finallyAt));
  assert.ok(body.includes("close()"), "that finally no longer calls close()");
  return body;
}

test("self-check: the PDF scratch finally still exists", () => {
  assert.match(src, /fs\.rmSync\(scratchDir/, "route.ts no longer deletes scratchDir");
  assert.match(src, /pdfRenderPromise = withSharedPdfPath/, "route.ts no longer renders inside the shared PDF path");
  pdfScratchFinally();
});

test("a scratch delete that throws still reaches close()", () => {
  const body = pdfScratchFinally();
  const rmAt = body.indexOf("fs.rmSync(scratchDir");
  const tryAt = body.lastIndexOf("try {", rmAt);
  const catchAt = body.indexOf("} catch", rmAt);
  assert.ok(tryAt >= 0 && tryAt < rmAt, "rmSync(scratchDir) must sit inside its own try");
  assert.ok(catchAt > rmAt, "the scratch try must have a catch, or a throw still skips close()");
  const guarded = body.slice(tryAt, catchAt);
  assert.equal(guarded.includes("close("), false, "close() inside the scratch try is skipped when rmSync throws");
  const afterCatch = body.slice(catchAt);
  assert.match(afterCatch, /finally\s*\{[^}]*close\(\)/, "close() must sit in a nested finally after the scratch catch");
});
