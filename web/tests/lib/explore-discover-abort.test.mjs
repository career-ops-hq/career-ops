// Discover used to abort itself: history.replaceState of the filter URL is a
// Next.js navigation, which cancels POST /api/explore; AbortError was then
// painted as failed/empty. These files are TypeScript, so this reads source
// the way core-writer-await.test.mjs does.
//
// Run:  node --test tests/lib/explore-discover-abort.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const provider = readFileSync(join(ROOT, "components/explore/explore-provider.tsx"), "utf8");
const scan = readFileSync(join(ROOT, "lib/core/scan.ts"), "utf8");
const route = readFileSync(join(ROOT, "app/api/explore/route.ts"), "utf8");

test("Discover and AI hunt do not replaceState while the fetch is in flight", () => {
  assert.doesNotMatch(
    provider,
    /history\.replaceState\s*\(/,
    "replaceState during Discover/AI hunt aborts the in-flight POST — leave the URL alone until the stream settles, or skip it",
  );
});

test("AbortError is classified, not assigned as sawError", () => {
  assert.match(provider, /isAbortError/);
  assert.match(provider, /postNdjsonXhr/);
  assert.doesNotMatch(
    provider,
    /catch \(e\) \{\s*sawError = e instanceof Error/,
    "the catch must not treat AbortError as a failed scan",
  );
});

test("the scanner killer outlives a Workday sweep so --json can flush", () => {
  assert.match(scan, /12\s*\*\s*60\s*\*\s*1000/);
  assert.doesNotMatch(scan, /230_000/);
  assert.match(scan, /parseScanJsonStdout/);
});

test("the explore route outlives the killer and keeps the scan after the client drops", () => {
  const m = route.match(/export const maxDuration = (\d+)/);
  assert.ok(m, "maxDuration is set");
  assert.ok(Number(m[1]) >= 720, `maxDuration ${m[1]}s must outlive the 12-minute scanner killer`);
  assert.match(route, /from "next\/server"/);
  assert.match(route, /\bafter\s*\(/);
  assert.match(
    route,
    /addOffersToPipeline/,
    "Next.js aborts the HTTP stream on Explore remount; matches must still be written to pipeline.md",
  );
  assert.match(provider, /XMLHttpRequest|postNdjsonXhr/);
});
