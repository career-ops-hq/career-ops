/**
 * inbox-rank.mjs — deterministic fit for a pending posting.
 *
 * One rule for the inbox list, the what's-new route, and rank-pipeline's
 * heuristic segment. Turbopack cannot import this file from web/, so
 * web/src/lib/core/inbox-rank.mjs is a byte copy. Edit this file, then copy it.
 *
 * The tokenizer is inlined. web/src/lib/title-fit.mjs cannot be imported here
 * without forking the copy, and that helper is forbidden from ordering lists.
 *
 * A parsed rank stamp wins outright. Its score is already on the 0 to 5 scale
 * this function uses, and its reason is the line a previous pass wrote.
 * Mixing that number with a fresh title/place/pay total would let the two
 * disagree on the same row. No stamp, and no hit, is null: unranked, not zero,
 * so a real 0 stamp still sorts ahead of a row this function cannot judge.
 */

const TOKEN_RE = /[\p{L}\p{N}+#.]+/gu;

const SENIORITY = new Set([
  "junior", "jr", "mid", "middle", "senior", "sr", "staff", "principal",
  "lead", "head", "chief", "associate", "assistant", "intern", "internship",
  "entry", "level", "ii", "iii", "iv",
]);

/**
 * @param {unknown} profile Parsed profile.yml, or anything else.
 * @returns {{ roles: string[], places: string[], wantsRemote: boolean, payFloor: number | null, currency: string | null }}
 */
export function fitTargetsFromProfile(profile) {
  const doc = profile && typeof profile === "object" ? profile : {};
  const rolesBlock = doc.target_roles;
  let roles = [];
  if (rolesBlock && typeof rolesBlock === "object" && !Array.isArray(rolesBlock)) {
    const primary = Array.isArray(rolesBlock.primary) ? rolesBlock.primary : [];
    const names = Array.isArray(rolesBlock.archetypes)
      ? rolesBlock.archetypes.map((item) => item && item.name)
      : [];
    roles = [...primary, ...names].filter((role) => typeof role === "string");
  }
  const location = doc.location && typeof doc.location === "object" ? doc.location : {};
  const compensation = doc.compensation && typeof doc.compensation === "object" ? doc.compensation : {};
  const candidate = doc.candidate && typeof doc.candidate === "object" ? doc.candidate : {};
  const places = [location.city, location.country, candidate.location]
    .filter((place) => typeof place === "string" && place.trim().length >= 3)
    .map((place) => place.trim());
  const remoteText = [compensation.location_flexibility, location.onsite_availability]
    .filter((text) => typeof text === "string")
    .join(" ");
  const wantsRemote = location.remote === true || /remote/i.test(remoteText);
  const rawMinimum = compensation.minimum;
  const minimum = typeof rawMinimum === "number" && Number.isFinite(rawMinimum)
    ? String(rawMinimum)
    : typeof rawMinimum === "string" ? rawMinimum : "";
  const money = parseMoney(minimum);
  const named = currencyCode(compensation.currency);
  return {
    roles,
    places,
    wantsRemote,
    payFloor: money ? money.amount : null,
    currency: named || (money && money.currency) || null,
  };
}

/**
 * @param {unknown} raw The text after `rank:`.
 * @returns {{ score: number, reason: string } | null}
 */
export function parseRankStamp(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*\/\s*5\s*[—–-]\s*(.+)/);
  if (!match) return null;
  const reason = match[2].trim();
  if (!reason) return null;
  const score = Number(match[1]);
  if (!Number.isFinite(score)) return null;
  return { score: roundScore(score), reason };
}

/**
 * @param {{ title?: unknown, location?: unknown, pay?: unknown, rankStamp?: unknown } | null | undefined} posting
 * @param {{ roles?: string[], places?: string[], wantsRemote?: boolean, payFloor?: number | null, currency?: string | null } | null | undefined} targets
 * @returns {{ score: number, reason: string } | null}
 */
export function scorePosting(posting, targets) {
  const source = posting || {};
  const stamp = parseRankStamp(source.rankStamp);
  if (stamp) return stamp;
  const profile = targets || {};
  const clauses = [];
  let score = 0;
  const title = titleClause(source.title, profile.roles || []);
  if (title) {
    clauses.push(title.text);
    score += title.points;
  }
  const where = locationClauses(source.location, profile);
  clauses.push(...where.clauses);
  score += where.points;
  const pay = payClause(source.pay, profile);
  if (pay) {
    clauses.push(pay.text);
    score += pay.points;
  }
  if (!clauses.length) return null;
  return { score: Math.min(5, score), reason: clauses.join(" · ") };
}

/**
 * Ranked rows first, higher score first. Unranked rows after them.
 * Inside each group, a later YYYY-MM-DD comes first and a missing date goes last.
 * `newest` ignores fit and uses that date rule alone. The input order breaks ties.
 *
 * @template T
 * @param {T[]} rows
 * @param {"fit" | "newest"} [mode]
 * @returns {T[]}
 */
export function orderInbox(rows, mode = "fit") {
  const list = Array.isArray(rows) ? rows : [];
  const decorated = list.map((row, index) => ({ row, index }));
  decorated.sort((a, b) => {
    if (mode !== "newest") {
      const left = rankedScore(a.row);
      const right = rankedScore(b.row);
      const leftRanked = left != null;
      const rightRanked = right != null;
      if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
      if (leftRanked && rightRanked && left !== right) return right - left;
    }
    return compareRecency(a, b);
  });
  return decorated.map((item) => item.row);
}

