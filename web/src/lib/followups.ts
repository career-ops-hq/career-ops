// Pure types + helpers for the follow-up tracker (shared by the /followups page,
// the home follow-up card, and the log API route). The cadence VERDICT itself is
// the core's — followup-cadence.mjs --json — never recomputed here; these are
// only the display-side contracts and formatters.

export const CHANNELS = ["Email", "LinkedIn", "Phone", "Other"] as const;
export type Channel = (typeof CHANNELS)[number];

/** The profile.yml → followup_cadence keys the core followup-cadence.mjs reads. */
export const PROFILE_CADENCE_KEYS = [
  "applied_first_days",
  "applied_subsequent_days",
  "applied_max_followups",
  "responded_initial_days",
  "responded_subsequent_days",
  "interview_thankyou_days",
] as const;
export type ProfileCadenceKey = (typeof PROFILE_CADENCE_KEYS)[number];

/** Kept IDENTICAL to DEFAULT_CADENCE in followup-cadence.mjs (the source of
 *  truth) — only used to show the settings form's baseline values. */
export const CADENCE_DEFAULTS: Record<ProfileCadenceKey, number> = {
  applied_first_days: 7,
  applied_subsequent_days: 7,
  applied_max_followups: 2,
  responded_initial_days: 1,
  responded_subsequent_days: 3,
  interview_thankyou_days: 1,
};

/** One logged follow-up (a row of data/follow-ups.md; legacy bullets have num null). */
export type FollowupLogEntry = {
  num: number | null;
  appNum: number;
  date: string;
  company: string;
  role: string;
  channel: string;
  contact: string;
  notes: string;
};

export type SuggestedContact = { email: string; name: string | null };

/** One actionable application as analyzed by followup-cadence.mjs. */
export type CadenceEntry = {
  num: number;
  date: string;
  appliedDate: string;
  company: string;
  role: string;
  status: "applied" | "responded" | "interview";
  score: string;
  notes: string;
  reportPath: string | null;
  contacts: SuggestedContact[];
  daysSinceApplication: number;
  daysSinceLastFollowup: number | null;
  followupCount: number;
  followups: FollowupLogEntry[];
  urgency: Urgency;
  nextFollowupDate: string | null;
  /** User-pinned next date (overrides the computed cadence); absent on older engines. */
  nextOverride?: string | null;
  daysUntilNext: number | null;
};

export type CadenceMetadata = {
  analysisDate: string;
  totalTracked: number;
  actionable: number;
  overdue: number;
  urgent: number;
  cold: number;
  waiting: number;
};

export type Urgency = "urgent" | "overdue" | "waiting" | "cold";

/** Sort rank, NOT alphabetical: most pressing first. */
export const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, overdue: 1, waiting: 2, cold: 3 };

export function urgencyRank(u: string): number {
  return URGENCY_RANK[u as Urgency] ?? 9;
}

/** Badge tone per spec: urgent=red, overdue=amber, waiting=blue/info, cold=neutral. */
export function urgencyTone(u: string): "bad" | "warn" | "info" | "muted" {
  if (u === "urgent") return "bad";
  if (u === "overdue") return "warn";
  if (u === "waiting") return "info";
  return "muted";
}

/** Status badge tone per spec: interview=green, responded=blue, else neutral. */
export function followupStatusTone(status: string): "good" | "info" | "muted" {
  const s = status.toLowerCase();
  if (s.includes("interview")) return "good";
  if (s.includes("responded")) return "info";
  return "muted";
}

/** "today" / "tomorrow" / "in N days" / "N days ago" from a daysUntil delta. */
export function relativeDays(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil > 1) return `in ${daysUntil} days`;
  return daysUntil === -1 ? "1 day ago" : `${-daysUntil} days ago`;
}

/** 7/14-day escalation for "days since" cells: amber bold ≥7, red bold ≥14. */
export function daysHeatClass(days: number | null): string {
  if (days == null) return "text-faint";
  if (days >= 14) return "font-bold text-red-600 dark:text-red-400";
  if (days >= 7) return "font-bold text-amber-600 dark:text-amber-400";
  return "";
}

/** Today as YYYY-MM-DD in the user's LOCAL timezone — what a human means by
 *  "today". (toISOString() is UTC: east of UTC it shows yesterday in the
 *  morning; west of UTC it flips early evening.) */
export function localISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True only for a real calendar date in YYYY-MM-DD form (rejects 2026-13-45,
 *  2026-02-31 — regex-valid strings that produce Invalid Date and can crash
 *  date math downstream). */
export function isRealISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Oxford-style join: "A", "A and B", "A, B, and C". */
export function oxfordJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
