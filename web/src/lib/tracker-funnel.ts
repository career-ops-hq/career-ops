import { canonStatus } from "@/lib/format";

/** Forward pipeline stages (happy path). */
export const TRACKER_FORWARD = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Hired",
] as const;

function forwardIndex(status: string): number {
  const c = canonStatus(status);
  return TRACKER_FORWARD.findIndex((s) => c === s.toUpperCase());
}

/** Advance one stage on the happy path; reopen terminal rows into Evaluated. */
export function promoteStatus(current: string): string | null {
  const idx = forwardIndex(current);
  if (idx >= 0) {
    if (idx >= TRACKER_FORWARD.length - 1) return null;
    return TRACKER_FORWARD[idx + 1];
  }
  const c = canonStatus(current);
  if (c.includes("REJECTED") || c.includes("DISCARDED") || c.includes("SKIP")) return "Evaluated";
  return null;
}

/** Step back one stage; Evaluated → Discarded; terminal negatives → Evaluated. */
export function demoteStatus(current: string): string | null {
  const idx = forwardIndex(current);
  if (idx > 0) return TRACKER_FORWARD[idx - 1];
  if (idx === 0) return "Discarded";
  const c = canonStatus(current);
  if (c.includes("REJECTED")) return "Applied";
  if (c.includes("DISCARDED") || c.includes("SKIP")) return "Evaluated";
  if (c.includes("HIRED")) return "Offer";
  return null;
}

export function promoteLabel(current: string): string {
  return promoteStatus(current) ?? "—";
}

export function demoteLabel(current: string): string {
  return demoteStatus(current) ?? "—";
}
