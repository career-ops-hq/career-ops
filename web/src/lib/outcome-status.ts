/** Tracker states routed through outcome.mjs (shared by client + server). */
export const OUTCOME_STATUSES = {
  Rejected: "rejected",
  Interview: "interview_progress",
  Offer: "offer_received",
  Hired: "hired",
} as const;

export type OutcomeStatus = keyof typeof OUTCOME_STATUSES;

export function outcomeTypeForStatus(status: string): string | null {
  return OUTCOME_STATUSES[status as OutcomeStatus] ?? null;
}

export function usesOutcomePipeline(status: string): boolean {
  return status in OUTCOME_STATUSES;
}
