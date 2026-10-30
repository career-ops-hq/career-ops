// The filter URL is written when a Discover run settles, not while it is in
// flight (that write is what cut the run short).
//
// Run:  node --test tests/lib/explore-url.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { settledExploreUrl } from "../../src/lib/explore-url.mjs";

test("a settled run on /explore writes the search into the URL", () => {
  assert.equal(settledExploreUrl("/explore", "q=staff+engineer&since=7"), "/explore?q=staff+engineer&since=7");
  assert.equal(settledExploreUrl("/explore/", "mode=ai&intent=robotics"), "/explore?mode=ai&intent=robotics");
});

test("default filters write the bare path, which also drops an onboarding ?run=1", () => {
  assert.equal(settledExploreUrl("/explore", ""), "/explore");
});

test("a run that settles after the user left /explore leaves that page's URL alone", () => {
  assert.equal(settledExploreUrl("/pipeline", "q=staff"), null);
  assert.equal(settledExploreUrl("/", "q=staff"), null);
  assert.equal(settledExploreUrl("/explorer", "q=staff"), null);
});
