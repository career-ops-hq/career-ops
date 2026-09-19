import { canonStatus } from "./status-alias.mjs";

const STAGE_ORDER = ["TRACKED", "APPLIED", "RESPONDED", "INTERVIEW", "OFFER"];
const SCORE_BUCKETS = [
  { label: "4.5–5.0", min: 4.5, max: Infinity },
  { label: "4.0–4.4", min: 4, max: 4.5 },
  { label: "3.5–3.9", min: 3.5, max: 4 },
  { label: "3.0–3.4", min: 3, max: 3.5 },
  { label: "Below 3.0", min: -Infinity, max: 3 },
];

function scoreValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const match = String(value ?? "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : NaN;
}

function percentage(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function normalizedStatus(value) {
  return canonStatus(String(value ?? ""));
}

function sortByCountThenLabel(a, b) {
  return b.count - a.count || a.label.localeCompare(b.label);
}

/**
 * Port of dashboard/internal/data/career.go's cumulative funnel semantics.
 * The returned object is pure so it can be parity-tested without filesystem IO.
 */
export function computeProgressMetrics(applications = []) {
  const apps = Array.isArray(applications) ? applications : [];
  const statusCounts = new Map();
  const scores = [];
  let totalOffers = 0;
  let activeApps = 0;
  let totalScore = 0;
  let topScore = 0;

  for (const app of apps) {
    const status = normalizedStatus(app?.status);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    const score = scoreValue(app?.score);
    if (Number.isFinite(score) && score > 0) {
      scores.push(score);
      totalScore += score;
      topScore = Math.max(topScore, score);
    }
    if (status === "OFFER" || status === "HIRED") totalOffers += 1;
    if (!["SKIP", "REJECTED", "DISCARDED"].includes(status)) activeApps += 1;
  }

  const count = (status) => statusCounts.get(status) ?? 0;
  const tracked = apps.length;
  const applied = count("APPLIED") + count("RESPONDED") + count("ASSESSMENT") + count("INTERVIEW") + count("OFFER") + count("HIRED") + count("REJECTED");
  const responded = count("RESPONDED") + count("ASSESSMENT") + count("INTERVIEW") + count("OFFER") + count("HIRED");
  const interview = count("INTERVIEW") + count("OFFER") + count("HIRED");
  const offer = count("OFFER") + count("HIRED");
  const funnelCounts = [tracked, applied, responded, interview, offer];

  const funnel = STAGE_ORDER.map((label, index) => {
    const stageCount = funnelCounts[index];
    // TUI semantics: Tracked and Applied are measured against all tracker rows;
    // downstream stages use Applied as the denominator.
    const denominator = index <= 1 ? tracked : applied;
    return { label: label[0] + label.slice(1).toLowerCase(), count: stageCount, pct: percentage(stageCount, denominator) };
  });

  const scoreDistribution = SCORE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: scores.filter((score) => score >= bucket.min && score < bucket.max).length,
    pct: 0,
  }));
  for (const bucket of scoreDistribution) bucket.pct = percentage(bucket.count, scores.length);

  const weekCounts = new Map();
  for (const app of apps) {
    const date = String(app?.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    const [inputYear, inputMonth, inputDay] = date.split("-").map(Number);
    if (parsed.getUTCFullYear() !== inputYear || parsed.getUTCMonth() + 1 !== inputMonth || parsed.getUTCDate() !== inputDay) continue;
    const { year, week } = isoWeek(parsed);
    const key = `${year}-W${String(week).padStart(2, "0")}`;
    weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
  }
  const weeklyActivity = [...weekCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([week, count]) => ({ week, shortWeek: week.slice(5), count }));

  return {
    tracked,
    avgScore: scores.length ? totalScore / scores.length : 0,
    topScore,
    activeApps,
    totalOffers,
    funnel,
    scoreDistribution,
    responseRate: percentage(responded, applied),
    interviewRate: percentage(interview, applied),
    offerRate: percentage(offer, applied),
    weeklyActivity,
  };
}

export function resolveAnalyticsTab(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "search-stats" ? "search-stats" : "progress";
}

function isoWeek(date) {
  const day = date.getUTCDay() || 7;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return {
    year: thursday.getUTCFullYear(),
    week: Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7),
  };
}

