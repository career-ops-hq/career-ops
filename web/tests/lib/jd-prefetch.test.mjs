// Tests for the server-side JD prefetch that runs before an evaluate worker.
//
// Run:  node --test tests/lib/jd-prefetch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { prefetchJd, postingUrlFrom, isTruncatedJd, MIN_PREFETCH_JD_CHARS } from "../../src/lib/jd-prefetch.mjs";

const JD = "Responsibilities include building and operating services. ".repeat(20);
const ok = (stdout) => async () => ({ code: 0, stdout, timedOut: false, spawnFailed: false });

test("postingUrlFrom accepts http(s) URLs only", () => {
  assert.equal(postingUrlFrom("https://careers.example.com/job/1"), "https://careers.example.com/job/1");
  assert.equal(postingUrlFrom("  http://example.com/j  "), "http://example.com/j");
  for (const bad of ["018", "local:jds/acme.md", "file:///etc/passwd", "javascript:alert(1)", "", null, undefined, 7]) {
    assert.equal(postingUrlFrom(bad), null, String(bad));
  }
});

test("prefetchJd runs fetch-jd with the URL as a single argv entry and returns the text", async () => {
  const seen = [];
  const jd = await prefetchJd("https://careers.example.com/job/1?x=1&y=$(id)", async (script, args) => {
    seen.push([script, args]);
    return { code: 0, stdout: `${JD}\n`, timedOut: false, spawnFailed: false };
  });
  assert.equal(jd.text, JD.trim());
  assert.equal(jd.closedEvidence, null);
  assert.deepEqual(seen, [["fetch-jd", ["https://careers.example.com/job/1?x=1&y=$(id)"]]]);
});

test("prefetchJd does not run anything for a non-URL input", async () => {
  let called = false;
  assert.equal((await prefetchJd("018", async () => { called = true; return { code: 0, stdout: JD }; })).text, null);
  assert.equal(called, false);
});

test("prefetchJd returns null on a miss, so the worker falls back to WebFetch", async () => {
  const url = "https://careers.example.com/job/1";
  assert.equal((await prefetchJd(url, async () => ({ code: 1, stdout: "" }))).text, null);
  assert.equal((await prefetchJd(url, async () => ({ code: 0, stdout: JD, timedOut: true }))).text, null);
  assert.equal((await prefetchJd(url, async () => ({ code: -1, stdout: "", spawnFailed: true }))).text, null);
});

test("prefetchJd refuses a stub shorter than the floor", async () => {
  const url = "https://careers.example.com/job/1";
  assert.equal((await prefetchJd(url, ok("x".repeat(MIN_PREFETCH_JD_CHARS - 1)))).text, null);
  assert.ok((await prefetchJd(url, ok("x".repeat(MIN_PREFETCH_JD_CHARS)))).text);
});

test("prefetchJd never throws", async () => {
  assert.deepEqual(await prefetchJd("https://careers.example.com/job/1", async () => { throw new Error("boom"); }), { text: null, closedEvidence: null });
});

test("prefetchJd carries a closed posting (fetch-jd exit 3) instead of treating it as a plain miss", async () => {
  const url = "https://careers.example.com/job/1";
  const closed = await prefetchJd(url, async () => ({ code: 3, stdout: "CLOSED_POSTING JobPosting validThrough 2026-10-01T00:00:00Z" }));
  assert.deepEqual(closed, { text: null, closedEvidence: "JobPosting validThrough 2026-10-01T00:00:00Z" });
});

test("prefetchJd accepts closure evidence that contains a newline", async () => {
  const out = await prefetchJd("https://careers.example.com/job/1", async () => ({ code: 3, stdout: "CLOSED_POSTING page text: line one\nline two" }));
  assert.equal(out.closedEvidence, "page text: line one\nline two");
});

test("isTruncatedJd spots the cut notice and nothing else", () => {
  assert.equal(isTruncatedJd("text\n\n[Job description truncated here: the posting is longer than 20000 characters. This text is NOT the complete job description.]"), true);
  assert.equal(isTruncatedJd("a full description"), false);
  assert.equal(isTruncatedJd(null), false);
});

test("prefetchJd ignores an exit 3 whose output is not the closed-posting line", async () => {
  const url = "https://careers.example.com/job/1";
  assert.deepEqual(await prefetchJd(url, async () => ({ code: 3, stdout: "something else" })), { text: null, closedEvidence: null });
  assert.deepEqual(await prefetchJd(url, async () => ({ code: 3, stdout: "" })), { text: null, closedEvidence: null });
});

test("prefetchJd does not start when the request is already aborted, and passes the signal to the child", async () => {
  const url = "https://careers.example.com/job/1";
  const aborted = AbortSignal.abort();
  let ran = false;
  assert.deepEqual(await prefetchJd(url, async () => { ran = true; return { code: 0, stdout: JD }; }, aborted), { text: null, closedEvidence: null });
  assert.equal(ran, false);

  const controller = new AbortController();
  let received;
  await prefetchJd(url, async (_s, _a, opts) => { received = opts?.signal; return { code: 0, stdout: JD }; }, controller.signal);
  assert.equal(received, controller.signal, "the run must be able to kill the child on abort");
});
