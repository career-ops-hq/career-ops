// Client-safe types + codec for the Explorer (job discovery). NO node imports —
// both client components and server routes import this for the shared shapes, so
// the filter contract, the discovered-offer shape, and the stream-event grammar
// can never drift between the two halves. Server-only logic (spawning the scanner,
// writing temp files) lives in lib/core/{scan,portals,pipeline}.ts.

export type EmployerSource = "tencent" | "bytedance" | "meituan";
export type DiscoverySource = AtsSource | EmployerSource;
export type EmployerScanOutcome = { state: "complete" | "partial" | "failed"; message: string };
export type AtsSource = "greenhouse" | "lever" | "ashby" | "workday";
export const ATS_SOURCES: AtsSource[] = ["greenhouse", "lever", "ashby", "workday"];
export const ATS_LABEL: Record<AtsSource, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
};

/** Role-type / seniority family (AGEN-254). Coarse on purpose: the scanner
 *  matches substrings, so "intern" catches "internship", "senior" catches
 *  "senior staff". Maps onto title_filter.positive keyword injection. */
export type RoleType =
  | "intern"
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | "lead"
  | "manager"
  | "director"
  | "vp"
  | "c-level";

export const ROLE_TYPES: RoleType[] = [
  "intern", "junior", "mid", "senior", "staff",
  "principal", "lead", "manager", "director", "vp", "c-level",
];

export const ROLE_TYPE_LABEL: Record<RoleType, string> = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  staff: "Staff",
  principal: "Principal",
  lead: "Lead",
  manager: "Manager",
  director: "Director",
  vp: "VP",
  "c-level": "C-level",
};

/** Keywords a RoleType injects into title_filter.positive — the single source
 *  of truth is explore-expand.mjs (shared with the scheduled runner). */
export const ROLE_TYPE_KEYWORDS: Record<RoleType, string[]> = ROLE_TYPE_KEYWORDS_JS;

/** Work-setup preference (AGEN-254). Multi-select: both remote and hybrid is
 *  ["remote", "hybrid"]. Maps onto the location allow list only — the
 *  full-fidelity workplace_policy object stays under the user's control in
 *  portals.yml (see AGEN-249 shared-contracts doc). */
export type WorkSetup = "remote" | "hybrid" | "onsite";

export const WORK_SETUPS: WorkSetup[] = ["remote", "hybrid", "onsite"];

export const WORK_SETUP_LABEL: Record<WorkSetup, string> = {
  remote: "Remote (anywhere)",
  hybrid: "Hybrid",
  onsite: "In-office",
};

/** Location allow-list entries a WorkSetup adds — the single source of truth is
 *  explore-expand.mjs (shared with the scheduled runner). "onsite" adds nothing;
 *  the location allow/block already governs it. */
export const WORK_SETUP_ALLOW: Record<WorkSetup, string[]> = WORK_SETUP_ALLOW_JS;

/** The full UI filter state. The keyword/location lists mirror scan.mjs's
 *  buildTitleFilter / buildLocationFilter semantics; sinceDays/ats/limitPerAts map
 *  to scan-ats-full.mjs's --since / --ats / --limit. roleType/workSetup are
 *  optional — undefined (or an empty array) means "don't filter on this axis",
 *  which is also what pre-AGEN-254 scheduled-job records decode to. */
export type ExploreFilters = {
  preset?: "china-employers";
  employers?: EmployerSource[];
  positive: string[];
  negative: string[];
  allow: string[];
  block: string[];
  blockHard: string[];
  alwaysAllow: string[];
  sinceDays: number;
  ats: AtsSource[];
  limitPerAts: number;
  roleType?: RoleType[];
  workSetup?: WorkSetup[];
};

export const DEFAULT_FILTERS: ExploreFilters = {
  positive: [],
  negative: [],
  allow: [],
  block: [],
  blockHard: [],
  alwaysAllow: [],
  sinceDays: 7,
  ats: [...ATS_SOURCES],
  limitPerAts: 150,
};

/** Banded title-vs-profile overlap (web/src/lib/title-fit.mjs). Words, not
 *  numbers, so it can't be mistaken for the evaluation's real 1–5 / A–F. */
export type FitBand = "strong" | "related" | "weak";

