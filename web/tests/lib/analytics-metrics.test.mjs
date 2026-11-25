import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cumulativeProgressWithHistory } from "../../src/lib/funnel-tiles.mjs";
import {
  canonicalizeArchetype,
  canonicalizeLocation,
  computeProgressMetrics,
  computeStatsMetrics,
  deriveSeniority,
  generateInsights,
  resolveAnalyticsView,
} from "../../src/lib/analytics-metrics.mjs";

const app = (status, score = "4.0/5", date = "2026-09-18", extra = {}) => ({ status, score, date, role: "Senior AI Engineer", ...extra });

test("SKIP belongs to Tracked inventory, not active or advanced funnel stages", () => {
  const before = computeProgressMetrics([app("Applied")]);
  const after = computeProgressMetrics([app("Applied"), app("SKIP")]);
  assert.deepEqual(after.funnel.map(stage => stage.count), [2, 1, 0, 0, 0]);
  assert.equal(after.tracked, before.tracked + 1);
  assert.equal(after.funnel[1].pct, 50);
  assert.equal(after.activeApps, before.activeApps);
  assert.equal(after.totalOffers, before.totalOffers);
  assert.equal(after.responseRate, before.responseRate);
  assert.equal(after.interviewRate, before.interviewRate);
  assert.equal(after.offerRate, before.offerRate);
});

test("a measured zero still prints — the gate reads the denominator, not the rate", () => {
  // The failure mode of an over-eager fix: gating on the rate's own value
  // would hide a genuine 0%, which is a finding the user needs rather than an
  // absence. Six applied, none responded, is a real measurement.
  const metrics = computeProgressMetrics([
    app("Applied"), app("Applied"), app("Applied"),
    app("Applied"), app("Applied"), app("Applied"),
  ]);
  assert.equal(metrics.ratesDenominator, 6);
  assert.equal(metrics.responseRate, 0, "0 of 6 replied IS a measurement and must still print");
  assert.equal(metrics.interviewRate, 0);
  assert.equal(metrics.offerRate, 0);
});

test("core ledger achievements survive the Analytics view refactor", () => {
  const metrics = computeProgressMetrics([app("Rejected")], { interviews: 1, offers: 1 });
  assert.deepEqual(metrics.funnel.map(stage => stage.count), [1, 1, 1, 1, 1]);
  assert.equal(metrics.interviewRate, 100);
  assert.equal(metrics.offerRate, 100);
});

test("progress preserves core history for rejected and discarded rows", async () => {
  const applications = [app("Rejected", "4/5", "2026-09-18", { n: "1" }),
    app("Discarded", "4/5", "2026-09-18", { n: "2" }),
    app("SKIP", "4/5", "2026-09-18", { n: "3" })];
  const history = "1\t2026-09-01\tInterview\tRejected\n2\t2026-09-01\tOffer\tDiscarded\n3\t2026-09-01\tOffer\tSKIP";
  const achievements = await cumulativeProgressWithHistory(applications, history,
    fileURLToPath(new URL("../../../", import.meta.url)));
  assert.deepEqual(achievements, { applied: 2, responded: 2, interviews: 2, offers: 1 });
  const metrics = computeProgressMetrics(applications, achievements);
  assert.deepEqual(metrics.funnel.map(stage => stage.count), [3, 2, 2, 2, 1]);
  assert.equal(metrics.totalOffers, 1);
});

test("Assessment history never becomes an interview or offer after rebasing main", async () => {
  const applications = ["Assessment", "Interview", "Offer", "Discarded", "Rejected", "SKIP"]
    .map((status, i) => app(status, "4/5", "2026-10-11", { n: String(i + 1) }));
  const history = "4\t2026-10-01\tAssessment\tDiscarded\n5\t2026-10-01\tOffer\tRejected\n6\t2026-10-01\tOffer\tSKIP";
  const achievements = await cumulativeProgressWithHistory(applications, history,
    fileURLToPath(new URL("../../../", import.meta.url)));
  assert.deepEqual(achievements, { applied: 5, responded: 5, interviews: 3, offers: 2 });
  assert.deepEqual(computeProgressMetrics(applications, achievements).funnel.map(stage => stage.count), [6, 5, 5, 3, 2]);
});

