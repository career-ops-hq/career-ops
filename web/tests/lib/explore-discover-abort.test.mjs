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
const scanArgs = readFileSync(join(ROOT, "lib/core/scan-args.mjs"), "utf8");

// The body of one `const <name> = useCallback(async () => { ... }, [...])`.
// Self-checking: a rename fails here instead of matching nothing below.
function callbackBody(name) {
  const head = `const ${name} = useCallback(async`;
  const start = provider.indexOf(head);
  assert.ok(start >= 0, `explore-provider.tsx: could not find the ${name} callback. Update this extractor.`);
  const next = provider.indexOf("= useCallback(", start + head.length);
  const body = provider.slice(start, next < 0 ? undefined : next);
  assert.ok(body.length > 500, `explore-provider.tsx: the ${name} callback came back nearly empty. Update this extractor.`);
  return body;
}

test("the filter URL is written once, in a helper, never inline in a run", () => {
  const writes = provider.match(/history\.replaceState\s*\(/g) ?? [];
  assert.equal(writes.length, 1, "exactly one replaceState: the writeSearchUrl helper");
  assert.doesNotMatch(callbackBody("discover"), /replaceState\s*\(/);
  assert.doesNotMatch(callbackBody("discoverAI"), /replaceState\s*\(/);
});

test("Discover writes the filter URL after the stream has settled, not before", () => {
  const body = callbackBody("discover");
  const request = body.indexOf('postNdjsonXhr("/api/explore"');
  const settled = body.indexOf("} catch (e) {", request);
  const write = body.indexOf("writeSearchUrl(filtersToParams(f))");
  assert.ok(request >= 0 && settled > request, "the stream is read inside a try/catch");
  assert.ok(write >= 0, "the filter URL is written (a finished search stays shareable)");
  assert.ok(write > settled, "writing the URL while the request is in flight aborts it");
  assert.equal(body.split("writeSearchUrl(").length - 1, 1, "written once per run");
});

test("AI hunt writes its URL after the stream has settled, not before", () => {
  const body = callbackBody("discoverAI");
  const request = body.indexOf('fetch("/api/explore/ai"');
  assert.ok(request >= 0, "the hunt request is found");
  let at = body.indexOf("writeSearchUrl(");
  assert.ok(at >= 0, "the AI search URL is written");
  for (; at >= 0; at = body.indexOf("writeSearchUrl(", at + 1)) {
    assert.ok(at > request, "no URL write before the hunt request is sent");
  }
  assert.ok(body.indexOf("writeSearchUrl(aiToParams(intent))", body.indexOf("} catch (e) {", request)) > 0);
});

test("a settled run publishes its URL only while it still owns the generation", () => {
  for (const name of ["discover", "discoverAI"]) {
    const body = callbackBody(name);
    let at = body.indexOf("writeSearchUrl(");
    assert.ok(at >= 0, `${name} writes its URL when the run settles`);
    for (; at >= 0; at = body.indexOf("writeSearchUrl(", at + 1)) {
      const guard = body.lastIndexOf(".owns(", at);
      assert.ok(guard >= 0 && at - guard < 220, `${name} checks ownership on this write`);
    }
  }
  const setMode = provider.slice(provider.indexOf("const setMode = useCallback"));
  assert.match(setMode, /invalidate\(\)/);
  assert.match(provider, /createRunOwner/);
});

test("AbortError is classified as interrupted, not assigned as a scan failure", () => {
  assert.match(provider, /isAbortError/);
  assert.match(provider, /postNdjsonXhr/);
  assert.doesNotMatch(
    provider,
    /catch \(e\) \{\s*sawError = e instanceof Error/,
    "the catch must not treat AbortError as a failed scan",
  );
  assert.match(callbackBody("discover"), /aborted\s*\?\s*"Discover was interrupted/);
  assert.doesNotMatch(provider, /saved matches/i, "an interrupted Discover saved nothing: do not send the user to look for it");
});

test("Discover writes nothing to pipeline.md: only the offers the user picks are added", () => {
  // The scan route streams what it found and stops there.
  assert.doesNotMatch(route, /addOffersToPipeline|core\/pipeline|appendToPipeline|appendToScanHistory/);
  assert.doesNotMatch(route, /\bafter\s*\(/, "no work after the response: a dropped client must not turn into a silent save");
  assert.doesNotMatch(scan, /addOffersToPipeline|core\/pipeline|appendToPipeline|appendToScanHistory/);
  assert.match(scan, /scannerArgs\(/, "the scanner child takes its flags from scan-args.mjs");
  assert.match(scanArgs, /"--dry-run"/, "the scanner child stays a dry run");

  // The writer is the explicit "Add to pipeline" route, fed by the user's pick.
  const addRoute = readFileSync(join(ROOT, "app/api/explore/add/route.ts"), "utf8");
  assert.match(addRoute, /addOffersToPipeline\(offers\)/);

  // And the client never marks an offer as added from a scan event.
  assert.doesNotMatch(provider, /savedUrls/);
  assert.doesNotMatch(callbackBody("discover"), /setAdded\(/);
  assert.equal(provider.split('fetch("/api/explore/add"').length - 1, 1, "addToPipeline is the only caller of the add route");
});

test("the scanner budget is the configured one, with no floor over it", () => {
  assert.match(scan, /const timeoutMs = readScanTimeoutMs\(\);/);
  assert.doesNotMatch(scan, /Math\.max\(\s*readScanTimeoutMs/, "a scan.timeout_seconds below a floor would be silently ignored");
  assert.match(scan, /parseScanJsonStdout/);
});