/**
 * Fit order for the what's-new payload. `fit` is not returned. The walk that
 * built `offers` stays newest-line-first. This only reorders that already
 * capped pool, then slices to the caller's render limit.
 *
 * @param {Array<Record<string, unknown>>} offers
 * @param {Parameters<typeof scorePosting>[1]} targets
 * @param {number} limit
 */
export function rankOffers(offers, targets, limit) {
  const list = Array.isArray(offers) ? offers : [];
  const ordered = orderInbox(list.map((offer) => ({
    ...offer,
    postedAt: typeof offer.postedAt === "string" ? offer.postedAt : "",
    fit: scorePosting({
      title: offer.title || offer.role || "",
      location: offer.location || "",
      pay: offer.pay || offer.compensation || "",
      rankStamp: offer.rankStamp || null,
    }, targets),
  })), "fit");
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ordered.length;
  return ordered.slice(0, cap).map((row) => {
    const { fit, ...rest } = row;
    return rest;
  });
}

function rankedScore(row) {
  const fit = row && row.fit;
  if (!fit || typeof fit.score !== "number" || !Number.isFinite(fit.score)) return null;
  return fit.score;
}

function compareRecency(a, b) {
  const left = dateKey(a.row);
  const right = dateKey(b.row);
  if (left !== right) {
    if (!left) return 1;
    if (!right) return -1;
    return left < right ? 1 : -1;
  }
  return a.index - b.index;
}

function dateKey(row) {
  const value = row && row.postedAt;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function roundScore(score) {
  return Math.round(Math.min(5, Math.max(0, score)) * 10) / 10;
}

function currencyCode(raw) {
  const text = String(raw ?? "").trim().toUpperCase();
  if (text === "USD" || text === "$" || text === "US$") return "USD";
  if (text === "EUR" || text === "€") return "EUR";
  if (text === "GBP" || text === "£") return "GBP";
  return null;
}

function parseMoney(raw) {
  const text = String(raw ?? "");
  const currency = /€|\bEUR\b/i.test(text) ? "EUR" : /£|\bGBP\b/i.test(text) ? "GBP" : /\$|\bUSD\b/i.test(text) ? "USD" : null;
  const amounts = [];
  const pattern = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s*[kK])?/g;
  for (const match of text.matchAll(pattern)) {
    let amount = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;
    if (match[2]) amount *= 1000;
    if (amount >= 1000) amounts.push(amount);
  }
  if (!amounts.length) return null;
  return { amount: Math.min(...amounts), currency };
}

function tokenSet(text) {
  const raw = String(text ?? "").toLowerCase().match(TOKEN_RE) ?? [];
  return new Set(raw.map((token) => token.replace(/\.+$/, "")).filter((token) => token.length > 1 && !SENIORITY.has(token)));
}

function titleClause(title, roles) {
  const titleTokens = tokenSet(title);
  if (!titleTokens.size || !Array.isArray(roles)) return null;
  const lowerTitle = String(title).toLowerCase();
  let best = null;
  for (const role of roles) {
    if (typeof role !== "string" || !role.trim()) continue;
    const phrase = role.trim();
    const roleTokens = [...tokenSet(phrase)];
    if (!roleTokens.length) continue;
    let hits = 0;
    for (const token of roleTokens) if (titleTokens.has(token)) hits += 1;
    const ratio = hits / roleTokens.length;
    const phraseHit = lowerTitle.includes(phrase.toLowerCase());
    let points = 0;
    if (phraseHit || hits === roleTokens.length) points = 3;
    else if (ratio >= 0.6) points = 2;
    else if (ratio >= 0.34) points = 1;
    if (!points) continue;
    if (
      !best
      || points > best.points
      || (points === best.points && ratio > best.ratio)
      || (points === best.points && ratio === best.ratio && phrase.length > best.phrase.length)
    ) {
      best = { points, ratio, phrase };
    }
  }
  if (!best) return null;
  return { points: best.points, text: `Title matches '${best.phrase}'` };
}

function locationClauses(location, targets) {
  const text = String(location ?? "");
  const clauses = [];
  let points = 0;
  if (targets.wantsRemote && /\bremote\b/i.test(text)) {
    clauses.push("Remote");
    points += 1;
  }
  const places = [...(targets.places || [])].filter((place) => typeof place === "string");
  places.sort((a, b) => b.length - a.length);
  for (const place of places) {
    if (place.trim().length < 3) continue;
    if (text.toLowerCase().includes(place.trim().toLowerCase())) {
      clauses.push(`Location matches '${place.trim()}'`);
      points += 1;
      break;
    }
  }
  return { clauses, points };
}

function payClause(pay, targets) {
  if (targets.payFloor == null || !Number.isFinite(targets.payFloor)) return null;
  const money = parseMoney(pay);
  if (!money) return null;
  const floorCurrency = currencyCode(targets.currency);
  if (money.currency && floorCurrency && money.currency !== floorCurrency) return null;
  if (money.amount < targets.payFloor) return null;
  return { points: 1, text: "pay above your floor" };
}