export type DiscoveredOffer = {
  url: string;
  company: string;
  title: string;
  location: string;
  /** YYYY-MM-DD, or "" when the engine reported n/a (AI offers always "") */
  postedAt: string;
  /** Provider evidence carried through review for the conditional Inbox gate. */
  geographyEvidence?: Record<string, unknown>;
  ats: string;
  source: string;
  /** which positive keyword matched the title (transparency, e.g. "ai" in "Nail") */
  matchedKeyword?: string;
  /** free, zero-token triage hint computed at discovery time from the posting
   *  TITLE vs config/profile.yml target roles (#3260). Recommendation layer
   *  only — filters or orders results only when the user picks a fit filter or
   *  the Fit sort, and never replaces the evaluation score; Evaluate gives the
   *  real A–F.
   *  Scan offers only; AI offers already carry why + confidence. */
  fit?: { band: FitBand; score: number };
  /** optional free-text ranking signal preserved to pipeline.md by the canonical
   *  writer (scan.mjs formatPipelineOffer). Generic and source-agnostic — an
   *  importer can attach a note; the deterministic scan omits it. */
  note?: string;
  // ── AI-search (modes/discover.md) additions — all optional, so the
  //    deterministic scan offer is unaffected (fields simply absent). ──
  /** present ONLY on AI offers → drives the "unverified" badge. AI finds can't be
   *  liveness-confirmed (AGENTS.md); the scan hits a live ATS API so it omits this. */
  verification?: "unconfirmed";
  /** one-line "why it matched" judgment (the thing a deterministic scan can't give) */
  why?: string;
  /** human freshness ("~5d ago", "unknown") shown when postedAt is "" */
  postedHint?: string;
  confidence?: "low" | "medium" | "high";
};

/** The two discovery surfaces: free deterministic Scan vs token-spending AI search. */
export type ExploreMode = "scan" | "ai";

/** Stream event grammar (NDJSON). `kind` discriminates. Discovery is FREE — the
 *  terminal `done` always carries cost {tokens:0, usd:0}. */
export type ScanEvent =
  | { kind: "start"; ats: string[]; sinceDays: number; limit: number; free: true }
  | { kind: "atsStart"; ats: string; companies: number }
  | { kind: "progress"; ats: string; scanned: number; total: number; matches: number }
  | { kind: "atsDone"; ats: string; unreachable: number }
  | { kind: "offer"; offer: DiscoveredOffer }
  | {
      kind: "summary";
      companiesScanned: number;
      unreachable: number;
      matches: number;
      // Authoritative degraded-vs-empty signals from the scanner's --json mode (#1199).
      // Absent on older local checkouts (the legacy human-stdout parse can't supply them).
      companiesAvailable?: number;
      capHit?: boolean;
      datasetStatus?: Record<string, "ok" | "stale" | "empty">;
      postingsDroppedNoDate?: number;
      // Sources whose results are missing (ran out of time or crashed) while the
      // others finished — a partial result, never "all caught up".
      incomplete?: string[];
      employerOutcome?: EmployerScanOutcome;
      employerSources?: { id: string; state: string; reason?: string }[];
    }
  | { kind: "log"; line: string }
  | { kind: "error"; message: string }
  | { kind: "done"; count: number; offers: DiscoveredOffer[]; cost?: { tokens: number; usd: number } };

// cleanChips is defined in clean-chips.mjs (plain JS) so it can be shared
// with the test suite without a TypeScript runner. Import for internal use
// and re-export for external consumers (filter-builder.tsx, etc.).
import { cleanChips } from "./clean-chips.mjs";
export { cleanChips };

// The roleType/workSetup keyword maps and the fold live in explore-expand.mjs
// (plain JS) so the scheduled-jobs runner — which runs as plain `node` with no
// bundler and cannot import this .ts — shares one source of truth with the
// Explorer path. Re-exported here with their TS types for existing consumers.
import {
  ROLE_TYPE_KEYWORDS as ROLE_TYPE_KEYWORDS_JS,
  WORK_SETUP_ALLOW as WORK_SETUP_ALLOW_JS,
  expandFiltersForScan as expandFiltersForScanJs,
} from "./explore-expand.mjs";

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function cleanAts(v: unknown): AtsSource[] {
  if (!Array.isArray(v)) return [...ATS_SOURCES];
  const out = v
    .map((a) => String(a).toLowerCase())
    .filter((a): a is AtsSource => (ATS_SOURCES as string[]).includes(a));
  return out.length ? Array.from(new Set(out)) : [...ATS_SOURCES];
}

/** Apply a (possibly partial) action/assistant patch onto a base. The assistant
 *  emits {positive,negative,allow,block,alwaysAllow,since,ats,limit}. With
 *  merge=true, list fields are ADDED to the base; otherwise the given fields
 *  REPLACE. Unspecified fields are left as-is. */
