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
  assert.deepEqual(seen, [["fetch-jd", ["https://careers.example.com/job/1?x=1&y=$(id)", "--visible"]]]);
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

test("prefetchJd asks fetch-jd for visible text in one run, never a second fetch (#7507)", async () => {
  const url = "https://careers.example.com/job/1";
  for (const res of [{ code: 0, stdout: JD }, { code: 1, stdout: "" }, { code: 1, stdout: "", timedOut: true }, { code: -1, stdout: "", spawnFailed: true }, { code: 3, stdout: "CLOSED_POSTING gone" }]) {
    const seen = [];
    // Only fetch-jd calls are counted here; the browser tier has its own tests below.
    await prefetchJd(url, async (script, args) => { if (script === "fetch-jd") seen.push(args); return res; });
    assert.deepEqual(seen, [[url, "--visible"]]);
  }
});

test("prefetchJd stays a miss when fetch-jd misses", async () => {
  const out = await prefetchJd("https://careers.example.com/job/1", async () => ({ code: 1, stdout: "" }));
  assert.deepEqual(out, { text: null, closedEvidence: null });
});

// ── #7507: a last server-side read in a browser when both fetch-jd reads miss ──

const BROWSER_JD = "Process improvement specialist. You will map, measure and improve our operations workflows across teams. ".repeat(12);
const browserOk = (text, extra = {}) => ({ code: 0, stdout: JSON.stringify({ url: urlJ, title: "Careers", text, ...extra }), timedOut: false, spawnFailed: false });
const urlJ = "https://jobs.example.com/job/1";

/** A runner that records calls: fetch-jd answers `fetchRes`, browser-extract answers `browserRes`. */
function runner(fetchRes, browserRes) {
  const calls = [];
  const run = async (script, args) => {
    calls.push([script, args]);
    return script === "fetch-jd" ? fetchRes : browserRes;
  };
  return { run, calls };
}

test("prefetchJd falls back to a browser read when fetch-jd misses", async () => {
  const { run, calls } = runner({ code: 1, stdout: "" }, browserOk(BROWSER_JD));
  const out = await prefetchJd(urlJ, run);
  assert.equal(out.text, BROWSER_JD.trim());
  assert.equal(out.closedEvidence, null);
  assert.deepEqual(calls.map((c) => c[0]), ["fetch-jd", "browser-extract"]);
  assert.deepEqual(calls[1][1].slice(0, 3), [urlJ, "--mode", "jd"]);
});

test("prefetchJd does not open a browser when fetch-jd already answered, timed out, failed to start or saw a closed posting", async () => {
  for (const res of [{ code: 0, stdout: JD }, { code: 1, stdout: "", timedOut: true }, { code: -1, stdout: "", spawnFailed: true }, { code: 3, stdout: "CLOSED_POSTING gone" }]) {
    const { run, calls } = runner(res, browserOk(BROWSER_JD));
    await prefetchJd(urlJ, run);
    assert.deepEqual(calls.map((c) => c[0]), ["fetch-jd"], JSON.stringify(res));
  }
});

test("prefetchJd does not open a browser for a request that was aborted", async () => {
  const controller = new AbortController();
  const { run, calls } = runner({ code: 1, stdout: "" }, browserOk(BROWSER_JD));
  const wrapped = async (script, args, opts) => { const r = await run(script, args, opts); controller.abort(); return r; };
  const out = await prefetchJd(urlJ, wrapped, controller.signal);
  assert.deepEqual(out, { text: null, closedEvidence: null });
  assert.deepEqual(calls.map((c) => c[0]), ["fetch-jd"]);
});

test("prefetchJd stays a miss when the browser read fails, times out, is not JSON or is too short", async () => {
  const bad = [
    { code: 1, stdout: "" },
    { code: 1, stdout: JSON.stringify({ error: "x", code: "navigation_error" }) },
    { code: 0, stdout: "not json" },
    { code: 0, stdout: JSON.stringify({ text: "Too short to be a posting." }) },
    { code: 0, stdout: JSON.stringify({ text: "word ".repeat(60) }) }, // 300 chars, under the floor
    { code: 1, stdout: "", timedOut: true },
    { code: -1, stdout: "", spawnFailed: true },
    { code: 0, stdout: JSON.stringify({ text: 12345 }) },
  ];
  for (const b of bad) {
    const { run } = runner({ code: 1, stdout: "" }, b);
    assert.deepEqual(await prefetchJd(urlJ, run), { text: null, closedEvidence: null }, JSON.stringify(b).slice(0, 60));
  }
});

test("prefetchJd refuses a browser read with too few words even when it is long", async () => {
  const { run } = runner({ code: 1, stdout: "" }, browserOk("x".repeat(900)));
  assert.deepEqual(await prefetchJd(urlJ, run), { text: null, closedEvidence: null });
});