export function canonicalizeArchetype(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || ["unknown", "none", "n/a", "—", "-"].includes(value) || value.startsWith("none ")) return "Unclassified";
  if (value.includes("agentic") || value.includes("automation")) return "Agentic & Automation";
  if (value.includes("solutions architect") || value.includes("forward deployed") || value.includes("deployment architect")) return "AI Solutions & FDE";
  if (value.includes("technical ai pm") || (value.includes("ai") && value.includes("pm")) || (value.includes("ai") && value.includes("product manager"))) return "Technical AI PM";
  if (value.includes("llmops") || value.includes("mlops") || value.includes("platform") || value.includes("infrastructure")) return "AI Platform & LLMOps";
  if (value.includes("ai/ml") || value.includes("ml engineer") || value.includes("ai engineer") || value.includes("ki- entwickler") || value.includes("genai") || value.includes("applied ai")) return "AI & ML Engineering";
  if (value.includes("transformation") || value.includes("strategy") || value.includes("consultant") || value.includes("governance") || value.includes("policy")) return "AI Transformation & Governance";
  if (value.includes("product") || value.includes("project") || value.includes("program") || value.includes("pm") || value.includes("projektkoordin")) return "Product & Program Mgmt";
  if (value.includes("data") || value.includes("analytics") || value.includes("business intelligence")) return "Data & Analytics";
  if (value.includes("support") || value.includes("helpdesk") || value.includes("service desk") || value.includes("customer service") || value.includes("onboarding") || value.includes("administrator") || value.includes("operations") || value.includes("admin")) return "IT & Technical Operations";
  if (value.includes("research") || value.includes("wissenschaft") || value.includes("universit") || value.includes("bildung")) return "Research & Academia";
  return "Other / Cross-Functional";
}

