import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeArchetype,
  canonicalizeLocation,
  computeProgressMetrics,
  computeStatsMetrics,
  deriveSeniority,
  generateInsights,
  resolveAnalyticsTab,
} from "../../src/lib/analytics-metrics.mjs";

const app = (status, score = "4.0/5", date = "2026-09-18", extra = {}) => ({ status, score, date, role: "Senior AI Engineer", ...extra });

test("progress uses cumulative funnel semantics, including hired and rejected", () => {
  const metrics = computeProgressMetrics([
    app("Applied", "4.5/5"),
    app("Responded", "4.0/5"),
    app("Interview", "3.0/5"),
    app("Offer", "2.9/5"),
    app("Hired", "4.2/5"),
    app("Rejected", "N/A"),
  ]);

  assert.deepEqual(metrics.funnel.map((stage) => stage.count), [6, 6, 4, 3, 2]);
  assert.deepEqual(metrics.funnel.map((stage) => stage.label), ["Tracked", "Applied", "Responded", "Interview", "Offer"]);
  assert.equal(metrics.funnel[1].pct, 100);
  assert.equal(metrics.funnel[2].pct, (4 / 6) * 100);
  assert.equal(metrics.activeApps, 5);
  assert.equal(metrics.totalOffers, 2);
  assert.equal(metrics.responseRate, (4 / 6) * 100);
  assert.equal(metrics.interviewRate, (3 / 6) * 100);
  assert.equal(metrics.offerRate, (2 / 6) * 100);
});

test("progress boundaries and zero denominators are stable", () => {
  const metrics = computeProgressMetrics([
    app("Evaluated", "4.5/5"),
    app("Evaluated", "4.0/5"),
    app("Evaluated", "3.5/5"),
    app("Evaluated", "3.0/5"),
    app("Evaluated", "2.9/5"),
    app("Evaluated", "N/A", "bad-date"),
    app("Evaluated", "N/A", "2026-02-30"),
  ]);
  assert.equal(metrics.responseRate, 0);
  assert.equal(metrics.funnel[0].label, "Tracked");
  assert.equal(metrics.funnel[0].count, 7);
  assert.deepEqual(metrics.scoreDistribution.map((row) => row.count), [1, 1, 1, 1, 1]);
  assert.deepEqual(metrics.weeklyActivity.map((row) => row.shortWeek), ["W38"]);
});

test("weekly activity keeps only the latest eight populated weeks", () => {
  const apps = Array.from({ length: 10 }, (_, index) => app("Applied", "4.0/5", `2026-${String(index + 1).padStart(2, "0")}-05`));
  const weeks = computeProgressMetrics(apps).weeklyActivity;
  assert.equal(weeks.length, 8);
  assert.ok(weeks.every((row) => /^W\d+$/.test(row.shortWeek)));
});

test("stats canonicalizes dimensions and computes pay distribution", () => {
  const metrics = computeStatsMetrics([
    app("Applied", "4.5/5", "2026-09-18", { archetype: "AI Platform / LLMOps", workMode: "Remote", location: "münchen", payMax: 180000, paySource: "POSTED" }),
    app("Applied", "3.8/5", "2026-09-18", { archetype: "Data Engineer / Analytics Engineer", workMode: "Hybrid", location: "Munich", payMax: 120000, paySource: "est", role: "Junior Data Engineer" }),
    app("Applied", "2.9/5", "2026-09-18", { archetype: "Agentic / Automation", workMode: "Remote", location: "Berlin", payMax: 90000, paySource: "POSTED", role: "Staff Automation Engineer" }),
  ]);

  assert.equal(metrics.archetypes[0].label, "Agentic & Automation");
  assert.equal(metrics.workModes[0].label, "Remote");
  assert.equal(metrics.locations[0].label, "Munich");
  assert.equal(metrics.pay.count, 3);
  assert.equal(metrics.pay.medianPayMax, 120000);
  assert.equal(metrics.pay.maxPayMax, 180000);
  assert.equal(metrics.qualityBarPct, (1 / 3) * 100);
  assert.equal(metrics.seniorityMix.find((row) => row.label === "Staff / Principal").count, 1);
});

test("canonicalization and seniority helpers retain TUI vocabulary", () => {
  assert.equal(canonicalizeArchetype("Applied AI Engineer"), "AI & ML Engineering");
  assert.equal(canonicalizeArchetype(""), "Unclassified");
  assert.equal(canonicalizeLocation("münchen"), "Munich");
  assert.equal(canonicalizeLocation("Kuala lumpur, malaysia"), "Kuala Lumpur");
  assert.equal(canonicalizeLocation("**Blank.** The pasted JD's workplace type carries no value."), "");
  assert.equal(canonicalizeLocation("Azure"), "");
  assert.equal(deriveSeniority("Principal Platform Engineer"), "Staff / Principal");
  assert.equal(deriveSeniority("Graduate Data Engineer"), "Junior / Entry");
  assert.equal(deriveSeniority("Data Engineer"), "Mid-Level");
});

test("stats caps locations, preserves work-mode counts and salary boundaries", () => {
  const locations = ["Berlin", "London", "Paris", "Singapore", "Kuala Lumpur", "Munich", "Dublin", "Vienna", "Toronto"];
  const apps = locations.map((location, index) => app("Applied", "4.0/5", "2026-09-18", {
    archetype: index === 0 ? "" : "AI Engineer",
    workMode: index % 2 ? "Remote" : "Hybrid",
    location,
    payMax: [99999, 100000, 140000, 140001, 180000, 180001, 220000, 220001, 0][index],
    paySource: "est",
  }));
  const metrics = computeStatsMetrics(apps);
  assert.equal(metrics.locations.length, 8);
  assert.equal(metrics.workModes.find((row) => row.label === "Hybrid").count, 5);
  assert.deepEqual(metrics.payHistogram.map((row) => row.count), [1, 2, 2, 2, 1]);
  assert.equal(metrics.archetypes.every((row) => row.label !== "Unclassified"), true);
});

test("strategic insights are deterministic with complete and missing data", () => {
  const full = computeStatsMetrics([
    app("Applied", "4.5/5", "2026-09-18", { archetype: "AI Engineer", workMode: "Hybrid", payMax: 120000 }),
    app("Applied", "4.0/5", "2026-09-18", { archetype: "AI Engineer", workMode: "Hybrid", payMax: 100000 }),
    app("Applied", "3.5/5", "2026-09-18", { archetype: "Data Engineer", workMode: "Remote", payMax: 90000 }),
  ]);
  const insights = generateInsights(full);
  assert.match(insights[0], /AI & ML Engineering/);
  assert.match(insights[1], /Hybrid/);
  assert.match(insights[2], /median top pay/);
  assert.deepEqual(generateInsights(computeStatsMetrics([])), []);
});

test("empty metrics and invalid analytics tabs are stable", () => {
  const progress = computeProgressMetrics([]);
  const stats = computeStatsMetrics([]);
  assert.equal(progress.tracked, 0);
  assert.equal(progress.avgScore, 0);
  assert.deepEqual(progress.weeklyActivity, []);
  assert.deepEqual(stats.archetypes, []);
  assert.equal(stats.pay.count, 0);
  assert.equal(resolveAnalyticsTab(undefined), "progress");
  assert.equal(resolveAnalyticsTab("bogus"), "progress");
  assert.equal(resolveAnalyticsTab(["search-stats"]), "search-stats");
});
