// Pure, client-side derivations for the inbox triage view. Every signal here is
// FREE — parsed from data the raw posting already carries (URL host, title text,
// first_seen date). 🔴 None of this ranks or scores relevance; it only labels and
// buckets so the cheap facet filters can narrow the firehose with zero tokens.

import type { AtsSource } from "@/lib/explore";

/** Which ATS a posting lives on, derived from its URL host (0 tokens, no network).
 *  Matches on the registrable domain anchored at a dot boundary (host === base OR
 *  host ends with ".base") — never a bare substring, so "greenhouse.io.evil.com"
 *  or "notlever.co" can't be misread as that ATS. */
export function sourceFromUrl(url: string): AtsSource | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const domainIs = (base: string) => host === base || host.endsWith(`.${base}`);
  if (domainIs("greenhouse.io")) return "greenhouse";
  if (domainIs("lever.co")) return "lever";
  if (domainIs("ashbyhq.com")) return "ashby";
  if (domainIs("myworkdayjobs.com") || domainIs("workday.com")) return "workday";
  return null;
}

// Coarse seniority buckets, detected from the title. Ordered senior→junior so the
// facet chips read top-down; a title that matches nothing gets no tag (still shows,
// just untagged). We only ever surface buckets that actually appear in the data.
export type Seniority = "lead" | "staff" | "senior" | "mid" | "junior" | "intern";
export const SENIORITY_ORDER: Seniority[] = ["lead", "staff", "senior", "mid", "junior", "intern"];
export const SENIORITY_LABEL: Record<Seniority, string> = {
  lead: "Lead / Mgr",
  staff: "Staff+",
  senior: "Senior",
  mid: "Mid",
  junior: "Junior",
  intern: "Intern",
};

export function seniorityFromTitle(title: string): Seniority | null {
  const t = ` ${title.toLowerCase()} `;
  if (/\b(head|vp|vice president|director|chief|manager|mgr|lead)\b/.test(t)) return "lead";
  if (/\b(staff|principal|distinguished|fellow|architect)\b/.test(t)) return "staff";
  if (/\b(senior|sr\.?|snr)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|entry|graduate|associate)\b/.test(t)) return "junior";
  if (/\b(intern|internship|working student|apprentice)\b/.test(t)) return "intern";
  // an untagged IC role sits in the broad middle
  if (/\b(engineer|developer|scientist|designer|analyst|manager|specialist|consultant)\b/.test(t)) return "mid";
  return null;
}

// Truly geography-agnostic remote wording — eligible for anyone. "worldwide" /
// "global" are unconditional; "anywhere" is universal ONLY when it isn't scoped
// to a place: "Anywhere in France" means anywhere WITHIN France, so it must be
// judged against the authorized regions, not waved through on the word alone.
const GLOBAL_REMOTE = /\b(worldwide|world wide|global|globally)\b/i;
const ANYWHERE = /\banywhere\b/i;
function isUniversalRemote(loc: string): boolean {
  if (GLOBAL_REMOTE.test(loc)) return true;
  if (!ANYWHERE.test(loc)) return false;
  // "anywhere in <place>" is scoped to that place unless the place is the world.
  const scoped = loc.match(/\banywhere\b\s+in\s+(.+)/i);
  return !scoped || /^the\s+world\b|^world\b/i.test(scoped[1].trim());
}
const BARE_REMOTE = /^\s*(?:remote|remoto)\s*$/i;

/** True when an authorized region appears in the location as a COMPLETE name,
 *  bounded by non-letters (or string edges) on both sides — so a short code
 *  like "us" can't match inside "Russia" and "uk" can't match "Ukraine".
 *  Regions are normalized (trimmed, lowercased) and regex-escaped. */
function regionMatches(loc: string, region: string): boolean {
  const r = region.trim().toLowerCase();
  if (!r) return false;
  const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}($|[^a-z])`, "i").test(loc);
}

/** Cheap, zero-token geo-eligibility hint from a raw location string, judged
 *  against the CANDIDATE'S OWN authorized regions (read from config/profile.yml
 *  — nothing hardcoded to one geography). "ok" → universally remote, or the
 *  location names a region the candidate listed in `authorized_in`/`country`;
 *  "warn" → it names a concrete place, none of the candidate's regions match,
 *  and it isn't a bare "remote"; null → nothing to say (empty, an ambiguous
 *  bare "remote", or the user configured no regions). A user who wants a broader
 *  region to count as eligible just lists it in `authorized_in`. Recall-first;
 *  the authoritative work-authorization check stays Block A. */
export function eligibilityFromLocation(
  location: string | undefined,
  authorizedRegions: string[] = [],
): "ok" | "warn" | null {
  if (!location) return null;
  const loc = location.toLowerCase();
  if (isUniversalRemote(loc)) return "ok";
  if (authorizedRegions.some((r) => regionMatches(loc, r))) return "ok";
  if (BARE_REMOTE.test(loc)) return null;
  return authorizedRegions.length > 0 ? "warn" : null;
}

// Generic role words carry no stack signal; drop them before matching a title.
const STACK_STOP = new Set([
  "engineer", "engineering", "developer", "development", "senior", "sr", "snr", "staff",
  "principal", "lead", "junior", "jr", "mid", "of", "and", "the", "role", "software", "dev",
]);

/** Which of the candidate's target keywords literally appear in a job title — a
 *  cheap, honest "why this might fit" signal (a real list of hits, never a
 *  fabricated match%). Splits multi-word target roles into meaningful tokens,
 *  drops generic role words, and matches short tokens on a word boundary. */
export function stackHits(title: string, keywords: string[]): string[] {
  if (!title || !keywords || keywords.length === 0) return [];
  const t = ` ${title.toLowerCase()} `;
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const kw of keywords) {
    for (const tok of kw.split(/[\s/,()+&|-]+/)) {
      const w = tok.trim();
      const lw = w.toLowerCase();
      if (w.length < 2 || STACK_STOP.has(lw) || seen.has(lw)) continue;
      seen.add(lw);
      const escaped = lw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matched = lw.length <= 3 ? new RegExp(`\\b${escaped}\\b`).test(t) : t.includes(lw);
      if (matched) hits.push(w);
    }
  }
  return hits;
}

/** Whole days between an ISO date (YYYY-MM-DD) and now; null if unparseable. */
export function daysSince(iso: string | undefined, now: number): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

// Freshness windows mirror the Explore "posted within" segmented control so the two
// surfaces feel like one system. A posting passes a window if its age ≤ the window.
export const FRESHNESS_WINDOWS = [
  { label: "24h", days: 1 },
  { label: "3d", days: 3 },
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
] as const;
