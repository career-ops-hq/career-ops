import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";

/**
 * ACL for templates/states.yml — the SINGLE SOURCE OF TRUTH for canonical
 * application states (career-ops writer + dashboard reader both read it). Per the
 * web↔core contract we READ it live and never hardcode the list (the maintainer
 * once mis-listed it from memory — the file had one more). The FALLBACK below is
 * only a last resort if the file is unreadable, and is kept identical to the file.
 */
export type CanonicalState = {
  id: string;
  label: string;
  aliases: string[];
  description: string;
  group: string;
};

const FALLBACK: CanonicalState[] = [
  { id: "evaluated", label: "Evaluated", aliases: ["evaluada"], description: "Offer evaluated with report, pending decision", group: "evaluated" },
  { id: "applied", label: "Applied", aliases: ["aplicado", "enviada", "aplicada", "sent"], description: "Application submitted", group: "applied" },
  { id: "responded", label: "Responded", aliases: ["respondido"], description: "Company has responded (not yet interview)", group: "responded" },
  { id: "interview", label: "Interview", aliases: ["entrevista"], description: "Active interview process", group: "interview" },
  { id: "offer", label: "Offer", aliases: ["oferta"], description: "Offer received", group: "offer" },
  { id: "rejected", label: "Rejected", aliases: ["rechazado", "rechazada"], description: "Rejected by company", group: "rejected" },
  { id: "discarded", label: "Discarded", aliases: ["descartado", "descartada", "cerrada", "cancelada"], description: "Discarded by candidate or offer closed", group: "discarded" },
  { id: "skip", label: "SKIP", aliases: ["no_aplicar", "no aplicar", "skip", "monitor"], description: "Doesn't fit, don't apply", group: "skip" },
];

let cache: CanonicalState[] | null = null;

export function readCanonicalStates(): CanonicalState[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(path.join(careerOpsRoot(), "templates", "states.yml"), "utf8");
    const doc = yaml.load(raw) as { states?: unknown };
    const list = Array.isArray(doc?.states) ? doc.states : null;
    if (list && list.length) {
      const parsed: CanonicalState[] = [];
      for (const s of list as Record<string, unknown>[]) {
        if (!s || typeof s.label !== "string") continue;
        parsed.push({
          id: typeof s.id === "string" ? s.id : s.label.toLowerCase(),
          label: s.label,
          aliases: Array.isArray(s.aliases) ? s.aliases.filter((a): a is string => typeof a === "string") : [],
          description: typeof s.description === "string" ? s.description : "",
          group: typeof s.dashboard_group === "string" ? s.dashboard_group : (typeof s.id === "string" ? s.id : s.label.toLowerCase()),
        });
      }
      if (parsed.length) {
        cache = parsed;
        return parsed;
      }
    }
  } catch {
    /* fall through to fallback */
  }
  cache = FALLBACK;
  return FALLBACK;
}

export function canonicalLabels(): string[] {
  return readCanonicalStates().map((s) => s.label);
}

/** Map any raw status (label/id/alias, case-insensitive) to its canonical label,
 *  or null if unrecognized. */
export function canonicalizeStatus(raw: string): string | null {
  const q = raw.trim().toLowerCase().replace(/\*\*/g, "");
  if (!q) return null;
  for (const s of readCanonicalStates()) {
    if (s.label.toLowerCase() === q || s.id.toLowerCase() === q || s.aliases.some((a) => a.toLowerCase() === q)) {
      return s.label;
    }
  }
  return null;
}
