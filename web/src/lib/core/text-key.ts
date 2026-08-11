import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";

/**
 * ACL for the core's `normalizeTextKey` (tracker-parse.mjs) — the shared
 * matching/dedup key helper that scan.mjs and tracker-parse.mjs use (#2569).
 *
 * DERIVED, NOT COPIED (#2369, #2666). The web used to reimplement this with
 * `[^a-z0-9]`, which deletes every non-ASCII letter: "Nestlé" keyed to "nestl",
 * "Škoda" to "koda" and "日本電産" to the empty string. Two companies could then
 * collide after stripping and a genuinely new offer got suppressed as "already
 * evaluated" — a job the user never saw, with no signal.
 *
 * We can't `import` it statically: the core lives in the USER's checkout,
 * resolved at runtime via careerOpsRoot(), and is not a build dependency of this
 * app. So we import it dynamically per resolved root and cache the module —
 * keyed by path, and NEVER caching a failure (the lesson from #2590, where a
 * cached fallback pinned stale definitions for the process lifetime).
 *
 * Consequence, by design: the web keys with the normalizeTextKey of the user's
 * OWN core, so web dedup always matches their CLI dedup. Version skew is
 * semantic, and that's the correct behaviour — not a bug to paper over.
 */

type NormalizeTextKey = (value: unknown, separator?: string) => string;

const modCache = new Map<string, NormalizeTextKey>();

/**
 * Last-resort key when the core is absent (a partial checkout, or a data-only
 * install). This IS a copy, and we say so rather than pretending otherwise —
 * but it degrades toward the LEAST destructive shape: Unicode-aware, so it can
 * never reproduce the #2666 bug of silently dropping non-Latin names. Worst
 * case it disagrees with the core about some exotic separator; it will never
 * turn a company name into "".
 */
function fallbackKey(value: unknown, separator = ""): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, separator)
    .trim();
}

let warned = false;

/** Resolve the core's normalizeTextKey for the current root, or the fallback. */
export async function getNormalizeTextKey(): Promise<NormalizeTextKey> {
  const file = path.join(careerOpsRoot(), "tracker-parse.mjs");
  const hit = modCache.get(file);
  if (hit) return hit;
  try {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(file).href);
    const fn = mod?.normalizeTextKey;
    if (typeof fn === "function") {
      modCache.set(file, fn); // only successes are cached (#2590)
      return fn;
    }
    if (!warned) {
      warned = true;
      console.warn(
        `[career-ops] ${file} has no normalizeTextKey export — company matching falls back to a local Unicode-safe key. Update career-ops to keep web dedup identical to CLI dedup.`,
      );
    }
  } catch {
    if (!warned) {
      warned = true;
      console.warn(
        `[career-ops] could not load ${file} — company matching falls back to a local Unicode-safe key. Update career-ops to keep web dedup identical to CLI dedup.`,
      );
    }
  }
  return fallbackKey;
}
