// Tests for the beta reporter's dupe-deflection search.
//
// The behaviour under test is a DISTINCTION that did not exist: the caller used
// to write `if (!res.ok) return []`, so "the search failed" and "the search
// found nothing" arrived as the same value. When the repo moved orgs and the
// stale `repo:` qualifier began returning 422, the reporter told users nothing
// similar was filed — calmly, with no error — for two days.
//
// Run:  node --test tests/lib/issue-search.test.mjs

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { searchIssues, _resetCache } from "../../src/lib/beta/issue-search.mjs";

beforeEach(() => _resetCache());

const ok = (items) => async () => ({ ok: true, json: async () => ({ items }) });
const status = (code) => async () => ({ ok: false, status: code, json: async () => ({}) });
const item = (n) => ({ number: n, title: `bug ${n}`, html_url: `https://example.test/${n}` });

test("a search that ran and found nothing is an empty array, not null", () => {
  return searchIssues("q", "o/r", ok([])).then((r) => assert.deepEqual(r, []));
});

test("422 — the exact status a moved repo's stale qualifier returns — is null", async () => {
  // This is the case that shipped broken. `[]` here is what made a live
  // breakage indistinguishable from a clean result.
  assert.equal(await searchIssues("q", "o/r", status(422)), null);
});

test("403 (rate limit) and 500 are null too: none of them mean 'nothing similar'", async () => {
  assert.equal(await searchIssues("q", "o/r", status(403)), null);
  assert.equal(await searchIssues("q", "o/r", status(500)), null);
});

test("a thrown fetch — offline, DNS, CORS — is null, not an empty result", async () => {
  const boom = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await searchIssues("q", "o/r", boom), null);
});

test("malformed JSON does not surface as 'nothing similar' either", async () => {
  const badJson = async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token"); } });
  assert.equal(await searchIssues("q", "o/r", badJson), null);
});

test("a response with no items array yields an empty result rather than throwing", async () => {
  assert.deepEqual(await searchIssues("q", "o/r", ok(undefined)), []);
});

test("results are mapped to the shape the banner renders", async () => {
  assert.deepEqual(await searchIssues("q", "o/r", ok([item(7)])), [
    { number: 7, title: "bug 7", url: "https://example.test/7" },
  ]);
});

test("a FAILURE is never cached, so the retry the user is invited to make actually retries", async () => {
  // Caching a failure would pin "couldn't check" for the life of the page and
  // make the retry a no-op — the #2590 lesson, in a place where the user can
  // see the consequence.
  let calls = 0;
  const failThenSucceed = async (...args) => {
    calls += 1;
    return calls === 1 ? status(422)(...args) : ok([item(1)])(...args);
  };
  assert.equal(await searchIssues("same-q", "o/r", failThenSucceed), null);
  assert.deepEqual(await searchIssues("same-q", "o/r", failThenSucceed), [
    { number: 1, title: "bug 1", url: "https://example.test/1" },
  ]);
  assert.equal(calls, 2);
});

test("a SUCCESS is cached, so typing on does not hammer an unauthenticated API", async () => {
  let calls = 0;
  const counting = async (...args) => {
    calls += 1;
    return ok([item(2)])(...args);
  };
  await searchIssues("cached-q", "o/r", counting);
  await searchIssues("cached-q", "o/r", counting);
  assert.equal(calls, 1);
});

test("the repo qualifier reaches the URL, and the query is encoded once", async () => {
  // The moved-org bug was a wrong value in exactly this position, so assert the
  // value rather than that a request merely happened.
  let seen = "";
  const capture = async (url) => {
    seen = url;
    return { ok: true, json: async () => ({ items: [] }) };
  };
  await searchIssues('in:body "abc"', "career-ops-hq/career-ops", capture);
  assert.match(seen, /^https:\/\/api\.github\.com\/search\/issues\?per_page=4&q=/);
  assert.equal(
    decodeURIComponent(seen.split("&q=")[1]),
    'repo:career-ops-hq/career-ops is:issue is:open in:body "abc"',
  );
});
