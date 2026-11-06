import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fitTargetsFromProfile,
  orderInbox,
  parseRankStamp,
  rankOffers,
  scorePosting,
} from "../../src/lib/core/inbox-rank.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REASON = "Title matches 'Senior Data Analyst' · Remote · pay above your floor";

const profile = {
  target_roles: {
    primary: ["Senior Data Analyst"],
    archetypes: [{ name: "Analytics Lead" }],
  },
  location: { city: "Austin", country: "United States" },
  compensation: {
    minimum: "$100k",
    currency: "USD",
    location_flexibility: "Remote preferred",
  },
};

function targets() {
  return fitTargetsFromProfile(profile);
}

test("a title, remote, and pay hit become one reason line", () => {
  const fit = scorePosting({
    title: "Senior Data Analyst",
    location: "Remote",
    pay: "$140k",
    rankStamp: null,
  }, targets());
  assert.deepEqual(fit, { score: 5, reason: REASON });
});

test("a stamped row keeps that score and reason", () => {
  const fit = scorePosting({
    title: "Senior Data Analyst",
    location: "Remote",
    pay: "$140k",
    rankStamp: "4.2/5 \u2014 Strong finance match",
  }, targets());
  assert.deepEqual(fit, { score: 4.2, reason: "Strong finance match" });
});

test("no hit stays unranked", () => {
  assert.equal(scorePosting({
    title: "Zookeeper",
    location: "Berlin",
    pay: "",
    rankStamp: null,
  }, targets()), null);
});

test("a different currency and a pay range below the floor add no pay clause", () => {
  const euro = scorePosting({ title: "Office Manager", location: "Austin, TX", pay: "\u20ac140k" }, targets());
  assert.equal(euro.reason, "Location matches 'Austin'");
  assert.equal(euro.score, 1);
  const low = scorePosting({ title: "Office Manager", location: "Austin, TX", pay: "$80k-$90k" }, targets());
  assert.equal(low.reason, "Location matches 'Austin'");
});

test("ranked rows come first and unranked rows stay newest-first", () => {
  const rows = [
    { key: "old-fit", postedAt: "2026-11-01", fit: scorePosting({ title: "Senior Data Analyst", location: "Remote", pay: "$140k" }, targets()) },
    { key: "stamp", postedAt: "2026-11-04", fit: scorePosting({ title: "Accountant", rankStamp: "4.2/5 \u2014 Strong finance match" }, targets()) },
    { key: "new-miss", postedAt: "2026-11-05", fit: null },
    { key: "old-miss", postedAt: "2026-11-02", fit: null },
  ];
  assert.deepEqual(orderInbox(rows, "fit").map((row) => row.key), ["old-fit", "stamp", "new-miss", "old-miss"]);
  assert.deepEqual(orderInbox(rows, "newest").map((row) => row.key), ["new-miss", "stamp", "old-miss", "old-fit"]);
});

test("a missing date sorts after a dated row in the same group", () => {
  const rows = [
    { postedAt: "", fit: { score: 1, reason: "Remote" } },
    { postedAt: "2026-11-03", fit: { score: 1, reason: "Remote" } },
  ];
  assert.equal(orderInbox(rows)[0].postedAt, "2026-11-03");
});

test("what's new keeps the best fits inside the render cap", () => {
  const offers = rankOffers([
    { url: "https://example.com/new", title: "Zookeeper", location: "Berlin", postedAt: "2026-11-05" },
    { url: "https://example.com/fit", title: "Senior Data Analyst", location: "Remote", pay: "$140k", postedAt: "2026-11-01" },
    { url: "https://example.com/city", title: "Office Manager", location: "Austin, TX", postedAt: "2026-11-04" },
  ], targets(), 2);
  assert.deepEqual(offers.map((offer) => offer.url), ["https://example.com/fit", "https://example.com/city"]);
  assert.equal("fit" in offers[0], false);
});

test("a stamp without a reason is not a rank", () => {
  assert.equal(parseRankStamp("3"), null);
  assert.equal(parseRankStamp("4.0/5 \u2014 "), null);
});

test("a numeric compensation minimum is the pay floor", () => {
  const numeric = fitTargetsFromProfile({
    target_roles: { primary: ["Senior Data Analyst"] },
    compensation: { minimum: 120000, currency: "USD", location_flexibility: "Remote preferred" },
  });
  assert.equal(numeric.payFloor, 120000);
  const fit = scorePosting({
    title: "Senior Data Analyst",
    location: "Remote",
    pay: "$140,000",
  }, numeric);
  assert.match(fit.reason, /pay above your floor/);
  assert.equal(fitTargetsFromProfile({ compensation: { minimum: 500 } }).payFloor, null);
  assert.equal(fitTargetsFromProfile({ compensation: { minimum: Infinity } }).payFloor, null);
  assert.equal(fitTargetsFromProfile({ compensation: { minimum: "$100k" } }).payFloor, 100000);
});

test("the web copy matches the root module byte for byte", () => {
  const core = fs.readFileSync(path.join(ROOT, "lib", "inbox-rank.mjs"));
  const web = fs.readFileSync(path.join(ROOT, "web", "src", "lib", "core", "inbox-rank.mjs"));
  assert.ok(core.equals(web), "web/src/lib/core/inbox-rank.mjs drifted from lib/inbox-rank.mjs");
});