export function parseExplorePatch(
  raw: Record<string, unknown>,
  base: ExploreFilters = DEFAULT_FILTERS,
  merge = false,
): ExploreFilters {
  const next: ExploreFilters = { ...base, ats: [...base.ats] };
  if (raw.preset === "china-employers") next.preset = "china-employers";
  else if (raw.preset !== undefined) next.preset = undefined;
  if (raw.employers !== undefined && Array.isArray(raw.employers)) {
    next.employers = [...new Set(raw.employers.filter((id): id is EmployerSource => ["tencent", "bytedance", "meituan"].includes(String(id))))];
  }
  const lists: [keyof ExploreFilters, string][] = [
    ["positive", "positive"],
    ["negative", "negative"],
    ["allow", "allow"],
    ["block", "block"],
    ["blockHard", "blockHard"],
    ["alwaysAllow", "alwaysAllow"],
  ];
  for (const [field, key] of lists) {
    if (raw[key] === undefined) continue;
    const incoming = cleanChips(raw[key]);
    next[field] = (merge ? cleanChips([...(base[field] as string[]), ...incoming]) : incoming) as never;
  }
  if (raw.since !== undefined) next.sinceDays = clampNum(raw.since, 1, 60, base.sinceDays);
  if (raw.sinceDays !== undefined) next.sinceDays = clampNum(raw.sinceDays, 1, 60, base.sinceDays);
  if (raw.limit !== undefined) next.limitPerAts = clampNum(raw.limit, 50, 500, base.limitPerAts);
  if (raw.limitPerAts !== undefined) next.limitPerAts = clampNum(raw.limitPerAts, 50, 500, base.limitPerAts);
  if (raw.ats !== undefined) next.ats = cleanAts(raw.ats);
  if (raw.roleType !== undefined) next.roleType = cleanEnumList(raw.roleType, ROLE_TYPES);
  if (raw.workSetup !== undefined) next.workSetup = cleanEnumList(raw.workSetup, WORK_SETUPS);
  return next;
}

/** Keep only known enum values from an array, de-duped; anything else (a
 *  non-array, an empty result) becomes undefined so it reads as "no filter". */
function cleanEnumList<T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.filter((x): x is T => allowed.includes(x as T)))];
  return out.length ? out : undefined;
}

/** Fold the coarse roleType/workSetup axes into the scanner's keyword/location
 *  lists (AGEN-249 contract). roleType APPENDS seniority keywords to positive;
 *  workSetup APPENDS allow-list entries. Both are additive — the user's explicit
 *  chips always survive — idempotent, and case-insensitively de-duped via
 *  cleanChips. Returns a new object; the input is never mutated. */
export const expandFiltersForScan: (f: ExploreFilters) => ExploreFilters = expandFiltersForScanJs;

/** URL <-> filters codec (so a search is shareable/restorable). */
export function filtersToParams(f: ExploreFilters): string {
  const sp = new URLSearchParams();
  if (f.preset === "china-employers") {
    sp.set("preset", f.preset);
    sp.set("employers", (f.employers ?? []).join(","));
  }
  if (f.positive.length) sp.set("q", f.positive.join(","));
  if (f.negative.length) sp.set("not", f.negative.join(","));
  if (f.allow.length) sp.set("loc", f.allow.join(","));
  if (f.block.length) sp.set("noloc", f.block.join(","));
  if (f.blockHard.length) sp.set("hardno", f.blockHard.join(","));
  if (f.alwaysAllow.length) sp.set("home", f.alwaysAllow.join(","));
  if (f.sinceDays !== DEFAULT_FILTERS.sinceDays) sp.set("since", String(f.sinceDays));
  if (f.ats.length !== ATS_SOURCES.length) sp.set("ats", f.ats.join(","));
  if (f.limitPerAts !== DEFAULT_FILTERS.limitPerAts) sp.set("limit", String(f.limitPerAts));
  if (f.roleType?.length) sp.set("role", f.roleType.join(","));
  if (f.workSetup?.length) sp.set("setup", f.workSetup.join(","));
  return sp.toString();
}

export function paramsToFilters(sp: URLSearchParams, base: ExploreFilters = DEFAULT_FILTERS): ExploreFilters {
  const split = (s: string | null) => (s ? s.split(",") : undefined);
  return parseExplorePatch(
    {
      preset: sp.get("preset") ?? undefined,
      employers: sp.has("employers") ? (sp.get("employers") || "").split(",") : undefined,
      positive: split(sp.get("q")),
      negative: split(sp.get("not")),
      allow: split(sp.get("loc")),
      block: split(sp.get("noloc")),
      blockHard: split(sp.get("hardno")),
      alwaysAllow: split(sp.get("home")),
      since: sp.get("since") ?? undefined,
      ats: split(sp.get("ats")),
      roleType: split(sp.get("role")),
      workSetup: split(sp.get("setup")),
      limit: sp.get("limit") ?? undefined,
    },
    base,
  );
}

/** AI-search URL codec (so an AI hunt is shareable/restorable). */
export function aiToParams(intent: string): string {
  const sp = new URLSearchParams();
  sp.set("mode", "ai");
  if (intent.trim()) sp.set("intent", intent.trim());
  return sp.toString();
}

export function paramsToAi(sp: URLSearchParams): string | null {
  if (sp.get("mode") !== "ai") return null;
  return sp.get("intent") ?? "";
}

/** Is the search broad enough that "nothing found" means "you're current"
 *  (good news) rather than "loosen your filters" (actionable)? */
export function isBroadSearch(f: ExploreFilters): boolean {
  return f.positive.length <= 1 && f.block.length === 0 && f.allow.length === 0;
}