function titleCase(value) {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function canonicalizeLocation(raw) {
  const value = String(raw ?? "").trim();
  if (!value || ["—", "-", "N/A"].includes(value) || /^(?:unknown|none|not stated|not specified|\*\*blank)/i.test(value) || /^(?:azure|aws|gcp|remote|hybrid|on[- ]?site)$/i.test(value)) return "";
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  const aliases = {
    "kuala lumpur": "Kuala Lumpur",
    "petaling jaya": "Petaling Jaya",
    cyberjaya: "Cyberjaya",
    singapore: "Singapore",
    münchen: "Munich",
    munich: "Munich",
    zürich: "Zurich",
    zurich: "Zurich",
    wien: "Vienna",
    vienna: "Vienna",
  };
  const first = parts[0].toLowerCase();
  const city = aliases[first] ?? titleCase(parts[0]);
  // Collapse known city variants ("Singapore, On-site", state/province
  // suffixes, and country-qualified labels) into the same TUI bucket.
  if (aliases[first]) return city;
  if (["Req", "Job", "Id", "User", "Applicant"].some((bad) => city.toLowerCase().startsWith(bad.toLowerCase()))) return "";
  if (parts.length === 1) {
    return city;
  }
  return `${city}, ${parts.slice(1).map((part) => part.length <= 2 ? part.toUpperCase() : titleCase(part)).join(", ")}`;
}

export function deriveSeniority(role = "") {
  const value = String(role).toLowerCase();
  if (/\b(chief|vp|vice president|director|head of|executive)\b/.test(value)) return "Executive";
  if (/\b(staff|principal)\b/.test(value)) return "Staff / Principal";
  if (/\b(lead|manager|management)\b/.test(value)) return "Lead / Manager";
  if (/\b(senior|sr\.?|expert)\b/.test(value)) return "Senior";
  if (/\b(junior|jr\.?|graduate|grad|intern|internship|trainee|entry|campus|protege|protégé)\b/.test(value)) return "Junior / Entry";
  return "Mid-Level";
}

function payBand(value) {
  if (value < 100000) return "< $100K";
  if (value <= 140000) return "$100K – $140K";
  if (value <= 180000) return "$140K – $180K";
  if (value <= 220000) return "$180K – $220K";
  return "$220K+";
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeStatsMetrics(applications = []) {
  const apps = Array.isArray(applications) ? applications : [];
  const archetypeMap = new Map();
  const workModeMap = new Map();
  const locationMap = new Map();
  const seniorityMap = new Map();
  const payValues = [];
  const payBands = new Map([["< $100K", 0], ["$100K – $140K", 0], ["$140K – $180K", 0], ["$180K – $220K", 0], ["$220K+", 0]]);
  const quality = new Map([["Elite (≥4.5)", 0], ["Strong (4.0–4.4)", 0], ["Viable (3.5–3.9)", 0], ["Moderate (3.0–3.4)", 0], ["Below Bar (<3.0)", 0]]);
  let archetypeTotal = 0;
  let workModeTotal = 0;
  let locationTotal = 0;
  let seniorityTotal = 0;
  let postedCount = 0;
  let estimatedCount = 0;
  let scoredCount = 0;

  for (const app of apps) {
    const score = scoreValue(app?.score);
    const rawArchetype = String(app?.archetype ?? "").trim();
    if (rawArchetype) {
      const archetype = canonicalizeArchetype(rawArchetype);
      const archetypeEntry = archetypeMap.get(archetype) ?? { count: 0, scoreSum: 0, scoreCount: 0 };
      archetypeEntry.count += 1;
      if (Number.isFinite(score) && score > 0) { archetypeEntry.scoreSum += score; archetypeEntry.scoreCount += 1; }
      archetypeMap.set(archetype, archetypeEntry);
      archetypeTotal += 1;
    }

    const mode = String(app?.workMode ?? "").trim();
    if (mode) { workModeMap.set(mode, (workModeMap.get(mode) ?? 0) + 1); workModeTotal += 1; }
    const location = canonicalizeLocation(app?.location);
    if (location) { locationMap.set(location, (locationMap.get(location) ?? 0) + 1); locationTotal += 1; }

    if (app?.role) {
      const seniority = deriveSeniority(app.role);
      seniorityMap.set(seniority, (seniorityMap.get(seniority) ?? 0) + 1);
      seniorityTotal += 1;
    }

    if (Number.isFinite(score) && score > 0) {
      scoredCount += 1;
      const tier = score >= 4.5 ? "Elite (≥4.5)" : score >= 4 ? "Strong (4.0–4.4)" : score >= 3.5 ? "Viable (3.5–3.9)" : score >= 3 ? "Moderate (3.0–3.4)" : "Below Bar (<3.0)";
      quality.set(tier, quality.get(tier) + 1);
    }
    const pay = Number(app?.payMax);
    if (Number.isFinite(pay) && pay > 0) {
      payValues.push(pay);
      payBands.set(payBand(pay), payBands.get(payBand(pay)) + 1);
      if (String(app?.paySource).toUpperCase() === "POSTED") postedCount += 1;
      else if (String(app?.paySource).toLowerCase() === "est") estimatedCount += 1;
    }
  }

  const mapRows = (map, total, limit = Infinity) => [...map.entries()]
    .map(([label, count]) => ({ label, count, pct: percentage(count, total) }))
    .sort(sortByCountThenLabel)
    .slice(0, limit);

  const archetypes = [...archetypeMap.entries()]
    .map(([label, entry]) => ({ label, count: entry.count, pct: percentage(entry.count, archetypeTotal), avgScore: entry.scoreCount ? entry.scoreSum / entry.scoreCount : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const qualityTiers = [...quality.entries()]
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({ label, count, pct: percentage(count, scoredCount) }));
  const seniorityOrder = ["Executive", "Staff / Principal", "Lead / Manager", "Senior", "Mid-Level", "Junior / Entry"];
  const seniorityMix = seniorityOrder.filter((label) => seniorityMap.has(label)).map((label) => ({ label, count: seniorityMap.get(label), pct: percentage(seniorityMap.get(label), seniorityTotal) }));
  const payHistogram = [...payBands.entries()].map(([label, count]) => ({ label, count, pct: percentage(count, payValues.length) }));

  return {
    archetypes,
    workModes: mapRows(workModeMap, workModeTotal),
    locations: mapRows(locationMap, locationTotal, 8),
    qualityTiers,
    qualityBarPct: percentage((quality.get("Elite (≥4.5)") ?? 0) + (quality.get("Strong (4.0–4.4)") ?? 0), scoredCount),
    seniorityMix,
    pay: {
      count: payValues.length,
      postedCount,
      estimatedCount,
      avgPayMax: payValues.length ? payValues.reduce((sum, value) => sum + value, 0) / payValues.length : 0,
      medianPayMax: median(payValues),
      maxPayMax: payValues.length ? Math.max(...payValues) : 0,
    },
    payHistogram,
  };
}

export function generateInsights(metrics) {
  const insights = [];
  if (metrics?.archetypes?.length) {
    const top = metrics.archetypes[0];
    const best = metrics.archetypes
      .filter((row) => row.count >= 3 && row.avgScore > 0 && row.label !== "Unclassified")
      .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count)[0];
    insights.push(best && best.label !== top.label
      ? `Primary archetype is ${top.label} (${top.count} roles, ${Math.round(top.pct)}%); strongest average fit is ${best.label} (${best.avgScore.toFixed(1)}/5).`
      : `Primary archetype is ${top.label} (${top.count} roles, ${Math.round(top.pct)}% of the evaluated profile).`);
  }
  if (metrics?.workModes?.length) {
    const mode = metrics.workModes[0];
    insights.push(`Workplace distribution: ${Math.round(mode.pct)}% of classified roles are ${mode.label}.`);
  }
  if (metrics?.pay?.count) {
    insights.push(`Compensation benchmark: median top pay is ${formatMoney(metrics.pay.medianPayMax)} (peak ${formatMoney(metrics.pay.maxPayMax)}) across ${metrics.pay.count} data points.`);
  }
  return insights;
}

export function formatMoney(value) {
  if (!value) return "—";
  return value >= 1000 ? `$${Math.round(value / 1000)}K` : `$${Math.round(value)}`;
}

export { scoreValue };
