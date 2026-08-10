import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { DEFAULT_FILTERS, cleanChips, type ExploreFilters } from "@/lib/explore";

/**
 * ACL for portals.yml — the core's scan-filter config (a CONTRACT entry-point,
 * see reference_web_core_sync_protocol). The Explorer NEVER mutates the user's
 * real portals.yml: it writes an EPHEMERAL filter file and points the scanner at
 * it via CAREER_OPS_PORTALS, so an ad-hoc search can't clobber the curated config.
 * We also read the real portals.yml + config/profile.yml (tolerantly) only to
 * SEED sensible defaults for the first search.
 *
 * Filter semantics mirror scan.mjs::buildTitleFilter / buildLocationFilter:
 *   title positive → substring match (empty = everything matches)
 *   title negative → substring reject
 *   location always_allow > block > allow (case-insensitive substring)
 */
type FilterLists = Pick<ExploreFilters, "positive" | "negative" | "allow" | "block" | "alwaysAllow">;

function listFrom(v: unknown): string[] {
  return cleanChips(v);
}

/** Serialize filters into a minimal, valid portals.yml. Scalars go through
 *  JSON.stringify (a valid YAML double-quoted scalar) so arbitrary keywords —
 *  colons, quotes, leading dashes — can never break the document or inject YAML. */
export function serializePortals(f: FilterLists, baseYaml?: string): string {
  let doc: any = {};
  let baseLf: any = null; // location_filter from portals.yml (used as fallback)

  let baseTf: any = null;

  if (baseYaml) {
    try {
      const base = yaml.load(baseYaml) as any;
      if (base && typeof base === "object") {
        // Copy ONLY the non-filter sections (companies, search_queries, job boards, etc.)
        for (const key of Object.keys(base)) {
          if (key !== "title_filter" && key !== "location_filter") {
            doc[key] = base[key];
          }
        }
        // Keep a reference to the saved location_filter as fallback
        if (base.location_filter && typeof base.location_filter === "object") {
          baseLf = base.location_filter;
        }
        if (base.title_filter && typeof base.title_filter === "object") {
          baseTf = base.title_filter;
        }
      }
    } catch {}
  }

  // title_filter: UI always wins
  if (f.positive.length || f.negative.length) {
    baseTf = baseTf || {};
    doc.title_filter = {
      positive: Array.from(new Set([...f.positive, ...(Array.isArray(baseTf.positive) ? baseTf.positive : typeof baseTf.positive === 'string' ? [baseTf.positive] : [])])),
      negative: Array.from(new Set([...f.negative, ...(Array.isArray(baseTf.negative) ? baseTf.negative : typeof baseTf.negative === 'string' ? [baseTf.negative] : [])]))
    };
  }

  // location_filter: UI wins when non-empty; otherwise fall back to portals.yml
  // so the saved "Dónde buscar" config is always the default for zero-config searches.
  if (f.allow.length || f.block.length || f.alwaysAllow.length) {
    doc.location_filter = {
      always_allow: Array.from(new Set([...f.alwaysAllow, ...(Array.isArray(baseLf?.always_allow) ? baseLf.always_allow : typeof baseLf?.always_allow === 'string' ? [baseLf.always_allow] : [])])),
      allow: Array.from(new Set([...f.allow, ...(Array.isArray(baseLf?.allow) ? baseLf.allow : typeof baseLf?.allow === 'string' ? [baseLf.allow] : [])])),
      block: Array.from(new Set([...f.block, ...(Array.isArray(baseLf?.block) ? baseLf.block : typeof baseLf?.block === 'string' ? [baseLf.block] : [])]))
    };
  } else if (baseLf) {
    // No UI override → use the portals.yml location_filter as-is
    doc.location_filter = baseLf;
  }
  // If neither exists → no location restriction (find everything)

  return "# Ephemeral Explorer filters — generated per-search, safe to delete.\n" + yaml.dump(doc);
}



/** Write the ephemeral filter file to a temp path; caller cleans it up. */
export function writeTempPortals(f: FilterLists): string {
  const file = path.join(os.tmpdir(), `career-ops-explore-${randomUUID()}.yml`);
  let base = "";
  try {
    base = fs.readFileSync(path.join(careerOpsRoot(), "portals.yml"), "utf8");
  } catch {}
  fs.writeFileSync(file, serializePortals(f, base), "utf8");
  return file;
}

export function cleanupTempPortals(file: string): void {
  try {
    if (file.startsWith(os.tmpdir()) && file.includes("career-ops-explore-")) fs.unlinkSync(file);
  } catch {
    /* best-effort */
  }
}

function loadYaml(rel: string): Record<string, unknown> | null {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), rel), "utf8"));
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Tolerantly seed first-search defaults from the user's real config. Reads
 * portals.yml (title_filter / location_filter) and falls back to
 * config/profile.yml (target_roles, location) for the positive keywords when
 * portals has none. Never throws — a bare checkout just yields DEFAULT_FILTERS.
 */
export function seedExploreFilters(): { filters: ExploreFilters; seededFrom: string[] } {
  const filters: ExploreFilters = { ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats] };
  const seededFrom: string[] = [];

  const portals = loadYaml("portals.yml");
  if (portals) {
    const tf = (portals.title_filter ?? {}) as Record<string, unknown>;
    const lf = (portals.location_filter ?? {}) as Record<string, unknown>;
    filters.positive = listFrom(tf.positive);
    filters.negative = listFrom(tf.negative);
    filters.allow = listFrom(lf.allow);
    filters.block = listFrom(lf.block);
    filters.alwaysAllow = listFrom(lf.always_allow);
    if (filters.positive.length || filters.allow.length || filters.block.length) seededFrom.push("portals.yml");
  }

  const profile = loadYaml("config/profile.yml");
  if (profile) {
    if (filters.positive.length === 0) {
      const roles = (profile.target_roles ?? {}) as Record<string, unknown>;
      const fromRoles = listFrom([
        ...(Array.isArray(roles.primary) ? roles.primary : typeof roles.primary === "string" ? [roles.primary] : []),
        ...(Array.isArray(roles.archetypes) ? roles.archetypes.map((a: any) => typeof a === 'object' && a !== null ? a.name : a) : []),
      ]);
      if (fromRoles.length) {
        filters.positive = fromRoles;
        if (!seededFrom.includes("profile.yml")) seededFrom.push("profile.yml");
      }
    }

    if (filters.allow.length === 0) {
      const loc = (profile.location ?? {}) as Record<string, unknown>;
      const fromLoc = listFrom([
        ...(typeof loc.country === "string" ? [loc.country] : []),
        ...(Array.isArray(loc.authorized_in) ? loc.authorized_in : [])
      ]);
      if (fromLoc.length) {
        filters.allow = Array.from(new Set(fromLoc));
        if (!seededFrom.includes("profile.yml")) seededFrom.push("profile.yml");
      }
    }
  }

  return { filters, seededFrom };
}

export { listFrom as normalizeKeywords };
