import { test } from "node:test";
import assert from "node:assert/strict";
import { homeLead, showFirstRunHome } from "../../src/lib/home/home-lead.mjs";

test("tracked work leads Today, ahead of setup", () => {
  assert.equal(homeLead(true), "queue");
});

test("an install with nothing tracked still leads with setup", () => {
  assert.equal(homeLead(false), "setup");
});

test("a first run with no inbox rows is the empty CV screen", () => {
  assert.equal(showFirstRunHome("first-run", 0), true);
});

test("done inbox rows skip the empty CV screen", () => {
  assert.equal(showFirstRunHome("first-run", 2), false);
  assert.equal(showFirstRunHome("in-between", 0), false);
});
