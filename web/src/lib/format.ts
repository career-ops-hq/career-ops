// Pure, node-free helpers shared by server and client components (no fs/path
// imports here — career-ops.ts holds the filesystem reads). Aligned with the
// core: normalize-statuses.mjs (aliases) + the Go TUI dashboard (score/status
// colours = the current state-of-the-art).

// Spanish + legacy aliases → canonical English tokens (normalize-statuses.mjs).
const STATUS_ALIAS: Record<string, string> = {
  evaluada: "EVALUATED",
  evaluado: "EVALUATED",
  condicional: "EVALUATED",
  hold: "EVALUATED",
  evaluar: "EVALUATED",
  verificar: "EVALUATED",
  aplicada: "APPLIED",
  aplicado: "APPLIED",
  enviada: "APPLIED",
  sent: "APPLIED",
  respondida: "RESPONDED",
  respondido: "RESPONDED",
  contestada: "RESPONDED",
  entrevista: "INTERVIEW",
  oferta: "OFFER",
  rechazada: "REJECTED",
  rechazado: "REJECTED",
  descartada: "DISCARDED",
  descartado: "DISCARDED",
  cerrada: "DISCARDED",
  cancelada: "DISCARDED",
  duplicado: "DISCARDED",
  repost: "DISCARDED",
  monitor: "SKIP",
  no_aplicar: "SKIP",
  "no aplicar": "SKIP",
};

export const CANONICAL_STATES = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
  "SKIP",
] as const;

export function canonStatus(s: string): string {
  const k = s.trim().toLowerCase();
  if (k === "" || k === "—" || k === "-") return "DISCARDED";
  return STATUS_ALIAS[k] ?? s.toUpperCase();
}

/** Status dot colour, mirroring the Go TUI: green interview/offer, sky applied/
 *  responded, red skip/rejected, gray discarded, neutral evaluated. */
export function statusDot(status: string): string {
  const c = canonStatus(status);
  if (c.includes("INTERVIEW") || c.includes("OFFER")) return "bg-emerald-400";
  if (c.includes("APPLIED") || c.includes("RESPONDED")) return "bg-sky-400";
  if (c.includes("REJECTED") || c.includes("SKIP")) return "bg-red-400";
  if (c.includes("DISCARDED")) return "bg-zinc-600";
  return "bg-zinc-500"; // Evaluated / unknown
}

/** First number in a score string ("4.1/5", "B+", "3.0") → numeric, or NaN. */
export function scoreNum(s: string): number {
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
}

/** Score → tone, mirroring the Go TUI thresholds (>=4.2 green, >=3.8 yellow,
 *  >=3.0 normal, <3.0 red). */
export function scoreTone(score: string): "good" | "warn" | "bad" | "muted" {
  const num = scoreNum(score);
  if (!Number.isNaN(num)) {
    if (num >= 4.2) return "good";
    if (num >= 3.8) return "warn";
    if (num >= 3.0) return "muted";
    return "bad";
  }
  const g = score.trim().toUpperCase()[0];
  if (g === "A") return "good";
  if (g === "B") return "warn";
  if (g === "C") return "muted";
  if (g === "D" || g === "E" || g === "F") return "bad";
  return "muted";
}

/** Block-G legitimacy tier → tone. */
export function legitimacyTone(l: string): "good" | "warn" | "bad" | "muted" {
  const s = l.toLowerCase();
  if (s.includes("high") || s.includes("confian") || s.includes("legit")) return "good";
  if (s.includes("caution") || s.includes("precau") || s.includes("caut")) return "warn";
  if (s.includes("suspic") || s.includes("sospech") || s.includes("scam") || s.includes("fake")) return "bad";
  return "muted";
}

export type ReportMeta = {
  title: string | null;
  fields: { label: string; value: string }[];
  legitimacy: string | null;
  body: string;
};

const FIELD_KEYS: Record<string, string> = {
  date: "Date",
  fecha: "Date",
  url: "URL",
  archetype: "Archetype",
  arquetipo: "Archetype",
  score: "Score",
  legitimacy: "Legitimacy",
  legitimidad: "Legitimacy",
  pdf: "PDF",
};

/**
 * Tolerant report parser (per maintainer: adapt the render, don't migrate the
 * old data). Extracts the bold key/value header fields (Date/URL/Archetype/
 * Score/Legitimacy/PDF) when present and returns the body without the header
 * block. Degrades gracefully on legacy reports that lack some fields.
 */
export function parseReport(md: string): ReportMeta {
  const lines = md.split("\n");
  // Header runs until the first `---` or the first `## ` section.
  let cut = lines.findIndex((l, i) => i > 0 && (/^\s*-{3,}\s*$/.test(l) || /^##\s/.test(l)));
  if (cut === -1) cut = Math.min(lines.length, 10);

  const headerLines = lines.slice(0, cut);
  let bodyStart = cut;
  if (/^\s*-{3,}\s*$/.test(lines[cut] ?? "")) bodyStart = cut + 1;
  const body = lines.slice(bodyStart).join("\n").trim();

  let title: string | null = null;
  let legitimacy: string | null = null;
  const fields: { label: string; value: string }[] = [];

  for (const l of headerLines) {
    const h = l.match(/^#\s+(.+)/);
    if (h) {
      title = h[1].replace(/^Evaluat?i[oó]n:?\s*/i, "").trim();
      continue;
    }
    const m = l.match(/^\s*\*\*(.+?):\*\*\s*(.*)$/);
    if (!m) continue;
    const label = FIELD_KEYS[m[1].trim().toLowerCase()];
    const value = m[2].trim();
    if (!label || !value) continue;
    if (label === "Legitimacy") legitimacy = value;
    fields.push({ label, value });
  }

  return { title, fields, legitimacy, body: body || md };
}
