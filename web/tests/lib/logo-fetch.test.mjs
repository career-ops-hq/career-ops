// The logo proxy's permanent cache may only hold answers about a domain.
//
// The cache never expires and stores a miss as an empty sentinel so a company
// with no favicon is never refetched. Google's favicon service answers 404
// (with a globe placeholder) for a domain it has no icon for, which is a
// miss. A timeout, a network error, a 429 from a burst of lazy-loaded cards
// or a 5xx says nothing about the domain, and was cached as a miss all the
// same: one bad moment became that company's monogram forever.
//
// Run:  node --test tests/lib/logo-fetch.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheLogoResult, fetchFavicon, resolveLogo } from "../../src/lib/core/logo-fetch.mjs";
import { COMPANY_KEY_VERSION } from "../../src/lib/core/logo-cache-key.mjs";

const ICON = new Uint8Array(519).fill(7); // a real favicon is larger than the placeholder cap
const GLOBE = new Uint8Array(726).fill(1); // what Google sends with its 404

/** A fetch that answers each domain from a table: a Response, or an Error to throw. */
function fakeFetch(table) {
  const asked = [];
  const fn = async (url) => {
    const domain = new URL(url).searchParams.get("domain");
    asked.push(domain);
    const answer = table[domain];
    if (answer instanceof Error) throw answer;
    if (!answer) throw new Error(`no fake answer for ${domain}`);
    return answer();
  };
  return { fn, asked };
}

const icon = () => new Response(ICON, { status: 200, headers: { "Content-Type": "image/png" } });
const notFound = () => new Response(GLOBE, { status: 404, headers: { "Content-Type": "image/png" } });
const status = (code) => () => new Response("", { status: code });

test("fetchFavicon: a 200 icon is a hit, Google's 404 and its tiny placeholder are misses", async () => {
  const { fn } = fakeFetch({
    "acme.com": icon,
    "none.example": notFound,
    "tiny.example": () => new Response(new Uint8Array(120), { status: 200 }),
  });
  const hit = await fetchFavicon("acme.com", fn);
  assert.equal(hit.kind, "hit");
  assert.equal(hit.bytes.byteLength, ICON.byteLength);
  assert.deepEqual(await fetchFavicon("none.example", fn), { kind: "miss" });
  assert.deepEqual(await fetchFavicon("tiny.example", fn), { kind: "miss" });
});

test("fetchFavicon: a failed lookup is unknown, never a miss", async () => {
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const { fn } = fakeFetch({
    "slow.example": timeout,
    "offline.example": new TypeError("fetch failed"),
    "busy.example": status(429),
    "down.example": status(503),
    "error.example": status(500),
  });
  for (const domain of ["slow.example", "offline.example", "busy.example", "down.example", "error.example"]) {
    assert.deepEqual(await fetchFavicon(domain, fn), { kind: "unknown" }, domain);
  }
});

test("fetchFavicon: a body that dies mid-read is unknown", async () => {
  const broken = () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error("socket hang up"));
      },
    });
    return new Response(body, { status: 200 });
  };
  const { fn } = fakeFetch({ "cut.example": broken });
  assert.deepEqual(await fetchFavicon("cut.example", fn), { kind: "unknown" });
});

test("resolveLogo: the first hit wins and later candidates are not asked", async () => {
  const { fn, asked } = fakeFetch({ "acme.com": notFound, "acme.io": icon, "acme.ai": icon });
  const result = await resolveLogo(["acme.com", "acme.io", "acme.ai"], fn);
  assert.equal(result.kind, "hit");
  assert.deepEqual(asked, ["acme.com", "acme.io"]);
});

test("resolveLogo: a miss needs every candidate to be a definite miss", async () => {
  const allMiss = fakeFetch({ "acme.com": notFound, "acme.io": notFound });
  assert.deepEqual(await resolveLogo(["acme.com", "acme.io"], allMiss.fn), { kind: "miss" });

  // One candidate's lookup failed: it may have had the icon, so nothing can
  // be concluded about the company.
  const oneFailed = fakeFetch({ "acme.com": notFound, "acme.io": status(429) });
  assert.deepEqual(await resolveLogo(["acme.com", "acme.io"], oneFailed.fn), { kind: "unknown" });
});

test("cacheLogoResult: writes the icon and the miss sentinel, and nothing for an unknown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "co-logo-cache-"));
  try {
    const hitFile = join(dir, "cache", "hit.png");
    const missFile = join(dir, "cache", "miss.png");
    const unknownFile = join(dir, "cache", "unknown.png");

    assert.equal(await cacheLogoResult(hitFile, { kind: "hit", bytes: ICON.buffer }), true);
    assert.deepEqual(new Uint8Array(readFileSync(hitFile)), ICON);

    assert.equal(await cacheLogoResult(missFile, { kind: "miss" }), true);
    assert.equal(readFileSync(missFile).byteLength, 0, "a miss is the empty sentinel");

    assert.equal(await cacheLogoResult(unknownFile, { kind: "unknown" }), false);
    assert.equal(existsSync(unknownFile), false, "a failed lookup leaves no sentinel, so the next request asks again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the logo route resolves and caches through logo-fetch.mjs, not a private copy", () => {
  const route = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../src/app/api/logo/route.ts"),
    "utf8",
  );
  assert.match(route, /import\s*{[^}]*\bresolveLogo\b[^}]*}\s*from\s*"@\/lib\/core\/logo-fetch\.mjs"/);
  assert.match(route, /await\s+resolveLogo\(\s*candidates\s*\)/);
  assert.match(route, /await\s+cacheLogoResult\(\s*file\s*,\s*result\s*\)/);
  // The write that cached every failed lookup as a miss must not come back.
  assert.doesNotMatch(route, /fs\.writeFile\(/);
  assert.doesNotMatch(route, /s2\/favicons/);
});

test("the company key version was bumped past the one that cached failures as misses", () => {
  // Same reasoning as company-domains.test.mjs's pin: a v4 install already
  // holds empty sentinels written by failed lookups, and on disk they look
  // exactly like real misses. Only a new key version makes those companies
  // ask again.
  assert.notEqual(COMPANY_KEY_VERSION, "v4", "failed lookups stopped being cached while COMPANY_KEY_VERSION stayed at v4");
});