test("one view resolver selects all three views and defaults unknown values", () => {
  for (const view of ["progress", "insights", "search-stats"]) {
    assert.equal(resolveAnalyticsView(view), view);
    assert.equal(resolveAnalyticsView([view, "bogus"]), view);
  }
  for (const raw of [undefined, "", "bogus", "INSIGHTS", [], ["bogus", "search-stats"]]) {
    assert.equal(resolveAnalyticsView(raw), "progress");
  }
});

test("progress uses cumulative funnel semantics, including hired and rejected", () => {
  const metrics = computeProgressMetrics([
    app("Applied", "4.5/5"),
    app("Responded", "4.0/5"),
    app("Interview", "3.0/5"),
    app("Offer", "2.9/5"),
    app("Hired", "4.2/5"),
    app("Rejected", "N/A"),
  ]);

  assert.deepEqual(metrics.funnel.map((stage) => stage.count), [6, 6, 5, 3, 2]);
  assert.deepEqual(metrics.funnel.map((stage) => stage.label), ["Tracked", "Applied", "Responded", "Interview", "Offer"]);
  assert.equal(metrics.funnel[1].pct, 100);
  assert.equal(metrics.funnel[2].pct, (5 / 6) * 100);
  assert.equal(metrics.activeApps, 4);
  assert.equal(metrics.totalOffers, 2);
  assert.equal(metrics.responseRate, (5 / 6) * 100);
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
  // Nothing here was applied to, so there is no denominator and the three rates
  // are ABSENT. This asserted 0 before, which is what the view printed as
  // "0.0%" — the dashboard reporting the search as failing before it began.
  assert.equal(metrics.ratesDenominator, 0);
  assert.equal(metrics.responseRate, null);
  assert.equal(metrics.interviewRate, null);
  assert.equal(metrics.offerRate, null);
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

test("empty progress and Search stats metrics are stable", () => {
  const progress = computeProgressMetrics([]);
  const stats = computeStatsMetrics([]);
  assert.equal(progress.tracked, 0);
  assert.equal(progress.avgScore, 0);
  assert.deepEqual(progress.weeklyActivity, []);
  assert.deepEqual(stats.archetypes, []);
  assert.equal(stats.pay.count, 0);
});

test("archetype IT operations bucket matches admin as a word", () => {
  assert.equal(canonicalizeArchetype("Badminton Coach"), "Other / Cross-Functional");
  assert.equal(canonicalizeArchetype("Sys Admin"), "IT & Technical Operations");
  assert.equal(canonicalizeArchetype("Database Administrator"), "Data & Analytics");
  assert.equal(canonicalizeArchetype("Systems Administrator"), "IT & Technical Operations");
});

test("archetype buckets match ai and pm as words, not inside other words", () => {
  assert.equal(canonicalizeArchetype("Supply Chain Product Manager"), "Product & Program Mgmt");
  assert.equal(canonicalizeArchetype("GenAI Product Manager"), "Technical AI PM");
  assert.equal(canonicalizeArchetype("Software Development"), "Other / Cross-Functional");
  assert.equal(canonicalizeArchetype("Domain Expert"), "Other / Cross-Functional");
  assert.equal(canonicalizeArchetype("AI PM"), "Technical AI PM");
  assert.equal(canonicalizeArchetype("AI Product Manager"), "Technical AI PM");
  assert.equal(canonicalizeArchetype("Senior PM, Payments"), "Product & Program Mgmt");
});

test("executive in a title is not an executive level on its own", () => {
  assert.equal(deriveSeniority("Account Executive"), "Mid-Level");
  assert.equal(deriveSeniority("Senior Account Executive"), "Senior");
  assert.equal(deriveSeniority("Executive Assistant"), "Mid-Level");
  assert.equal(deriveSeniority("Executive Director, Engineering"), "Executive");
  assert.equal(deriveSeniority("Chief Executive Officer"), "Executive");
});

test("location junk filter drops form labels but keeps places that share a prefix", () => {
  assert.equal(canonicalizeLocation("Req 12345"), "");
  assert.equal(canonicalizeLocation("Job ID 99"), "");
  assert.equal(canonicalizeLocation("Applicant location"), "");
  assert.equal(canonicalizeLocation("Idaho Falls, ID"), "Idaho Falls, ID");
  assert.equal(canonicalizeLocation("Jobner, India"), "Jobner, India");
});
