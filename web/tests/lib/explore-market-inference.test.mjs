import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FILTERS, filtersToParams, paramsToFilters, parseExplorePatch } from "../../src/lib/explore.ts";

test("a Portuguese location adds the Portugal market when no market was selected", () => {
  const filters = parseExplorePatch({ allow: ["Lisboa"] }, DEFAULT_FILTERS);
  assert.deepEqual(filters.markets, ["portugal"]);
});

test("explicit market choices and conflicting locations are never replaced by inference", () => {
  assert.deepEqual(parseExplorePatch({ allow: ["Lisboa"], markets: ["spain"] }, DEFAULT_FILTERS).markets, ["spain"]);
  assert.deepEqual(parseExplorePatch({ allow: ["Lisboa"], markets: [] }, DEFAULT_FILTERS).markets, []);
  assert.deepEqual(parseExplorePatch({ allow: ["Lisboa", "Madrid"] }, DEFAULT_FILTERS).markets, []);
});

test("removing inferred Portugal survives a shareable URL round-trip", () => {
  const filters = { ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats], allow: ["Lisboa"], markets: [] };
  const params = filtersToParams(filters);
  assert.match(params, /(?:^|&)markets=(?:&|$)/);
  assert.deepEqual(paramsToFilters(new URLSearchParams(params)).markets, []);
});
