/**
 * application-pipeline.mjs — Application pipeline model (FAS 5)
 *
 * Pipeline statuses for the Application Studio, with allowed transitions,
 * history and timestamps. Pure module — no I/O.
 *
 * The existing core pipeline (core/states.ts) is NOT modified; this model maps
 * onto it for display purposes (`coreStatus`) while keeping the richer FAS 5
 * lifecycle (Saved → … → Withdrawn).
 */

export const PIPELINE_STATUSES = [
  { id: "Saved", label: "Saved", description: "Paketet är sparat men inte förberett ännu." },
  { id: "Preparing", label: "Preparing", description: "Meddelanden och CV-version förbereds." },
  { id: "Ready to Apply", label: "Ready to Apply", description: "Allt är granskat och redo att skickas." },
  { id: "Applied", label: "Applied", description: "Ansökan har skickats (av användaren, aldrig automatiskt)." },
  { id: "Recruiter Contact", label: "Recruiter Contact", description: "Rekryterare har kontaktats eller svarat." },
  { id: "Interview", label: "Interview", description: "Intervjuprocess pågår." },
  { id: "Assessment", label: "Assessment", description: "Test eller arbetsprov pågår." },
  { id: "Offer", label: "Offer", description: "Erbjudande har kommit." },
  { id: "Rejected", label: "Rejected", description: "Företaget har tackat nej." },
  { id: "Withdrawn", label: "Withdrawn", description: "Ansökan är återtagen." },
];

/** Forward transitions that are allowed (plus no-op same-status). */
const TRANSITIONS = {
  "Saved": ["Preparing", "Ready to Apply", "Withdrawn"],
  "Preparing": ["Ready to Apply", "Saved", "Withdrawn"],
  "Ready to Apply": ["Applied", "Withdrawn"],
  "Applied": ["Recruiter Contact", "Interview", "Assessment", "Offer", "Rejected", "Withdrawn"],
  "Recruiter Contact": ["Interview", "Assessment", "Offer", "Rejected", "Applied", "Withdrawn"],
  "Interview": ["Assessment", "Offer", "Rejected", "Withdrawn"],
  "Assessment": ["Interview", "Offer", "Rejected", "Withdrawn"],
  "Offer": ["Rejected", "Withdrawn", "Applied"],
  "Rejected": ["Withdrawn"],
  "Withdrawn": [],
};

export function isPipelineStatus(value) {
  return PIPELINE_STATUSES.some((s) => s.id === value);
}

/** Allowed next statuses for a given status (for the UI). */
export function nextPipelineStatuses(status) {
  const next = TRANSITIONS[status] ?? [];
  return next.filter((id) => isPipelineStatus(id));
}

/**
 * Transition a package to a new status, recording history with timestamp.
 * Returns a NEW package object (immutability). Throws on illegal transition.
 */
export function transitionPipeline(pkg, toStatus, now = new Date().toISOString()) {
  if (!isPipelineStatus(toStatus)) throw new Error(`Okänd status: ${toStatus}`);
  const from = pkg.status ?? "Saved";
  if (from === toStatus) return pkg;
  if (!(TRANSITIONS[from] ?? []).includes(toStatus)) {
    throw new Error(`Ogiltig övergång: ${from} → ${toStatus}`);
  }
  return {
    ...pkg,
    status: toStatus,
    history: [
      ...(pkg.history || []),
      { at: now, event: "status-change", status: toStatus, from, to: toStatus },
    ],
    updatedAt: now,
  };
}

/** Map a FAS 5 status to the existing core pipeline status for display. */
export function toCoreStatus(status) {
  switch (status) {
    case "Applied": return "applied";
    case "Recruiter Contact": return "responded";
    case "Interview": return "interview";
    case "Offer": return "offer";
    case "Rejected": return "rejected";
    case "Withdrawn": return "discarded";
    default: return "saved";
  }
}
