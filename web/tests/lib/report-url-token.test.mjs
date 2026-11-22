// Parity tests for the web's unwrapReportUrlToken mirror. Imports the core and
// the web copy side by side so they cannot drift, same pattern as
// url-key.test.mjs and normalize-text-key.test.mjs. The cases are the core's
// own (tests/report-url-unwrap.test.mjs, tests/report-url-balanced-paren.test.mjs).
//
// Run:  node --test tests/lib/report-url-token.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unwrapReportUrlToken as webUnwrap } from "../../src/lib/core/report-url-token.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { unwrapReportUrlToken: coreUnwrap } = await import(pathToFileURL(join(ROOT, "tracker-parse.mjs")).href);

const GH = "https://boards.greenhouse.io/acme/jobs/123";
const PAREN = "https://careers.example.test/jobs/7/eng-(remote)";

test("web mirror matches core on autolinks and trailing punctuation", () => {
  const CASES = [
    [`<${GH}>,`, GH],
    [`<${GH}>).`, GH],
    [`<${GH}>`, GH],
    [`${GH},`, GH],
    [GH, GH],
    ["N/A", "N/A"],
  ];
  for (const [input, expected] of CASES) {
    assert.equal(webUnwrap(input), expected, `web: ${input}`);
    assert.equal(webUnwrap(input), coreUnwrap(input), `parity: ${input}`);
  }
});

test("web mirror matches core on balanced and unbalanced parentheses", () => {
  const CASES = [
    // balanced: the `)` belongs to the URL
    [PAREN, PAREN],
    [`${PAREN},`, PAREN],
    [`${PAREN}.`, PAREN],
    [`${PAREN};`, PAREN],
    [`<${PAREN}>`, PAREN],
    [`<${PAREN}>,`, PAREN],
    ["https://example.test/wiki/Foo_(bar)_(baz)", "https://example.test/wiki/Foo_(bar)_(baz)"],
    // unbalanced: the `)` closes a paren wrapping the URL
    [`${PAREN})`, PAREN],
    [`${PAREN}).`, PAREN],
    [`<${PAREN}>).`, PAREN],
    ["https://careers.example.test/jobs/7)", "https://careers.example.test/jobs/7"],
    ["https://careers.example.test/jobs/7)),;", "https://careers.example.test/jobs/7"],
    // an unclosed `(` is not stripped or completed
    ["https://careers.example.test/jobs/7/eng-(remote", "https://careers.example.test/jobs/7/eng-(remote"],
    ["https://careers.example.test/jobs/7/eng-(remote,", "https://careers.example.test/jobs/7/eng-(remote"],
  ];
  for (const [input, expected] of CASES) {
    assert.equal(webUnwrap(input), expected, `web: ${input}`);
    assert.equal(webUnwrap(input), coreUnwrap(input), `parity: ${input}`);
  }
});
