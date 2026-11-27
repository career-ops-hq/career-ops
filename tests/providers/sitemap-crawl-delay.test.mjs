// tests/providers/sitemap-crawl-delay.test.mjs — a robots.txt Crawl-delay is a
// pace the host asked for, and it is honoured as stated.
//
// `robotsAllows()` returns `crawlDelay` (seconds, or null) for our product token,
// and the sitemap provider paced every host at a fixed 250 ms regardless. Two
// rules follow from taking the statement seriously:
//
//   - the stated delay is never shortened. Pacing faster than the host asked is
//     how a user agent gets blocked, so a value too long to honour refuses the
//     board rather than being trimmed to something the host never agreed to. That
//     matches harvest-buildlist.mjs and its MAX_CRAWL_DELAY_S.
//   - the gap is between individual requests, not between groups of them. A
//     parallel batch starts its members together, so the host sees three requests
//     with no gap and then a pause.
//
// Run:  node --test tests/providers/sitemap-crawl-delay.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const { detailPaceMs, crawlDelayRefusal, paceRequests, MAX_CRAWL_DELAY_S } = await import(
  pathToFileURL(join(ROOT, "providers/sitemap.mjs")).href
);

const DEFAULT_PACE = 250;

test("no stated Crawl-delay keeps the default pace", () => {
  assert.equal(detailPaceMs({ crawlDelay: null }), DEFAULT_PACE);
  assert.equal(detailPaceMs({}), DEFAULT_PACE);
  assert.equal(detailPaceMs(undefined), DEFAULT_PACE);
  assert.equal(detailPaceMs({ crawlDelay: 0 }), DEFAULT_PACE);
});

test("a stated Crawl-delay is used as given", () => {
  assert.equal(detailPaceMs({ crawlDelay: 1 }), 1_000);
  assert.equal(detailPaceMs({ crawlDelay: 2.5 }), 2_500);
  assert.equal(detailPaceMs({ crawlDelay: MAX_CRAWL_DELAY_S }), MAX_CRAWL_DELAY_S * 1_000);
});

test("a sub-millisecond statement never speeds the pace up", () => {
  // Crawl-delay 0.1 is 100 ms, below the floor this provider already applies.
  assert.equal(detailPaceMs({ crawlDelay: 0.1 }), DEFAULT_PACE);
});

test("a delay at the limit is honoured, not refused", () => {
  assert.equal(crawlDelayRefusal({ crawlDelay: MAX_CRAWL_DELAY_S }), null);
  assert.equal(crawlDelayRefusal({ crawlDelay: 5 }), null);
  assert.equal(crawlDelayRefusal({ crawlDelay: null }), null);
  assert.equal(crawlDelayRefusal({}), null);
});

test("a delay past the limit refuses the board instead of being shortened", () => {
  const why = crawlDelayRefusal({ crawlDelay: 86_400 });
  assert.match(why, /86400s/);
  assert.match(why, new RegExp(`${MAX_CRAWL_DELAY_S}s`));

  // The pace function still reports what the host asked for. Nothing shortens it
  // and then fetches anyway; the caller refuses before it gets that far.
  assert.equal(detailPaceMs({ crawlDelay: 86_400 }), 86_400_000);
  assert.notEqual(crawlDelayRefusal({ crawlDelay: MAX_CRAWL_DELAY_S + 1 }), null);
});
test("the paced view leaves the stated gap before every request after the first", async () => {
  // The gap is a property of the host, not of one kind of request, so the root
  // sitemap, each child sitemap and each detail page all pass through this. The
  // sleep is injected, so the case asserts the wait it asks for without waiting.
  // paceRequests reads Date.now(), so the clock is faked too: the stubbed sleep
  // advances it by the wait it was asked for, and a slow CI runner cannot add
  // time between two requests.
  const realNow = Date.now;
  // paceRequests starts with last = 0, so the clock starts well above the gap;
  // otherwise the first request would look like it still has to wait.
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    const calls = [];
    const waits = [];
    const ctx = {
      async fetchText(url) { calls.push(url); return "x"; },
      async sleep(ms) { waits.push(ms); clock += ms; },
    };

    const paced = paceRequests(ctx, 1_000);
    await paced.fetchText("root");
    await paced.fetchText("child");
    await paced.fetchText("detail");

    assert.deepEqual(calls, ["root", "child", "detail"]);
    assert.deepEqual(waits, [1_000, 1_000], "the first request is not delayed, the next two wait the stated gap");
  } finally {
    Date.now = realNow;
  }
});

test("the paced view does not swallow a failed request", async () => {
  const ctx = {
    async fetchText() { throw new Error("boom"); },
    async sleep() {},
  };
  await assert.rejects(() => paceRequests(ctx, 10).fetchText("x"), /boom/);
});
