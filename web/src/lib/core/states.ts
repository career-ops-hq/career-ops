import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { CANONICAL_STATES } from "@/lib/format";

/**
 * ACL for templates/states.yml — the SINGLE SOURCE OF TRUTH for canonical
 * application states (career-ops writer + dashboard reader both read it). Per the
 * web↔core contract we READ it live and never hardcode the list.
 *
 * The hand-maintained FALLBACK that used to live here is gone. It promised to be
 * "kept identical to the file" and was not: it shipped without `hired` (#2282)
 * and later drifted 31 aliases behind. The core states the rule outright in
 * followup-cadence.mjs — "a fallback copy is the same copy in disguise and drifts
 * the same way" — and two incidents in this file proved it.
 *
 * The degraded path now derives from CANONICAL_STATES, the list CI already
 * freezes against states.yml (test-all §55.3b). So when states.yml is unreadable
 * we accept exactly what the UI is able to offer — labels only, no aliases —
 * and there is no second list that can drift on its own.
 */
export type CanonicalState = {
  id: string;
  label: string;
  aliases: string[];
  description: string;
  group: string;
};

const FALLBACK: CanonicalState[] = CANONICAL_STATES.map((label) => ({
  id: label.toLowerCase(),
  label,
  aliases: [],
  description: "",
  group: label.toLowerCase(),
}));

/**
 * Cached per resolved states.yml path and keyed on the file's mtime+size (one
 * statSync per call, no full read), mirroring loadHeaderAliases in
 * tracker-table.mjs.
 *
 * A bare `if (cache) return cache` made the "READ it live" contract above true
 * only for the first request a server process ever served: a core update that
 * rewrote templates/states.yml (git pull, update-system.mjs apply) was then
 * invisible until restart, so a newly canonical status was rejected by
 * POST /api/status and a removed one kept being accepted.
 *
 * Failures are NEVER cached, so a states.yml that is momentarily unreadable
 * falls back for that call only, instead of pinning FALLBACK for the lifetime
 * of the process.
 */
const statesCache = new Map<string, { mtimeMs: number; size: number; states: CanonicalState[] }>();

export function readCanonicalStates(): CanonicalState[] {
  const file = path.join(careerOpsRoot(), "templates", "states.yml");
  try {
    const { mtimeMs, size } = fs.statSync(file);
    const cached = statesCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.states;
    const raw = fs.readFileSync(file, "utf8");
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
        statesCache.set(file, { mtimeMs, size, states: parsed });
        return parsed;
      }
    }
    // Readable but unusable (empty/!states) — drop any stale entry so a
    // repaired file is picked up on the next request rather than after a
    // restart, and fall back for this call only.
    statesCache.delete(file);
  } catch {
    /* unreadable — fall back for this call, never cache the failure */
  }
  return FALLBACK;
}

export function canonicalLabels(): string[] {
  return readCanonicalStates().map((s) => s.label);
}

/**
 * Fold a raw status the SAME way the core's foldStatusInput does
 * (tracker-utils.mjs). A bare toLowerCase() is not enough: JS lowercases the
 * Turkish dotted capital `İ` to `i` + U+0307 and the mark survives, so every
 * all-caps Turkish status ("TEKLİF", "KABUL EDİLDİ") missed every alias here
 * while the CLI resolved it — the web answered HTTP 400 for rows the core
 * considered perfectly canonical.
 *
 * NO `NFD`, and that is the whole safety property (5df43e7): NFKC leaves ż, ė
 * and ġ as single precomposed code points this strip cannot reach, while
 * `i` + U+0307 has no precomposed form and stays exposed. Decomposing first
 * looks equivalent and collapses Żubr/Zubr.
 */
function foldStatusInput(input: string): string {
  return String(input ?? "")
    .replace(/\*\*/g, "")
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/̇/gu, "");
}

/** Map any raw status (label/id/alias, case-insensitive) to its canonical label,
 *  or null if unrecognized. */
export function canonicalizeStatus(raw: string): string | null {
  const q = foldStatusInput(raw);
  if (!q) return null;
  for (const s of readCanonicalStates()) {
    if (foldStatusInput(s.label) === q || foldStatusInput(s.id) === q || s.aliases.some((a) => foldStatusInput(a) === q)) {
      return s.label;
    }
  }
  return null;
}
