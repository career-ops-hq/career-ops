import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WATCH,
  canonicalOfferUrl,
  inferWorkModes,
  isWatchDue,
  normalizeWatch,
  rankOffers,
} from "../../src/lib/automation-model.mjs";

test("normalizeWatch creates a safe Swedish career watch", () => {
  const watch = normalizeWatch({
    roles: ["  AI Engineer ", "AI Engineer", ""],
    locations: ["Stockholm", " Sverige "],
    workModes: ["remote", "hybrid", "invalid"],
    intervalMinutes: 5,
    minimumScore: 200,
    aiEnabled: true,
  });

  assert.deepEqual(watch.roles, ["AI Engineer"]);
  assert.deepEqual(watch.locations, ["Stockholm", "Sverige"]);
  assert.deepEqual(watch.workModes, ["remote", "hybrid"]);
  assert.equal(watch.intervalMinutes, 30);
  assert.equal(watch.minimumScore, 100);
  assert.equal(watch.aiEnabled, true);
  assert.deepEqual(watch.sources, DEFAULT_WATCH.sources);
  assert.ok(DEFAULT_WATCH.roles.length >= 3);
});

test("inferWorkModes understands remote, hybrid, onsite and mobile work", () => {
  assert.deepEqual(inferWorkModes({ title: "Senior utvecklare", location: "Remote · Sweden" }), ["remote"]);
  assert.deepEqual(inferWorkModes({ title: "UX Designer (Hybrid)", location: "Stockholm" }), ["hybrid"]);
  assert.deepEqual(inferWorkModes({ title: "Resande servicetekniker", location: "Sverige" }), ["mobile"]);
  assert.deepEqual(inferWorkModes({ title: "Ekonom", location: "Göteborg" }), ["onsite"]);
});

test("rankOffers filters work modes, deduplicates URLs and sorts best match first", () => {
  const watch = normalizeWatch({
    roles: ["AI Engineer"],
    locations: ["Stockholm", "Sweden"],
    workModes: ["remote", "hybrid"],
    minimumScore: 20,
    includeKeywords: ["platform"],
    excludeKeywords: ["intern"],
  });
  const offers = [
    { title: "Senior AI Platform Engineer", company: "Northstar", location: "Remote, Sweden", url: "https://jobs.example/a?utm_source=x", date: "2026-08-05", source: "greenhouse" },
    { title: "Senior AI Platform Engineer", company: "Northstar", location: "Remote, Sweden", url: "https://jobs.example/a", date: "2026-08-05", source: "greenhouse" },
    { title: "AI Engineer Intern", company: "Other", location: "Stockholm", url: "https://jobs.example/b", date: "2026-08-05", source: "lever" },
    { title: "AI Engineer", company: "OfficeCo", location: "Malmö", url: "https://jobs.example/c", date: "2026-08-05", source: "ashby" },
    { title: "AI Engineer", company: "HybridCo", location: "Hybrid · Stockholm", url: "https://jobs.example/d", date: "2026-08-04", source: "workday" },
  ];

  const ranked = rankOffers(offers, watch, new Date("2026-08-05T12:00:00Z"));
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].company, "Northstar");
  assert.equal(ranked[0].workModes[0], "remote");
  assert.equal(ranked[1].company, "HybridCo");
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.equal(canonicalOfferUrl(offers[0].url), canonicalOfferUrl(offers[1].url));
});

test("isWatchDue respects enabled state and interval", () => {
  const watch = normalizeWatch({ enabled: true, intervalMinutes: 60 });
  const now = new Date("2026-08-05T12:00:00Z");
  assert.equal(isWatchDue(watch, null, now), true);
  assert.equal(isWatchDue(watch, "2026-08-05T10:59:00Z", now), true);
  assert.equal(isWatchDue(watch, "2026-08-05T11:30:00Z", now), false);
  assert.equal(isWatchDue({ ...watch, enabled: false }, "2026-08-05T10:00:00Z", now), false);
});
