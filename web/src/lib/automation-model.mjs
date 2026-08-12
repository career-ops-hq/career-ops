const WORK_MODES = ["remote", "hybrid", "onsite", "mobile"];
const SOURCES = ["greenhouse", "lever", "ashby", "workday"];

export const DEFAULT_WATCH = Object.freeze({
  id: "huvudbevakning",
  name: "Min jobb-bevakning",
  enabled: true,
  roles: ["AI Engineer", "Software Engineer", "Platform Engineer"],
  locations: ["Sverige", "Stockholm", "Göteborg", "Malmö"],
  workModes: [...WORK_MODES],
  includeKeywords: ["AI", "automation", "platform"],
  excludeKeywords: [],
  sources: [...SOURCES],
  sinceDays: 14,
  intervalMinutes: 360,
  minimumScore: 45,
  aiEnabled: true,
  autoAddToPipeline: false,
});

function cleanList(value, allowed) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const item = String(raw ?? "").trim();
    const key = item.toLocaleLowerCase("sv");
    if (!item || seen.has(key) || (allowed && !allowed.includes(item))) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeWatch(value = {}) {
  const roles = cleanList(value.roles);
  const locations = cleanList(value.locations);
  const workModes = cleanList(value.workModes, WORK_MODES);
  const sources = cleanList(value.sources, SOURCES);
  return {
    ...DEFAULT_WATCH,
    id: String(value.id || DEFAULT_WATCH.id).trim().slice(0, 80) || DEFAULT_WATCH.id,
    name: String(value.name || DEFAULT_WATCH.name).trim().slice(0, 120) || DEFAULT_WATCH.name,
    enabled: value.enabled !== false,
    roles,
    locations,
    workModes: workModes.length ? workModes : [...DEFAULT_WATCH.workModes],
    includeKeywords: cleanList(value.includeKeywords),
    excludeKeywords: cleanList(value.excludeKeywords),
    sources: sources.length ? sources : [...DEFAULT_WATCH.sources],
    sinceDays: clamp(value.sinceDays, 1, 30, DEFAULT_WATCH.sinceDays),
    intervalMinutes: clamp(value.intervalMinutes, 30, 10080, DEFAULT_WATCH.intervalMinutes),
    minimumScore: clamp(value.minimumScore, 0, 100, DEFAULT_WATCH.minimumScore),
    aiEnabled: value.aiEnabled !== false,
    autoAddToPipeline: value.autoAddToPipeline === true,
  };
}

export function inferWorkModes(offer) {
  const text = `${offer?.title || ""} ${offer?.location || ""}`.toLocaleLowerCase("sv");
  const modes = [];
  if (/\b(remote|distans|hemifrån|home[- ]?based|anywhere)\b/.test(text)) modes.push("remote");
  if (/\b(hybrid|hybridarbete|delvis distans)\b/.test(text)) modes.push("hybrid");
  if (/\b(resande|travel(?:ling)?|fält(?:arbete|tekniker)?|field service|mobil(?:t| roll)?)\b/.test(text)) modes.push("mobile");
  if (modes.length === 0) modes.push("onsite");
  return modes;
}

export function canonicalOfferUrl(raw) {
  try {
    const url = new URL(String(raw));
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return String(raw || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function words(value) {
  return String(value || "")
    .toLocaleLowerCase("sv")
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter((word) => word.length >= 2);
}

function includesNeedle(text, needle) {
  return text.includes(String(needle).toLocaleLowerCase("sv"));
}

function scoreOffer(offer, watch, now) {
  const title = String(offer.title || "");
  const text = `${title} ${offer.company || ""} ${offer.location || ""}`.toLocaleLowerCase("sv");
  const modes = inferWorkModes(offer);
  if (!modes.some((mode) => watch.workModes.includes(mode))) return null;
  if (watch.excludeKeywords.some((keyword) => includesNeedle(text, keyword))) return null;

  let score = 5;
  const reasons = [];
  if (watch.roles.length === 0) {
    score += 20;
  } else {
    let bestRole = 0;
    for (const role of watch.roles) {
      const phrase = role.toLocaleLowerCase("sv");
      const roleWords = words(role);
      const titleWords = new Set(words(title));
      const overlap = roleWords.filter((word) => titleWords.has(word)).length;
      const roleScore = includesNeedle(title.toLocaleLowerCase("sv"), phrase)
        ? 48
        : Math.round((overlap / Math.max(1, roleWords.length)) * 38);
      bestRole = Math.max(bestRole, roleScore);
    }
    score += bestRole;
    if (bestRole > 0) reasons.push("Matchar målroll");
  }

  const locationMatch = watch.locations.some((location) => includesNeedle(text, location));
  if (locationMatch) {
    score += 16;
    reasons.push("Rätt plats");
  } else if (modes.includes("remote")) {
    score += 10;
    reasons.push("Distansarbete");
  } else if (watch.locations.length > 0) {
    score -= 12;
  }

  const matchingKeywords = watch.includeKeywords.filter((keyword) => includesNeedle(text, keyword));
  if (matchingKeywords.length) {
    score += Math.min(24, matchingKeywords.length * 12);
    reasons.push(`Nyckelord: ${matchingKeywords.join(", ")}`);
  }

  if (offer.date) {
    const posted = new Date(`${offer.date}T00:00:00Z`);
    if (!Number.isNaN(posted.getTime())) {
      const ageDays = Math.max(0, (now.getTime() - posted.getTime()) / 86400000);
      if (ageDays <= 2) score += 12;
      else if (ageDays <= 7) score += 8;
      else if (ageDays <= watch.sinceDays) score += 4;
      else return null;
      if (ageDays <= 7) reasons.push("Nyligen publicerad");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    ...offer,
    score,
    workModes: modes,
    reasons,
    canonicalUrl: canonicalOfferUrl(offer.url),
  };
}

export function rankOffers(offers, watchInput, now = new Date()) {
  const watch = normalizeWatch(watchInput);
  const seen = new Set();
  const ranked = [];
  for (const offer of Array.isArray(offers) ? offers : []) {
    const key = canonicalOfferUrl(offer?.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const scored = scoreOffer(offer, watch, now);
    if (scored && scored.score >= watch.minimumScore) ranked.push(scored);
  }
  return ranked.sort((a, b) => b.score - a.score || String(b.date || "").localeCompare(String(a.date || "")));
}

export function isWatchDue(watchInput, lastRunAt, now = new Date()) {
  const watch = normalizeWatch(watchInput);
  if (!watch.enabled) return false;
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= watch.intervalMinutes * 60000;
}

export const AUTOMATION_WORK_MODES = Object.freeze([...WORK_MODES]);
export const AUTOMATION_SOURCES = Object.freeze([...SOURCES]);
