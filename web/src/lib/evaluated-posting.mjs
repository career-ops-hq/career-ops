import { normalizeUrl, postingUrlRelation } from "./core/url-key.mjs";

export function matchEvaluatedPosting(evaluated, offer, norm) {
  const rows = evaluated ?? [];
  const offerKey = normalizeUrl(offer?.url);
  if (offerKey) {
    for (const row of rows) {
      if (!normalizeUrl(row?.url)) continue;
      if (postingUrlRelation(row.url, offer.url) === "same") return row;
    }
  }

  // A tracker row with no URL cannot be compared by posting, so it falls back
  // to an exact company and title match.
  const company = norm(offer?.company);
  const title = norm(offer?.title ?? "");
  if (!title) return null;
  for (const row of rows) {
    if (normalizeUrl(row?.url)) continue;
    if (norm(row?.company) !== company) continue;
    if (norm(row?.role ?? "") === title) return row;
  }
  return null;
}
