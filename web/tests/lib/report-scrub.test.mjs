// Tests for the bug reporter's PII / secret scrubber.
//
// The scrubber used to strip only POSIX home directories and `key=`-style
// secrets, so a Windows account name (C:\Users\jdoe) and prefixed tokens with
// nothing in front of them (ghp_…, xoxb-…) went into the public issue as-is.
//
// Run:  node --test tests/lib/report-scrub.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub } from "../../src/lib/report/scrub.mjs";

// test-all's absolute-path check rejects a macOS home-dir literal in tracked
// files, so the POSIX and forward-slash Windows paths are built from this.
const U = "Users";

const leaks = (out, secret) => assert.ok(!out.includes(secret), `still contains ${secret}: ${out}`);

test("scrub: POSIX home directories become ~", () => {
  assert.equal(scrub(`/${U}/jdoe/career-ops/cv.md`), "~/career-ops/cv.md");
  assert.equal(scrub("/home/jdoe/career-ops/cv.md"), "~/career-ops/cv.md");
});

test("scrub: Windows home directories become ~, either slash style", () => {
  assert.equal(scrub("C:\\Users\\jdoe\\career-ops\\cv.md"), "~\\career-ops\\cv.md");
  assert.equal(scrub(`c:/${U}/jdoe/career-ops/cv.md`), "~/career-ops/cv.md");
  assert.equal(scrub("D:\\users\\jdoe\\x"), "~\\x");
  assert.equal(scrub("open 'C:\\Users\\jdoe\\cv.md' failed"), "open '~\\cv.md' failed");
});

test("scrub: a Windows path inside JSON-escaped text is caught", () => {
  const out = scrub('{"path":"C:\\\\Users\\\\jdoe\\\\cv.md"}');
  leaks(out, "jdoe");
});

test("scrub: Windows account names with spaces are removed whole", () => {
  assert.equal(scrub("C:\\Users\\Jane Doe\\cv.md"), "~\\cv.md");
  assert.equal(scrub(`open 'C:/${U}/Jane Doe' failed`), "open '~' failed");
  leaks(scrub('{"path":"C:\\\\Users\\\\Jane Doe\\\\cv.md"}'), "Doe");
  assert.equal(scrub(`/${U}/jdoe failed`), "~ failed");
});

test("scrub: the text after a bare home directory survives", () => {
  assert.equal(
    scrub("/home/jdoe failed to contact https://example.com"),
    "~ failed to contact https://example.com",
  );
  assert.equal(
    scrub(`C:/${U}/jdoe failed to contact https://example.com`),
    "~ failed to contact https://example.com",
  );
  assert.equal(scrub("C:\\Users\\jdoe failed to read C:\\tmp"), "~ failed to read C:\\tmp");
});

test("scrub: an apostrophe inside a Windows account name is part of it", () => {
  assert.equal(scrub("C:\\Users\\O'Brien\\cv.md"), "~\\cv.md");
  assert.equal(scrub("open 'C:\\Users\\jdoe' failed"), "open '~' failed");
});

test("scrub: a POSIX account name keeps its backslashes", () => {
  assert.equal(scrub("/home/jane\\doe/cv.md"), "~/cv.md");
});

test("scrub: a JSON escape ends a POSIX account name", () => {
  assert.equal(scrub('{"message":"/home/jdoe\\nEACCES"}'), '{"message":"~\\nEACCES"}');
  assert.equal(scrub('{"path":"/home/jdoe\\"}'), '{"path":"~\\"}');
});

test("scrub: a JSON \\u escape inside a POSIX account name is part of it", () => {
  assert.equal(scrub('{"path":"/home/\\u006aane/cv.md"}'), '{"path":"~/cv.md"}');
  assert.equal(scrub('{"path":"/home/j\\u0061ne\\nEACCES"}'), '{"path":"~\\nEACCES"}');
});

test("scrub: a Windows name with spaces is removed whole across mixed separators", () => {
  assert.equal(scrub("C:\\Users\\Jane Doe/cv.md"), "~/cv.md");
  assert.equal(scrub(`C:/${U}/Jane Doe\\cv.md`), "~\\cv.md");
});

test("scrub: prefixed tokens are redacted with nothing in front of them", () => {
  for (const tok of [
    "ghp_abcdefghijklmnopqrstuvwx0123",
    "gho_abcdefghijklmnopqrstuvwx0123",
    "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
    "xoxb-1234567890-abcdefghijkl",
    "AKIAIOSFODNN7EXAMPLE",
  ]) {
    const out = scrub(`failed with ${tok} in header`);
    leaks(out, tok);
    assert.equal(out, "failed with [redacted] in header");
  }
});

test("scrub: keyed secrets are still redacted", () => {
  assert.equal(scrub("sk-ant-api03-abcdefghijk"), "sk-[redacted]");
  assert.equal(scrub("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc"), "Authorization: Bearer [redacted]");
  assert.equal(scrub("GITHUB_TOKEN=abcdefghij12"), "GITHUB_TOKEN=[redacted]");
  assert.equal(scrub("secret_key=abcdefghij12"), "secret_key=[redacted]");
  assert.equal(scrub("x-api-key: abcdefghij12"), "x-api-key: [redacted]");
  assert.equal(scrub("accessToken=AbCdEfGhIjKlMnOp1234"), "accessToken=[redacted]");
  assert.equal(scrub("clientSecret=AbCdEfGhIjKlMnOp1234"), "clientSecret=[redacted]");
  assert.equal(scrub('{"refresh_token":"AbCdEfGhIjKl"}'), '{"refresh_token":"[redacted]"}');
});

test("scrub: ordinary text is left alone", () => {
  for (const s of [
    "the task-12345678 failed",
    "monkey: bananas-and-more",
    "ghp is not a token, nor is ghp_short",
    "xoxo hugs",
    "C:\\Program Files\\career-ops\\node.exe",
    "/users/settings",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  ]) {
    assert.equal(scrub(s), s);
  }
});

test("scrub: empty input", () => {
  assert.equal(scrub(""), "");
  assert.equal(scrub(undefined), "");
});