test("prefetchJd marks a browser read that hit the length cap as truncated", async () => {
  // browser-extract cuts at the cap and appends "…", so a cut text is one character over it.
  const long = "Responsibilities and requirements for this role. ".repeat(500);
  const { run } = runner({ code: 1, stdout: "" }, browserOk(`${long.slice(0, 20_000)}…`));
  const out = await prefetchJd(urlJ, run);
  assert.ok(isTruncatedJd(out.text), "the route refuses a partial posting");
});

test("prefetchJd asks the browser for a bounded read and passes the abort signal", async () => {
  const controller = new AbortController();
  let seenArgs; let seenSignal;
  const run = async (script, args, opts) => {
    if (script === "fetch-jd") return { code: 1, stdout: "" };
    seenArgs = args; seenSignal = opts?.signal;
    return browserOk(BROWSER_JD);
  };
  await prefetchJd(urlJ, run, controller.signal);
  assert.ok(seenArgs.includes("--timeout") && seenArgs.includes("--max-chars"));
  assert.equal(seenSignal, controller.signal);
});

test("prefetchJd runs at most two browser reads at once and finishes them all", async () => {
  let active = 0; let peak = 0;
  const run = async (script, args) => {
    if (script === "fetch-jd") return { code: 1, stdout: "" };
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return browserOk(BROWSER_JD, { url: args[0] });
  };
  const outs = await Promise.all(Array.from({ length: 6 }, (_, i) => prefetchJd(`https://jobs.example.com/job/${i}`, run)));
  assert.equal(outs.filter((o) => o.text).length, 6);
  assert.ok(peak <= 2, `peak was ${peak}`);
});

test("prefetchJd does not mark a browser read of exactly the cap as truncated", async () => {
  const exact = "Responsibilities and requirements for this role. ".repeat(500).slice(0, 20_000);
  const { run } = runner({ code: 1, stdout: "" }, browserOk(exact));
  const out = await prefetchJd(urlJ, run);
  assert.ok(out.text && !isTruncatedJd(out.text));
});

test("prefetchJd treats a browser read that landed on another page as a miss", async () => {
  for (const finalUrl of ["https://jobs.example.com/search", "https://other.example.org/job/1", "https://jobs.example.com/"]) {
    const { run } = runner({ code: 1, stdout: "" }, browserOk(BROWSER_JD, { url: finalUrl }));
    assert.deepEqual(await prefetchJd(urlJ, run), { text: null, closedEvidence: null }, finalUrl);
  }
  // Same page: www, trailing slash, query and fragment differences are not a redirect.
  for (const finalUrl of ["https://www.jobs.example.com/job/1/", "https://jobs.example.com/job/1?utm_source=x#top"]) {
    const { run } = runner({ code: 1, stdout: "" }, browserOk(BROWSER_JD, { url: finalUrl }));
    assert.ok((await prefetchJd(urlJ, run)).text, finalUrl);
  }
});

test("prefetchJd releases its browser slot when the read throws", async () => {
  let throwing = true; let calls = 0;
  const run = async (script) => {
    if (script === "fetch-jd") return { code: 1, stdout: "" };
    calls++;
    if (throwing) throw new Error("boom");
    return browserOk(BROWSER_JD);
  };
  for (let i = 0; i < 5; i++) assert.deepEqual(await prefetchJd(urlJ, run), { text: null, closedEvidence: null });
  throwing = false;
  const a = await Promise.all([prefetchJd(urlJ, run), prefetchJd(urlJ, run), prefetchJd(urlJ, run)]);
  assert.equal(a.filter((o) => o.text).length, 3, "all slots were free again");
  assert.equal(calls, 8);
});

test("prefetchJd: a request aborted while it waits for a browser slot never starts a browser", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const started = [];
  const run = async (script, args) => {
    if (script === "fetch-jd") return { code: 1, stdout: "" };
    started.push(args[0]);
    await gate;
    return browserOk(BROWSER_JD);
  };
  const first = [prefetchJd("https://jobs.example.com/a", run), prefetchJd("https://jobs.example.com/b", run)];
  await new Promise((r) => setTimeout(r, 10));
  const controller = new AbortController();
  const queued = prefetchJd("https://jobs.example.com/c", run, controller.signal);
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  assert.deepEqual(await queued, { text: null, closedEvidence: null });
  release();
  await Promise.all(first);
  assert.deepEqual(started.sort(), ["https://jobs.example.com/a", "https://jobs.example.com/b"]);
});

test("the browser read's truncation notice is the one lib/jd-page-fetch.mjs writes", async () => {
  const { TRUNCATION_NOTICE } = await import("../../../lib/jd-page-fetch.mjs");
  const long = `${"Responsibilities and requirements for this role. ".repeat(500).slice(0, 20_000)}…`;
  const { run } = runner({ code: 1, stdout: "" }, browserOk(long));
  const out = await prefetchJd(urlJ, run);
  assert.ok(out.text.endsWith(TRUNCATION_NOTICE(20_000)));
});
