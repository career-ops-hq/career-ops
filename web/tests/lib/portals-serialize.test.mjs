// The Explorer writes an ephemeral portals.yml and points the scanner at it. If
// the serializer omits a location tier the type carries, that filter is silently
// dropped — the user set it, the scan ignores it. block_hard (#2956/#3102) is the
// tier this test exists to protect: it is the ONE tier always_allow cannot
// override, so dropping it doesn't loosen results, it lets through jobs the user
// hard-rejected.
//
// Run:  node --test tests/lib/portals-serialize.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import * as yaml from "js-yaml";
import { serializePortals } from "../../src/lib/core/portals-serialize.mjs";

const empty = { positive: [], negative: [], allow: [], block: [], alwaysAllow: [], blockHard: [] };

test("block_hard is written under location_filter", () => {
  const doc = yaml.load(serializePortals({ ...empty, blockHard: ["usa", "brazil"] }));
  assert.deepEqual(doc.location_filter.block_hard, ["usa", "brazil"]);
});

test("a hard-block-ONLY config still emits location_filter (the #3102 drop)", () => {
  // The bug the guard fixes: the location_filter header used to be gated on
  // allow/block/always_allow only, so a config that hard-blocks and nothing else
  // wrote no location_filter at all and the scan honored none of it.
  const doc = yaml.load(serializePortals({ ...empty, blockHard: ["usa"] }));
  assert.ok(doc.location_filter, "location_filter must be present for a block_hard-only config");
  assert.deepEqual(doc.location_filter.block_hard, ["usa"]);
});

test("all location tiers round-trip through YAML", () => {
  const f = { ...empty, allow: ["remote"], block: ["india"], alwaysAllow: ["london"], blockHard: ["usa"] };
  const lf = yaml.load(serializePortals(f)).location_filter;
  assert.deepEqual(lf.block_hard, ["usa"]);
  assert.deepEqual(lf.always_allow, ["london"]);
  assert.deepEqual(lf.allow, ["remote"]);
  assert.deepEqual(lf.block, ["india"]);
});

test("no location tiers → no location_filter section", () => {
  const doc = yaml.load(serializePortals({ ...empty, positive: ["engineer"] }));
  assert.equal(doc.location_filter, undefined);
  assert.deepEqual(doc.title_filter.positive, ["engineer"]);
});

test("a keyword that could break YAML is quoted, not injected", () => {
  // A hard-block keyword is user input; a bare `- key: value` or a leading dash
  // would corrupt the document or smuggle structure. JSON.stringify makes each a
  // double-quoted scalar.
  const doc = yaml.load(serializePortals({ ...empty, blockHard: ["a: b", "- x", '"q"'] }));
  assert.deepEqual(doc.location_filter.block_hard, ["a: b", "- x", '"q"']);
});
